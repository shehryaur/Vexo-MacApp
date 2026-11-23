/* oxlint-disable t3code/no-global-process-runtime -- Plain Node for this Mac host. HostProcess is an Effect service and does not fit here. */
// @effect-diagnostics nodeBuiltinImport:off globalDate:off globalTimers:off cryptoRandomUUID:off -- Prompt ids are minted outside an Effect runtime.
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { helperScript, parseReply, run, swiftBin } from "./exec.ts";
import { current, touch } from "./lease.ts";

/** Login-keychain generic password. The secret is never returned to callers. */
const KEYCHAIN_SERVICE = "com.vexo.mac.unlock";

/**
 * Lock-screen binary shipped on older macOS. When it is missing, relock sends
 * the Lock Screen shortcut through System Events. Do not call a private lock API.
 */
const RELOCK_BIN =
  "/System/Library/CoreServices/Menu Extras/User.menu/Contents/Resources/CGSession";

/** Control-Command-Q, the standard Lock Screen shortcut. Needs Accessibility. */
const LOCK_SCREEN_SCRIPT =
  'tell application "System Events" to keystroke "q" using {control down, command down}';

export type UnlockResult = { ok: true } | { ok: false; reason: string };

export type RelockResult = { ok: true; relocked: boolean } | { ok: false; reason: string };

const ACCESS_DENIED =
  "Accessibility permission is missing. Enable it in System Settings → Privacy & Security → Accessibility.";

/** A crashed unlock stops redacting the screen after this long. */
const UNLOCKING_STALE_MS = 60_000;

let unlocking = false;
let unlockEpoch = 0;
let supportDirOverride: string | null = null;
let relockBin = RELOCK_BIN;
let monotonicNow = (): number => Date.now();
let waitForDecision = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 200);
  });

/** Tests resolve the decision wait themselves. Production waits 200ms between reads. */
export function setUnlockWaitForTests(
  next: { readonly now?: () => number; readonly wait?: () => Promise<void> } | null,
): void {
  monotonicNow = next?.now ?? (() => Date.now());
  waitForDecision =
    next?.wait ??
    (() =>
      new Promise((resolve) => {
        setTimeout(resolve, 200);
      }));
}

/**
 * Bumps when a confirmed unlock starts. Callers that already began a capture
 * compare this so pixels taken while the password was typed are not published
 * after the in-memory flag drops.
 */
export function unlockGeneration(): number {
  return unlockEpoch;
}

/**
 * True in this process, and in any other process that can see the unlocking
 * file. The desktop app and the environment server do not share memory.
 */
export function isUnlockInProgress(): boolean {
  if (unlocking) return true;
  try {
    const info = NodeFS.statSync(unlockingPath());
    return Date.now() - info.mtimeMs < UNLOCKING_STALE_MS;
  } catch {
    return false;
  }
}

function account(): string {
  return NodeOS.userInfo().username;
}

function supportDir(): string {
  return (
    supportDirOverride ??
    NodePath.join(NodeOS.homedir(), "Library", "Application Support", "VexoMac")
  );
}

function markerPath(): string {
  return NodePath.join(supportDir(), "unlock.json");
}

function askBeforeUnlockPath(): string {
  return NodePath.join(supportDir(), "mac-unlock.json");
}

function unlockingPath(): string {
  return NodePath.join(supportDir(), "unlocking.json");
}

/**
 * Missing or unreadable settings ask before unlock. Only an explicit false
 * turns that off. Shared by the Mac app dialog and MCP `vexo_unlock`.
 */
export function askBeforeUnlockFromStored(raw: string | null): boolean {
  if (raw === null) return true;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || !("askBeforeUnlock" in parsed)) {
      return true;
    }
    return (parsed as { readonly askBeforeUnlock: unknown }).askBeforeUnlock !== false;
  } catch {
    return true;
  }
}

export async function readAskBeforeUnlock(): Promise<boolean> {
  try {
    return askBeforeUnlockFromStored(await NodeFSP.readFile(askBeforeUnlockPath(), "utf8"));
  } catch {
    return true;
  }
}

function promptPath(): string {
  return NodePath.join(supportDir(), "unlock-prompt.json");
}

