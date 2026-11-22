// @effect-diagnostics globalTimers:off cryptoRandomUUID:off -- The unlock prompt waits on the app window, then resolves the pending call. Prompt ids are minted outside an Effect runtime.
import { askBeforeUnlockFromStored } from "@t3tools/vexo-mac";

export type MacUnlockDecisionResult = { ok: true } | { ok: false; reason: string };

export interface UnlockConfirmEvent {
  readonly id: string;
  readonly open: boolean;
}

export { askBeforeUnlockFromStored };

/**
 * Asks when the setting is on, then calls `unlockConfirmed` only after approval.
 * `unlockConfirmed` is the only path that may call `unlock({ confirmed: true })`.
 */
export async function decideUnlock(input: {
  readonly askBeforeUnlock: boolean;
  readonly confirm: () => Promise<boolean>;
  readonly unlockConfirmed: () => Promise<MacUnlockDecisionResult>;
}): Promise<MacUnlockDecisionResult> {
  if (input.askBeforeUnlock) {
    const approved = await input.confirm();
    if (!approved) return { ok: false, reason: "denied" };
  }
  return input.unlockConfirmed();
}

/**
 * Agent unlock after the Mac app dialog. Deny, or a prompt the asker already
 * dropped, does not call `unlockConfirmed`.
 */
export async function settleAgentUnlockPrompt(input: {
  readonly approved: boolean;
  readonly stillPending: boolean;
  readonly unlockConfirmed: () => Promise<MacUnlockDecisionResult>;
}): Promise<MacUnlockDecisionResult> {
  if (!input.approved) return { ok: false, reason: "denied" };
  if (!input.stillPending) return { ok: false, reason: "timed_out" };
  return input.unlockConfirmed();
}

type PendingConfirm = {
  readonly resolve: (approved: boolean) => void;
  readonly send: (event: UnlockConfirmEvent) => void;
  readonly timer: ReturnType<typeof setTimeout>;
};

export function createUnlockConfirmations(timeoutMs = 120_000) {
  const pending = new Map<string, PendingConfirm>();

  const finish = (id: string, approved: boolean) => {
    const current = pending.get(id);
    if (!current) return;
    pending.delete(id);
    clearTimeout(current.timer);
    try {
      current.send({ id, open: false });
    } catch {
      // The window can close while the prompt is open.
    }
    current.resolve(approved);
  };

  return {
    request(send: (event: UnlockConfirmEvent) => void): Promise<boolean> {
      const id = globalThis.crypto.randomUUID();
      return new Promise((resolve) => {
        const timer = setTimeout(() => finish(id, false), timeoutMs);
        pending.set(id, { resolve, send, timer });
        try {
          send({ id, open: true });
        } catch {
          finish(id, false);
        }
      });
    },
    respond(id: string, approved: boolean) {
      finish(id, approved);
    },
  };
}
