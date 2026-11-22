import type { DesktopBridge } from "@t3tools/contracts";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import {
  applyMacUnlockConfirm,
  readMacUnlockConfirm,
  resetMacUnlockConfirmForTests,
  respondMacUnlockConfirm,
  runMacUnlockTask,
  startMacUnlockConfirmQueue,
} from "./macUnlock";

beforeEach(() => {
  resetMacUnlockConfirmForTests();
});

describe("runMacUnlockTask", () => {
  it("does not relock when unlock is denied", async () => {
    let worked = false;
    let relocked = false;
    const bridge = {
      macUnlock: {
        unlockForTask: async () => ({ ok: false as const, reason: "denied" }),
        relockIfAbandoned: async () => {
          relocked = true;
          return { ok: true as const, relocked: true };
        },
      },
    } as unknown as DesktopBridge;

    await expect(
      runMacUnlockTask(async () => {
        worked = true;
        return "done";
      }, bridge),
    ).resolves.toEqual({ ok: false, reason: "denied" });
    expect(worked).toBe(false);
    expect(relocked).toBe(false);
  });

  it("relocks after the task, including when the task throws", async () => {
    const calls: string[] = [];
    const bridge = {
      macUnlock: {
        unlockForTask: async () => {
          calls.push("unlock");
          return { ok: true as const };
        },
        relockIfAbandoned: async () => {
          calls.push("relock");
          return { ok: true as const, relocked: true };
        },
      },
    } as unknown as DesktopBridge;

    await expect(
      runMacUnlockTask(async () => {
        calls.push("work");
        return 1;
      }, bridge),
    ).resolves.toEqual({ ok: true, value: 1 });
    await expect(
      runMacUnlockTask(async () => {
        calls.push("fail");
        throw new Error("task failed");
      }, bridge),
    ).rejects.toThrow("task failed");
    expect(calls).toEqual(["unlock", "work", "relock", "unlock", "fail", "relock"]);
  });
});

describe("unlock confirm queue", () => {
  it("answers the open prompt and drops a settled one", async () => {
    const answers: Array<{ id: string; approved: boolean }> = [];
    const bridge = {
      macUnlock: {
        onUnlockConfirm: (listener: (event: { id: string; open: boolean }) => void) => {
          listener({ id: "prompt-1", open: true });
          return () => undefined;
        },
        respondToUnlock: async (id: string, approved: boolean) => {
          answers.push({ id, approved });
        },
      },
    } as unknown as DesktopBridge;

    startMacUnlockConfirmQueue(bridge);
    expect(readMacUnlockConfirm()).toEqual({ id: "prompt-1" });
    applyMacUnlockConfirm({ id: "prompt-1", open: false });
    expect(readMacUnlockConfirm()).toBeNull();

    applyMacUnlockConfirm({ id: "prompt-2", open: true });
    await respondMacUnlockConfirm(true);
    expect(answers).toEqual([{ id: "prompt-2", approved: true }]);
    expect(readMacUnlockConfirm()).toBeNull();
  });

  it("deny does not approve", async () => {
    const answers: boolean[] = [];
    applyMacUnlockConfirm({ id: "prompt-3", open: true });
    const bridge = {
      macUnlock: {
        onUnlockConfirm: () => () => undefined,
        respondToUnlock: async (_id: string, approved: boolean) => {
          answers.push(approved);
        },
      },
    } as unknown as DesktopBridge;
    startMacUnlockConfirmQueue(bridge);
    await respondMacUnlockConfirm(false);
    expect(answers).toEqual([false]);
  });
});
