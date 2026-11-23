// @effect-diagnostics nodeBuiltinImport:off globalFetch:off
import * as NodeServices from "@effect/platform-node/NodeServices";
import { it as effectIt } from "@effect/vitest";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterEach, expect } from "vite-plus/test";
import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  AuthSessionId,
  EnvironmentAuthenticatedAuth,
  EnvironmentAuthenticatedPrincipal,
  EnvironmentVexoHttpApi,
  type AuthEnvironmentScope,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as HttpServer from "effect/http/HttpServer";
import * as HttpApi from "effect/http-api/HttpApi";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import * as HttpRouter from "effect/http/HttpRouter";

import * as ServerSettings from "../serverSettings.ts";
import { layer } from "./screenHttp.ts";
import {
  resetTranscriptStoreForTests,
  setTranscriptPluginUrlForTests,
  setTranscriptStoreFileForTests,
} from "./transcriptStore.ts";

const decodeSessionId = Schema.decodeUnknownSync(AuthSessionId);

const principal = (...scopes: AuthEnvironmentScope[]) =>
  Layer.succeed(EnvironmentAuthenticatedAuth, (effect) =>
    effect.pipe(
      Effect.provideService(EnvironmentAuthenticatedPrincipal, {
        sessionId: decodeSessionId("vexo-transcript-test"),
        subject: "test",
        method: "bearer-access-token",
        scopes: new Set(scopes),
      }),
    ),
  );

let dir: string | null = null;

afterEach(async () => {
  resetTranscriptStoreForTests();
  if (dir !== null) await NodeFSP.rm(dir, { recursive: true, force: true });
  dir = null;
});

effectIt.effect("ingests a snippet and returns it as last-conversation context", () =>
  Effect.gen(function* () {
    dir = yield* Effect.promise(() =>
      NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "vexo-transcript-http-")),
    );
    setTranscriptStoreFileForTests(NodePath.join(dir, "transcripts.json"));
    setTranscriptPluginUrlForTests(null);
    const routes = HttpApiBuilder.layer(
      HttpApi.make("environment").add(EnvironmentVexoHttpApi),
    ).pipe(
      Layer.provide(layer),
      Layer.provide(principal(AuthOrchestrationReadScope, AuthOrchestrationOperateScope)),
      Layer.provide(ServerSettings.layerTest()),
      Layer.provide(HttpServer.layerServices),
      Layer.provide(NodeServices.layer),
    );
    const { handler, dispose } = HttpRouter.toWebHandler(routes, { disableLogger: true });
    yield* Effect.addFinalizer(() => Effect.promise(dispose));
    const context = yield* Layer.build(ServerSettings.layerTest());
    const call = (request: Request) => Effect.promise(() => handler(request, context));

    const ingested = yield* call(
      new Request("http://localhost/api/vexo/transcript", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "remember the milk", at: "2026-11-22T18:01:00.000Z" }),
      }),
    );
    expect(ingested.status).toBe(200);
    const stored = (yield* Effect.promise(() => ingested.json())) as {
      snippet: { text: string };
    };
    expect(stored.snippet.text).toBe("remember the milk");

    const recent = yield* call(new Request("http://localhost/api/vexo/transcript?limit=5"));
    expect(recent.status).toBe(200);
    expect(recent.headers.get("cache-control")).toBe("no-store");
    expect(yield* Effect.promise(() => recent.json())).toMatchObject({
      source: "local",
      snippets: [{ text: "remember the milk" }],
    });

    const built = yield* call(
      new Request("http://localhost/api/vexo/transcript/context", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ threadId: "thread-9", message: "what was that?" }),
      }),
    );
    expect(built.status).toBe(200);
    const payload = (yield* Effect.promise(() => built.json())) as {
      label: string;
      threadId: string;
      prompt: string;
    };
    expect(payload.label).toBe("last conversation");
    expect(payload.threadId).toBe("thread-9");
    expect(payload.prompt).toContain("remember the milk");
    expect(payload.prompt).toContain("what was that?");
  }),
);

effectIt.effect("refuses ingest without operate access", () =>
  Effect.gen(function* () {
    dir = yield* Effect.promise(() =>
      NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "vexo-transcript-http-")),
    );
    setTranscriptStoreFileForTests(NodePath.join(dir, "transcripts.json"));
    const routes = HttpApiBuilder.layer(
      HttpApi.make("environment").add(EnvironmentVexoHttpApi),
    ).pipe(
      Layer.provide(layer),
      Layer.provide(principal(AuthOrchestrationReadScope)),
      Layer.provide(ServerSettings.layerTest()),
      Layer.provide(HttpServer.layerServices),
      Layer.provide(NodeServices.layer),
    );
    const { handler, dispose } = HttpRouter.toWebHandler(routes, { disableLogger: true });
    yield* Effect.addFinalizer(() => Effect.promise(dispose));
    const context = yield* Layer.build(ServerSettings.layerTest());
    const response = yield* Effect.promise(() =>
      handler(
        new Request("http://localhost/api/vexo/transcript", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text: "nope" }),
        }),
        context,
      ),
    );
    expect(response.status).toBe(403);
  }),
);
