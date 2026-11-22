import type { DesktopBridge, DesktopFrontWindowCapture } from "@t3tools/contracts";

import {
  type ComposerImageAttachment,
  type DraftId,
  type PersistedComposerImageAttachment,
  useComposerDraftStore,
} from "../../composerDraftStore";
import { readComposerImageBytes } from "../chat/composerAttachmentFiles";

export const CAPTURE_THREAD_PROMPT =
  "Capture the front window with vexo_observe and describe what you see";

/**
 * Asks the desktop host to capture the front window.
 *
 * `desktopBridge.captureFrontWindow` runs `@t3tools/vexo-mac` `observeFront` in
 * the main process. Callers open a draft with `CAPTURE_THREAD_PROMPT` when this
 * returns `"unavailable"`: no bridge, a thrown call, or a redacted/locked screen.
 */
export async function requestFrontWindowCapture(): Promise<"captured" | "unavailable"> {
  if (typeof window === "undefined") return "unavailable";
  const desktop: DesktopBridge | undefined = window.desktopBridge;
  const capture = desktop?.captureFrontWindow;
  if (typeof capture !== "function") return "unavailable";
  try {
    const result = await capture();
    return isCapturedFrontWindow(result) ? "captured" : "unavailable";
  } catch {
    return "unavailable";
  }
}

/** Returns the raw front-window capture result when available, or null on error/redaction. */
export async function getFrontWindowCapture(): Promise<DesktopFrontWindowCapture | null> {
  if (typeof window === "undefined") return null;
  const desktop: DesktopBridge | undefined = window.desktopBridge;
  const capture = desktop?.captureFrontWindow;
  if (typeof capture !== "function") return null;
  try {
    const result = await capture();
    return isCapturedFrontWindow(result) ? result : null;
  } catch {
    return null;
  }
}

function isCapturedFrontWindow(result: DesktopFrontWindowCapture): boolean {
  return result.ok === true && result.imagePath.length > 0;
}

const JPEG_DATA_URL_PREFIX = "data:image/jpeg;base64,";

/** JPEG data URL the composer can attach. A path alone is not enough. */
export function capturedWindowDataUrl(capture: DesktopFrontWindowCapture | null): string | null {
  if (!capture || !capture.ok) return null;
  const dataUrl = capture.dataUrl;
  if (typeof dataUrl !== "string" || !dataUrl.startsWith(JPEG_DATA_URL_PREFIX)) return null;
  if (dataUrl.length <= JPEG_DATA_URL_PREFIX.length) return null;
  return dataUrl;
}

/** Attaches the captured JPEG image into the composer draft as a thumbnail attachment. */
export async function attachCapturedWindowToDraft(
  target: DraftId,
  capture: DesktopFrontWindowCapture,
): Promise<boolean> {
  const imageUrl = capturedWindowDataUrl(capture);
  if (!imageUrl || !capture.ok) return false;
  const store = useComposerDraftStore.getState();
  const { compressImageToByteLimit, dataUrlToFile, readFileAsDataUrl } =
    await import("../../lib/imageCompression");
  const captureId = `capture-${Date.now()}`;
  const fileName = `${capture.app || "window"}.jpg`;
  const original = dataUrlToFile(imageUrl, fileName, "image/jpeg");
  const compressed = await compressImageToByteLimit(original, 5 * 1024 * 1024);
  if (!compressed.ok) return false;
  const file = compressed.file;
  await readComposerImageBytes(file);
  const dataUrl = compressed.recompressed ? await readFileAsDataUrl(file) : imageUrl;
  const image: ComposerImageAttachment = {
    type: "image",
    id: captureId,
    name: file.name,
    mimeType: file.type,
    sizeBytes: file.size,
    previewUrl: dataUrl,
    file,
  };
  const added = store.addImage(target, image);
  if (!added) return false;
  const persisted: PersistedComposerImageAttachment = {
    id: captureId,
    name: file.name,
    mimeType: file.type,
    sizeBytes: file.size,
    dataUrl,
  };
  await store.appendPersistedAttachments(target, [image], [persisted]);
  return true;
}
