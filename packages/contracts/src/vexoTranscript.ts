import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "./baseSchemas.ts";

/** One spoken or ingested line. `at` is an ISO-8601 timestamp. */
export const VexoTranscriptSnippet = Schema.Struct({
  id: Schema.String,
  text: Schema.String,
  at: Schema.String,
  speaker: Schema.optional(Schema.String),
  source: Schema.optional(Schema.String),
});
export type VexoTranscriptSnippet = typeof VexoTranscriptSnippet.Type;

export const VexoTranscriptIngestRequest = Schema.Struct({
  text: TrimmedNonEmptyString.check(Schema.isMaxLength(8_000)),
  speaker: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(120))),
  source: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(120))),
  at: Schema.optional(Schema.String.check(Schema.isMaxLength(40))),
});
export type VexoTranscriptIngestRequest = typeof VexoTranscriptIngestRequest.Type;

export const VexoTranscriptIngestResult = Schema.Struct({
  snippet: VexoTranscriptSnippet,
});
export type VexoTranscriptIngestResult = typeof VexoTranscriptIngestResult.Type;

export const VexoTranscriptRecentQuery = Schema.Struct({
  limit: Schema.optionalKey(Schema.String),
  q: Schema.optionalKey(Schema.String),
});
export type VexoTranscriptRecentQuery = typeof VexoTranscriptRecentQuery.Type;

export const VexoTranscriptSource = Schema.Literals(["plugin", "local"]);
export type VexoTranscriptSource = typeof VexoTranscriptSource.Type;

export const VexoTranscriptList = Schema.Struct({
  source: VexoTranscriptSource,
  snippets: Schema.Array(VexoTranscriptSnippet),
});
export type VexoTranscriptList = typeof VexoTranscriptList.Type;

export const VexoTranscriptContextRequest = Schema.Struct({
  threadId: Schema.optional(Schema.String.check(Schema.isMaxLength(200))),
  query: Schema.optional(Schema.String.check(Schema.isMaxLength(500))),
  limit: Schema.optional(Schema.Number),
  message: Schema.optional(Schema.String.check(Schema.isMaxLength(8_000))),
});
export type VexoTranscriptContextRequest = typeof VexoTranscriptContextRequest.Type;

/** `context` is the last conversation. `prompt` is that block plus `message`, ready to send. */
export const VexoTranscriptContext = Schema.Struct({
  source: VexoTranscriptSource,
  label: Schema.Literal("last conversation"),
  threadId: Schema.NullOr(Schema.String),
  context: Schema.String,
  prompt: Schema.String,
  snippets: Schema.Array(VexoTranscriptSnippet),
});
export type VexoTranscriptContext = typeof VexoTranscriptContext.Type;
