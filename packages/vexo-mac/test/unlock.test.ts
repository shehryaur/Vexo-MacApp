import * as NodeAssert from "node:assert/strict";
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeTest from "node:test";
import { setRunForTests } from "../src/exec.ts";
import { acquire, release, resetLeaseForTests } from "../src/lease.ts";
import {
  askBeforeUnlockFromStored,
  isUnlockInProgress,
  readAskBeforeUnlock,
  readPendingUnlockPrompt,
  relock,
  relockIfAbandoned,
  requestUnlockConfirmation,
  resetUnlockForTests,
  savePassword,
  setRelockBinForTests,
  setSupportDirForTests,
  setUnlockInProgressForTests,
  setUnlockWaitForTests,
  unlock,
  writeAskBeforeUnlock,
  writeUnlockDecision,
} from "../src/unlock.ts";

NodeTest.beforeEach(async () => {
  setSupportDirForTests(await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "vexo-mac-ask-")));
});

NodeTest.afterEach(() => {
  resetUnlockForTests();
  resetLeaseForTests();
  setRunForTests(null);
});

NodeTest.test("ask before unlock defaults on and only false turns it off", async () => {
  NodeAssert.equal(askBeforeUnlockFromStored(null), true);
  NodeAssert.equal(askBeforeUnlockFromStored('{"askBeforeUnlock":false}'), false);
  const dir = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "vexo-mac-ask-"));
  setSupportDirForTests(dir);
  NodeAssert.equal(await readAskBeforeUnlock(), true);
  await writeAskBeforeUnlock(false);
  NodeAssert.equal(await readAskBeforeUnlock(), false);
  NodeAssert.equal(
    JSON.parse(await NodeFSP.readFile(NodePath.join(dir, "mac-unlock.json"), "utf8"))
      .askBeforeUnlock,
    false,
  );
});

NodeTest.test("unlock does nothing until the caller confirms", async () => {
  setRunForTests(async () => {
    throw new Error("unlock must not touch the system before confirmation");
  });
  NodeAssert.deepEqual(await unlock(), { ok: false, reason: "confirmation_required" });
  NodeAssert.deepEqual(await unlock({ confirmed: false }), {
    ok: false,
    reason: "confirmation_required",
  });
  NodeAssert.equal(isUnlockInProgress(), false);
});

NodeTest.test("a confirmed unlock on an open session does not read the keychain", async () => {
  setRunForTests(async (command, args) => {
    if (command.endsWith("security")) throw new Error("password was read");
    if (args[1] === "locked")
      return { code: 0, stdout: '{"ok":true,"locked":false}\n', stderr: "" };
    throw new Error("unexpected command");
  });
  NodeAssert.deepEqual(await unlock({ confirmed: true }), { ok: false, reason: "not_locked" });
});

NodeTest.test("a reported password mismatch is not saved", async () => {
  const commands: string[] = [];
  setRunForTests(async (command, args) => {
    commands.push(args[1] ?? command);
    if (args[1] === "verify")
      return { code: 1, stdout: '{"ok":false,"reason":"mismatch"}\n', stderr: "" };
    throw new Error("security must not run");
  });
  NodeAssert.deepEqual(await savePassword("not-a-login-password"), {
    ok: false,
    reason: "password_mismatch",
  });
  NodeAssert.deepEqual(commands, ["verify"]);
});

NodeTest.test("an abandoned unlock marker relocks only when the lease is gone", async () => {
  const dir = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "vexo-mac-unlock-"));
  setSupportDirForTests(dir);
  setRelockBinForTests(NodePath.join(dir, "missing-CGSession"));
  const marker = NodePath.join(dir, "unlock.json");
  await NodeFSP.writeFile(
    marker,
    JSON.stringify({ unlocked: true, at: "2026-11-22T00:00:00.000Z" }),
    { mode: 0o600 },
  );
  let runs = 0;
  setRunForTests(async () => {
    runs += 1;
    return { code: 1, stdout: "", stderr: "not_found" };
  });

  acquire("thread-a");
  NodeAssert.deepEqual(await relockIfAbandoned(), { ok: true, relocked: false });
  NodeAssert.equal(runs, 0);
  NodeAssert.equal(JSON.parse(await NodeFSP.readFile(marker, "utf8")).unlocked, true);

  release("thread-a");
  NodeAssert.deepEqual(await relockIfAbandoned(), { ok: false, reason: "relock_unavailable" });
  NodeAssert.equal(runs, 1);
  NodeAssert.equal(JSON.parse(await NodeFSP.readFile(marker, "utf8")).unlocked, true);
});

