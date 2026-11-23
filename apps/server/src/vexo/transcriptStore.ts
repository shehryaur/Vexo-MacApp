// @effect-diagnostics nodeBuiltinImport:off globalDate:off globalFetch:off
/**
 * Conversation snippets for the agent. A set `VEXO_TRANSCRIPT_PLUGIN_URL` is read
 * first and ingest is forwarded there. A failed plug-in read falls back to the
 * local file. POST ingest always writes that file.
 */
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import type {
  VexoTranscriptContext,
  VexoTranscriptList,
  VexoTranscriptSnippet,
  VexoTranscriptSource,
} from "@t3tools/contracts";

const LAST_CONVERSATION_LABEL = "last conversation";

const MAX_STORED = 80;
const MAX_TEXT = 4_000;
const DEFAULT_LIMIT = 12;
const MAX_LIMIT = 20;
const MAX_CONTEXT_CHARS = 8_000;
const PLUGIN_TIMEOUT_MS = 2_000;

export interface TranscriptIngest {
  readonly text: string;
  readonly speaker?: string | undefined;
  readonly source?: string | undefined;
  readonly at?: string | undefined;
}

interface TranscriptRead {
  readonly limit?: number | string | undefined;
  readonly query?: string | undefined;
}

let snippets: VexoTranscriptSnippet[] = [];
let loaded = false;
let gate: Promise<void> = Promise.resolve();
let storeFileOverride: string | null = null;
let pluginUrlOverride: { readonly url: string | null } | null = null;
let fetchImpl: typeof fetch = globalThis.fetch;

function storeFile(): string {
  return (
    storeFileOverride ??
    NodePath.join(NodeOS.homedir(), "Library", "Application Support", "VexoMac", "transcripts.json")
  );
}

function pluginUrl(): string | null {
  if (pluginUrlOverride) return pluginUrlOverride.url;
  const raw = process.env.VEXO_TRANSCRIPT_PLUGIN_URL?.trim() ?? "";
  return raw.length > 0 ? raw : null;
}

export function setTranscriptStoreFileForTests(file: string | null): void {
  storeFileOverride = file;
  snippets = [];
  loaded = false;
  gate = Promise.resolve();
}

export function setTranscriptPluginUrlForTests(url: string | null | undefined): void {
  pluginUrlOverride = url === undefined ? null : { url };
}

export function setTranscriptFetchForTests(next: typeof fetch | null): void {
  fetchImpl = next ?? globalThis.fetch;
}

export function resetTranscriptStoreForTests(): void {
  snippets = [];
  loaded = false;
  gate = Promise.resolve();
  storeFileOverride = null;
  pluginUrlOverride = null;
  fetchImpl = globalThis.fetch;
}

function enqueue<T>(work: () => Promise<T>): Promise<T> {
  const run = gate.then(work, work);
  gate = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function clampLimit(value: number | string | undefined): number {
  const parsed =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : DEFAULT_LIMIT;
  if (!Number.isFinite(parsed)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, Math.floor(parsed)));
}

function optionalText(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.slice(0, max) : undefined;
}

