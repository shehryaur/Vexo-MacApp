/* oxlint-disable t3code/no-global-process-runtime -- Plain Node for this Mac host. HostProcess is an Effect service and does not fit here. */
// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { run, swiftBin } from "./exec.ts";

/**
 * Best-effort Vexo band radio check.
 *
 * Names containing "vexo" and GATT UUIDs containing `a8e9` come from the firmware notes
 * (`a8e90001…`, audio channels `…0020` / `…0021`). This lists matching radios only.
 * It does not pair, connect, or claim a session with the band.
 */

const DETAIL_MAX = 400;
const MATCH_LIMIT = 8;

export type BandMatch = {
  name: string;
  id: string;
  connected: boolean;
};

export type BandStatus = {
  state: "connected" | "not-found";
  matches: BandMatch[];
  detail: string;
};

export type BandSeen = BandMatch & { uuids: readonly string[] };

const NOT_MAC: BandStatus = {
  state: "not-found",
  matches: [],
  detail: "Band scan runs on macOS. Pairing is not implemented.",
};

const UNREADABLE: BandStatus = {
  state: "not-found",
  matches: [],
  detail: "Bluetooth status could not be read. Pairing is not implemented.",
};

export function matchesVexoBand(name: string, uuids: readonly string[]): boolean {
  if (name.toLowerCase().includes("vexo")) return true;
  return uuids.some((uuid) =>
    uuid
      .replace(/[^0-9a-f]/gi, "")
      .toLowerCase()
      .includes("a8e9"),
  );
}

export function peripheralsFromProfiler(value: unknown): BandSeen[] {
  const found: BandSeen[] = [];
  walk(value, null, found);
  return found;
}

