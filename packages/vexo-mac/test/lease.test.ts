import * as NodeAssert from "node:assert/strict";
import * as NodeTest from "node:test";
import {
  abort,
  acquire,
  current,
  LEASE_IDLE_MS,
  release,
  resetLeaseForTests,
  setLeaseNowForTests,
  touch,
} from "../src/lease.ts";

NodeTest.afterEach(() => {
  resetLeaseForTests();
});

NodeTest.test("one thread holds the desktop lease", () => {
  const first = acquire("thread-a");
  NodeAssert.deepEqual(first, { ok: true, owner: "thread-a" });
  const second = acquire("thread-b");
  NodeAssert.deepEqual(second, { ok: false, reason: "held", owner: "thread-a" });
  NodeAssert.equal(current()?.owner, "thread-a");
  NodeAssert.deepEqual(release("thread-b"), { ok: false, reason: "not_holder", owner: "thread-a" });
  NodeAssert.deepEqual(release("thread-a"), { ok: true });
  NodeAssert.equal(current(), null);
  NodeAssert.deepEqual(acquire("thread-b"), { ok: true, owner: "thread-b" });
});

NodeTest.test("the lease expires after 120 seconds idle and abort clears it", () => {
  let clock = 1_000_000;
  setLeaseNowForTests(() => clock);
  NodeAssert.equal(acquire("thread-a").ok, true);
  clock += LEASE_IDLE_MS - 1;
  NodeAssert.equal(touch("thread-a"), true);
  clock += LEASE_IDLE_MS - 1;
  NodeAssert.equal(acquire("thread-b").ok, false);
  clock += 1;
  NodeAssert.equal(current(), null);
  NodeAssert.deepEqual(acquire("thread-b"), { ok: true, owner: "thread-b" });
  NodeAssert.deepEqual(abort(), { owner: "thread-b" });
  NodeAssert.equal(current(), null);
  NodeAssert.equal(touch("thread-b"), false);
  NodeAssert.equal(acquire("").ok, false);
});
