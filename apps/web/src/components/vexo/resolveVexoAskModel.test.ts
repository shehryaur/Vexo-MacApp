import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { resolveVexoAskModelSelection } from "./resolveVexoAskModel";

const CLAUDE = ProviderDriverKind.make("claudeAgent");
const CODEX = ProviderDriverKind.make("codex");

function provider(partial: {
  readonly instanceId: string;
  readonly driver: ProviderDriverKind;
  readonly models: ReadonlyArray<string>;
  readonly enabled?: boolean;
  readonly status?: ServerProvider["status"];
}): ServerProvider {
  return ({
    instanceId: ProviderInstanceId.make(partial.instanceId),
    driver: partial.driver,
    enabled: partial.enabled ?? true,
    installed: true,
    version: "1",
    status: partial.status ?? "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-11-23T00:00:00.000Z",
    models: partial.models.map((slug) => ({
      slug,
      name: slug,
      isCustom: false,
      capabilities: null,
    })),
  } as unknown) as ServerProvider;
}

describe("resolveVexoAskModelSelection", () => {
  it("prefers Claude Haiku 5.5 when listed", () => {
    expect(
      resolveVexoAskModelSelection([
        provider({
          instanceId: "claudeAgent",
          driver: CLAUDE,
          models: ["claude-sonnet-4-6", "claude-haiku-5-5", "claude-haiku-4-5"],
        }),
      ]),
    ).toEqual({
      instanceId: ProviderInstanceId.make("claudeAgent"),
      model: "claude-haiku-5-5",
    });
  });

  it("falls back to any Haiku slug on Claude", () => {
    expect(
      resolveVexoAskModelSelection([
        provider({
          instanceId: "claude_work",
          driver: CLAUDE,
          models: ["claude-opus-4-6", "claude-haiku-4-5-20251001"],
        }),
      ]),
    ).toEqual({
      instanceId: ProviderInstanceId.make("claude_work"),
      model: "claude-haiku-4-5-20251001",
    });
  });

  it("ignores non-Claude providers", () => {
    expect(
      resolveVexoAskModelSelection([
        provider({
          instanceId: "codex",
          driver: CODEX,
          models: ["gpt-5.4"],
        }),
      ]),
    ).toBeNull();
  });

  it("skips disabled Claude instances", () => {
    expect(
      resolveVexoAskModelSelection([
        provider({
          instanceId: "claudeAgent",
          driver: CLAUDE,
          models: ["claude-haiku-5-5"],
          enabled: false,
        }),
      ]),
    ).toBeNull();
  });
});
