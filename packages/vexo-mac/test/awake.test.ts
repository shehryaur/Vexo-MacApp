import * as NodeAssert from "node:assert/strict";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import * as NodeTest from "node:test";
import { setRunForTests, type RunResult } from "../src/exec.ts";
import {
  awakeStatus,
  cutoffReason,
  parseBattery,
  parseThermal,
  resetAwakeForTests,
  setAwake,
  setAwakeClockForTests,
  setAwakePlatformForTests,
  setAwakeSpawnerForTests,
  type AwakeChild,
} from "../src/awake.ts";

const AC_80 = `Now drawing from 'AC Power'\n -InternalBattery-0 (id=1)\t80%; charging; 0:20 remaining present: true\n`;
const BATT_10 = `Now drawing from 'Battery Power'\n -InternalBattery-0 (id=1)\t10%; discharging; 1:00 remaining present: true\n`;
const NOMINAL = "Note: No thermal warning level has been recorded\n";
const CRITICAL = "Thermal warning level: critical\n";

let battery = AC_80;
let thermal = NOMINAL;
let settings = " SleepDisabled\t\t0\n";
const spawned: string[] = [];
let killed = 0;

function powerResult(args: readonly string[]): RunResult {
  if (args.includes("batt")) return { code: 0, stdout: battery, stderr: "" };
  if (args.includes("therm")) return { code: 0, stdout: thermal, stderr: "" };
  return { code: 0, stdout: settings, stderr: "" };
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

NodeTest.afterEach(() => {
  resetAwakeForTests();
  setRunForTests(null);
  battery = AC_80;
  thermal = NOMINAL;
  settings = " SleepDisabled\t\t0\n";
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

NodeTest.test("hold spawns caffeinate and never the root helper", async () => {
  setAwakePlatformForTests("darwin");
  setRunForTests(async (_command, args) => powerResult(args));
  setAwakeSpawnerForTests((command, args) => {
    spawned.push([command, ...args].join(" "));
    return fakeChild();
  });
  const status = await setAwake(true);
  NodeAssert.equal(status.active, true);
  NodeAssert.equal(status.mode, "user-space");
  NodeAssert.equal(spawned.length, 1);
  NodeAssert.match(spawned[0] ?? "", /^\/usr\/bin\/caffeinate -dims -w \d+$/);
  NodeAssert.doesNotMatch(spawned[0] ?? "", /sleepdisabled|awake-root-helper/);
  NodeAssert.match(status.detail, /closed lid on battery still sleeps/);
});

NodeTest.test("a low battery refuses the hold and a later drop releases it", async () => {
  setAwakePlatformForTests("darwin");
  setRunForTests(async (_command, args) => powerResult(args));
  setAwakeSpawnerForTests((command, args) => {
    spawned.push([command, ...args].join(" "));
    return fakeChild();
  });
  battery = BATT_10;
  const refused = await setAwake(true);
  NodeAssert.equal(refused.active, false);
  NodeAssert.equal(spawned.length, 0);
  NodeAssert.match(refused.detail, /low-battery/);

  battery = AC_80;
  NodeAssert.equal((await setAwake(true)).active, true);
  battery = BATT_10;
  const released = await awakeStatus();
  NodeAssert.equal(released.active, false);
  NodeAssert.equal(killed, 1);
  NodeAssert.match(released.detail, /low-battery/);
});

NodeTest.test("a critical thermal reading and the 7-day cap release the hold", async () => {
  setAwakePlatformForTests("darwin");
  setRunForTests(async (_command, args) => powerResult(args));
  setAwakeSpawnerForTests(() => fakeChild());
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

NodeTest.test("turning the hold off stops caffeinate", async () => {
  setAwakePlatformForTests("darwin");
  setRunForTests(async (_command, args) => powerResult(args));
  setAwakeSpawnerForTests(() => fakeChild());
  await setAwake(true);
  const status = await setAwake(false);
  NodeAssert.equal(status.active, false);
  NodeAssert.equal(killed, 1);
  NodeAssert.match(status.detail, /user-space hold is off/);
});

NodeTest.test(
  "the root helper scaffold refuses to run and only documents the cutoffs",
  async () => {
    const script = NodePath.join(
      NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)),
      "../scripts/awake-root-helper.sh",
    );
    const text = await NodeFSP.readFile(script, "utf8");
    NodeAssert.match(text, /SAFETY/);
    NodeAssert.match(text, /batteryFloor/);
    NodeAssert.match(text, /604800/);
    const code = text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#"));
    NodeAssert.deepEqual(code, ["exit 64"]);
  },
);

NodeTest.test("non-mac platforms stay off", async () => {
  setAwakePlatformForTests("linux");
  const status = await setAwake(true);
  NodeAssert.equal(status.active, false);
  NodeAssert.match(status.detail, /macOS/);
});
