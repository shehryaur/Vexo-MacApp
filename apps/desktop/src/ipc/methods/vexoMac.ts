// @effect-diagnostics nodeBuiltinImport:off globalDate:off -- the rename display hold expires on wall-clock time in a plain IPC handler.
import { execFile } from "node:child_process";
import * as NodeFSSync from "node:fs";
import * as NodeFS from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { promisify } from "node:util";

import {
  DesktopVexoAwakeStatusSchema,
  DesktopVexoBandStatusSchema,
  DesktopVexoCliSessionRenameInputSchema,
  DesktopVexoCliSessionRenameResultSchema,
  DesktopVexoCliSessionResumeInputSchema,
  DesktopVexoCliSessionResumeResultSchema,
  DesktopVexoCliSessionsStatusSchema,
  type DesktopVexoAwakeStatus,
  type DesktopVexoBandStatus,
  type DesktopVexoCliSession,
  type DesktopVexoCliSessionRenameInput,
  type DesktopVexoCliSessionRenameResult,
  type DesktopVexoCliSessionResumeInput,
  type DesktopVexoCliSessionResumeResult,
  type DesktopVexoCliSessionsStatus,
} from "@t3tools/contracts";
import {
  awakeStatus,
  bandScan,
  bandStatus,
  removeLidClosedSetup,
  setAwake,
} from "@t3tools/vexo-mac";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { renameClaudeSession } from "../../vexoSessions/claudeSessionTitle.ts";
import * as IpcChannels from "../channels.ts";
import * as DesktopIpc from "../DesktopIpc.ts";

const execFileAsync = promisify(execFile);

