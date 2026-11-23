// @effect-diagnostics globalTimers:off -- The desktop app polls agent unlock prompts outside a fiber.
import {
  DesktopMacUnlockRelockResultSchema,
  DesktopMacUnlockRespondSchema,
  DesktopMacUnlockResultSchema,
  DesktopMacUnlockStatusSchema,
} from "@t3tools/contracts";
import {
  clearPassword,
  passwordStored,
  readAskBeforeUnlock,
  readPendingUnlockPrompt,
  relockIfAbandoned,
  savePassword,
  unlock,
  writeAskBeforeUnlock,
  writeUnlockDecision,
} from "@t3tools/vexo-mac";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Electron from "electron";

import {
  createUnlockConfirmations,
  decideUnlock,
  settleAgentUnlockPrompt,
  type MacUnlockDecisionResult,
} from "../../macUnlock/macUnlock.ts";
import * as IpcChannels from "../channels.ts";
import * as DesktopIpc from "../DesktopIpc.ts";

const confirmations = createUnlockConfirmations();

let promptWatcherRunning = false;

/**
 * Starts watching for pending unlock confirmation prompts from other processes
 * (such as an agent calling vexo_unlock through MCP). Broadcasts the prompt to
 * open windows so MacUnlockConfirmDialog can render. Approve calls
 * unlock({ confirmed: true }). Deny does not.
 */
export function startDesktopUnlockPromptWatcher(): () => void {
  if (promptWatcherRunning) return () => undefined;
  promptWatcherRunning = true;
  let active = true;
  let inFlight = false;

  const check = async () => {
    if (!active || inFlight) return;
    try {
      const prompt = await readPendingUnlockPrompt();
      if (!prompt) return;
      inFlight = true;
      try {
        if (appWindows().length === 0) {
          await writeUnlockDecision(prompt.id, { ok: false, reason: "window-unavailable" });
          return;
        }
        // The dialog id is the confirm-queue id. Approval is the only path that unlocks.
        const approved = await confirmations.request((confirmEvent) => {
          sendConfirm(undefined, confirmEvent);
        });
        const pending = await readPendingUnlockPrompt();
        const settled = await settleAgentUnlockPrompt({
          approved,
          stillPending: pending?.id === prompt.id,
          unlockConfirmed: () => unlock({ confirmed: true }),
        });
        await writeUnlockDecision(
          prompt.id,
          settled.ok ? { ok: true } : { ok: false, reason: settled.reason },
        );
      } catch {
        await writeUnlockDecision(prompt.id, { ok: false, reason: "unlock_failed" });
      } finally {
        inFlight = false;
      }
    } catch {
      // Ignore poll error
    }
  };

  const timer = setInterval(() => {
    void check();
  }, 500);

  return () => {
    active = false;
    promptWatcherRunning = false;
    clearInterval(timer);
  };
}

function clipReason(reason: string): string {
  const bounded = reason.slice(0, 400);
  return bounded.length > 0 ? bounded : "unlock_failed";
}

function clipResult(result: MacUnlockDecisionResult) {
  if (result.ok) return { ok: true as const };
  return { ok: false as const, reason: clipReason(result.reason) };
}

function appWindows(): Electron.BrowserWindow[] {
  return Electron.BrowserWindow.getAllWindows().filter(
    (win) => !win.isDestroyed() && !win.webContents.isDestroyed(),
  );
}

function sendConfirm(senderId: number | undefined, event: { id: string; open: boolean }) {
  if (senderId !== undefined) {
    const contents = Electron.webContents.fromId(senderId);
    if (contents && !contents.isDestroyed()) {
      contents.send(IpcChannels.MAC_UNLOCK_CONFIRM_CHANNEL, event);
      return;
    }
  }
  const windows = appWindows();
  if (windows.length === 0) {
    if (event.open) throw new Error("window-unavailable");
    return;
  }
  if (event.open) {
    const target = windows.find((win) => win.isFocused()) ?? windows[0];
    if (target?.isMinimized()) target.restore();
    target?.show();
    target?.focus();
  }
  for (const win of windows) {
    win.webContents.send(IpcChannels.MAC_UNLOCK_CONFIRM_CHANNEL, event);
  }
}

export const macUnlockStatus = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.MAC_UNLOCK_STATUS_CHANNEL,
  payload: Schema.Void,
  result: DesktopMacUnlockStatusSchema,
  handler: () =>
    Effect.promise(async () => ({
      passwordStored: await passwordStored().catch(() => false),
      askBeforeUnlock: await readAskBeforeUnlock(),
    })),
});

export const macUnlockSave = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.MAC_UNLOCK_SAVE_CHANNEL,
  payload: Schema.Unknown,
  result: DesktopMacUnlockResultSchema,
  handler: (password) =>
    Effect.promise(async () => {
      // The secret is an argument to the keychain helper and is not returned or logged.
      if (typeof password !== "string" || password.length === 0 || password.length > 1024) {
        return { ok: false as const, reason: "empty" };
      }
      try {
        return clipResult(await savePassword(password));
      } catch {
        return { ok: false as const, reason: "keychain_save_failed" };
      }
    }),
});

export const macUnlockClear = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.MAC_UNLOCK_CLEAR_CHANNEL,
  payload: Schema.Void,
  result: DesktopMacUnlockResultSchema,
  handler: () =>
    Effect.promise(async () => {
      try {
        return clipResult(await clearPassword());
      } catch {
        return { ok: false as const, reason: "keychain_delete_failed" };
      }
    }),
});

export const macUnlockSetAsk = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.MAC_UNLOCK_SET_ASK_CHANNEL,
  payload: Schema.Boolean,
  result: DesktopMacUnlockResultSchema,
  handler: (askBeforeUnlock) =>
    Effect.promise(async () => {
      try {
        await writeAskBeforeUnlock(askBeforeUnlock);
        return { ok: true as const };
      } catch {
        return { ok: false as const, reason: "settings_unavailable" };
      }
    }),
});

export const macUnlockForTask = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.MAC_UNLOCK_UNLOCK_CHANNEL,
  payload: Schema.Void,
  result: DesktopMacUnlockResultSchema,
  handler: (_payload, event) =>
    Effect.promise(async () => {
      const senderId = event?.sender.id;
      const askBeforeUnlock = await readAskBeforeUnlock();
      try {
        return clipResult(
          await decideUnlock({
            askBeforeUnlock,
            confirm: () =>
              confirmations.request((confirmEvent) => sendConfirm(senderId, confirmEvent)),
            unlockConfirmed: () => unlock({ confirmed: true }),
          }),
        );
      } catch {
        return { ok: false as const, reason: "unlock_failed" };
      }
    }),
});

export const macUnlockRespond = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.MAC_UNLOCK_RESPOND_CHANNEL,
  payload: DesktopMacUnlockRespondSchema,
  result: Schema.Void,
  handler: ({ id, approved }) =>
    Effect.sync(() => {
      confirmations.respond(id, approved);
    }),
});

export const macUnlockRelock = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.MAC_UNLOCK_RELOCK_CHANNEL,
  payload: Schema.Void,
  result: DesktopMacUnlockRelockResultSchema,
  handler: () =>
    Effect.promise(async () => {
      try {
        const result = await relockIfAbandoned();
        if (result.ok) return { ok: true as const, relocked: result.relocked };
        return { ok: false as const, reason: clipReason(result.reason) };
      } catch {
        return { ok: false as const, reason: "relock_failed" };
      }
    }),
});
