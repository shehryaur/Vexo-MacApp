/* oxlint-disable t3code/no-global-process-runtime -- Plain Node for this Mac host. HostProcess is an Effect service and does not fit here. */
// @effect-diagnostics nodeBuiltinImport:off globalTimers:off
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { run } from "./exec.ts";

// Lid-closed hold: `pmset -a disablesleep 1` through a sudoers rule that allows only that
// command. A detached watchdog and a login agent turn sleep back on after a crash, hang or restart.
// Without the rule it falls back to caffeinate, which macOS ignores when the lid closes.

export const BATTERY_FLOOR = 20;
export const MAX_HOLD_MS = 604_800_000;
export const SUDOERS_PATH = "/etc/sudoers.d/vexomacapp-awake";
export const RESTORE_AGENT_LABEL = "com.t3tools.vexomacapp.awake-restore";
const POLL_MS = 20_000;
const LID_POLL_MS = 5_000;
const WATCHDOG_STALE_SECONDS = 90;
const PROMPT_TIMEOUT_MS = 180_000;
const SUDO = "/usr/bin/sudo";
const PMSET = "/usr/bin/pmset";
const SAFE_PATH = /^[A-Za-z0-9/._-]+$/;
const SAFE_USER = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/;
const PROMPT = "VexoMacApp needs your password once to keep this Mac awake with the lid closed.";

// Exits quietly once the marker is gone (a normal stop). Otherwise it turns sleep back on
// when the app process is gone or has not touched the heartbeat file for too long.
const WATCHDOG_SCRIPT = `pid=$1; beat=$2; mark=$3; stale=$4
while [ -f "$mark" ]; do
  sleep 5
  [ -f "$mark" ] || exit 0
  kill -0 "$pid" 2>/dev/null || break
  age=$(( $(date +%s) - $(stat -f %m "$beat" 2>/dev/null || echo 0) ))
  [ "$age" -gt "$stale" ] && break
done
[ -f "$mark" ] || exit 0
${SUDO} -n ${PMSET} -a disablesleep 0 && /bin/rm -f "$mark"`;

export type Thermal = "nominal" | "fair" | "serious" | "critical" | "unknown";
export type AwakeMode = "off" | "user-space" | "lid-closed";

export type AwakeStatus = {
  active: boolean;
  mode: AwakeMode;
  lidClosedReady: boolean;
  sleepDisabled: boolean;
  batteryPercent: number | null;
  onExternalPower: boolean | null;
  thermal: Thermal;
  detail: string;
};

type Power = {
  sleepDisabled: boolean;
  batteryPercent: number | null;
  onExternalPower: boolean | null;
  thermal: Thermal;
};

export type AwakeChild = {
  kill: (signal?: NodeJS.Signals) => void;
  readonly pid: number | null;
  onExit: (cb: () => void) => void;
};

type SpawnOptions = { readonly detached?: boolean };
type Spawner = (command: string, args: readonly string[], options?: SpawnOptions) => AwakeChild;

type Paths = {
  supportDir: string;
  launchAgentsDir: string;
  tmpDir: string;
};

type LiveHold = {
  mode: "user-space" | "lid-closed";
  child: AwakeChild | null;
  startedAt: number;
  timer: ReturnType<typeof setInterval>;
  lidTimer: ReturnType<typeof setInterval> | null;
  lidClosed: boolean;
  intentionalStop: boolean;
};

const LID_DETAIL =
  "Lid-closed is on. This Mac stays awake with the lid closed, even on battery. Sleep comes back under 20% battery, when it runs hot, after 7 days, or if this app quits.";
const USER_SPACE_DETAIL =
  "Holding with caffeinate only. Idle sleep is blocked, but a closed lid still sleeps.";
const OFF_READY = "Lid-closed is off.";
const OFF_SETUP =
  "Lid-closed is off. The first time you turn it on, macOS asks for your password once.";

