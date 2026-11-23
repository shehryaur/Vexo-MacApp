/* oxlint-disable t3code/no-global-process-runtime -- Plain Node for this Mac host. HostProcess is an Effect service and does not fit here. */
import { helperScript, parseReply, run, swiftBin } from "./exec.ts";
import { heldBy, touch } from "./lease.ts";

export type Point = { x: number; y: number };

export type ActionTarget = {
  role?: string;
  subrole?: string;
  title?: string;
  windowId?: number;
};

export type ActResult = { ok: true } | { ok: false; reason: string };

const PASSWORD_ROLE = /securetextfield|secure.?text.?field|password/i;
const PASSWORD_TITLE = /\b(password|passcode|passwd)\b/i;

const KEYS = new Set([
  "return",
  "enter",
  "escape",
  "esc",
  "tab",
  "space",
  "delete",
  "backspace",
  "forwarddelete",
  "left",
  "right",
  "up",
  "down",
]);

/** True when the role or title looks like a password field. Input must not be posted. */
export function isPasswordField(
  target?: { role?: string; subrole?: string; title?: string } | null,
): boolean {
  if (!target) return false;
  const role = `${target.role ?? ""} ${target.subrole ?? ""}`;
  if (PASSWORD_ROLE.test(role)) return true;
  return Boolean(target.title && PASSWORD_TITLE.test(target.title));
}

function gate(threadId: string, target?: ActionTarget): ActResult | null {
  if (process.platform !== "darwin") return { ok: false, reason: "not_macos" };
  if (!heldBy(threadId)) return { ok: false, reason: "lease_required" };
  if (isPasswordField(target)) return { ok: false, reason: "password_field" };
  return null;
}

async function post(
  op: "click" | "type" | "key",
  payload: Record<string, unknown>,
): Promise<ActResult> {
  const result = await run(swiftBin(), [helperScript(), op], JSON.stringify(payload));
  const reply = parseReply(result.stdout);
  if (reply?.ok) return { ok: true };
  if (reply?.reason) return { ok: false, reason: reply.reason };
  return { ok: false, reason: "input_failed" };
}

/** Raise the window, then post a click. Refuses a password field and a missing lease. */
export async function click(
  threadId: string,
  point: Point,
  target?: ActionTarget,
): Promise<ActResult> {
  const denied = gate(threadId, target);
  if (denied) return denied;
  touch(threadId);
  return post("click", {
    x: point.x,
    y: point.y,
    windowId: target?.windowId,
  });
}

/** Type text. The text is sent to the helper on stdin and is not logged. */
export async function typeText(
  threadId: string,
  text: string,
  target?: ActionTarget,
): Promise<ActResult> {
  const denied = gate(threadId, target);
  if (denied) return denied;
  if (text.length === 0) return { ok: false, reason: "empty" };
  touch(threadId);
  return post("type", { text, windowId: target?.windowId });
}

/** Press one named key, such as `return`, `escape`, or `tab`. */
export async function key(
  threadId: string,
  name: string,
  target?: ActionTarget,
): Promise<ActResult> {
  const denied = gate(threadId, target);
  if (denied) return denied;
  const keyName = name.trim().toLowerCase();
  if (!KEYS.has(keyName)) return { ok: false, reason: "unknown_key" };
  touch(threadId);
  return post("key", { key: keyName, windowId: target?.windowId });
}
