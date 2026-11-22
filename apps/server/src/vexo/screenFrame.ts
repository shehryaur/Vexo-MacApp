// @effect-diagnostics nodeBuiltinImport:off globalDate:off
import * as NodeFSP from "node:fs/promises";
import {
  SCREEN_RECORDING_PERMISSION_MESSAGE,
  VEXO_SCREEN_NOT_MACOS_MESSAGE,
  type VexoScreenFrame,
} from "@t3tools/contracts";
import { captureFrame, isUnlockInProgress, unlockGeneration, type Frame } from "@t3tools/vexo-mac";

/** At most ~2.5 frames per second, shared by every watcher. */
export const SCREEN_FRAME_INTERVAL_MS = 400;

export type ScreenFrameResult =
  | { readonly ok: true; readonly frame: VexoScreenFrame }
  | { readonly ok: false; readonly detail: string };

function messageForCaptureFailure(reason: string): string {
  if (reason === "screen_recording_unavailable") return SCREEN_RECORDING_PERMISSION_MESSAGE;
  if (reason === "not_macos") return VEXO_SCREEN_NOT_MACOS_MESSAGE;
  return `Screen capture failed (${reason}).`;
}

async function frameFromCapture(captured: Frame): Promise<ScreenFrameResult> {
  if ("redacted" in captured) return { ok: true, frame: { status: "redacted" } };
  if (!("imagePath" in captured)) {
    return { ok: false, detail: messageForCaptureFailure(captured.reason) };
  }
  try {
    const bytes = await NodeFSP.readFile(captured.imagePath);
    if (bytes.byteLength === 0) {
      return { ok: false, detail: SCREEN_RECORDING_PERMISSION_MESSAGE };
    }
    return {
      ok: true,
      frame: { status: "frame", jpegBase64: Buffer.from(bytes).toString("base64") },
    };
  } catch {
    return { ok: false, detail: SCREEN_RECORDING_PERMISSION_MESSAGE };
  } finally {
    await NodeFSP.unlink(captured.imagePath).catch(() => undefined);
  }
}

type Capture = () => Promise<Frame>;

const REDACTED: ScreenFrameResult = { ok: true, frame: { status: "redacted" } };

let capture: Capture = captureFrame;
let now = () => Date.now();
let cached: { readonly at: number; readonly result: ScreenFrameResult } | null = null;
let inflight: Promise<ScreenFrameResult> | null = null;
let epoch = 0;

function dropCachedFrame(): void {
  epoch += 1;
  cached = null;
  inflight = null;
}

export function setCaptureFrameForTests(next: Capture | null): void {
  capture = next ?? captureFrame;
  dropCachedFrame();
}

export function setScreenFrameClockForTests(next: (() => number) | null): void {
  now = next ?? (() => Date.now());
  cached = null;
}

export function resetScreenFrameForTests(): void {
  capture = async () => {
    throw new Error("screen capture was not mocked");
  };
  now = () => Date.now();
  dropCachedFrame();
}

/**
 * Latest view-only frame. Overlapping polls share one capture, and a fresh
 * result is reused until the interval elapses. Unlock always redacts immediately
 * and drops any cached pixels.
 */
export function latestScreenFrame(): Promise<ScreenFrameResult> {
  if (isUnlockInProgress()) {
    dropCachedFrame();
    return Promise.resolve(REDACTED);
  }
  const current = now();
  if (cached !== null && current - cached.at < SCREEN_FRAME_INTERVAL_MS) {
    return Promise.resolve(cached.result);
  }
  if (inflight !== null) return inflight;
  const started = epoch;
  const unlockStarted = unlockGeneration();
  const slot: { pending: Promise<ScreenFrameResult> | null } = { pending: null };
  const pending = (async () => {
    try {
      const result = await frameFromCapture(await capture());
      if (started !== epoch || unlockStarted !== unlockGeneration() || isUnlockInProgress()) {
        return REDACTED;
      }
      cached = { at: now(), result };
      return result;
    } catch {
      if (started !== epoch || unlockStarted !== unlockGeneration() || isUnlockInProgress()) {
        return REDACTED;
      }
      return { ok: false as const, detail: "Screen capture failed." };
    } finally {
      if (inflight === slot.pending) inflight = null;
    }
  })();
  slot.pending = pending;
  inflight = pending;
  return pending;
}