let platform: NodeJS.Platform = process.platform;
let clock: () => number = () => Date.now();
let spawner: Spawner = defaultSpawn;
let paths: Paths = defaultPaths();
let hold: LiveHold | null = null;
let releaseReason: string | null = null;
let fallbackReason: string | null = null;
let recovered = false;

export function cutoffReason(input: {
  batteryPercent: number | null;
  thermal: Thermal;
  startedAt: number;
  now: number;
}): string | null {
  if (input.now - input.startedAt >= MAX_HOLD_MS) {
    return "The 7-day hold cap ended, so sleep was restored.";
  }
  if (input.thermal === "critical") {
    return "Your Mac got too hot, so sleep was turned back on.";
  }
  if (input.batteryPercent === null) {
    return "The battery level could not be read, so sleep was turned back on.";
  }
  if (input.batteryPercent < BATTERY_FLOOR) {
    return "The battery reached your low-battery limit.";
  }
  return null;
}

export function parseBattery(text: string): {
  batteryPercent: number | null;
  onExternalPower: boolean | null;
} {
  const source = text.match(/Now drawing from '([^']+)'/);
  const onExternalPower = source ? /ac power/i.test(source[1] ?? "") : null;
  const percentMatch = text.match(/(\d+)%/);
  const percent = percentMatch ? Number(percentMatch[1]) : null;
  return {
    batteryPercent: percent !== null && percent >= 0 && percent <= 100 ? percent : null,
    onExternalPower,
  };
}

export function parseThermal(text: string): Thermal {
  const lower = text.toLowerCase();
  if (lower.trim() === "") return "unknown";
  if (/\bcritical\b/.test(lower)) return "critical";
  if (/\bserious\b/.test(lower)) return "serious";
  if (/no thermal warning/.test(lower)) return "nominal";
  if (/\bwarning\b/.test(lower) || /\bfair\b/.test(lower)) return "fair";
  return "unknown";
}

/** The sudoers rule installed once. It permits exactly two commands and nothing else. */
export function sudoersRule(user: string): string {
  return [
    "# VexoMacApp lid-closed mode. Allows only these two commands. Delete this file to revoke.",
    `${user} ALL=(root) NOPASSWD: ${PMSET} -a disablesleep 0, ${PMSET} -a disablesleep 1`,
    "",
  ].join("\n");
}

export async function awakeStatus(): Promise<AwakeStatus> {
  if (platform !== "darwin") return inactive("Lid-closed hold runs on macOS.");
  await recoverStaleHold();
  if (hold) await enforce();
  return build(await readPower(), await lidClosedReady());
}

export async function setAwake(active: boolean): Promise<AwakeStatus> {
  if (platform !== "darwin") return awakeStatus();
  await recoverStaleHold();
  if (!active) {
    await stopHold(null);
    return awakeStatus();
  }
  if (hold) return awakeStatus();
  const power = await readPower();
  const now = clock();
  const blocked = cutoffReason({
    batteryPercent: power.batteryPercent,
    thermal: power.thermal,
    startedAt: now,
    now,
  });
  if (blocked) {
    releaseReason = blocked;
    return build(power, await lidClosedReady());
  }
  fallbackReason = await ensureLidClosedRule();
  if (fallbackReason === null) {
    if (await startLidClosedHold()) return awakeStatus();
    fallbackReason = "Sleep could not be disabled safely, so only caffeinate is holding.";
  }
  startUserSpaceHold();
  return awakeStatus();
}

/** Removes the sudoers rule (one more password prompt) and the login restore agent. */
export async function removeLidClosedSetup(): Promise<AwakeStatus> {
  if (platform !== "darwin") return awakeStatus();
  if (hold?.mode === "lid-closed") await stopHold(null);
  await NodeFSP.rm(agentPath(), { force: true });
  if (await lidClosedReady()) {
    const removed = await adminShell(`/bin/rm -f ${SUDOERS_PATH}`);
    if (removed.code !== 0) {
      releaseReason = "The lid-closed permission was not removed.";
      return awakeStatus();
    }
  }
  releaseReason = "The lid-closed permission was removed.";
  return awakeStatus();
}

