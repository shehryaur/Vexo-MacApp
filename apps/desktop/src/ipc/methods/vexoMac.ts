import {
  DesktopVexoAwakeStatusSchema,
  DesktopVexoBandStatusSchema,
  type DesktopVexoAwakeStatus,
  type DesktopVexoBandStatus,
} from "@t3tools/contracts";
import { awakeStatus, bandScan, bandStatus, setAwake } from "@t3tools/vexo-mac";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import * as IpcChannels from "../channels.ts";
import * as DesktopIpc from "../DesktopIpc.ts";

const AWAKE_UNAVAILABLE: DesktopVexoAwakeStatus = {
  active: false,
  mode: "off",
  sleepDisabled: false,
  batteryPercent: null,
  onExternalPower: null,
  thermal: "unknown",
  detail: "The awake hold could not be read.",
};

const BAND_UNAVAILABLE: DesktopVexoBandStatus = {
  state: "not-found",
  matches: [],
  detail: "Bluetooth status could not be read. Pairing is not implemented.",
};

export const vexoAwakeStatus = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.VEXO_AWAKE_STATUS_CHANNEL,
  payload: Schema.Void,
  result: DesktopVexoAwakeStatusSchema,
  handler: () =>
    Effect.promise(async () => {
      try {
        return await awakeStatus();
      } catch {
        return AWAKE_UNAVAILABLE;
      }
    }),
});

export const vexoAwakeSet = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.VEXO_AWAKE_SET_CHANNEL,
  payload: Schema.Boolean,
  result: DesktopVexoAwakeStatusSchema,
  handler: (active) =>
    Effect.promise(async () => {
      try {
        return await setAwake(active);
      } catch {
        return AWAKE_UNAVAILABLE;
      }
    }),
});

export const vexoBandStatus = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.VEXO_BAND_STATUS_CHANNEL,
  payload: Schema.Void,
  result: DesktopVexoBandStatusSchema,
  handler: () =>
    Effect.promise(async () => {
      try {
        return await bandStatus();
      } catch {
        return BAND_UNAVAILABLE;
      }
    }),
});

export const vexoBandScan = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.VEXO_BAND_SCAN_CHANNEL,
  payload: Schema.Void,
  result: DesktopVexoBandStatusSchema,
  handler: () =>
    Effect.promise(async () => {
      try {
        return await bandScan();
      } catch {
        return BAND_UNAVAILABLE;
      }
    }),
});
