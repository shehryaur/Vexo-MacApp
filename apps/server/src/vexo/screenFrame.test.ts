// @effect-diagnostics nodeBuiltinImport:off globalFetch:off
import * as NodeServices from "@effect/platform-node/NodeServices";
import { it as effectIt } from "@effect/vitest";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterEach, beforeEach, expect, it } from "vite-plus/test";
import {
  AuthOrchestrationReadScope,
  AuthSessionId,
  EnvironmentAuthenticatedAuth,
  EnvironmentAuthenticatedPrincipal,
  EnvironmentVexoHttpApi,
  SCREEN_RECORDING_PERMISSION_MESSAGE,
  type AuthEnvironmentScope,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as HttpServer from "effect/http/HttpServer";
import * as HttpApi from "effect/http-api/HttpApi";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import * as HttpRouter from "effect/http/HttpRouter";
import {
  resetUnlockForTests,
  setSupportDirForTests,
  setUnlockInProgressForTests,
} from "../../../../packages/vexo-mac/src/unlock.ts";

import * as ServerSettings from "../serverSettings.ts";
import { layer } from "./screenHttp.ts";
import {
  latestScreenFrame,
  resetScreenFrameForTests,
  SCREEN_FRAME_INTERVAL_MS,
  setCaptureFrameForTests,
  setScreenFrameClockForTests,
} from "./screenFrame.ts";

const decodeSessionId = Schema.decodeUnknownSync(AuthSessionId);

const principal = (...scopes: AuthEnvironmentScope[]) =>
  Layer.succeed(EnvironmentAuthenticatedAuth, (effect) =>
    effect.pipe(
      Effect.provideService(EnvironmentAuthenticatedPrincipal, {
        sessionId: decodeSessionId("vexo-screen-test"),
        subject: "test",
        method: "bearer-access-token",
        scopes: new Set(scopes),
      }),
    ),
  );

beforeEach(async () => {
  setSupportDirForTests(
    await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "vexo-screen-support-")),
  );
});

afterEach(() => {
  resetUnlockForTests();
  resetScreenFrameForTests();
});

it("redacts immediately while unlock is in progress and does not capture", async () => {
  let calls = 0;
  setCaptureFrameForTests(async () => {
    calls += 1;
    return { imagePath: "/tmp/should-not-be-read.jpg" };
  });
  setUnlockInProgressForTests(true);
  await expect(latestScreenFrame()).resolves.toEqual({ ok: true, frame: { status: "redacted" } });
  expect(calls).toBe(0);
});

it("shares one capture across overlapping polls and reuses it until the interval elapses", async () => {
  let calls = 0;
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  setCaptureFrameForTests(async () => {
    calls += 1;
    await gate;
    return { redacted: true };
  });
  const first = latestScreenFrame();
  const second = latestScreenFrame();
  release();
  await expect(Promise.all([first, second])).resolves.toEqual([
    { ok: true, frame: { status: "redacted" } },
    { ok: true, frame: { status: "redacted" } },
  ]);
  expect(calls).toBe(1);

  let now = 10_000;
  setScreenFrameClockForTests(() => now);
  setCaptureFrameForTests(async () => {
    calls += 1;
    return { redacted: true };
  });
  await latestScreenFrame();
  await latestScreenFrame();
  expect(calls).toBe(2);
  now += SCREEN_FRAME_INTERVAL_MS;
  await latestScreenFrame();
  expect(calls).toBe(3);
});

it("does not publish pixels from a capture that overlaps unlock", async () => {
  const dir = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "vexo-screen-"));
  const imagePath = NodePath.join(dir, "frame.jpg");
  await NodeFSP.writeFile(imagePath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let calls = 0;
  setCaptureFrameForTests(async () => {
    calls += 1;
    await gate;
    return { imagePath };
  });
  const pending = latestScreenFrame();
  expect(calls).toBe(1);
  setUnlockInProgressForTests(true);
  await expect(latestScreenFrame()).resolves.toEqual({ ok: true, frame: { status: "redacted" } });
  setUnlockInProgressForTests(false);
  release();
  await expect(pending).resolves.toEqual({ ok: true, frame: { status: "redacted" } });
  await latestScreenFrame();
  expect(calls).toBe(2);
  await NodeFSP.rm(dir, { recursive: true, force: true });
});

it("returns jpeg base64, deletes the temp file, and reports a missing screen recording permission", async () => {
  const dir = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "vexo-screen-"));
  const imagePath = NodePath.join(dir, "frame.jpg");
  const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
  await NodeFSP.writeFile(imagePath, bytes);
  setCaptureFrameForTests(async () => ({ imagePath }));
  await expect(latestScreenFrame()).resolves.toEqual({
    ok: true,
    frame: { status: "frame", jpegBase64: bytes.toString("base64") },
  });
  await expect(NodeFSP.stat(imagePath)).rejects.toThrow();

  setCaptureFrameForTests(async () => ({ ok: false, reason: "screen_recording_unavailable" }));
  await expect(latestScreenFrame()).resolves.toEqual({
    ok: false,
    detail: SCREEN_RECORDING_PERMISSION_MESSAGE,
  });
  await NodeFSP.rm(dir, { recursive: true, force: true });
});

effectIt.effect("serves frames only to an authenticated environment member", () =>
  Effect.gen(function* () {
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
    const call = () =>
      Effect.promise(() => handler(new Request("http://localhost/api/vexo/screen/frame"), context));

    setCaptureFrameForTests(async () => ({ redacted: true }));
    const redacted = yield* call();
    expect(redacted.status).toBe(200);
    expect(redacted.headers.get("cache-control")).toBe("no-store");
    expect(yield* Effect.promise(() => redacted.json())).toEqual({ status: "redacted" });

    setCaptureFrameForTests(async () => ({ ok: false, reason: "screen_recording_unavailable" }));
    const missing = yield* call();
    expect(missing.status).toBe(503);
    expect(yield* Effect.promise(() => missing.text())).toContain("Screen Recording permission");
  }),
);

effectIt.effect("rejects a session without environment read access", () =>
  Effect.gen(function* () {
    const routes = HttpApiBuilder.layer(
      HttpApi.make("environment").add(EnvironmentVexoHttpApi),
    ).pipe(
      Layer.provide(layer),
      Layer.provide(principal()),
      Layer.provide(ServerSettings.layerTest()),
      Layer.provide(HttpServer.layerServices),
      Layer.provide(NodeServices.layer),
    );
    const { handler, dispose } = HttpRouter.toWebHandler(routes, { disableLogger: true });
    yield* Effect.addFinalizer(() => Effect.promise(dispose));
    const context = yield* Layer.build(ServerSettings.layerTest());
    setCaptureFrameForTests(async () => {
      throw new Error("capture must not run");
    });
    const response = yield* Effect.promise(() =>
      handler(new Request("http://localhost/api/vexo/screen/frame"), context),
    );
    expect(response.status).toBe(403);
  }),
);