export function setAwakeSpawnerForTests(next: Spawner | null): void {
  spawner = next ?? defaultSpawn;
}

export function setAwakePlatformForTests(next: NodeJS.Platform | null): void {
  platform = next ?? process.platform;
}

export function setAwakeClockForTests(next: (() => number) | null): void {
  clock = next ?? (() => Date.now());
}

export function setAwakePathsForTests(next: Partial<Paths> | null): void {
  paths = next === null ? defaultPaths() : { ...defaultPaths(), ...next };
}

export async function checkLidForTests(): Promise<void> {
  await checkLid();
}

export function resetAwakeForTests(): void {
  const current = hold;
  if (current) {
    clearInterval(current.timer);
    if (current.lidTimer) clearInterval(current.lidTimer);
  }
  hold = null;
  releaseReason = null;
  fallbackReason = null;
  recovered = false;
  spawner = defaultSpawn;
  platform = process.platform;
  clock = () => Date.now();
  paths = defaultPaths();
}

function defaultPaths(): Paths {
  const home = NodeOS.homedir();
  return {
    supportDir: NodePath.join(home, "Library", "Application Support", "VexoMac"),
    launchAgentsDir: NodePath.join(home, "Library", "LaunchAgents"),
    tmpDir: NodeOS.tmpdir(),
  };
}

function markerPath(): string {
  return NodePath.join(paths.supportDir, "lid-closed-hold.json");
}

function heartbeatPath(): string {
  return NodePath.join(paths.supportDir, "lid-closed-heartbeat");
}

function agentPath(): string {
  return NodePath.join(paths.launchAgentsDir, `${RESTORE_AGENT_LABEL}.plist`);
}

async function lidClosedReady(): Promise<boolean> {
  const listed = await run(SUDO, ["-n", "-l", PMSET, "-a", "disablesleep", "1"], undefined, 5_000);
  return listed.code === 0;
}

function sudoPmset(value: 0 | 1) {
  return run(SUDO, ["-n", PMSET, "-a", "disablesleep", String(value)], undefined, 10_000);
}

function adminShell(command: string) {
  return run(
    "/usr/bin/osascript",
    [
      "-e",
      "on run argv",
      "-e",
      `do shell script (item 1 of argv) with prompt "${PROMPT}" with administrator privileges`,
      "-e",
      "end run",
      command,
    ],
    undefined,
    PROMPT_TIMEOUT_MS,
  );
}

/** Returns null when the rule works, otherwise why the hold falls back to caffeinate. */
async function ensureLidClosedRule(): Promise<string | null> {
  if (await lidClosedReady()) return null;
  const user = NodeOS.userInfo().username;
  if (!SAFE_USER.test(user)) return "This account name cannot be used in the sudoers rule.";
  const dir = await NodeFSP.mkdtemp(NodePath.join(paths.tmpDir, "vexo-awake-"));
  const staged = NodePath.join(dir, "sudoers");
  try {
    if (!SAFE_PATH.test(staged)) return "The staging path is not safe for the password prompt.";
    await NodeFSP.writeFile(staged, sudoersRule(user), { mode: 0o600 });
    const installed = await adminShell(
      `/usr/sbin/visudo -cf ${staged} && /usr/sbin/chown root:wheel ${staged} && /bin/chmod 0440 ${staged} && /bin/mv -f ${staged} ${SUDOERS_PATH}`,
    );
    if (installed.code !== 0) {
      return /-128|cancel/i.test(installed.stderr)
        ? "The password prompt was canceled, so only caffeinate is holding."
        : "The lid-closed permission could not be installed, so only caffeinate is holding.";
    }
  } finally {
    await NodeFSP.rm(dir, { recursive: true, force: true });
  }
  return (await lidClosedReady())
    ? null
    : "The lid-closed permission did not take effect, so only caffeinate is holding.";
}

