import { OrchestratorMcpFailure } from "@t3tools/contracts";
import {
  abort,
  acquire,
  captureFrame,
  clearPassword,
  click,
  current,
  isUnlockInProgress,
  key,
  listWindows,
  observeFront,
  passwordStored,
  readAskBeforeUnlock,
  release,
  relock,
  relockIfAbandoned,
  requestUnlockConfirmation,
  savePassword,
  typeText,
  unlock,
  type ActionTarget,
} from "@t3tools/vexo-mac";
import * as Effect from "effect/Effect";

import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { assertFullAccess, loadCaller } from "../../threadAccess.ts";
import { VexoDesktopToolkit } from "./tools.ts";

type FailureCode = "capability_denied" | "invalid_request" | "orchestration_error";

const REASONS: Record<string, readonly [FailureCode, string]> = {
  lease_required: [
    "capability_denied",
    "This thread does not hold the desktop lease. Call vexo_lease_acquire, then retry.",
  ],
  not_holder: ["capability_denied", "This thread does not hold the desktop lease."],
  held: ["capability_denied", "The desktop lease is held by another thread."],
  invalid_thread: ["invalid_request", "This call has no thread to own the desktop lease."],
  password_field: ["capability_denied", "Refusing to act on a password field."],
  empty: ["invalid_request", "Nothing was given to type or save."],
  unknown_key: [
    "invalid_request",
    "That key is not supported. Use return, escape, tab, space, delete, backspace, forwarddelete, left, right, up, or down.",
  ],
  not_macos: ["capability_denied", "Desktop control only runs on this Mac."],
  confirmation_required: [
    "invalid_request",
    "Pass confirmed: true to type the stored password into the lock screen.",
  ],
  user_confirmation_required: [
    "capability_denied",
    "Ask before unlocking is on. Approve unlock in the Mac app dialog.",
  ],
  denied: ["capability_denied", "Unlock was denied in the Mac app."],
  timed_out: [
    "capability_denied",
    "The Mac app did not approve unlock in time. Approve the dialog, or turn off Ask before unlocking.",
  ],
  unavailable: ["orchestration_error", "The Mac app could not ask before unlocking."],
  "window-unavailable": [
    "orchestration_error",
    "The Mac app window is not open, so unlock could not be approved.",
  ],
  user_confirmation_denied: ["capability_denied", "The user denied permission to unlock this Mac."],
  user_confirmation_timed_out: [
    "capability_denied",
    "Unlock confirmation timed out waiting for user approval.",
  ],
  not_locked: ["invalid_request", "The session is not locked."],
  lock_state_unknown: ["orchestration_error", "Could not tell whether the session is locked."],
  unlock_in_progress: ["capability_denied", "An unlock is already in progress."],
  password_not_stored: [
    "invalid_request",
    "No Mac login password is stored. Call vexo_save_password first.",
  ],
  password_mismatch: ["invalid_request", "That password does not match this Mac account."],
  keychain_save_failed: [
    "orchestration_error",
    "Could not store the password in the login keychain.",
  ],
  keychain_delete_failed: [
    "orchestration_error",
    "Could not delete the password from the login keychain.",
  ],
  keychain_read_failed: ["orchestration_error", "Could not read the login keychain."],
  redacted: [
    "capability_denied",
    "The screen is hidden while the session is locked or unlock is in progress.",
  ],
  no_window: ["invalid_request", "No window is on screen."],
  window_list_failed: ["orchestration_error", "Could not list windows."],
  screen_recording_unavailable: [
    "capability_denied",
    "Screen Recording permission is missing. Enable it for this app in System Settings, then retry.",
  ],
  relock_unavailable: [
    "orchestration_error",
    "Could not lock the screen. CGSession is missing and the Lock Screen shortcut did not run. That shortcut needs Accessibility permission.",
  ],
  relock_failed: ["orchestration_error", "The lock command failed."],
  unlock_failed: ["orchestration_error", "Unlock failed."],
  input_failed: ["orchestration_error", "The input was not posted."],
};

