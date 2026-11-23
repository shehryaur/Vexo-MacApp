import {
  DEFAULT_TEXT_GENERATION_MODEL_BY_PROVIDER,
  type ModelSelection,
  ProviderDriverKind,
  type ServerProvider,
} from "@t3tools/contracts";

import {
  deriveProviderInstanceEntries,
  isProviderInstancePickerReady,
} from "../../providerInstances";

const CLAUDE_DRIVER = ProviderDriverKind.make("claudeAgent");

/** Prefer newest Haiku first; fall back to any Claude slug that looks like Haiku. */
const PREFERRED_HAIKU_SLUGS = [
  "claude-haiku-5-5",
  "claude-haiku-4-5",
  "claude-haiku-4-5-20251001",
] as const;

function isHaikuSlug(slug: string): boolean {
  return /haiku/i.test(slug);
}

/**
 * Small Claude model for Ask Vexo home jobs — stays off the agent dashboard.
 * Prefers an enabled Claude provider with a Haiku catalog entry.
 */
export function resolveVexoAskModelSelection(
  providers: ReadonlyArray<ServerProvider>,
): ModelSelection | null {
  const entries = deriveProviderInstanceEntries(providers).filter(
    (entry) => entry.driverKind === CLAUDE_DRIVER && isProviderInstancePickerReady(entry),
  );
  if (entries.length === 0) return null;

  for (const preferred of PREFERRED_HAIKU_SLUGS) {
    for (const entry of entries) {
      if (entry.models.some((model) => model.slug === preferred)) {
        return { instanceId: entry.instanceId, model: preferred };
      }
    }
  }

  for (const entry of entries) {
    const haiku = entry.models.find((model) => isHaikuSlug(model.slug));
    if (haiku !== undefined) {
      return { instanceId: entry.instanceId, model: haiku.slug };
    }
  }

  const fallbackSlug =
    DEFAULT_TEXT_GENERATION_MODEL_BY_PROVIDER[CLAUDE_DRIVER] ?? PREFERRED_HAIKU_SLUGS[0];
  const entry = entries[0];
  if (entry === undefined) return null;
  return { instanceId: entry.instanceId, model: fallbackSlug };
}
