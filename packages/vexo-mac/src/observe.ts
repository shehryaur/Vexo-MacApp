/* oxlint-disable t3code/no-global-process-runtime -- Plain Node for this Mac host. HostProcess is an Effect service and does not fit here. */
// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { helperScript, parseReply, run, swiftBin } from "./exec.ts";
import { isUnlockInProgress, sessionLockState } from "./unlock.ts";

export type Bounds = { x: number; y: number; width: number; height: number };

export type WindowInfo = {
  windowId: number;
  title: string;
  app: string;
  bounds: Bounds;
};

export type FrontWindow = WindowInfo & { imagePath: string };

export type ObserveFailure = { ok: false; reason: string };

const SCREEN_CAPTURE = "/usr/sbin/screencapture";

async function captureBlocked(): Promise<ObserveFailure | null> {
  const blocked = requireMac();
  if (blocked) return blocked;
  if (isUnlockInProgress()) return { ok: false, reason: "redacted" };
  if ((await sessionLockState()) === "locked") return { ok: false, reason: "redacted" };
  return null;
}

function requireMac(): ObserveFailure | null {
  if (process.platform !== "darwin") return { ok: false, reason: "not_macos" };
  return null;
}

/** On-screen windows, front to back. Does not capture pixels. */
export async function listWindows(): Promise<{ ok: true; windows: WindowInfo[] } | ObserveFailure> {
  const blocked = requireMac();
  if (blocked) return blocked;
  const result = await run(swiftBin(), [helperScript(), "windows"]);
  const reply = parseReply(result.stdout);
  if (!reply?.ok || !reply.windows)
    return { ok: false, reason: reply?.reason ?? "window_list_failed" };
  const windows: WindowInfo[] = [];
  for (const row of reply.windows) {
    const bounds = row.bounds;
    if (
      typeof row.windowId !== "number" ||
      !bounds ||
      typeof bounds.x !== "number" ||
      typeof bounds.y !== "number" ||
      typeof bounds.width !== "number" ||
      typeof bounds.height !== "number"
    ) {
      continue;
    }
    windows.push({
      windowId: row.windowId,
      title: typeof row.title === "string" ? row.title : "",
      app: typeof row.app === "string" ? row.app : "",
      bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
    });
  }
  return { ok: true, windows };
}

/**
 * Front window plus a temp JPEG of that window only.
 * The return value is the file path, never the image bytes.
 */
export async function observeFront(): Promise<FrontWindow | ObserveFailure> {
  const listed = await listWindows();
  if (!listed.ok) return listed;
  const front = listed.windows[0];
  if (!front) return { ok: false, reason: "no_window" };
  const captured = await captureWindow(front.windowId);
  if (!captured.ok) return captured;
  return { ...front, imagePath: captured.imagePath };
}

async function captureWindow(
  windowId: number,
): Promise<{ ok: true; imagePath: string } | ObserveFailure> {
  const blocked = await captureBlocked();
  if (blocked) return blocked;
  const imagePath = NodePath.join(
    NodeOS.tmpdir(),
    `vexo-mac-${windowId}-${NodeCrypto.randomUUID()}.jpg`,
  );
  const result = await run(
    SCREEN_CAPTURE,
    [`-l${windowId}`, "-t", "jpg", "-x", imagePath],
    undefined,
    20_000,
  );
  if (result.code !== 0) return { ok: false, reason: "screen_recording_unavailable" };
  const info = await NodeFSP.stat(imagePath).catch(() => null);
  if (!info || info.size <= 0) return { ok: false, reason: "screen_recording_unavailable" };
  return { ok: true, imagePath };
}

export async function captureDisplay(): Promise<{ ok: true; imagePath: string } | ObserveFailure> {
  const blocked = await captureBlocked();
  if (blocked) return blocked;
  const imagePath = NodePath.join(NodeOS.tmpdir(), `vexo-mac-frame-${NodeCrypto.randomUUID()}.jpg`);
  const result = await run(SCREEN_CAPTURE, ["-t", "jpg", "-x", imagePath], undefined, 20_000);
  if (result.code !== 0) return { ok: false, reason: "screen_recording_unavailable" };
  const info = await NodeFSP.stat(imagePath).catch(() => null);
  if (!info || info.size <= 0) return { ok: false, reason: "screen_recording_unavailable" };
  return { ok: true, imagePath };
}