const deny = (reason: string) => {
  const known = REASONS[reason];
  if (known) return new OrchestratorMcpFailure({ code: known[0], message: known[1] });
  if (reason.startsWith("Accessibility permission")) {
    return new OrchestratorMcpFailure({ code: "capability_denied", message: reason });
  }
  return new OrchestratorMcpFailure({
    code: "orchestration_error",
    message: "Desktop control failed.",
  });
};

const isRefusal = (result: object): result is { ok: false; reason: string } =>
  "ok" in result &&
  (result as { readonly ok?: unknown }).ok === false &&
  "reason" in result &&
  typeof (result as { readonly reason?: unknown }).reason === "string";

const fromVexo = <A>(attempt: () => Promise<A>) =>
  Effect.tryPromise({
    try: attempt,
    catch: () =>
      new OrchestratorMcpFailure({
        code: "orchestration_error",
        message: "Desktop control failed.",
      }),
  });

const unwrap = <A extends { ok: true }>(
  result: A | { ok: false; reason: string },
): Effect.Effect<A, OrchestratorMcpFailure> =>
  isRefusal(result) ? Effect.fail(deny(result.reason)) : Effect.succeed(result);

const threadId = (operation: string) =>
  McpInvocationContext.McpInvocationContext.pipe(
    Effect.flatMap((scope) => McpInvocationContext.requireThreadScope(scope, operation)),
    Effect.map((scope) => scope.thread.threadId),
  );

const requireNotPlan = Effect.gen(function* () {
  const { limits } = yield* loadCaller();
  if (limits.interactionMode === "plan") {
    return yield* new OrchestratorMcpFailure({
      code: "capability_denied",
      message: "Desktop control is unavailable in plan mode.",
    });
  }
});

const targetOf = (input: {
  readonly role?: string | undefined;
  readonly subrole?: string | undefined;
  readonly title?: string | undefined;
  readonly windowId?: number | undefined;
}): ActionTarget => ({
  ...(input.role === undefined ? {} : { role: input.role }),
  ...(input.subrole === undefined ? {} : { subrole: input.subrole }),
  ...(input.title === undefined ? {} : { title: input.title }),
  ...(input.windowId === undefined ? {} : { windowId: input.windowId }),
});