const AWAKE_UNAVAILABLE: DesktopVexoAwakeStatus = {
  active: false,
  mode: "off",
  lidClosedReady: false,
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

export const vexoAwakeRemoveSetup = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.VEXO_AWAKE_REMOVE_SETUP_CHANNEL,
  payload: Schema.Void,
  result: DesktopVexoAwakeStatusSchema,
  handler: () =>
    Effect.promise(async () => {
      try {
        return await removeLidClosedSetup();
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

const SESSIONS_UNAVAILABLE: DesktopVexoCliSessionsStatus = {
  available: false,
  sessions: [],
  detail: "The Vexo connector has not published sessions yet.",
};

const SESSION_PROVIDERS = new Set(["claude", "codex", "grok", "antigravity"]);
const SESSION_STATES = new Set(["ready", "busy", "setup", "idle", "offline"]);
const RESUME_ID_RE = /--resume(?:=|\s+)([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/giu;

function clip(value: string, max: number): string {
  const trimmed = value.trim();
  return trimmed.length <= max ? trimmed : trimmed.slice(0, max);
}

function connectorStatusPath(): string {
  return NodePath.join(
    NodeOS.homedir(),
    "Library",
    "Application Support",
    "VexoConnector",
    "status.json",
  );
}

function connectorIsUp(raw: unknown): boolean {
  if (typeof raw !== "object" || raw === null) return false;
  const row = raw as { state?: unknown; connected?: unknown };
  return row.connected === true || row.state === "connected";
}

/**
 * Connector `offline` means "cannot receive via the Vexo bridge", not that the
 * Mac is down. When the connector itself is up, surface those as idle. Live
 * `--resume=<id>` processes upgrade to ready.
 */
async function liveResumeIds(): Promise<ReadonlySet<string>> {
  try {
    const { stdout } = await execFileAsync("/bin/ps", ["-ax", "-o", "command="], {
      maxBuffer: 8 * 1024 * 1024,
      encoding: "utf8",
    });
    const ids = new Set<string>();
    for (const line of stdout.split("\n")) {
      RESUME_ID_RE.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = RESUME_ID_RE.exec(line)) !== null) {
        const id = match[1];
        if (id) ids.add(id.toLowerCase());
      }
    }
    return ids;
  } catch {
    return new Set();
  }
}

function parseConnectorSessions(
  raw: unknown,
  liveIds: ReadonlySet<string>,
): DesktopVexoCliSession[] {
  if (typeof raw !== "object" || raw === null || !("sessions" in raw)) return [];
  const list = (raw as { sessions?: unknown }).sessions;
  if (!Array.isArray(list)) return [];
  const bridgeUp = connectorIsUp(raw);
  const sessions: DesktopVexoCliSession[] = [];
  for (const entry of list) {
    if (typeof entry !== "object" || entry === null) continue;
    const row = entry as Record<string, unknown>;
    if (typeof row.id !== "string" || typeof row.title !== "string" || typeof row.cwd !== "string") {
      continue;
    }
    const providerRaw = typeof row.provider === "string" ? row.provider.toLowerCase() : "other";
    const provider = SESSION_PROVIDERS.has(providerRaw)
      ? (providerRaw as DesktopVexoCliSession["provider"])
      : "other";
    const stateRaw = typeof row.state === "string" ? row.state.toLowerCase() : "offline";
    let state = SESSION_STATES.has(stateRaw)
      ? (stateRaw as DesktopVexoCliSession["state"])
      : "offline";
    let connected = row.connected === true;
    const id = clip(row.id, 120);
    if (liveIds.has(id.toLowerCase())) {
      // A matching CLI process is up even if the Vexo bridge has not attached yet.
      if (state === "offline" || state === "idle" || state === "setup") state = "ready";
      connected = true;
    } else if (state === "offline" && bridgeUp) {
      // Inventory from a live connector: dormant, not unreachable.
      state = "idle";
    }
    const session: DesktopVexoCliSession = {
      id,
      provider,
      title: shownTitle(id, clip(row.title, 200)),
      cwd: clip(row.cwd, 500),
      state,
      connected,
      ...(typeof row.model === "string" && row.model.trim().length > 0
        ? { model: clip(row.model, 120) }
        : {}),
    };
    sessions.push(session);
    if (sessions.length >= 500) break;
  }
  return sessions;
}

async function readConnectorSessions(): Promise<DesktopVexoCliSessionsStatus> {
  try {
    const text = await NodeFS.readFile(connectorStatusPath(), "utf8");
    const parsed: unknown = JSON.parse(text);
    const liveIds = await liveResumeIds();
    const sessions = parseConnectorSessions(parsed, liveIds);
    return {
      available: true,
      sessions,
      detail:
        sessions.length === 0
          ? "No Claude, Codex, or Grok sessions found on this Mac yet."
          : `Found ${sessions.length} session${sessions.length === 1 ? "" : "s"} on this Mac.`,
    };
  } catch {
    return SESSIONS_UNAVAILABLE;
  }
}

export const vexoSessionsList = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.VEXO_SESSIONS_LIST_CHANNEL,
  payload: Schema.Void,
  result: DesktopVexoCliSessionsStatusSchema,
  handler: () => Effect.promise(readConnectorSessions),
});

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function connectorCliPath(): string | null {
  const shortcut = NodePath.join(NodeOS.homedir(), ".local", "bin", "vexo-connector");
  try {
    NodeFSSync.accessSync(shortcut, NodeFSSync.constants.X_OK);
    return shortcut;
  } catch {
    return null;
  }
}

async function writeResumeScript(input: {
  readonly lines: readonly string[];
}): Promise<string> {
  const dir = await NodeFS.mkdtemp(NodePath.join(NodeOS.tmpdir(), "vexo-resume-"));
  const scriptPath = NodePath.join(dir, "resume.command");
  const body = ["#!/bin/zsh", "set -eu", ...input.lines, ""].join("\n");
  await NodeFS.writeFile(scriptPath, body, { mode: 0o700 });
  return scriptPath;
}

async function openInTerminal(scriptPath: string): Promise<void> {
  await execFileAsync("/usr/bin/open", ["-a", "Terminal", scriptPath]);
}

async function resumeCliSession(
  input: DesktopVexoCliSessionResumeInput,
): Promise<DesktopVexoCliSessionResumeResult> {
  const cwd = input.cwd.trim();
  const id = input.id.trim();
  if (cwd.length === 0 || id.length === 0) {
    return { ok: false, detail: "Session id or folder is missing." };
  }
  try {
    await NodeFS.access(cwd);
  } catch {
    return { ok: false, detail: "That project folder no longer exists on this Mac." };
  }

  const connector = connectorCliPath();
  const provider = input.provider;

  try {
    if (provider === "claude" || provider === "antigravity") {
      const lines =
        connector !== null
          ? [`cd ${shellQuote(cwd)}`, `exec ${shellQuote(connector)} claude ${shellQuote(id)}`]
          : [`cd ${shellQuote(cwd)}`, `exec claude --resume ${shellQuote(id)}`];
      const scriptPath = await writeResumeScript({ lines });
      await openInTerminal(scriptPath);
      return {
        ok: true,
        detail:
          connector !== null
            ? "Opened Terminal with this Claude session (Vexo channel on)."
            : "Opened Terminal with claude --resume for this session.",
      };
    }

    if (provider === "codex") {
      const lines = [
        `cd ${shellQuote(cwd)}`,
        // Codex CLI resume; falls back to starting Codex in the project folder.
        `if command -v codex >/dev/null 2>&1; then exec codex resume ${shellQuote(id)}; fi`,
        `exec codex`,
      ];
      const scriptPath = await writeResumeScript({ lines });
      await openInTerminal(scriptPath);
      return { ok: true, detail: "Opened Terminal to continue this Codex session." };
    }

    return {
      ok: false,
      detail: `Resume from Vexo is not wired for ${provider} yet. Open that CLI in the project folder.`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not open Terminal.";
    return { ok: false, detail: clip(message, 400) };
  }
}

// The connector rescans transcripts on its own schedule, so a rename shows here first.
const RENAME_HOLD_MS = 10 * 60_000;
const renamedTitles = new Map<string, { readonly title: string; readonly until: number }>();

function shownTitle(id: string, connectorTitle: string): string {
  const renamed = renamedTitles.get(id);
  if (!renamed) return connectorTitle;
  if (renamed.title === connectorTitle || Date.now() > renamed.until) {
    renamedTitles.delete(id);
    return connectorTitle;
  }
  return renamed.title;
}

async function renameCliSession(
  input: DesktopVexoCliSessionRenameInput,
): Promise<DesktopVexoCliSessionRenameResult> {
  if (input.provider !== "claude") {
    return { ok: false, detail: "Only Claude sessions can be renamed here." };
  }
  const result = await renameClaudeSession({
    claudeDir: NodePath.join(NodeOS.homedir(), ".claude"),
    id: input.id.trim(),
    title: input.title,
  });
  if (result.ok) {
    renamedTitles.set(input.id.trim(), { title: result.title, until: Date.now() + RENAME_HOLD_MS });
    return { ok: true, title: result.title, detail: "Renamed." };
  }
  switch (result.reason) {
    case "empty_title":
      return { ok: false, detail: "Type a name first." };
    case "not_found":
      return { ok: false, detail: "This Claude session's file is not on this Mac." };
    case "invalid_id":
      return { ok: false, detail: "This is not a Claude session id." };
    case "write_failed":
      return { ok: false, detail: "The new name could not be saved." };
  }
}

export const vexoSessionsRename = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.VEXO_SESSIONS_RENAME_CHANNEL,
  payload: DesktopVexoCliSessionRenameInputSchema,
  result: DesktopVexoCliSessionRenameResultSchema,
  handler: (input) => Effect.promise(() => renameCliSession(input)),
});

export const vexoSessionsResume = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.VEXO_SESSIONS_RESUME_CHANNEL,
  payload: DesktopVexoCliSessionResumeInputSchema,
  result: DesktopVexoCliSessionResumeResultSchema,
  handler: (input) => Effect.promise(() => resumeCliSession(input)),
});