function decisionPath(): string {
  return NodePath.join(supportDir(), "unlock-decision.json");
}

export type UnlockConfirmationResult = { ok: true } | { ok: false; reason: string };

/**
 * Asks the desktop app to show the unlock dialog. This waits for that
 * decision and does not call `unlock`. The Mac app calls
 * `unlock({ confirmed: true })` only after the person approves.
 */
export async function requestUnlockConfirmation(
  timeoutMs = 120_000,
): Promise<UnlockConfirmationResult> {
  const dir = supportDir();
  await NodeFSP.mkdir(dir, { recursive: true, mode: 0o700 });
  const id =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `prompt-${Date.now()}`;
  const promptFile = promptPath();
  const decisionFile = decisionPath();
  const tmp = NodePath.join(dir, `.unlock-prompt.${process.pid}.tmp`);
  await NodeFSP.writeFile(tmp, JSON.stringify({ id, at: Date.now() }), { mode: 0o600 });
  await NodeFSP.rename(tmp, promptFile);

  const start = monotonicNow();
  try {
    while (monotonicNow() - start < timeoutMs) {
      const decision = await readUnlockDecision(id);
      if (decision) {
        await NodeFSP.unlink(decisionFile).catch(() => undefined);
        return decision;
      }
      await waitForDecision();
    }
    return { ok: false, reason: "timed_out" };
  } finally {
    const pending = await readPendingUnlockPrompt();
    if (pending?.id === id) await NodeFSP.unlink(promptFile).catch(() => undefined);
  }
}

async function readUnlockDecision(id: string): Promise<UnlockConfirmationResult | null> {
  try {
    const parsed: unknown = JSON.parse(await NodeFSP.readFile(decisionPath(), "utf8"));
    if (typeof parsed !== "object" || parsed === null || !("id" in parsed)) return null;
    if ((parsed as { id: unknown }).id !== id || !("approved" in parsed)) return null;
    if ((parsed as { approved: unknown }).approved === true) return { ok: true };
    const reason = (parsed as { reason?: unknown }).reason;
    return {
      ok: false,
      reason: typeof reason === "string" && reason.length > 0 ? reason.slice(0, 400) : "denied",
    };
  } catch {
    return null;
  }
}

export async function readPendingUnlockPrompt(): Promise<{ id: string; at: number } | null> {
  try {
    const raw = await NodeFSP.readFile(promptPath(), "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "id" in parsed &&
      typeof (parsed as { id: unknown }).id === "string"
    ) {
      return {
        id: (parsed as { id: string }).id,
        at: Number((parsed as { at?: unknown }).at) || Date.now(),
      };
    }
    return null;
  } catch {
    return null;
  }
}

/** Records the desktop dialog's outcome. `ok: true` means the person approved and unlock already ran. */
export async function writeUnlockDecision(
  id: string,
  result: { ok: true } | { ok: false; reason: string },
): Promise<void> {
  const dir = supportDir();
  await NodeFSP.mkdir(dir, { recursive: true, mode: 0o700 });
  const decisionFile = decisionPath();
  const tmp = NodePath.join(dir, `.unlock-decision.${process.pid}.tmp`);
  const body = result.ok
    ? { id, approved: true, at: Date.now() }
    : { id, approved: false, reason: result.reason.slice(0, 400), at: Date.now() };
  await NodeFSP.writeFile(tmp, JSON.stringify(body), { mode: 0o600 });
  await NodeFSP.rename(tmp, decisionFile);
  const pending = await readPendingUnlockPrompt();
  if (pending?.id === id) await NodeFSP.unlink(promptPath()).catch(() => undefined);
}

/** Writes the ask-before flag only. The login password is never stored here. */
export async function writeAskBeforeUnlock(askBeforeUnlock: boolean): Promise<void> {
  const dir = supportDir();
  await NodeFSP.mkdir(dir, { recursive: true, mode: 0o700 });
  const target = askBeforeUnlockPath();
  const tmp = NodePath.join(dir, `.mac-unlock.${process.pid}.tmp`);
  await NodeFSP.writeFile(tmp, JSON.stringify({ askBeforeUnlock }), { mode: 0o600 });
  await NodeFSP.rename(tmp, target);
}

