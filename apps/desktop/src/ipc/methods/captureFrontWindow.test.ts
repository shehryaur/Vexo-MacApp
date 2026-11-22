import { describe, expect, it } from "vite-plus/test";

import { toDesktopFrontWindowCapture } from "./captureFrontWindow.ts";

const front = {
  windowId: 4,
  title: "Notes",
  app: "Notes",
  bounds: { x: 1, y: 2, width: 3, height: 4 },
  imagePath: "/tmp/vexo-mac-4.jpg",
};

describe("toDesktopFrontWindowCapture", () => {
  it("keeps the front-window path and metadata", () => {
    expect(toDesktopFrontWindowCapture(front)).toEqual({
      ok: true,
      windowId: 4,
      title: "Notes",
      app: "Notes",
      bounds: { x: 1, y: 2, width: 3, height: 4 },
      imagePath: "/tmp/vexo-mac-4.jpg",
    });
  });

  it("includes a jpeg data url when the temp file was read", () => {
    expect(toDesktopFrontWindowCapture(front, "data:image/jpeg;base64,aGVsbG8=")).toEqual({
      ok: true,
      windowId: 4,
      title: "Notes",
      app: "Notes",
      bounds: { x: 1, y: 2, width: 3, height: 4 },
      imagePath: "/tmp/vexo-mac-4.jpg",
      dataUrl: "data:image/jpeg;base64,aGVsbG8=",
    });
  });

  it("returns redacted and locked with no image path", () => {
    expect(toDesktopFrontWindowCapture({ ok: false, reason: "redacted" })).toEqual({
      ok: false,
      reason: "redacted",
    });
    expect(toDesktopFrontWindowCapture({ ok: false, reason: "locked" })).toEqual({
      ok: false,
      reason: "locked",
    });
  });

  it("does not truncate an image path that cannot fit the bridge", () => {
    expect(toDesktopFrontWindowCapture({ ...front, imagePath: `${"a".repeat(4_097)}` })).toEqual({
      ok: false,
      reason: "unavailable",
    });
  });
});
