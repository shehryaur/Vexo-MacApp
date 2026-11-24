import * as NodeAssert from "node:assert/strict";
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeTest from "node:test";
import { helperScript, setRunForTests } from "../src/exec.ts";
import { captureFrame } from "../src/screen.ts";
import {
  resetUnlockForTests,
  setSupportDirForTests,
  setUnlockInProgressForTests,
} from "../src/unlock.ts";

NodeTest.beforeEach(async () => {
  setSupportDirForTests(await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "vexo-mac-screen-")));
});

NodeTest.afterEach(() => {
  resetUnlockForTests();
  setRunForTests(null);
});

NodeTest.test("frames are redacted during unlock and while the session is locked", async () => {
  let captures = 0;
  setRunForTests(async (command, args) => {
    if (command.endsWith("screencapture") || args[1] === "blank-host-capture") {
      captures += 1;
      throw new Error("capture must not run");
    }
    throw new Error("lock probe must not run while unlock is in progress");
  });
  setUnlockInProgressForTests(true);
  NodeAssert.deepEqual(await captureFrame(), { redacted: true });
  NodeAssert.equal(captures, 0);

  setUnlockInProgressForTests(false);
  setRunForTests(async (command, args) => {
    if (command.endsWith("screencapture") || args[1] === "blank-host-capture") {
      captures += 1;
      throw new Error("capture must not run");
    }
    if (args[1] === "locked") return { code: 0, stdout: '{"ok":true,"locked":true}\n', stderr: "" };
    throw new Error("unexpected command");
  });
  NodeAssert.deepEqual(await captureFrame(), { redacted: true });
  NodeAssert.equal(captures, 0);
});

NodeTest.test("an unlocked session returns a jpeg path and not the bytes", async () => {
  setUnlockInProgressForTests(false);
  setRunForTests(async (command, args) => {
    if (args[1] === "locked")
      return { code: 0, stdout: '{"ok":true,"locked":false}\n', stderr: "" };
    if (command.endsWith("screencapture")) {
      const imagePath = args[args.length - 1];
      if (!imagePath) throw new Error("missing path");
      await NodeFSP.writeFile(imagePath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
      return { code: 0, stdout: "", stderr: "" };
    }
    if (args[1] === "blank-host-capture") {
      return { code: 0, stdout: '{"ok":true}\n', stderr: "" };
    }
    throw new Error("unexpected command");
  });
  const frame = await captureFrame();
  NodeAssert.ok(!("redacted" in frame));
  NodeAssert.ok("imagePath" in frame);
  NodeAssert.match(frame.imagePath, /\.jpg$/);
  await NodeFSP.rm(frame.imagePath, { force: true });
});

NodeTest.test("the helper script stays next to the package when the module url moves", () => {
  NodeAssert.equal(NodeFS.existsSync(helperScript()), true);
  NodeAssert.match(helperScript(), /mac-helper\.swift$/);
});
