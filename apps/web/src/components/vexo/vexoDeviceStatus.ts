import type {
  DesktopVexoAwakeStatus,
  DesktopVexoBandStatus,
  DesktopVexoCliSessionRenameInput,
  DesktopVexoCliSessionRenameResult,
  DesktopVexoCliSessionResumeInput,
  DesktopVexoCliSessionResumeResult,
  DesktopVexoCliSessionsStatus,
} from "@t3tools/contracts";
import { msg } from "gt-react";

import { m } from "~/i18n/messages";

const AWAKE_BROWSER: DesktopVexoAwakeStatus = {
  active: false,
  mode: "off",
  lidClosedReady: false,
  sleepDisabled: false,
  batteryPercent: null,
  onExternalPower: null,
  thermal: "unknown",
  detail: m(msg("Open the desktop app to hold awake on this Mac.")),
};

const AWAKE_FAILED: DesktopVexoAwakeStatus = {
  ...AWAKE_BROWSER,
  detail: m(msg("The awake hold could not be read.")),
};

const BAND_BROWSER: DesktopVexoBandStatus = {
  state: "not-found",
  matches: [],
  detail: m(msg("Open the desktop app to scan for a band. Pairing is not implemented.")),
};

const BAND_FAILED: DesktopVexoBandStatus = {
  state: "not-found",
  matches: [],
  detail: m(msg("Bluetooth status could not be read. Pairing is not implemented.")),
};

function bridge(): Window["desktopBridge"] | undefined {
  if (typeof window === "undefined") return undefined;
  return window.desktopBridge;
}

export function readAwakeStatus(): Promise<DesktopVexoAwakeStatus> {
  const status = bridge()?.vexoAwake?.status;
  if (!status) return Promise.resolve(AWAKE_BROWSER);
  return status().catch(() => AWAKE_FAILED);
}

export function setAwakeActive(active: boolean): Promise<DesktopVexoAwakeStatus> {
  const setActive = bridge()?.vexoAwake?.setActive;
  if (!setActive) return Promise.resolve(AWAKE_BROWSER);
  return setActive(active).catch(() => AWAKE_FAILED);
}

export function removeAwakeSetup(): Promise<DesktopVexoAwakeStatus> {
  const removeSetup = bridge()?.vexoAwake?.removeSetup;
  if (!removeSetup) return Promise.resolve(AWAKE_BROWSER);
  return removeSetup().catch(() => AWAKE_FAILED);
}

export function readBandStatus(): Promise<DesktopVexoBandStatus> {
  const status = bridge()?.vexoBand?.status;
  if (!status) return Promise.resolve(BAND_BROWSER);
  return status().catch(() => BAND_FAILED);
}

export function scanBand(): Promise<DesktopVexoBandStatus> {
  const scan = bridge()?.vexoBand?.scan;
  if (!scan) return Promise.resolve(BAND_BROWSER);
  return scan().catch(() => BAND_FAILED);
}

const SESSIONS_BROWSER: DesktopVexoCliSessionsStatus = {
  available: false,
  sessions: [],
  detail: m(msg("Open the desktop app to list Claude, Codex, and Grok sessions on this Mac.")),
};

const SESSIONS_FAILED: DesktopVexoCliSessionsStatus = {
  available: false,
  sessions: [],
  detail: m(msg("Could not read sessions from the Vexo connector.")),
};

export function readCliSessions(): Promise<DesktopVexoCliSessionsStatus> {
  const list = bridge()?.vexoSessions?.list;
  if (!list) return Promise.resolve(SESSIONS_BROWSER);
  return list().catch(() => SESSIONS_FAILED);
}

const RESUME_BROWSER: DesktopVexoCliSessionResumeResult = {
  ok: false,
  detail: m(msg("Open the desktop app to continue a CLI session in Terminal.")),
};

export function resumeCliSession(
  input: DesktopVexoCliSessionResumeInput,
): Promise<DesktopVexoCliSessionResumeResult> {
  const resume = bridge()?.vexoSessions?.resume;
  if (!resume) return Promise.resolve(RESUME_BROWSER);
  return resume(input).catch(() => ({
    ok: false,
    detail: m(msg("Could not open Terminal for this session.")),
  }));
}

export function renameCliSession(
  input: DesktopVexoCliSessionRenameInput,
): Promise<DesktopVexoCliSessionRenameResult> {
  const rename = bridge()?.vexoSessions?.rename;
  if (!rename) {
    return Promise.resolve({
      ok: false,
      detail: m(msg("Open the desktop app to rename a CLI session.")),
    });
  }
  return rename(input).catch(() => ({
    ok: false,
    detail: m(msg("The new name could not be saved.")),
  }));
}
