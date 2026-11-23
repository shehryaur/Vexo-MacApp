import * as NodeAssert from "node:assert/strict";
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeTest from "node:test";
import { setRunForTests, type RunResult } from "../src/exec.ts";
import {
  awakeStatus,
  checkLidForTests,
  cutoffReason,
  parseBattery,
  parseThermal,
  removeLidClosedSetup,
  resetAwakeForTests,
  RESTORE_AGENT_LABEL,
  setAwake,
  setAwakeClockForTests,
  setAwakePathsForTests,
  setAwakePlatformForTests,
  setAwakeSpawnerForTests,
  SUDOERS_PATH,
  sudoersRule,
  type AwakeChild,
} from "../src/awake.ts";

const AC_80 = `Now drawing from 'AC Power'\n -InternalBattery-0 (id=1)\t80%; charging; 0:20 remaining present: true\n`;
const BATT_10 = `Now drawing from 'Battery Power'\n -InternalBattery-0 (id=1)\t10%; discharging; 1:00 remaining present: true\n`;
const NOMINAL = "Note: No thermal warning level has been recorded\n";
const CRITICAL = "Thermal warning level: critical\n";

let battery = AC_80;
let thermal = NOMINAL;
let ready = true;
let lid = "No";
let osaCode = 0;
let osaStderr = "";
let stagedRule: string | null = null;
let root = "";
const calls: string[] = [];
const spawned: Array<{ line: string; detached: boolean }> = [];
let killed = 0;

function fakeRun(command: string, args: readonly string[]): RunResult {
  const line = [command, ...args].join(" ");
  calls.push(line);
  if (command === "/usr/bin/sudo" && args.includes("-l")) {
    return { code: ready ? 0 : 1, stdout: "", stderr: "" };
  }
  if (command === "/usr/bin/sudo") return { code: 0, stdout: "", stderr: "" };
  if (command === "/usr/bin/osascript") {
    const shell = args[args.length - 1] ?? "";
    const staged = shell.match(/visudo -cf (\S+)/)?.[1];
    if (staged) stagedRule = NodeFS.readFileSync(staged, "utf8");
    if (osaCode === 0 && staged) ready = true;
    return { code: osaCode, stdout: "", stderr: osaStderr };
  }
  if (command === "/usr/sbin/ioreg") {
    return { code: 0, stdout: `  "AppleClamshellState" = ${lid}\n`, stderr: "" };
  }
  if (args.includes("batt")) return { code: 0, stdout: battery, stderr: "" };
  if (args.includes("therm")) return { code: 0, stdout: thermal, stderr: "" };
  return { code: 0, stdout: " SleepDisabled\t\t0\n", stderr: "" };
}

function fakeChild(): AwakeChild {
  return {
    pid: 42,
    kill() {
      killed += 1;
    },
    onExit() {},
  };
}

function marker(): string {
  return NodePath.join(root, "support", "lid-closed-hold.json");
}

function agent(): string {
  return NodePath.join(root, "agents", `${RESTORE_AGENT_LABEL}.plist`);
}

async function onMac(): Promise<void> {
  root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "vexo-awake-test-"));
  setAwakePlatformForTests("darwin");
  setAwakePathsForTests({
    supportDir: NodePath.join(root, "support"),
    launchAgentsDir: NodePath.join(root, "agents"),
    tmpDir: root,
  });
  setRunForTests(async (command, args) => fakeRun(command, args));
  setAwakeSpawnerForTests((command, args, options) => {
    spawned.push({ line: [command, ...args].join(" "), detached: options?.detached === true });
    calls.push(`spawn ${command}`);
    return fakeChild();
  });
}

NodeTest.afterEach(async () => {
  resetAwakeForTests();
  setRunForTests(null);
  if (root) await NodeFSP.rm(root, { recursive: true, force: true });
  root = "";
  battery = AC_80;
  thermal = NOMINAL;
  ready = true;
  lid = "No";
  osaCode = 0;
  osaStderr = "";
  stagedRule = null;
  calls.length = 0;
  spawned.length = 0;
  killed = 0;
});

