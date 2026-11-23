import { describe, expect, it } from "vite-plus/test";

import {
  askBeforeUnlockFromStored,
  createUnlockConfirmations,
  decideUnlock,
  settleAgentUnlockPrompt,
  type UnlockConfirmEvent,
} from "./macUnlock.ts";

describe("ask before unlock", () => {
  it("asks unless the stored flag is exactly false", () => {
    expect(askBeforeUnlockFromStored(null)).toBe(true);
    expect(askBeforeUnlockFromStored("")).toBe(true);
    expect(askBeforeUnlockFromStored("{")).toBe(true);
    expect(askBeforeUnlockFromStored("{}")).toBe(true);
    expect(askBeforeUnlockFromStored('{"askBeforeUnlock":true}')).toBe(true);
    expect(askBeforeUnlockFromStored('{"askBeforeUnlock":"false"}')).toBe(true);
    expect(askBeforeUnlockFromStored('{"askBeforeUnlock":false}')).toBe(false);
  });
});

describe("decideUnlock", () => {
  it("does not unlock when the person denies the prompt", async () => {
    let unlocked = false;
    const result = await decideUnlock({
      askBeforeUnlock: true,
      confirm: async () => false,
      unlockConfirmed: async () => {
        unlocked = true;
        return { ok: true };
      },
    });
    expect(result).toEqual({ ok: false, reason: "denied" });
    expect(unlocked).toBe(false);
  });

  it("unlocks only after approval when asking is on", async () => {
    const result = await decideUnlock({
      askBeforeUnlock: true,
      confirm: async () => true,
      unlockConfirmed: async () => ({ ok: true }),
    });
    expect(result).toEqual({ ok: true });
  });

  it("unlocks without a prompt when asking is off", async () => {
    let asked = false;
    const result = await decideUnlock({
      askBeforeUnlock: false,
      confirm: async () => {
        asked = true;
        return false;
      },
      unlockConfirmed: async () => ({ ok: false, reason: "not_locked" }),
    });
    expect(asked).toBe(false);
    expect(result).toEqual({ ok: false, reason: "not_locked" });
  });
});

describe("settleAgentUnlockPrompt", () => {
  it("does not unlock when the person denies or the prompt is already gone", async () => {
    let unlocked = false;
    const unlockConfirmed = async () => {
      unlocked = true;
      return { ok: true as const };
    };
    await expect(
      settleAgentUnlockPrompt({ approved: false, stillPending: true, unlockConfirmed }),
    ).resolves.toEqual({ ok: false, reason: "denied" });
    await expect(
      settleAgentUnlockPrompt({ approved: true, stillPending: false, unlockConfirmed }),
    ).resolves.toEqual({ ok: false, reason: "timed_out" });
    expect(unlocked).toBe(false);
  });

  it("unlocks only after the dialog is approved and the prompt is still waiting", async () => {
    const result = await settleAgentUnlockPrompt({
      approved: true,
      stillPending: true,
      unlockConfirmed: async () => ({ ok: true }),
    });
    expect(result).toEqual({ ok: true });
  });
});

describe("unlock confirmations", () => {
  it("closes the prompt and resolves deny", async () => {
    const events: UnlockConfirmEvent[] = [];
    const confirmations = createUnlockConfirmations(5_000);
    const pending = confirmations.request((event) => {
      events.push(event);
    });
    const id = events[0]?.id;
    expect(id).toEqual(expect.any(String));
    expect(events[0]).toEqual({ id, open: true });
    confirmations.respond(id ?? "", false);
    await expect(pending).resolves.toBe(false);
    expect(events[1]).toEqual({ id, open: false });
  });

  it("denies when the prompt times out", async () => {
    const confirmations = createUnlockConfirmations(15);
    await expect(confirmations.request(() => undefined)).resolves.toBe(false);
  });
});
