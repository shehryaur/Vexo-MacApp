import * as Effect from "effect/Effect";

import { PrimaryEnvironmentHttpClient } from "~/environments/primary/httpClient";
import { runPrimaryHttp } from "~/lib/runtime";

/** The bridge prompt when it has text, otherwise the spoken line. */
export function heyVexoPrompt(spoken: string, contextPrompt: string | null | undefined): string {
  const prompt = contextPrompt?.trim() ?? "";
  if (prompt.length > 0) return prompt;
  return spoken.trim();
}

/**
 * Builds a new agent message from a Mac dictation.
 * The last conversation is prepended when the transcript bridge answers.
 * The spoken line is also ingested for the next read. A failed bridge still returns the line.
 */
export async function submitHeyVexoTranscript(spoken: string): Promise<string> {
  const text = spoken.trim();
  if (text.length === 0) return "";
  try {
    const prompt = await runPrimaryHttp(
      Effect.gen(function* () {
        const client = yield* PrimaryEnvironmentHttpClient;
        const context = yield* client.vexo
          .transcriptContext({ headers: {}, payload: { message: text } })
          .pipe(Effect.orElseSucceed(() => null));
        yield* client.vexo
          .ingestTranscript({
            headers: {},
            payload: { text, source: "hey-vexo" },
          })
          .pipe(Effect.orElseSucceed(() => null));
        return heyVexoPrompt(text, context?.prompt);
      }),
    );
    return prompt.trim().length > 0 ? prompt : text;
  } catch {
    return text;
  }
}
