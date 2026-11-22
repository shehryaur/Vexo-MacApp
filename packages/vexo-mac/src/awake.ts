/* oxlint-disable t3code/no-global-process-runtime -- Plain Node for this Mac host. HostProcess is an Effect service and does not fit here. */
// @effect-diagnostics nodeBuiltinImport:off globalTimers:off
import * as NodeChildProcess from "node:child_process";
import { run } from "./exec.ts";

/**
 * User-space caffeinate hold. Never calls a private power API, never runs
 * `pmset sleepdisabled`, and never spawns `scripts/awake-root-helper.sh`.
 * A closed lid on battery still sleeps. Cutoffs: battery under 20%, critical
 * thermal, unreadable battery, or a hold longer than 7 days.
 */

export const BATTERY_FLOOR = 20;
export const MAX_HOLD_MS = 604_800_000;
const POLL_MS = 20_000;

export type Thermal = "nominal" | "fair" | "serious" | "critical" | "unknown";
export type AwakeMode = "off" | "user-space";

export type AwakeStatus = {
  active: boolean;
  mode: AwakeMode;
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

type AwakeChild = {
  kill: (signal?: NodeJS.Signals) => void;
  readonly pid: number | null;
  onExit: (cb: () => void) => void;
};

type Spawner = (command: string, args: readonly string[]) => AwakeChild;

type LiveHold = {
  child: AwakeChild;
  startedAt: number;
  timer: ReturnType<typeof setInterval>;
  intentionalStop: boolean;
};

const OFF_DETAIL =
  "The user-space hold is off. caffeinate can block idle sleep. A closed lid on battery still sleeps.";
const HOLD_DETAIL =
  "Holding with caffeinate. Idle sleep is blocked. A closed lid on battery still sleeps.";

let platform: NodeJS.Platform = process.platform;
let clock: () => number = () => Date.now();
let spawner: Spawner = defaultSpawn;
let hold: LiveHold | null = null;
let releaseReason: string | null = null;

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

export async function awakeStatus(): Promise<AwakeStatus> {
  if (platform !== "darwin") return inactive("Lid-closed hold runs on macOS.");
  if (hold) await enforce();
  return build(await readPower());
}

export async function setAwake(active: boolean): Promise<AwakeStatus> {
  if (platform !== "darwin") return awakeStatus();
  if (!active) {
    stopHold(null);
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
    return build(power);
  }
  startHold();
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

export function resetAwakeForTests(): void {
  stopHold(null);
  releaseReason = null;
  spawner = defaultSpawn;
  platform = process.platform;
  clock = () => Date.now();
}

function startHold(): void {
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
    child,
    startedAt: clock(),
    timer,
    intentionalStop: false,
  };
  hold = next;
  releaseReason = null;
  child.onExit(() => {
    if (hold !== next || next.intentionalStop) return;
    clearInterval(next.timer);
    hold = null;
    if (!releaseReason) releaseReason = "The user-space hold ended.";
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
  if (reason) stopHold(reason);
}

function stopHold(reason: string | null): void {
  releaseReason = reason;
  const current = hold;
  if (!current) return;
  current.intentionalStop = true;
  clearInterval(current.timer);
  hold = null;
  current.child.kill("SIGTERM");
}

async function readPower(): Promise<Power> {
  const [settings, batt, therm] = await Promise.all([
    run("/usr/bin/pmset", ["-g"]),
    run("/usr/bin/pmset", ["-g", "batt"]),
    run("/usr/bin/pmset", ["-g", "therm"]),
  ]);
  const battery = parseBattery(batt.code === 0 ? batt.stdout : "");
  return {
    sleepDisabled: /sleepdisabled\s+1\b/i.test(settings.stdout),
    batteryPercent: battery.batteryPercent,
    onExternalPower: battery.onExternalPower,
    thermal: therm.code === 0 ? parseThermal(therm.stdout) : "unknown",
  };
}

function build(power: Power): AwakeStatus {
  const active = hold !== null;
  let detail: string;
  if (active) {
    detail = power.sleepDisabled ? `${HOLD_DETAIL} System sleep is already disabled.` : HOLD_DETAIL;
  } else if (releaseReason) {
    detail = releaseReason;
  } else if (power.sleepDisabled) {
    detail = "The user-space hold is off. System sleep is already disabled outside this app.";
  } else {
    detail = OFF_DETAIL;
  }
  return {
    active,
    mode: active ? "user-space" : "off",
    sleepDisabled: power.sleepDisabled,
    batteryPercent: power.batteryPercent,
    onExternalPower: power.onExternalPower,
    thermal: power.thermal,
    detail,
  };
}

function inactive(detail: string): AwakeStatus {
  return {
    active: false,
    mode: "off",
    sleepDisabled: false,
    batteryPercent: null,
    onExternalPower: null,
    thermal: "unknown",
    detail,
  };
}

function defaultSpawn(command: string, args: readonly string[]): AwakeChild {
  const child = NodeChildProcess.spawn(command, args, { stdio: "ignore" });
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