export function peripheralsFromScan(
  stdout: string,
): { ok: true; devices: BandSeen[] } | { ok: false; reason: string } {
  const line = stdout
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter((item) => item.startsWith("{"))
    .at(-1);
  if (!line) return { ok: false, reason: "unavailable" };
  try {
    const parsed = JSON.parse(line) as {
      ok?: boolean;
      reason?: string;
      peripherals?: unknown;
    };
    if (parsed.ok === false) {
      return {
        ok: false,
        reason: typeof parsed.reason === "string" ? parsed.reason : "unavailable",
      };
    }
    if (!Array.isArray(parsed.peripherals)) return { ok: false, reason: "unavailable" };
    const devices: BandSeen[] = [];
    for (const row of parsed.peripherals) {
      if (!row || typeof row !== "object") continue;
      const record = row as Record<string, unknown>;
      const uuids = Array.isArray(record.uuids)
        ? record.uuids.filter((item): item is string => typeof item === "string")
        : [];
      devices.push({
        name: typeof record.name === "string" ? record.name : "",
        id: typeof record.id === "string" ? record.id : "",
        connected: record.connected === true,
        uuids,
      });
    }
    return { ok: true, devices };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

export function summarizeBand(devices: readonly BandSeen[]): BandStatus {
  const matches = devices
    .filter((device) => matchesVexoBand(device.name, device.uuids))
    .slice(0, MATCH_LIMIT)
    .map((device) => ({
      name: device.name.trim().slice(0, 80),
      id: device.id.trim().slice(0, 80),
      connected: device.connected,
    }));
  const connected = matches.find((device) => device.connected);
  if (connected) {
    return {
      state: "connected",
      matches,
      detail: clip(
        `macOS reports ${label(connected.name)} is connected. Pairing is not implemented.`,
      ),
    };
  }
  const nearby = matches[0];
  if (nearby) {
    return {
      state: "not-found",
      matches,
      detail: clip(
        `Saw ${label(nearby.name)} nearby. It is not connected. Pairing is not implemented.`,
      ),
    };
  }
  return {
    state: "not-found",
    matches: [],
    detail: "No Vexo band was found. Pairing is not implemented.",
  };
}

/** Paired and connected radios from `system_profiler`. Does not start a live scan. */
export async function bandStatus(): Promise<BandStatus> {
  if (process.platform !== "darwin") return NOT_MAC;
  const devices = await readProfiler();
  return devices ?? UNREADABLE;
}

/**
 * Live public CoreBluetooth scan, merged with the profiler list.
 * A match is "connected" only when macOS already reports a connection.
 */
export async function bandScan(): Promise<BandStatus> {
  if (process.platform !== "darwin") return NOT_MAC;
  const profiler = (await readProfilerDevices()) ?? [];
  const result = await run(swiftBin(), [bleScanScript()], undefined, 40_000);
  const parsed = peripheralsFromScan(result.stdout);
  if (!parsed.ok) {
    const status = profiler.length > 0 ? summarizeBand(profiler) : UNREADABLE;
    return {
      ...status,
      detail: clip(`${scanNote(parsed.reason, result.stderr)} ${status.detail}`),
    };
  }
  return summarizeBand(mergeDevices(profiler, parsed.devices));
}

export function bleScanScript(): string {
  const fromMeta = NodeURL.fileURLToPath(new URL("../scripts/ble-scan.swift", import.meta.url));
  if (NodeFS.existsSync(fromMeta)) return fromMeta;
  const starts = [NodePath.dirname(fromMeta), process.cwd()];
  const seen = new Set<string>();
  for (const start of starts) {
    let dir = start;
    for (let depth = 0; depth < 8; depth += 1) {
      if (seen.has(dir)) break;
      seen.add(dir);
      const candidates = [
        NodePath.join(dir, "scripts", "ble-scan.swift"),
        NodePath.join(dir, "packages", "vexo-mac", "scripts", "ble-scan.swift"),
      ];
      for (const candidate of candidates) {
        if (NodeFS.existsSync(candidate)) return candidate;
      }
      const parent = NodePath.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return fromMeta;
}

function walk(node: unknown, connected: boolean | null, out: BandSeen[]): void {
  if (Array.isArray(node)) {
    for (const item of node) walk(item, connected, out);
    return;
  }
  if (!node || typeof node !== "object") return;
  const record = node as Record<string, unknown>;
  if ("device_connected" in record) walk(record.device_connected, true, out);
  if ("device_not_connected" in record) walk(record.device_not_connected, false, out);
  for (const [key, value] of Object.entries(record)) {
    if (key === "device_connected" || key === "device_not_connected") continue;
    if (Array.isArray(value)) {
      walk(value, connected, out);
      continue;
    }
    if (!value || typeof value !== "object") continue;
    const child = value as Record<string, unknown>;
    if (isDevice(child)) {
      const flag = connectedFlag(child.device_isconnected);
      const strings: string[] = [];
      collectStrings(child, strings);
      out.push({
        name: key,
        id: typeof child.device_address === "string" ? child.device_address : "",
        connected: flag ?? connected ?? false,
        uuids: strings,
      });
      continue;
    }
    if (!key.startsWith("controller_")) walk(child, connected, out);
  }
}

function isDevice(child: Record<string, unknown>): boolean {
  return (
    "device_address" in child ||
    "device_isconnected" in child ||
    "device_minorType" in child ||
    "device_services" in child
  );
}

function connectedFlag(value: unknown): boolean | null {
  if (value === true) return true;
  if (value === false) return false;
  if (typeof value !== "string") return null;
  const text = value.toLowerCase();
  if (text.includes("yes")) return true;
  if (text === "no" || text.endsWith("_no")) return false;
  return null;
}

function collectStrings(value: unknown, out: string[]): void {
  if (typeof value === "string") {
    out.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, out);
    return;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) collectStrings(item, out);
  }
}

async function readProfiler(): Promise<BandStatus | null> {
  const devices = await readProfilerDevices();
  if (!devices) return null;
  return summarizeBand(devices);
}

async function readProfilerDevices(): Promise<BandSeen[] | null> {
  const result = await run(
    "/usr/sbin/system_profiler",
    ["SPBluetoothDataType", "-json"],
    undefined,
    12_000,
  );
  const start = result.stdout.indexOf("{");
  if (start < 0) return null;
  try {
    return peripheralsFromProfiler(JSON.parse(result.stdout.slice(start)));
  } catch {
    return null;
  }
}

function mergeDevices(left: readonly BandSeen[], right: readonly BandSeen[]): BandSeen[] {
  const out: BandSeen[] = [];
  for (const device of [...left, ...right]) {
    const key = `${device.id}|${device.name}`.toLowerCase();
    const existing = out.find((item) => `${item.id}|${item.name}`.toLowerCase() === key);
    if (!existing) {
      out.push({ ...device, uuids: [...device.uuids] });
      continue;
    }
    if (device.connected) existing.connected = true;
    existing.uuids = [...existing.uuids, ...device.uuids];
  }
  return out;
}

function scanNote(reason: string, stderr: string): string {
  if (reason === "powered_off") return "Bluetooth is off.";
  if (reason === "unauthorized") return "Bluetooth permission was denied.";
  if (reason === "unsupported") return "This Mac has no Bluetooth radio.";
  if (stderr.includes("timed_out")) return "The nearby scan timed out.";
  if (stderr.includes("not_found")) return "The nearby scan could not run.";
  return "The nearby scan could not run.";
}

function label(name: string): string {
  return name.trim().length > 0 ? name.trim() : "a matching radio";
}

function clip(text: string): string {
  return text.slice(0, DETAIL_MAX);
}