async function startLidClosedHold(): Promise<boolean> {
  const startedAt = clock();
  await NodeFSP.mkdir(paths.supportDir, { recursive: true });
  await NodeFSP.writeFile(markerPath(), JSON.stringify({ pid: process.pid, startedAt }));
  await touchHeartbeat();
  let watchdog: AwakeChild | null = null;
  try {
    watchdog = spawner(
      "/bin/sh",
      [
        "-c",
        WATCHDOG_SCRIPT,
        "vexo-awake-watchdog",
        String(process.pid),
        heartbeatPath(),
        markerPath(),
        String(WATCHDOG_STALE_SECONDS),
      ],
      { detached: true },
    );
  } catch {
    watchdog = null;
  }
  // No watchdog means a crash could leave sleep off, so never disable sleep without one.
  if (!watchdog || (await sudoPmset(1)).code !== 0) {
    watchdog?.kill("SIGTERM");
    await NodeFSP.rm(markerPath(), { force: true });
    return false;
  }
  await writeRestoreAgent().catch(() => undefined);
  const timer = setInterval(() => {
    void touchHeartbeat();
    void enforce();
  }, POLL_MS);
  timer.unref();
  const lidTimer = setInterval(() => {
    void checkLid();
  }, LID_POLL_MS);
  lidTimer.unref();
  hold = {
    mode: "lid-closed",
    child: watchdog,
    startedAt,
    timer,
    lidTimer,
    lidClosed: false,
    intentionalStop: false,
  };
  releaseReason = null;
  return true;
}

function startUserSpaceHold(): void {
  let child: AwakeChild;
  try {
    child = spawner("/usr/bin/caffeinate", ["-dims", "-w", String(process.pid)]);
  } catch {
    releaseReason = "caffeinate is not available.";
    return;
  }
  const timer = setInterval(() => {
    void enforce();
  }, POLL_MS);
  timer.unref();
  const next: LiveHold = {
    mode: "user-space",
    child,
    startedAt: clock(),
    timer,
    lidTimer: null,
    lidClosed: false,
    intentionalStop: false,
  };
  hold = next;
  releaseReason = null;
  child.onExit(() => {
    if (hold !== next || next.intentionalStop) return;
    clearInterval(next.timer);
    hold = null;
    if (!releaseReason) releaseReason = "The caffeinate hold ended.";
  });
}

async function enforce(): Promise<void> {
  const current = hold;
  if (!current) return;
  const power = await readPower();
  const reason = cutoffReason({
    batteryPercent: power.batteryPercent,
    thermal: power.thermal,
    startedAt: current.startedAt,
    now: clock(),
  });
  if (reason) await stopHold(reason);
}

async function stopHold(reason: string | null): Promise<void> {
  releaseReason = reason;
  fallbackReason = null;
  const current = hold;
  if (!current) return;
  current.intentionalStop = true;
  clearInterval(current.timer);
  if (current.lidTimer) clearInterval(current.lidTimer);
  hold = null;
  if (current.mode === "user-space") {
    current.child?.kill("SIGTERM");
    return;
  }
  if ((await sudoPmset(0)).code !== 0) {
    // Keep the marker so the watchdog and the login agent keep trying.
    releaseReason = `Sleep could not be turned back on. Run: sudo ${PMSET} -a disablesleep 0`;
    return;
  }
  await NodeFSP.rm(markerPath(), { force: true });
  current.child?.kill("SIGTERM");
}

/** A marker left by a crashed process means sleep may still be disabled. */
async function recoverStaleHold(): Promise<void> {
  if (recovered) return;
  recovered = true;
  if (hold) return;
  try {
    await NodeFSP.access(markerPath());
  } catch {
    return;
  }
  if ((await sudoPmset(0)).code !== 0) return;
  await NodeFSP.rm(markerPath(), { force: true });
  releaseReason = "Sleep was turned back on after the last lid-closed hold ended unexpectedly.";
}