async function markerExists(): Promise<boolean> {
  try {
    await NodeFSP.access(markerPath());
    return true;
  } catch {
    return false;
  }
}

/** Crash-safe: the marker is renamed into place before the password is typed. */
async function writeMarker(): Promise<void> {
  const dir = supportDir();
  await NodeFSP.mkdir(dir, { recursive: true, mode: 0o700 });
  const target = markerPath();
  const tmp = NodePath.join(dir, `.unlock.${process.pid}.tmp`);
  const body = JSON.stringify({ unlocked: true, at: new Date().toISOString() });
  await NodeFSP.writeFile(tmp, body, { mode: 0o600 });
  await NodeFSP.rename(tmp, target);
}

async function removeMarker(): Promise<void> {
  try {
    await NodeFSP.unlink(markerPath());
  } catch {
    // Already gone.
  }
}

/** Other processes redact while this file is fresh. Removed when unlock finishes. */
async function writeUnlocking(): Promise<void> {
  const dir = supportDir();
  await NodeFSP.mkdir(dir, { recursive: true, mode: 0o700 });
  const target = unlockingPath();
  const tmp = NodePath.join(dir, `.unlocking.${process.pid}.tmp`);
  await NodeFSP.writeFile(tmp, JSON.stringify({ at: new Date().toISOString() }), { mode: 0o600 });
  await NodeFSP.rename(tmp, target);
}

async function clearUnlocking(): Promise<void> {
  try {
    await NodeFSP.unlink(unlockingPath());
  } catch {
    // Already gone.
  }
}

export async function sessionLockState(): Promise<"locked" | "unlocked" | "unknown"> {
  if (process.platform !== "darwin") return "unknown";
  const result = await run(swiftBin(), [helperScript(), "locked"]);
  const reply = parseReply(result.stdout);
  if (!reply?.ok) return "unknown";
  if (reply.locked === true) return "locked";
  if (reply.locked === false) return "unlocked";
  return "unknown";
}

/**
 * Best-effort check against the local account. A helper failure does not block
 * the save. A reported mismatch does. The password is stdin to the helper, not a log line.
 */
async function verifyBestEffort(
  user: string,
  password: string,
): Promise<"ok" | "mismatch" | "unavailable"> {
  try {
    const result = await run(
      swiftBin(),
      [helperScript(), "verify"],
      JSON.stringify({ user, password }),
    );
    const reply = parseReply(result.stdout);
    if (reply?.ok) return "ok";
    if (reply?.reason === "mismatch") return "mismatch";
    return "unavailable";
  } catch {
    return "unavailable";
  }
}

/** Store the Mac login password in the login keychain. Never logs the password. */
export async function savePassword(password: string): Promise<UnlockResult> {
  if (process.platform !== "darwin") return { ok: false, reason: "not_macos" };
  if (password.length === 0) return { ok: false, reason: "empty" };
  const user = account();
  const verdict = await verifyBestEffort(user, password);
  if (verdict === "mismatch") return { ok: false, reason: "password_mismatch" };
  // -w is how `security` accepts the secret. Arguments are not written to logs.
  const saved = await run("/usr/bin/security", [
    "add-generic-password",
    "-U",
    "-s",
    KEYCHAIN_SERVICE,
    "-a",
    user,
    "-w",
    password,
  ]);
  if (saved.code !== 0) return { ok: false, reason: "keychain_save_failed" };
  return { ok: true };
}

/** True when a password item exists. The secret itself is discarded. */
export async function passwordStored(): Promise<boolean> {
  const read = await readStoredPassword();
  return read.ok;
}

export async function clearPassword(): Promise<UnlockResult> {
  if (process.platform !== "darwin") return { ok: false, reason: "not_macos" };
  const removed = await run("/usr/bin/security", [
    "delete-generic-password",
    "-s",
    KEYCHAIN_SERVICE,
    "-a",
    account(),
  ]);
  if (removed.code !== 0) return { ok: false, reason: "keychain_delete_failed" };
  return { ok: true };
}

async function readStoredPassword(): Promise<
  { ok: true; password: string } | { ok: false; reason: string }