NodeTest.test("relock uses CGSession -suspend when that binary exists", async () => {
  const dir = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "vexo-mac-unlock-"));
  setSupportDirForTests(dir);
  const bin = NodePath.join(dir, "CGSession");
  await NodeFSP.writeFile(bin, "", { mode: 0o755 });
  setRelockBinForTests(bin);
  const commands: string[] = [];
  setRunForTests(async (command, args) => {
    commands.push([command, ...args].join(" "));
    return { code: 0, stdout: "", stderr: "" };
  });
  NodeAssert.deepEqual(await relock(), { ok: true, relocked: true });
  NodeAssert.deepEqual(commands, [`${bin} -suspend`]);
});

NodeTest.test("a confirmed unlock is visible to other processes until it finishes", async () => {
  const dir = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "vexo-mac-unlock-"));
  setSupportDirForTests(dir);
  let visibleAcrossProcesses = false;
  setRunForTests(async (command, args) => {
    if (args[1] === "locked") return { code: 0, stdout: '{"ok":true,"locked":true}\n', stderr: "" };
    if (command.endsWith("security")) return { code: 0, stdout: "secret\n", stderr: "" };
    if (args[1] === "lock-type") {
      const marker = NodePath.join(dir, "unlocking.json");
      setUnlockInProgressForTests(false);
      visibleAcrossProcesses = NodeFS.existsSync(marker) && isUnlockInProgress();
      return { code: 0, stdout: '{"ok":true}\n', stderr: "" };
    }
    throw new Error(`unexpected ${command} ${args.join(" ")}`);
  });
  NodeAssert.deepEqual(await unlock({ confirmed: true }), { ok: true });
  NodeAssert.equal(visibleAcrossProcesses, true);
  NodeAssert.equal(isUnlockInProgress(), false);
  NodeAssert.equal(NodeFS.existsSync(NodePath.join(dir, "unlocking.json")), false);
});

NodeTest.test("a missing CGSession locks with Control-Command-Q", async () => {
  const dir = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "vexo-mac-unlock-"));
  setSupportDirForTests(dir);
  setRelockBinForTests(NodePath.join(dir, "missing-CGSession"));
  const commands: string[][] = [];
  setRunForTests(async (command, args) => {
    commands.push([command, ...args]);
    return { code: 0, stdout: "", stderr: "" };
  });
  NodeAssert.deepEqual(await relock(), { ok: true, relocked: true });
  NodeAssert.deepEqual(commands, [
    [
      "/usr/bin/osascript",
      "-e",
      'tell application "System Events" to keystroke "q" using {control down, command down}',
    ],
  ]);
});

NodeTest.test("unlock confirmation writes prompt and resolves upon decision", async () => {
  const dir = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "vexo-mac-prompt-"));
  setSupportDirForTests(dir);
  setRunForTests(async () => {
    throw new Error("requestUnlockConfirmation must not unlock");
  });

  let releaseHold = () => {};
  const holding = new Promise<void>((resolve) => {
    setUnlockWaitForTests({
      wait: () =>
        new Promise((release) => {
          releaseHold = release;
          resolve();
        }),
    });
  });
  const confirmPromise = requestUnlockConfirmation(2_000);
  await holding;

  const prompt = await readPendingUnlockPrompt();
  NodeAssert.ok(prompt);
  NodeAssert.equal(typeof prompt.id, "string");

  await writeUnlockDecision(prompt.id, { ok: true });
  releaseHold();
  const result = await confirmPromise;
  NodeAssert.deepEqual(result, { ok: true });
});

NodeTest.test("a denied unlock confirmation does not approve", async () => {
  const dir = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "vexo-mac-prompt-"));
  setSupportDirForTests(dir);
  setRunForTests(async () => {
    throw new Error("requestUnlockConfirmation must not unlock");
  });
  let releaseHold = () => {};
  const holding = new Promise<void>((resolve) => {
    setUnlockWaitForTests({
      wait: () =>
        new Promise((release) => {
          releaseHold = release;
          resolve();
        }),
    });
  });
  const confirmPromise = requestUnlockConfirmation(2_000);
  await holding;
  const prompt = await readPendingUnlockPrompt();
  NodeAssert.ok(prompt);
  await writeUnlockDecision(prompt.id, { ok: false, reason: "denied" });
  releaseHold();
  NodeAssert.deepEqual(await confirmPromise, { ok: false, reason: "denied" });
});

NodeTest.test("unlock confirmation times out when no decision is written", async () => {
  const dir = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "vexo-mac-prompt-"));
  setSupportDirForTests(dir);

  let clock = 0;
  setUnlockWaitForTests({
    now: () => clock,
    wait: async () => {
      clock += 1_000;
    },
  });
  const result = await requestUnlockConfirmation(100);
  NodeAssert.deepEqual(result, { ok: false, reason: "timed_out" });
});
