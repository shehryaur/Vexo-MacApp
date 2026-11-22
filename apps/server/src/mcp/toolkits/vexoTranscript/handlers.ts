import { OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import * as McpToolAccess from "../../McpToolAccess.ts";
import { transcriptContext } from "../../../vexo/transcriptStore.ts";
import { VexoTranscriptToolkit } from "./tools.ts";

const unavailable = () =>
  new OrchestratorMcpFailure({
    code: "orchestration_error",
    message: "Could not read the conversation transcript.",
  });

const handlers = {
  vexo_transcript_recent: McpToolAccess.readsAsCaller((input) =>
    Effect.tryPromise({
      try: () =>
        transcriptContext({
          ...(input.limit === undefined ? {} : { limit: input.limit }),
          ...(input.threadId === undefined ? {} : { threadId: input.threadId }),
        }),
      catch: unavailable,
    }),
  ),
  vexo_memory_query: McpToolAccess.readsAsCaller((input) =>
    Effect.tryPromise({
      try: () =>
        transcriptContext({
          query: input.query,
          ...(input.limit === undefined ? {} : { limit: input.limit }),
          ...(input.threadId === undefined ? {} : { threadId: input.threadId }),
        }),
      catch: unavailable,
    }),
  ),
} satisfies McpToolAccess.Handlers<typeof VexoTranscriptToolkit.tools>;

export const layer = McpToolAccess.toLayer(VexoTranscriptToolkit, handlers);
