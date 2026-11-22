import {
  decodeVexoTimelineBody,
  vexoTimelineAuthHeader,
  vexoTimelineRequestUrl,
  type VexoTimelineResponse,
  type VexoTimelineSettings,
} from "@t3tools/contracts";

export type TimelineFetchResult =
  | { ok: true; data: VexoTimelineResponse }
  | { ok: false; reason: string };

function formatDay(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export async function fetchTimeline(
  settings: VexoTimelineSettings,
  date?: Date,
): Promise<TimelineFetchResult> {
  if (!settings.enabled) {
    return { ok: false, reason: "Timeline integration is not enabled" };
  }

  if (!settings.baseUrl.trim()) {
    return { ok: false, reason: "No base URL configured for timeline" };
  }

  const day = formatDay(date ?? new Date());
  const url = vexoTimelineRequestUrl(settings, day);
  if (url === null) {
    return { ok: false, reason: "Timeline URL is not a valid http address" };
  }

  const headers: Record<string, string> = { Accept: "application/json" };
  const auth = vexoTimelineAuthHeader(settings);
  if (auth !== null) headers[auth.name] = auth.value;

  try {
    const response = await fetch(url, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(15000),
      redirect: "error",
    });

    if (!response.ok) {
      return {
        ok: false,
        reason: `Timeline API returned ${response.status}`,
      };
    }

    const json = (await response.json()) as unknown;
    const data = decodeVexoTimelineBody(json, day);
    if (data === null) {
      return { ok: false, reason: "Invalid response format from timeline API" };
    }
    return { ok: true, data };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: `Failed to fetch timeline: ${message}` };
  }
}