async function checkLid(): Promise<void> {
  const current = hold;
  if (!current || current.mode !== "lid-closed") return;
  const out = await run(
    "/usr/sbin/ioreg",
    ["-r", "-k", "AppleClamshellState", "-d", "4"],
    undefined,
    5_000,
  );
  const closed = /"AppleClamshellState"\s*=\s*Yes/.test(out.stdout);
  // With sleep disabled the built-in panel can stay lit under the lid, so turn it off.
  if (closed && !current.lidClosed) await run(PMSET, ["displaysleepnow"], undefined, 5_000);
  current.lidClosed = closed;
}

async function touchHeartbeat(): Promise<void> {
  await NodeFSP.writeFile(heartbeatPath(), String(clock())).catch(() => undefined);
}

async function writeRestoreAgent(): Promise<void> {
  const mark = markerPath();
  if (mark.includes("'")) return;
  const script = `[ -f '${mark}' ] && ${SUDO} -n ${PMSET} -a disablesleep 0 && /bin/rm -f '${mark}'; exit 0`;
  const plist = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    "<dict>",
    `  <key>Label</key><string>${RESTORE_AGENT_LABEL}</string>`,
    "  <key>ProgramArguments</key>",
    `  <array><string>/bin/sh</string><string>-c</string><string>${xmlEscape(script)}</string></array>`,
    "  <key>RunAtLoad</key><true/>",
    "</dict>",
    "</plist>",
    "",
  ].join("\n");
  await NodeFSP.mkdir(paths.launchAgentsDir, { recursive: true });
  await NodeFSP.writeFile(agentPath(), plist);
}

function xmlEscape(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

async function readPower(): Promise<Power> {
  const [settings, batt, therm] = await Promise.all([
    run(PMSET, ["-g"]),
    run(PMSET, ["-g", "batt"]),
    run(PMSET, ["-g", "therm"]),
  ]);
  const battery = parseBattery(batt.code === 0 ? batt.stdout : "");
  return {
    sleepDisabled: /sleepdisabled\s+1\b/i.test(settings.stdout),
    batteryPercent: battery.batteryPercent,
    onExternalPower: battery.onExternalPower,
    thermal: therm.code === 0 ? parseThermal(therm.stdout) : "unknown",
  };
}

function build(power: Power, ready: boolean): AwakeStatus {
  const mode = hold?.mode ?? "off";
  let detail: string;
  if (mode === "lid-closed") {
    detail = LID_DETAIL;
  } else if (mode === "user-space") {
    detail = fallbackReason ? `${fallbackReason} A closed lid still sleeps.` : USER_SPACE_DETAIL;
  } else if (releaseReason) {
    detail = releaseReason;
  } else if (power.sleepDisabled) {
    detail = "Lid-closed is off here, but system sleep is disabled outside this app.";
  } else {
    detail = ready ? OFF_READY : OFF_SETUP;
  }
  return {
    active: mode !== "off",
    mode,
    lidClosedReady: ready,
    sleepDisabled: power.sleepDisabled,
    batteryPercent: power.batteryPercent,
    onExternalPower: power.onExternalPower,
    thermal: power.thermal,
    detail: detail.slice(0, 400),
  };
}

function inactive(detail: string): AwakeStatus {
  return {
    active: false,
    mode: "off",
    lidClosedReady: false,
    sleepDisabled: false,
    batteryPercent: null,
    onExternalPower: null,
    thermal: "unknown",
    detail,
  };
}

function defaultSpawn(
  command: string,
  args: readonly string[],
  options?: SpawnOptions,
): AwakeChild {
  const detached = options?.detached === true;
  const child = NodeChildProcess.spawn(command, args, { stdio: "ignore", detached });
  if (detached) child.unref();
  const listeners: Array<() => void> = [];
  let exited = false;
  const note = () => {
    if (exited) return;
    exited = true;
    for (const listener of listeners) listener();
  };
  child.once("exit", note);
  child.once("error", note);
  return {
    pid: child.pid ?? null,
    kill: (signal) => {
      if (!child.killed) child.kill(signal);
    },
    onExit: (cb) => {
      if (exited) cb();
      else listeners.push(cb);
    },
  };
}
