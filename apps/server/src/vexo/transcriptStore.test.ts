// @effect-diagnostics nodeBuiltinImport:off globalFetch:off
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterEach, expect, it } from "vite-plus/test";

import {
  ingestTranscript,
  recentTranscripts,
  resetTranscriptStoreForTests,
  setTranscriptFetchForTests,
  setTranscriptPluginUrlForTests,
  setTranscriptStoreFileForTests,
  transcriptContext,
} from "./transcriptStore.ts";

let dir: string | null = null;

afterEach(async () => {
  resetTranscriptStoreForTests();
  if (dir !== null) await NodeFSP.rm(dir, { recursive: true, force: true });
  dir = null;
});

async function useStore(): Promise<void> {
  dir = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "vexo-transcript-"));
  setTranscriptStoreFileForTests(NodePath.join(dir, "transcripts.json"));
  setTranscriptPluginUrlForTests(null);
}

it("keeps ingested snippets and reloads them as the last conversation", async () => {
  await useStore();
  await ingestTranscript({ text: "earlier", at: "2026-11-22T18:00:00.000Z", speaker: "Sam" });
  await ingestTranscript({
    text: "remember the milk",
    at: "2026-11-22T18:01:00.000Z",
    source: "hey-vexo",
  });
  setTranscriptStoreFileForTests(NodePath.join(dir ?? "", "transcripts.json"));

  const listed = await recentTranscripts({ limit: 10 });
  expect(listed.source).toBe("local");
  expect(listed.snippets.map((snippet) => snippet.text)).toEqual(["earlier", "remember the milk"]);

  const context = await transcriptContext({
    threadId: "thread-1",
    query: "milk",
    message: "what was that?",
  });
  expect(context).toMatchObject({
    source: "local",
    label: "last conversation",
    threadId: "thread-1",
  });
  expect(context.context).toBe("last conversation:\n[2026-11-22T18:01:00.000Z] remember the milk");
  expect(context.prompt).toBe(`${context.context}\n\nwhat was that?`);
});

it("reads the plug-in when it is configured and falls back to the local store", async () => {
  await useStore();
  await ingestTranscript({ text: "local only", at: "2026-11-22T18:02:00.000Z" });
  setTranscriptPluginUrlForTests("http://plugin.test/transcripts");
  setTranscriptFetchForTests(async (input, init) => {
    if (init?.method === "POST") return new Response("ok");
    const url = new URL(String(input));
    expect(url.searchParams.get("q")).toBe("kitchen");
    return Response.json({
      snippets: [{ id: "plug-1", text: "in the kitchen", at: "2026-11-22T18:03:00.000Z" }],
    });
  });

  const fromPlugin = await recentTranscripts({ query: "kitchen" });
  expect(fromPlugin.source).toBe("plugin");
  expect(fromPlugin.snippets.map((snippet) => snippet.text)).toEqual(["in the kitchen"]);

  setTranscriptFetchForTests(async () => {
    throw new Error("down");
  });
  const fallback = await recentTranscripts({});
  expect(fallback.source).toBe("local");
  expect(fallback.snippets.map((snippet) => snippet.text)).toEqual(["local only"]);
});