NodeTest.test("cutoff reasons follow the battery, heat, and 7-day caps", () => {
  const startedAt = 1_000;
  NodeAssert.equal(
    cutoffReason({ batteryPercent: 19, thermal: "nominal", startedAt, now: startedAt }),
    "The battery reached your low-battery limit.",
  );
  NodeAssert.equal(
    cutoffReason({ batteryPercent: null, thermal: "nominal", startedAt, now: startedAt }),
    "The battery level could not be read, so sleep was turned back on.",
  );
  NodeAssert.equal(
    cutoffReason({ batteryPercent: 80, thermal: "critical", startedAt, now: startedAt }),
    "Your Mac got too hot, so sleep was turned back on.",
  );
  NodeAssert.equal(
    cutoffReason({
      batteryPercent: 80,
      thermal: "nominal",
      startedAt,
      now: startedAt + 604_800_000,
    }),
    "The 7-day hold cap ended, so sleep was restored.",
  );
  NodeAssert.equal(
    cutoffReason({ batteryPercent: 20, thermal: "fair", startedAt, now: startedAt + 1_000 }),
    null,
  );
});

NodeTest.test("pmset text parses battery source and thermal words", () => {
  NodeAssert.deepEqual(parseBattery(AC_80), { batteryPercent: 80, onExternalPower: true });
  NodeAssert.deepEqual(parseBattery(BATT_10), { batteryPercent: 10, onExternalPower: false });
  NodeAssert.equal(parseThermal(NOMINAL), "nominal");
  NodeAssert.equal(parseThermal(CRITICAL), "critical");
  NodeAssert.equal(parseThermal(""), "unknown");
});

NodeTest.test("the sudoers rule allows only the two disablesleep commands", () => {
  NodeAssert.equal(
    sudoersRule("alice")
      .split("\n")
      .filter((line) => line && !line.startsWith("#"))
      .join("\n"),
    "alice ALL=(root) NOPASSWD: /usr/bin/pmset -a disablesleep 0, /usr/bin/pmset -a disablesleep 1",
  );
});

NodeTest.test("lid-closed disables sleep only after the watchdog is running", async () => {
  await onMac();
  const status = await setAwake(true);
  NodeAssert.equal(status.active, true);
  NodeAssert.equal(status.mode, "lid-closed");
  NodeAssert.equal(status.lidClosedReady, true);
  const watchdogAt = calls.indexOf("spawn /bin/sh");
  const disableAt = calls.indexOf("/usr/bin/sudo -n /usr/bin/pmset -a disablesleep 1");
  NodeAssert.ok(watchdogAt >= 0 && disableAt > watchdogAt);
  NodeAssert.equal(spawned[0]?.detached, true);
  NodeAssert.ok(spawned[0]?.line.includes(marker()));
  NodeAssert.ok(NodeFS.existsSync(marker()));
  const plist = await NodeFSP.readFile(agent(), "utf8");
  NodeAssert.match(plist, /disablesleep 0/);
  NodeAssert.match(plist, /RunAtLoad/);
  NodeAssert.match(status.detail, /stays awake with the lid closed/);
});

NodeTest.test("turning lid-closed off turns sleep back on and clears the marker", async () => {
  await onMac();
  await setAwake(true);
  const status = await setAwake(false);
  NodeAssert.equal(status.active, false);
  NodeAssert.ok(calls.includes("/usr/bin/sudo -n /usr/bin/pmset -a disablesleep 0"));
  NodeAssert.equal(NodeFS.existsSync(marker()), false);
  NodeAssert.equal(killed, 1);
});

NodeTest.test("the first use installs the rule through one admin prompt", async () => {
  await onMac();
  ready = false;
  const status = await setAwake(true);
  NodeAssert.equal(status.mode, "lid-closed");
  const prompt = calls.find((line) => line.startsWith("/usr/bin/osascript")) ?? "";
  NodeAssert.match(prompt, /with administrator privileges/);
  NodeAssert.match(prompt, /\/usr\/sbin\/visudo -cf /);
  NodeAssert.ok(
    prompt.endsWith(`/bin/mv -f ${prompt.match(/visudo -cf (\S+)/)?.[1]} ${SUDOERS_PATH}`),
  );
  NodeAssert.equal(stagedRule, sudoersRule(NodeOS.userInfo().username));
});

