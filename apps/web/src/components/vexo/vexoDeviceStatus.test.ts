import type { DesktopVexoAwakeStatus, DesktopVexoBandStatus } from "@t3tools/contracts";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  readAwakeStatus,
  readBandStatus,
  removeAwakeSetup,
  scanBand,
  setAwakeActive,
} from "./vexoDeviceStatus";

const mockAwake: DesktopVexoAwakeStatus = {
  active: true,
  mode: "lid-closed",
  lidClosedReady: true,
  sleepDisabled: true,
  batteryPercent: 85,
  onExternalPower: true,
  thermal: "nominal",
  detail: "Lid-closed is on.",
};

const mockBand: DesktopVexoBandStatus = {
  state: "connected",
  matches: [{ name: "Vexo Ring", id: "123", connected: true }],
  detail: "macOS reports Vexo Ring is connected.",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("vexoDeviceStatus in browser mode", () => {
  it("returns fallback status when desktopBridge is absent", async () => {
    vi.stubGlobal("window", {});
    const awake = await readAwakeStatus();
    expect(awake.active).toBe(false);
    expect(awake.detail).toContain("Open the desktop app");

    const awakeSet = await setAwakeActive(true);
    expect(awakeSet.active).toBe(false);

    const band = await readBandStatus();
    expect(band.state).toBe("not-found");
    expect(band.detail).toContain("Open the desktop app");

    const scan = await scanBand();
    expect(scan.state).toBe("not-found");
  });
});

describe("vexoDeviceStatus in desktop mode", () => {
  it("delegates to desktopBridge when present", async () => {
    vi.stubGlobal("window", {
      desktopBridge: {
        vexoAwake: {
          status: async () => mockAwake,
          setActive: async (active: boolean) => ({ ...mockAwake, active }),
          removeSetup: async () => ({ ...mockAwake, active: false, lidClosedReady: false }),
        },
        vexoBand: {
          status: async () => mockBand,
          scan: async () => ({ ...mockBand, state: "not-found" as const }),
        },
      },
    });

    const awake = await readAwakeStatus();
    expect(awake).toEqual(mockAwake);

    const toggled = await setAwakeActive(false);
    expect(toggled.active).toBe(false);

    const removed = await removeAwakeSetup();
    expect(removed.lidClosedReady).toBe(false);

    const band = await readBandStatus();
    expect(band).toEqual(mockBand);

    const scan = await scanBand();
    expect(scan.state).toBe("not-found");
  });

  it("handles rejected calls gracefully", async () => {
    vi.stubGlobal("window", {
      desktopBridge: {
        vexoAwake: {
          status: async () => {
            throw new Error("ipc error");
          },
          setActive: async () => {
            throw new Error("ipc error");
          },
        },
        vexoBand: {
          status: async () => {
            throw new Error("ipc error");
          },
          scan: async () => {
            throw new Error("ipc error");
          },
        },
      },
    });

    const awake = await readAwakeStatus();
    expect(awake.detail).toContain("could not be read");

    const toggled = await setAwakeActive(true);
    expect(toggled.detail).toContain("could not be read");

    const band = await readBandStatus();
    expect(band.detail).toContain("could not be read");

    const scan = await scanBand();
    expect(scan.detail).toContain("could not be read");
  });
});
