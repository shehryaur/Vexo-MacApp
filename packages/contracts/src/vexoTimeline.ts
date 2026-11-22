import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

const DEFAULT_ACTIVITIES_PATH = "/v1/activities?day={day}";

export const VexoTimelineSettings = Schema.Struct({
  enabled: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  baseUrl: Schema.String.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
  apiKey: Schema.String.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
  authHeader: Schema.String.pipe(Schema.withDecodingDefault(Effect.succeed("Authorization"))),
  /** Activities path template. `{day}` is the date. Empty falls back to `dayPathTemplate`. */
  activitiesPath: Schema.String.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
  dayPathTemplate: Schema.String.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_ACTIVITIES_PATH)),
  ),
});
export type VexoTimelineSettings = typeof VexoTimelineSettings.Type;

export const DEFAULT_VEXO_TIMELINE_SETTINGS: VexoTimelineSettings = {
  enabled: false,
  baseUrl: "",
  apiKey: "",
  authHeader: "Authorization",
  activitiesPath: "",
  dayPathTemplate: DEFAULT_ACTIVITIES_PATH,
};

/** A base URL is saved and the plug-in is turned on. */
export function isVexoTimelineConfigured(settings: VexoTimelineSettings): boolean {
  return settings.enabled && settings.baseUrl.trim().length > 0;
}

/** Activities path template, with `{day}` left for the caller to fill. */
function vexoTimelineActivitiesPath(settings: VexoTimelineSettings): string {
  const explicit = settings.activitiesPath.trim();
  if (explicit.length > 0) return explicit;
  const fallback = settings.dayPathTemplate.trim();
  return fallback.length > 0 ? fallback : DEFAULT_ACTIVITIES_PATH;
}

/** Absolute http(s) URL for one day, or null when the plug-in is off or the URL is invalid. */
export function vexoTimelineRequestUrl(settings: VexoTimelineSettings, day: string): string | null {
  if (!isVexoTimelineConfigured(settings)) return null;
  const template = vexoTimelineActivitiesPath(settings).replaceAll(
    "{day}",
    encodeURIComponent(day),
  );
  try {
    const url = /^https?:\/\//iu.test(template)
      ? new URL(template)
      : new URL(
          template.startsWith("/") ? template : `/${template}`,
          settings.baseUrl.trim().endsWith("/")
            ? settings.baseUrl.trim()
            : `${settings.baseUrl.trim()}/`,
        );
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** Header for the API key. `Authorization` sends Bearer when the key has no scheme. */
export function vexoTimelineAuthHeader(
  settings: VexoTimelineSettings,
): { readonly name: string; readonly value: string } | null {
  const key = settings.apiKey.trim();
  if (key.length === 0) return null;
  const requested = settings.authHeader.trim();
  const name = /^[A-Za-z0-9-]+$/u.test(requested) ? requested : "Authorization";
  const value = name.toLowerCase() === "authorization" && !/\s/u.test(key) ? `Bearer ${key}` : key;
  return { name, value };
}

export const VexoTodoStatus = Schema.Literals(["pending", "in_progress", "done", "dismissed"]);
export type VexoTodoStatus = typeof VexoTodoStatus.Type;

export const VexoTodoExecutor = Schema.Literals(["vexo", "claude", "codex"]);
export type VexoTodoExecutor = typeof VexoTodoExecutor.Type;

export const VexoTodoStep = Schema.Struct({
  label: Schema.String,
  object: Schema.optional(Schema.String),
  state: Schema.optional(Schema.String),
});
export type VexoTodoStep = typeof VexoTodoStep.Type;

export const VexoTodo = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  status: VexoTodoStatus,
  executor: Schema.optional(VexoTodoExecutor),
  steps: Schema.optional(Schema.Array(VexoTodoStep)),
  createdAt: Schema.optional(Schema.String),
});
export type VexoTodo = typeof VexoTodo.Type;

export const VexoWorkoutEntry = Schema.Struct({
  id: Schema.String,
  type: Schema.optional(Schema.String),
  bandSteps: Schema.optional(Schema.Number),
  bandSeconds: Schema.optional(Schema.Number),
  bandMinuteSteps: Schema.optional(Schema.Array(Schema.Number)),
  bandPending: Schema.optional(Schema.Boolean),
  startedAt: Schema.optional(Schema.String),
});
export type VexoWorkoutEntry = typeof VexoWorkoutEntry.Type;

export const VexoFoodEntry = Schema.Struct({
  id: Schema.String,
  name: Schema.optional(Schema.String),
  kcal: Schema.optional(Schema.Number),
  protein: Schema.optional(Schema.Number),
  carbs: Schema.optional(Schema.Number),
  fat: Schema.optional(Schema.Number),
  numbersSaid: Schema.optional(Schema.Boolean),
  estimated: Schema.optional(Schema.Boolean),
  loggedAt: Schema.optional(Schema.String),
});
export type VexoFoodEntry = typeof VexoFoodEntry.Type;

export const VexoTimelineActivityKind = Schema.Literals([
  "workout",
  "meal",
  "meeting",
  "task",
  "note",
  "call",
  "other",
]);
export type VexoTimelineActivityKind = typeof VexoTimelineActivityKind.Type;

