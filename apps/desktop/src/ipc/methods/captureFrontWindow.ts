// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import {
  DesktopFrontWindowCaptureSchema,
  type DesktopFrontWindowCapture,
} from "@t3tools/contracts";
import { observeFront, type FrontWindow, type ObserveFailure } from "@t3tools/vexo-mac";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import * as IpcChannels from "../channels.ts";
import * as DesktopIpc from "../DesktopIpc.ts";

const TITLE_MAX = 1_000;
const APP_MAX = 255;
const IMAGE_PATH_MAX = 4_096;
const REASON_MAX = 400;

function clipReason(reason: string): string {
  const bounded = reason.slice(0, REASON_MAX);
  return bounded.length > 0 ? bounded : "unavailable";
}

/** Maps an `observeFront` result onto the desktop bridge. A path is never truncated. */
export function toDesktopFrontWindowCapture(
  observed: FrontWindow | ObserveFailure,
  dataUrl?: string,
): DesktopFrontWindowCapture {
  if ("ok" in observed) {
    return { ok: false, reason: clipReason(observed.reason) };
  }
  if (observed.imagePath.length === 0 || observed.imagePath.length > IMAGE_PATH_MAX) {
    return { ok: false, reason: "unavailable" };
  }
  return {
    ok: true,
    windowId: observed.windowId,
    title: observed.title.slice(0, TITLE_MAX),
    app: observed.app.slice(0, APP_MAX),
    bounds: {
      x: observed.bounds.x,
      y: observed.bounds.y,
      width: observed.bounds.width,
      height: observed.bounds.height,
    },
    imagePath: observed.imagePath,
    ...(dataUrl ? { dataUrl } : {}),
  };
}

export const captureFrontWindow = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.CAPTURE_FRONT_WINDOW_CHANNEL,
  payload: Schema.Void,
  result: DesktopFrontWindowCaptureSchema,
  handler: () =>
    Effect.promise(async () => {
      try {
        // observeFront writes a front-window JPEG, or returns reason "redacted"
        // while the session is locked or unlock is running. Same gate as captureFrame.
        const observed = await observeFront();
        if (!("ok" in observed) && observed.imagePath) {
          try {
            const buf = await NodeFSP.readFile(observed.imagePath);
            const dataUrl = `data:image/jpeg;base64,${buf.toString("base64")}`;
            return toDesktopFrontWindowCapture(observed, dataUrl);
          } catch {
            return toDesktopFrontWindowCapture(observed);
          }
        }
        return toDesktopFrontWindowCapture(observed);
      } catch {
        return { ok: false as const, reason: "unavailable" };
      }
    }),
});
