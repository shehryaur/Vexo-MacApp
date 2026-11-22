import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  EnvironmentHttpApi,
  EnvironmentInternalError,
  VexoScreenCaptureError,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as HttpEffect from "effect/http/HttpEffect";
import { HttpServerResponse } from "effect/http";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";

import { annotateEnvironmentRequest, requireEnvironmentScope } from "../auth/http.ts";
import { latestScreenFrame } from "./screenFrame.ts";
import { readTimelineDay, resolveTimelineDay } from "./timeline.ts";
import { ingestTranscript, recentTranscripts, transcriptContext } from "./transcriptStore.ts";

const traceId = Effect.currentParentSpan.pipe(
  Effect.map((span) => span.traceId),
  Effect.orElseSucceed(() => "unavailable"),
);

const fromStore = Effect.fn("vexo.transcript.fromStore")(function* <A>(read: () => Promise<A>) {
  const currentTraceId = yield* traceId;
  return yield* Effect.tryPromise({
    try: read,
    catch: (cause: unknown) =>
      new EnvironmentInternalError({
        code: "internal_error",
        reason: "internal_error",
        detail: cause instanceof Error ? cause.message : "Could not read the transcript.",
        traceId: currentTraceId,
      }),
  });
});

const noStore = HttpEffect.appendPreResponseHandler((_request, response) =>
  Effect.succeed(
    HttpServerResponse.setHeaders(response, {
      "cache-control": "no-store",
      pragma: "no-cache",
    }),
  ),
);

/**
 * Vexo routes for an authenticated environment member.
 * Screen frames are view-only: this route does not accept clicks, keys, or other remote control.
 */
export const layer = HttpApiBuilder.group(
  EnvironmentHttpApi,
  "vexo",
  // oxlint-disable-next-line require-yield -- The group builder returns the handler chain. Each route yields its own work.
  Effect.fnUntraced(function* (handlers) {
    return handlers
      .handle(
        "screenFrame",
        Effect.fn("environment.vexo.screenFrame")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* noStore;
          yield* requireEnvironmentScope(AuthOrchestrationReadScope);
          const result = yield* Effect.promise(() => latestScreenFrame());
          if (!result.ok) {
            return yield* new VexoScreenCaptureError({
              code: "screen_capture_unavailable",
              detail: result.detail,
            });
          }
          return result.frame;
        }),
      )
      .handle(
        "ingestTranscript",
        Effect.fn("environment.vexo.ingestTranscript")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* noStore;
          yield* requireEnvironmentScope(AuthOrchestrationOperateScope);
          const snippet = yield* fromStore(() => ingestTranscript(args.payload));
          return { snippet };
        }),
      )
      .handle(
        "transcriptRecent",
        Effect.fn("environment.vexo.transcriptRecent")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* noStore;
          yield* requireEnvironmentScope(AuthOrchestrationReadScope);
          return yield* fromStore(() =>
            recentTranscripts({
              ...(args.query.limit === undefined ? {} : { limit: args.query.limit }),
              ...(args.query.q === undefined ? {} : { query: args.query.q }),
            }),
          );
        }),
      )
      .handle(
        "transcriptContext",
        Effect.fn("environment.vexo.transcriptContext")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* noStore;
          yield* requireEnvironmentScope(AuthOrchestrationReadScope);
          return yield* fromStore(() => transcriptContext(args.payload));
        }),
      )
      .handle(
        "timelineDay",
        Effect.fn("environment.vexo.timelineDay")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* noStore;
          yield* requireEnvironmentScope(AuthOrchestrationReadScope);
          const now = yield* Clock.currentTimeMillis;
          return yield* readTimelineDay(resolveTimelineDay(args.query.day, now));
        }),
      );
  }),
);