export const VexoTimelineActivity = Schema.Struct({
  id: Schema.String,
  kind: VexoTimelineActivityKind,
  title: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  startedAt: Schema.String,
  endedAt: Schema.optional(Schema.String),
  workout: Schema.optional(VexoWorkoutEntry),
  food: Schema.optional(VexoFoodEntry),
  todo: Schema.optional(VexoTodo),
});
export type VexoTimelineActivity = typeof VexoTimelineActivity.Type;

export const VexoTimelineResponse = Schema.Struct({
  day: Schema.String,
  activities: Schema.Array(VexoTimelineActivity),
  todos: Schema.optional(Schema.Array(VexoTodo)),
  bandStepsTotal: Schema.optional(Schema.Number),
  bandSecondsTotal: Schema.optional(Schema.Number),
});
export type VexoTimelineResponse = typeof VexoTimelineResponse.Type;

const decodeTimelineResponse = Schema.decodeUnknownOption(VexoTimelineResponse);
const ACTIVITY_KINDS: ReadonlySet<string> = new Set([
  "workout",
  "meal",
  "meeting",
  "task",
  "note",
  "call",
  "other",
]);

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function stringField(record: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) return value;
  }
  return undefined;
}

function unwrapTimelineBody(body: unknown): unknown {
  const record = asRecord(body);
  return record !== null && "data" in record ? record.data : body;
}

function looseActivity(value: unknown, index: number): VexoTimelineActivity | null {
  const record = asRecord(value);
  if (record === null) return null;
  const kindValue = record.kind;
  const kind =
    typeof kindValue === "string" && ACTIVITY_KINDS.has(kindValue)
      ? (kindValue as VexoTimelineActivityKind)
      : "other";
  const title = stringField(record, ["title", "name", "summary"]);
  const description = stringField(record, ["description", "detail"]);
  const startedAt = stringField(record, ["startedAt", "at", "time", "timestamp"]) ?? "";
  const endedAt = stringField(record, ["endedAt"]);
  return {
    id: stringField(record, ["id"]) ?? `activity-${index}`,
    kind,
    startedAt,
    ...(title === undefined ? {} : { title }),
    ...(description === undefined ? {} : { description }),
    ...(endedAt === undefined ? {} : { endedAt }),
  };
}

function looseTodos(value: unknown): ReadonlyArray<VexoTodo> | undefined {
  if (!Array.isArray(value)) return undefined;
  const todos: VexoTodo[] = [];
  for (const [index, entry] of value.entries()) {
    const record = asRecord(entry);
    if (record === null) continue;
    const title = stringField(record, ["title", "name"]);
    if (title === undefined) continue;
    const status = record.status;
    todos.push({
      id: stringField(record, ["id"]) ?? `todo-${index}`,
      title,
      status:
        status === "pending" ||
        status === "in_progress" ||
        status === "done" ||
        status === "dismissed"
          ? status
          : "pending",
    });
  }
  return todos;
}

/** Reads a plug-in body, including a bare list or an `{ activities }` / `{ items }` object. */
export function decodeVexoTimelineBody(body: unknown, day: string): VexoTimelineResponse | null {
  const unwrapped = unwrapTimelineBody(body);
  const strict = decodeTimelineResponse(unwrapped);
  if (Option.isSome(strict)) {
    return strict.value.day.trim().length > 0 ? strict.value : { ...strict.value, day };
  }
  const source = asRecord(unwrapped);
  const list = Array.isArray(unwrapped)
    ? unwrapped
    : source !== null && Array.isArray(source.activities)
      ? source.activities
      : source !== null && Array.isArray(source.items)
        ? source.items
        : null;
  if (list === null) return null;
  const activities = list.flatMap((entry, index) => {
    const activity = looseActivity(entry, index);
    return activity === null ? [] : [activity];
  });
  if (activities.length === 0 && list.length > 0) return null;
  const todos = source === null ? undefined : looseTodos(source.todos);
  const bandStepsTotal =
    source !== null && typeof source.bandStepsTotal === "number"
      ? source.bandStepsTotal
      : undefined;
  const bandSecondsTotal =
    source !== null && typeof source.bandSecondsTotal === "number"
      ? source.bandSecondsTotal
      : undefined;
  return {
    day: source === null ? day : (stringField(source, ["day"]) ?? day),
    activities,
    ...(todos === undefined ? {} : { todos }),
    ...(bandStepsTotal === undefined ? {} : { bandStepsTotal }),
    ...(bandSecondsTotal === undefined ? {} : { bandSecondsTotal }),
  };
}

/** One day of the memory plug-in, including the not-configured and error states. */
export const VexoTimelineDayView = Schema.Struct({
  configured: Schema.Boolean,
  day: Schema.String,
  activities: Schema.Array(VexoTimelineActivity),
  todos: Schema.optional(Schema.Array(VexoTodo)),
  bandStepsTotal: Schema.optional(Schema.Number),
  bandSecondsTotal: Schema.optional(Schema.Number),
  notice: Schema.optional(Schema.String),
});
export type VexoTimelineDayView = typeof VexoTimelineDayView.Type;