NodeTest.test("a canceled password prompt falls back to caffeinate", async () => {
  await onMac();
  ready = false;
  osaCode = 1;
  osaStderr = "execution error: User canceled. (-128)";
  const status = await setAwake(true);
  NodeAssert.equal(status.mode, "user-space");
  NodeAssert.match(spawned[0]?.line ?? "", /^\/usr\/bin\/caffeinate -dims -w \d+$/);
  NodeAssert.ok(!calls.includes("/usr/bin/sudo -n /usr/bin/pmset -a disablesleep 1"));
  NodeAssert.match(status.detail, /canceled/);
  NodeAssert.match(status.detail, /closed lid still sleeps/);
});

NodeTest.test("sleep is never disabled without a watchdog", async () => {
  await onMac();
  setAwakeSpawnerForTests((command) => {
    if (command === "/bin/sh") throw new Error("spawn failed");
    return fakeChild();
  });
  const status = await setAwake(true);
  NodeAssert.equal(status.mode, "user-space");
  NodeAssert.ok(!calls.includes("/usr/bin/sudo -n /usr/bin/pmset -a disablesleep 1"));
  NodeAssert.equal(NodeFS.existsSync(marker()), false);
});

NodeTest.test("a low battery refuses the hold and a later drop turns sleep back on", async () => {
  await onMac();
  battery = BATT_10;
  const refused = await setAwake(true);
  NodeAssert.equal(refused.active, false);
  NodeAssert.equal(spawned.length, 0);
  NodeAssert.match(refused.detail, /low-battery/);

  battery = AC_80;
  NodeAssert.equal((await setAwake(true)).mode, "lid-closed");
  battery = BATT_10;
  const released = await awakeStatus();
  NodeAssert.equal(released.active, false);
  NodeAssert.ok(calls.includes("/usr/bin/sudo -n /usr/bin/pmset -a disablesleep 0"));
  NodeAssert.match(released.detail, /low-battery/);
});

NodeTest.test("critical heat and the 7-day cap turn sleep back on", async () => {
  await onMac();
  let now = 5_000;
  setAwakeClockForTests(() => now);
  NodeAssert.equal((await setAwake(true)).active, true);
  thermal = CRITICAL;
  const hot = await awakeStatus();
  NodeAssert.equal(hot.active, false);
  NodeAssert.match(hot.detail, /too hot/);

  thermal = NOMINAL;
  NodeAssert.equal((await setAwake(true)).active, true);
  now += 604_800_000;
  const capped = await awakeStatus();
  NodeAssert.equal(capped.active, false);
  NodeAssert.match(capped.detail, /7-day/);
});

NodeTest.test("a marker left by a crashed run turns sleep back on at startup", async () => {
  await onMac();
  await NodeFSP.mkdir(NodePath.dirname(marker()), { recursive: true });
  await NodeFSP.writeFile(marker(), JSON.stringify({ pid: 1, startedAt: 0 }));
  const status = await awakeStatus();
  NodeAssert.ok(calls.includes("/usr/bin/sudo -n /usr/bin/pmset -a disablesleep 0"));
  NodeAssert.equal(NodeFS.existsSync(marker()), false);
  NodeAssert.match(status.detail, /ended unexpectedly/);
});

NodeTest.test("closing the lid turns the built-in display off once", async () => {
  await onMac();
  await setAwake(true);
  lid = "Yes";
  await checkLidForTests();
  await checkLidForTests();
  NodeAssert.equal(calls.filter((line) => line === "/usr/bin/pmset displaysleepnow").length, 1);
});

NodeTest.test("removing the setup deletes the rule and the login agent", async () => {
  await onMac();
  await setAwake(true);
  const status = await removeLidClosedSetup();
  NodeAssert.equal(status.active, false);
  NodeAssert.ok(calls.includes("/usr/bin/sudo -n /usr/bin/pmset -a disablesleep 0"));
  NodeAssert.ok(calls.some((line) => line.endsWith(`/bin/rm -f ${SUDOERS_PATH}`)));
  NodeAssert.equal(NodeFS.existsSync(agent()), false);
  NodeAssert.match(status.detail, /removed/);
});

NodeTest.test("non-mac platforms stay off", async () => {
  setAwakePlatformForTests("linux");
  const status = await setAwake(true);
  NodeAssert.equal(status.active, false);
  NodeAssert.match(status.detail, /macOS/);
});
