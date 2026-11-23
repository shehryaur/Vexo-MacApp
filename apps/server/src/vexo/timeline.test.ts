import { describe, expect, it } from "@effect/vitest";
import { DEFAULT_VEXO_TIMELINE_SETTINGS } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import * as ServerSettings from "../serverSettings.ts";
import { readTimelineDay, resolveTimelineDay } from "./timeline.ts";

describe("vexo timeline", () => {
  it("uses a valid day and otherwise the local date", () => {
    expect(resolveTimelineDay("2026-11-22", Date.UTC(2026, 0, 1))).toBe("2026-11-22");
    expect(resolveTimelineDay("tomorrow", Date.parse("2026-11-22T20:00:00Z"))).toMatch(
      /^\d{4}-\d{2}-\d{2}$/u,
    );
  });

  it.effect("does not fetch when the plug-in is not configured", () =>
    Effect.gen(function* () {
      let calls = 0;
      const original = globalThis.fetch;
      globalThis.fetch = async () => {
        calls += 1;
        return new Response("{}", { status: 200 });
      };
      try {
        const view = yield* readTimelineDay("2026-11-22").pipe(
          Effect.provide(ServerSettings.layerTest()),
        );
        expect(view).toEqual({ configured: false, day: "2026-11-22", activities: [] });
        expect(calls).toBe(0);
        expect(DEFAULT_VEXO_TIMELINE_SETTINGS.enabled).toBe(false);
      } finally {
        globalThis.fetch = original;
      }
    }),
  );

  it.effect("keeps a saved api key when the activities path changes", () =>
    Effect.gen(function* () {
      const settings = yield* ServerSettings.ServerSettingsService;
      const saved = yield* settings.updateSettings({
        vexoTimeline: {
          ...DEFAULT_VEXO_TIMELINE_SETTINGS,
          enabled: true,
          baseUrl: "https://memory.example",
          apiKey: "secret",
          activitiesPath: "/v1/activities?day={day}",
        },
      });
      const next = yield* settings.updateSettings({
        vexoTimeline: { ...saved.vexoTimeline, activitiesPath: "/day/{day}" },
      });
      expect(next.vexoTimeline.apiKey).toBe("secret");
      expect(next.vexoTimeline.baseUrl).toBe("https://memory.example");
      expect(next.vexoTimeline.activitiesPath).toBe("/day/{day}");
    }).pipe(Effect.provide(ServerSettings.layerTest())),
  );
});
