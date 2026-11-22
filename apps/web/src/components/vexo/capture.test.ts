import type { DesktopFrontWindowCapture } from "@t3tools/contracts";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  attachCapturedWindowToDraft,
  capturedWindowDataUrl,
  getFrontWindowCapture,
  requestFrontWindowCapture,
} from "./capture";

const captured: DesktopFrontWindowCapture = {
  ok: true,
  windowId: 7,
  title: "Notes",
  app: "Notes",
  bounds: { x: 0, y: 0, width: 100, height: 80 },
  imagePath: "/tmp/vexo-mac-7.jpg",
  dataUrl: "data:image/jpeg;base64,ZmFrZWltYWdlZGF0YQ==",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("requestFrontWindowCapture", () => {
  it("returns captured when the bridge returns a front-window path", async () => {
    vi.stubGlobal("window", {
      desktopBridge: { captureFrontWindow: async () => captured },
    });
    await expect(requestFrontWindowCapture()).resolves.toBe("captured");
  });

  it("returns unavailable when the bridge is missing or throws", async () => {
    vi.stubGlobal("window", {});
    await expect(requestFrontWindowCapture()).resolves.toBe("unavailable");

    vi.stubGlobal("window", {
      desktopBridge: {
        captureFrontWindow: async () => {
          throw new Error("ipc failed");
        },
      },
    });
    await expect(requestFrontWindowCapture()).resolves.toBe("unavailable");
  });

  it("returns unavailable when the screen is redacted or locked", async () => {
    for (const reason of ["redacted", "locked"] as const) {
      const result: DesktopFrontWindowCapture = { ok: false, reason };
      vi.stubGlobal("window", {
        desktopBridge: { captureFrontWindow: async () => result },
      });
      await expect(requestFrontWindowCapture()).resolves.toBe("unavailable");
    }
  });
});

describe("captured window image", () => {
  it("keeps a jpeg data url and ignores a path-only capture", async () => {
    const { dataUrl, ...pathOnly } = captured;
    expect(capturedWindowDataUrl(captured)).toBe(dataUrl);
    expect(capturedWindowDataUrl(pathOnly)).toBeNull();
    expect(capturedWindowDataUrl({ ok: false, reason: "redacted" })).toBeNull();
    await expect(attachCapturedWindowToDraft("draft" as never, pathOnly)).resolves.toBe(false);
  });
});

describe("getFrontWindowCapture", () => {
  it("returns the capture object when successful", async () => {
    vi.stubGlobal("window", {
      desktopBridge: { captureFrontWindow: async () => captured },
    });
    await expect(getFrontWindowCapture()).resolves.toEqual(captured);
  });

  it("returns null when bridge is absent or error occurs", async () => {
    vi.stubGlobal("window", {});
    await expect(getFrontWindowCapture()).resolves.toBeNull();
  });
});

describe("attachCapturedWindowToDraft", () => {
  it("returns false if capture failed or dataUrl is missing", async () => {
    await expect(
      attachCapturedWindowToDraft("draft-1" as any, { ok: false, reason: "unavailable" }),
    ).resolves.toBe(false);

    await expect(
      attachCapturedWindowToDraft("draft-1" as any, {
        ok: true,
        windowId: 1,
        title: "Test",
        app: "Test",
        bounds: { x: 0, y: 0, width: 10, height: 10 },
        imagePath: "/tmp/test.jpg",
      }),
    ).resolves.toBe(false);
  });
});
