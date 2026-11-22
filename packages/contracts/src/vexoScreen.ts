import * as Schema from "effect/Schema";
import * as HttpServerRespondable from "effect/http/HttpServerRespondable";
import * as HttpServerResponse from "effect/http/HttpServerResponse";

/** Shown when screencapture cannot read the display. */
export const SCREEN_RECORDING_PERMISSION_MESSAGE =
  "Screen Recording permission is missing. Enable it in System Settings → Privacy & Security → Screen Recording, then try again.";

/** Shown when this environment is not the Mac that can capture its own display. */
export const VEXO_SCREEN_NOT_MACOS_MESSAGE =
  "Screen watch only runs on the Mac that hosts this environment.";

/**
 * One view-only display frame. `redacted` carries no pixels: the session is locked
 * or an unlock is in progress.
 */
export const VexoScreenFrame = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("redacted"),
  }),
  Schema.Struct({
    status: Schema.Literal("frame"),
    jpegBase64: Schema.String,
  }),
]);
export type VexoScreenFrame = typeof VexoScreenFrame.Type;

export class VexoScreenCaptureError extends Schema.TaggedError<VexoScreenCaptureError>()(
  "VexoScreenCaptureError",
  {
    code: Schema.Literal("screen_capture_unavailable"),
    detail: Schema.String,
  },
  { httpApiStatus: 503 },
) {
  [HttpServerRespondable.symbol]() {
    return HttpServerResponse.schemaJson(VexoScreenCaptureError)(this, { status: 503 });
  }

  override get message(): string {
    return this.detail;
  }
}
