import * as NodeAssert from "node:assert/strict";
import * as NodeTest from "node:test";
import { click, isPasswordField, typeText } from "../src/act.ts";
import { setRunForTests, type Runner } from "../src/exec.ts";
import { acquire, release, resetLeaseForTests } from "../src/lease.ts";

NodeTest.afterEach(() => {
  resetLeaseForTests();
  setRunForTests(null);
});

NodeTest.test("password fields are refused and no input is posted", async () => {
  const calls: string[] = [];
  const runner: Runner = async (_command, args) => {
    calls.push(args[1] ?? "");
    return { code: 0, stdout: '{"ok":true}\n', stderr: "" };
  };
  setRunForTests(runner);

  NodeAssert.equal(isPasswordField({ role: "AXSecureTextField" }), true);
  NodeAssert.equal(isPasswordField({ role: "AXTextField", subrole: "AXSecureTextField" }), true);
  NodeAssert.equal(isPasswordField({ role: "AXTextField", title: "Password" }), true);
  NodeAssert.equal(isPasswordField({ role: "AXButton", title: "Submit" }), false);

  const lockedOut = await click("thread-a", { x: 1, y: 2 }, { role: "AXSecureTextField" });
  NodeAssert.deepEqual(lockedOut, { ok: false, reason: "lease_required" });

  acquire("thread-a");
  const byRole = await click(
    "thread-a",
    { x: 1, y: 2 },
    { role: "AXSecureTextField", windowId: 9 },
  );
  const byTitle = await typeText("thread-a", "secret", { title: "Passcode" });
  NodeAssert.deepEqual(byRole, { ok: false, reason: "password_field" });
  NodeAssert.deepEqual(byTitle, { ok: false, reason: "password_field" });
  NodeAssert.deepEqual(calls, []);

  const posted = await click(
    "thread-a",
    { x: 4, y: 5 },
    { role: "AXButton", title: "Submit", windowId: 9 },
  );
  NodeAssert.deepEqual(posted, { ok: true });
  NodeAssert.deepEqual(calls, ["click"]);
  release("thread-a");
});