const handlers = {
  vexo_desktop_status: McpToolAccess.readsAsCaller(() =>
    Effect.gen(function* () {
      const lease = current();
      const stored = yield* fromVexo(() => passwordStored());
      return {
        leaseOwner: lease?.owner ?? null,
        passwordStored: stored,
        unlockInProgress: isUnlockInProgress(),
      };
    }),
  ),
  vexo_list_windows: McpToolAccess.readsAsCaller(() =>
    Effect.gen(function* () {
      const listed = yield* unwrap(yield* fromVexo(() => listWindows()));
      return { windows: listed.windows };
    }),
  ),
  vexo_observe: McpToolAccess.readsAsCaller(() =>
    Effect.gen(function* () {
      const observed = yield* fromVexo(() => observeFront());
      if (isRefusal(observed)) return yield* deny(observed.reason);
      return {
        windowId: observed.windowId,
        title: observed.title,
        app: observed.app,
        bounds: observed.bounds,
        imagePath: observed.imagePath,
      };
    }),
  ),
  vexo_capture_frame: McpToolAccess.readsAsCaller(() =>
    Effect.gen(function* () {
      const frame = yield* fromVexo(() => captureFrame());
      if (isRefusal(frame)) return yield* deny(frame.reason);
      if ("redacted" in frame) return { redacted: true as const };
      return { imagePath: frame.imagePath };
    }),
  ),
  vexo_lease_acquire: McpToolAccess.actsAsCaller(() =>
    Effect.gen(function* () {
      yield* requireNotPlan;
      const owner = yield* threadId("vexo_lease_acquire");
      const acquired = acquire(owner);
      if (!acquired.ok) {
        if (acquired.reason === "held") {
          return yield* new OrchestratorMcpFailure({
            code: "capability_denied",
            message: `The desktop lease is held by another thread (${acquired.owner}).`,
          });
        }
        return yield* deny(acquired.reason);
      }
      return { owner: acquired.owner };
    }),
  ),
  vexo_lease_release: McpToolAccess.actsAsCaller(() =>
    Effect.gen(function* () {
      const owner = yield* threadId("vexo_lease_release");
      const released = release(owner);
      if (!released.ok) return yield* deny(released.reason);
      return { released: true as const };
    }),
  ),
  vexo_lease_abort: McpToolAccess.actsAsCaller(() =>
    Effect.gen(function* () {
      yield* requireNotPlan;
      const { owner } = abort();
      return { owner };
    }),
  ),
  vexo_click: McpToolAccess.actsAsCaller((input) =>
    Effect.gen(function* () {
      yield* requireNotPlan;
      const owner = yield* threadId("vexo_click");
      yield* unwrap(
        yield* fromVexo(() => click(owner, { x: input.x, y: input.y }, targetOf(input))),
      );
      return { ok: true as const };
    }),
  ),
  vexo_type: McpToolAccess.actsAsCaller((input) =>
    Effect.gen(function* () {
      yield* requireNotPlan;
      const owner = yield* threadId("vexo_type");
      yield* unwrap(yield* fromVexo(() => typeText(owner, input.text, targetOf(input))));
      return { ok: true as const };
    }),
  ),
  vexo_key: McpToolAccess.actsAsCaller((input) =>
    Effect.gen(function* () {
      yield* requireNotPlan;
      const owner = yield* threadId("vexo_key");
      yield* unwrap(yield* fromVexo(() => key(owner, input.key, targetOf(input))));
      return { ok: true as const };
    }),
  ),
  vexo_unlock: McpToolAccess.actsAsCaller((input) =>
    Effect.gen(function* () {
      yield* requireNotPlan;
      if (input.confirmed !== true) {
        return yield* deny("confirmation_required");
      }
      if (yield* fromVexo(() => readAskBeforeUnlock())) {
        // Desktop shows MacUnlockConfirmDialog and calls unlock({ confirmed: true })
        // only after Approve. This process must not unlock from the agent's flag.
        const decision = yield* fromVexo(() => requestUnlockConfirmation());
        if (!decision.ok) return yield* deny(decision.reason);
        return { unlocked: true as const };
      }
      yield* unwrap(yield* fromVexo(() => unlock({ confirmed: true })));
      return { unlocked: true as const };
    }),
  ),
  vexo_relock: McpToolAccess.actsAsCaller(() =>
    Effect.gen(function* () {
      yield* requireNotPlan;
      const locked = yield* unwrap(yield* fromVexo(() => relock()));
      return { relocked: locked.relocked };
    }),
  ),
  vexo_relock_if_abandoned: McpToolAccess.actsAsCaller(() =>
    Effect.gen(function* () {
      yield* requireNotPlan;
      const locked = yield* unwrap(yield* fromVexo(() => relockIfAbandoned()));
      return { relocked: locked.relocked };
    }),
  ),
  vexo_password_stored: McpToolAccess.readsAsCaller(() =>
    Effect.gen(function* () {
      return { stored: yield* fromVexo(() => passwordStored()) };
    }),
  ),
  vexo_save_password: McpToolAccess.actsAsCaller((input) =>
    Effect.gen(function* () {
      yield* assertFullAccess(
        yield* loadCaller(),
        "Saving the Mac login password needs a full-access thread that is not in plan mode.",
      );
      yield* unwrap(yield* fromVexo(() => savePassword(input.password)));
      return { saved: true as const };
    }),
  ),
  vexo_clear_password: McpToolAccess.actsAsCaller(() =>
    Effect.gen(function* () {
      yield* requireNotPlan;
      yield* unwrap(yield* fromVexo(() => clearPassword()));
      return { cleared: true as const };
    }),
  ),
} satisfies McpToolAccess.Handlers<typeof VexoDesktopToolkit.tools>;

export const layer = McpToolAccess.toLayer(VexoDesktopToolkit, handlers);