> {
  const result = await run("/usr/bin/security", [
    "find-generic-password",
    "-s",
    KEYCHAIN_SERVICE,
    "-a",
    account(),
    "-w",
  ]);
  if (result.code !== 0) {
    if (/could not be found/i.test(result.stderr))
      return { ok: false, reason: "password_not_stored" };
    return { ok: false, reason: "keychain_read_failed" };
  }
  const password = result.stdout.endsWith("\n") ? result.stdout.slice(0, -1) : result.stdout;
  if (password.length === 0) return { ok: false, reason: "password_not_stored" };
  return { ok: true, password };
}

/**
 * Default is confirm-required. `unlock({ confirmed: true })` types the stored
 * password only when the session is locked, then leaves the crash-safe marker.
 */
export async function unlock(options?: { confirmed?: boolean }): Promise<UnlockResult> {
  if (options?.confirmed !== true) {
    return { ok: false, reason: "confirmation_required" };
  }
  if (process.platform !== "darwin") return { ok: false, reason: "not_macos" };
  if (unlocking) return { ok: false, reason: "unlock_in_progress" };
  unlocking = true;
  unlockEpoch += 1;
  try {
    await writeUnlocking();
    const state = await sessionLockState();
    if (state !== "locked") {
      return { ok: false, reason: state === "unlocked" ? "not_locked" : "lock_state_unknown" };
    }
    const owner = current();
    if (owner) touch(owner.owner);
    await writeMarker();
    const stored = await readStoredPassword();
    if (!stored.ok) {
      await removeMarker();
      return { ok: false, reason: stored.reason };
    }
    const typed = await run(
      swiftBin(),
      [helperScript(), "lock-type"],
      JSON.stringify({ text: stored.password }),
    );
    const reply = parseReply(typed.stdout);
    if (!reply?.ok) {
      const reason = reply?.reason ?? "unlock_failed";
      if (reason !== "unlock_failed") await removeMarker();
      if (reason === ACCESS_DENIED || reason.startsWith("Accessibility permission")) {
        return { ok: false, reason: ACCESS_DENIED };
      }
      return { ok: false, reason };
    }
    return { ok: true };
  } finally {
    unlocking = false;
    await clearUnlocking();
  }
}

async function relockBinExists(): Promise<boolean> {
  try {
    await NodeFSP.access(relockBin, NodeFS.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Lock the session. Prefer `CGSession -suspend` when that binary exists.
 * Otherwise send Control-Command-Q through System Events. If that cannot run,
 * return `relock_unavailable`. Never calls a private lock-screen API.
 */
export async function relock(): Promise<RelockResult> {
  if (process.platform !== "darwin") return { ok: false, reason: "not_macos" };
  if (await relockBinExists()) {
    const result = await run(relockBin, ["-suspend"]);
    if (result.code !== 0) return { ok: false, reason: "relock_failed" };
    await removeMarker();
    await clearUnlocking();
    return { ok: true, relocked: true };
  }
  const result = await run("/usr/bin/osascript", ["-e", LOCK_SCREEN_SCRIPT]);
  if (result.code !== 0) return { ok: false, reason: "relock_unavailable" };
  await removeMarker();
  await clearUnlocking();
  return { ok: true, relocked: true };
}

/** If a previous unlock crashed and nobody holds the lease, lock the Mac again. */
export async function relockIfAbandoned(): Promise<RelockResult> {
  if (!(await markerExists())) return { ok: true, relocked: false };
  if (current() !== null) return { ok: true, relocked: false };
  return relock();
}

export function setUnlockInProgressForTests(value: boolean): void {
  if (value && !unlocking) unlockEpoch += 1;
  unlocking = value;
}

export function setSupportDirForTests(dir: string | null): void {
  supportDirOverride = dir;
}

export function setRelockBinForTests(bin: string | null): void {
  relockBin = bin ?? RELOCK_BIN;
}

export function resetUnlockForTests(): void {
  unlocking = false;
  unlockEpoch = 0;
  supportDirOverride = null;
  relockBin = RELOCK_BIN;
  setUnlockWaitForTests(null);
}