function normalizeSnippet(value: unknown): VexoTranscriptSnippet | null {
  if (value === null || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const text = optionalText(record.text, MAX_TEXT);
  if (text === undefined) return null;
  const id = optionalText(record.id, 80) ?? NodeCrypto.randomUUID();
  const at = optionalText(record.at, 40) ?? new Date().toISOString();
  const speaker = optionalText(record.speaker, 120);
  const source = optionalText(record.source, 120);
  return {
    id,
    text,
    at,
    ...(speaker === undefined ? {} : { speaker }),
    ...(source === undefined ? {} : { source }),
  };
}

function normalizeList(value: unknown): VexoTranscriptSnippet[] {
  const list = Array.isArray(value)
    ? value
    : value !== null && typeof value === "object" && "snippets" in value
      ? (value as { snippets?: unknown }).snippets
      : [];
  if (!Array.isArray(list)) return [];
  return list.flatMap((entry) => {
    const snippet = normalizeSnippet(entry);
    return snippet === null ? [] : [snippet];
  });
}

async function ensureLoaded(): Promise<void> {
  if (loaded) return;
  loaded = true;
  try {
    const raw = await NodeFSP.readFile(storeFile(), "utf8");
    snippets = normalizeList(JSON.parse(raw)).slice(-MAX_STORED);
  } catch {
    snippets = [];
  }
}

async function persist(): Promise<void> {
  const file = storeFile();
  try {
    await NodeFSP.mkdir(NodePath.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    await NodeFSP.writeFile(tmp, JSON.stringify({ snippets }));
    await NodeFSP.rename(tmp, file);
  } catch {
    // The in-memory list still serves this process.
  }
}

async function pushPlugin(snippet: VexoTranscriptSnippet): Promise<void> {
  const base = pluginUrl();
  if (base === null) return;
  try {
    await fetchImpl(base, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(snippet),
      signal: AbortSignal.timeout(PLUGIN_TIMEOUT_MS),
    });
  } catch {
    // Local ingest already succeeded.
  }
}

async function readPlugin(input: {
  readonly limit: number;
  readonly query?: string;
}): Promise<VexoTranscriptSnippet[] | null> {
  const base = pluginUrl();
  if (base === null) return null;
  const url = new URL(base);
  url.searchParams.set("limit", String(input.limit));
  if (input.query !== undefined) url.searchParams.set("q", input.query);
  const response = await fetchImpl(url, {
    method: "GET",
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(PLUGIN_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Transcript plug-in returned ${response.status}.`);
  return normalizeList(await response.json()).slice(-input.limit);
}

function matches(snippet: VexoTranscriptSnippet, query: string): boolean {
  const haystack = `${snippet.speaker ?? ""} ${snippet.text}`.toLowerCase();
  return haystack.includes(query.toLowerCase());
}

function takeRecent(
  all: readonly VexoTranscriptSnippet[],
  limit: number,
  query: string | undefined,
): VexoTranscriptSnippet[] {
  const filtered = query === undefined ? all : all.filter((snippet) => matches(snippet, query));
  return filtered.slice(-limit);
}

function lineFor(snippet: VexoTranscriptSnippet): string {
  const speaker = snippet.speaker?.trim();
  const body = speaker ? `${speaker}: ${snippet.text}` : snippet.text;
  return `[${snippet.at}] ${body}`;
}

function formatLastConversation(
  recent: readonly VexoTranscriptSnippet[],
  message?: string,
): { readonly context: string; readonly prompt: string } {
  const lines: string[] = [];
  let used = LAST_CONVERSATION_LABEL.length + 2;
  for (let index = recent.length - 1; index >= 0; index -= 1) {
    const snippet = recent[index];
    if (snippet === undefined) continue;
    const line = lineFor(snippet);
    if (lines.length > 0 && used + line.length + 1 > MAX_CONTEXT_CHARS) break;
    lines.push(line);
    used += line.length + 1;
  }
  lines.reverse();
  const context = lines.length === 0 ? "" : `${LAST_CONVERSATION_LABEL}:\n${lines.join("\n")}`;
  const spoken = message?.trim() ?? "";
  const prompt = [context, spoken].filter((part) => part.length > 0).join("\n\n");
  return { context, prompt };
}

export function ingestTranscript(input: TranscriptIngest): Promise<VexoTranscriptSnippet> {
  return enqueue(async () => {
    await ensureLoaded();
    const snippet = normalizeSnippet({
      id: NodeCrypto.randomUUID(),
      text: input.text,
      at: input.at ?? new Date().toISOString(),
      ...(input.speaker === undefined ? {} : { speaker: input.speaker }),
      ...(input.source === undefined ? {} : { source: input.source }),
    });
    if (snippet === null) {
      throw new Error("Transcript text is empty.");
    }
    snippets = [...snippets, snippet].slice(-MAX_STORED);
    await persist();
    await pushPlugin(snippet);
    return snippet;
  });
}

async function readRecent(input: TranscriptRead): Promise<VexoTranscriptList> {
  const limit = clampLimit(input.limit);
  const query = input.query?.trim() || undefined;
  if (pluginUrl() !== null) {
    try {
      const fromPlugin = await readPlugin({ limit, ...(query === undefined ? {} : { query }) });
      if (fromPlugin !== null)
        return { source: "plugin" satisfies VexoTranscriptSource, snippets: fromPlugin };
    } catch {
      // The local file is the stand-in when the plug-in cannot be read.
    }
  }
  await ensureLoaded();
  return { source: "local", snippets: takeRecent(snippets, limit, query) };
}

export function recentTranscripts(input: TranscriptRead = {}): Promise<VexoTranscriptList> {
  return enqueue(() => readRecent(input));
}

export function transcriptContext(input: {
  readonly threadId?: string | undefined;
  readonly query?: string | undefined;
  readonly limit?: number | string | undefined;
  readonly message?: string | undefined;
}): Promise<VexoTranscriptContext> {
  return enqueue(async () => {
    const listed = await readRecent({
      ...(input.limit === undefined ? {} : { limit: input.limit }),
      ...(input.query === undefined ? {} : { query: input.query }),
    });
    const formatted = formatLastConversation(listed.snippets, input.message);
    const threadId = input.threadId?.trim() ?? "";
    return {
      source: listed.source,
      label: LAST_CONVERSATION_LABEL,
      threadId: threadId.length > 0 ? threadId : null,
      context: formatted.context,
      prompt: formatted.prompt,
      snippets: listed.snippets,
    };
  });
}
