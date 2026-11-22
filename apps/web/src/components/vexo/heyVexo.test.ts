import { afterEach, describe, expect, it } from "vite-plus/test";

import { __setPrimaryHttpRunnerForTests, type PrimaryHttpEffectRunner } from "~/lib/runtime";

import { heyVexoPrompt, submitHeyVexoTranscript } from "./heyVexo";

afterEach(() => {
  __setPrimaryHttpRunnerForTests();
});

describe("heyVexoPrompt", () => {
  it("keeps the last-conversation prompt and falls back to the spoken line", () => {
    expect(heyVexoPrompt("open notes", "last conversation:\nhi\n\nopen notes")).toBe(
      "last conversation:\nhi\n\nopen notes",
    );
    expect(heyVexoPrompt("  open notes  ", "  ")).toBe("open notes");
  });
});

describe("submitHeyVexoTranscript", () => {
  it("sends the bridge prompt when the transcript call succeeds", async () => {
    __setPrimaryHttpRunnerForTests(
      (async () => "last conversation:\nhi\n\nopen notes") as PrimaryHttpEffectRunner,
    );
    await expect(submitHeyVexoTranscript("open notes")).resolves.toBe(
      "last conversation:\nhi\n\nopen notes",
    );
  });

  it("sends the spoken line when the bridge is unreachable", async () => {
    __setPrimaryHttpRunnerForTests((async () => {
      throw new Error("offline");
    }) as PrimaryHttpEffectRunner);
    await expect(submitHeyVexoTranscript("open notes")).resolves.toBe("open notes");
    await expect(submitHeyVexoTranscript("   ")).resolves.toBe("");
  });
});
