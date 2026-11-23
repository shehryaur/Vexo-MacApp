// @effect-diagnostics globalDate:off -- The memory plug-in asks for a local calendar day, and fetchTimeline takes a Date.
import {
  DEFAULT_VEXO_TIMELINE_SETTINGS,
  isVexoTimelineConfigured,
  type VexoTimelineDayView,
} from "@t3tools/contracts";
import { fetchTimeline } from "@t3tools/vexo-mac";
import * as Effect from "effect/Effect";

import * as ServerSettings from "../serverSettings.ts";

export function resolveTimelineDay(raw: string | undefined, nowMillis: number): string {
  const trimmed = raw?.trim() ?? "";
  if (/^\d{4}-\d{2}-\d{2}$/u.test(trimmed)) return trimmed;
  const now = new Date(nowMillis);
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

function dateForDay(day: string): Date {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(year ?? 0, (month ?? 1) - 1, date ?? 1, 12);
}

function timelineNotice(reason: string): string {
  if (reason.startsWith("Failed to fetch timeline")) return "Could not reach the memory plug-in.";
  if (reason.startsWith("Timeline API returned"))
    return reason.replace("Timeline API", "The memory plug-in");
  if (reason === "Invalid response format from timeline API") {
    return "The memory plug-in returned a timeline this app could not read.";
  }
  if (reason === "Timeline URL is not a valid http address") {
    return "The Timeline URL is not a valid http address.";
  }
  return "Could not read the memory plug-in.";
}

/** Loads one day from the saved memory plug-in. Unconfigured days do not leave the machine. */
export const readTimelineDay = Effect.fn("vexo.timeline.read")(function* (
  day: string,
): Effect.fn.Return<VexoTimelineDayView, never, ServerSettings.ServerSettingsService> {
  const service = yield* ServerSettings.ServerSettingsService;
  const settings = yield* service.getSettings.pipe(
    Effect.map((current) => current.vexoTimeline),
    Effect.orElseSucceed(() => DEFAULT_VEXO_TIMELINE_SETTINGS),
  );
  if (!isVexoTimelineConfigured(settings)) {
    return { configured: false, day, activities: [] };
  }
  const result = yield* Effect.promise(() => fetchTimeline(settings, dateForDay(day)));
  if (!result.ok) {
    return { configured: true, day, activities: [], notice: timelineNotice(result.reason) };
  }
  return {
    configured: true,
    day: result.data.day.trim().length > 0 ? result.data.day : day,
    activities: result.data.activities,
    ...(result.data.todos === undefined ? {} : { todos: result.data.todos }),
    ...(result.data.bandStepsTotal === undefined
      ? {}
      : { bandStepsTotal: result.data.bandStepsTotal }),
    ...(result.data.bandSecondsTotal === undefined
      ? {}
      : { bandSecondsTotal: result.data.bandSecondsTotal }),
  };
});
