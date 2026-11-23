import { captureDisplay } from "./observe.ts";

export type Frame = { imagePath: string } | { redacted: true } | { ok: false; reason: string };

/**
 * Display JPEG path. While unlock is running, or the session is locked,
 * returns `{redacted: true}` and does not capture.
 */
export async function captureFrame(): Promise<Frame> {
  const captured = await captureDisplay();
  if (!captured.ok) {
    if (captured.reason === "redacted") return { redacted: true };
    return captured;
  }
  return { imagePath: captured.imagePath };
}
