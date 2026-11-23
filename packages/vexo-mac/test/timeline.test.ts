import * as NodeAssert from "node:assert/strict";
import * as NodeTest from "node:test";

import { DEFAULT_VEXO_TIMELINE_SETTINGS, type VexoTimelineSettings } from "@t3tools/contracts";

import { fetchTimeline } from "../src/timeline.ts";

const originalFetch = globalThis.fetch;

const configured = (patch: Partial<VexoTimelineSettings> = {}): VexoTimelineSettings => ({
  ...DEFAULT_VEXO_TIMELINE_SETTINGS,
  enabled: true,
  baseUrl: "https://memory.example",
  ...patch,
});

NodeTest.afterEach(() => {
  globalThis.fetch = originalFetch;
});

NodeTest.test("does not call the network when the plug-in is off", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response("{}", { status: 200 });
  };
  const result = await fetchTimeline(DEFAULT_VEXO_TIMELINE_SETTINGS, new Date(2026, 10, 22, 12));
  NodeAssert.equal(result.ok, false);
  NodeAssert.equal(calls, 0);
});

NodeTest.test("requests the activities path and sends a custom auth header", async () => {
  const seen: { url?: string; authorization?: string; apiKey?: string } = {};
  globalThis.fetch = async (input, init) => {
    seen.url = String(input);
    const headers = new Headers(init?.headers);
    seen.authorization = headers.get("authorization") ?? undefined;
    seen.apiKey = headers.get("x-api-key") ?? undefined;
    return Response.json({
      items: [{ id: "walk", title: "Morning walk", at: "2026-11-22T15:00:00Z" }],
    });
  };
  const result = await fetchTimeline(
    configured({
      apiKey: "secret",
      authHeader: "X-Api-Key",
      activitiesPath: "/memory/activities?day={day}",
    }),
    new Date(2026, 10, 22, 12),
  );
  NodeAssert.equal(result.ok, true);
  NodeAssert.equal(seen.url, "https://memory.example/memory/activities?day=2026-11-22");
  NodeAssert.equal(seen.authorization, undefined);
  NodeAssert.equal(seen.apiKey, "secret");
  if (result.ok) {
    NodeAssert.equal(result.data.activities[0]?.title, "Morning walk");
    NodeAssert.equal(result.data.activities[0]?.kind, "other");
  }
});

NodeTest.test("prefixes Bearer on the Authorization header", async () => {
  let authorization = "";
  globalThis.fetch = async (_input, init) => {
    authorization = new Headers(init?.headers).get("authorization") ?? "";
    return Response.json({
      day: "2026-11-22",
      activities: [
        { id: "note", kind: "note", title: "Standup", startedAt: "2026-11-22T16:00:00Z" },
      ],
    });
  };
  const result = await fetchTimeline(configured({ apiKey: "secret" }), new Date(2026, 10, 22, 12));
  NodeAssert.equal(result.ok, true);
  NodeAssert.equal(authorization, "Bearer secret");
});
