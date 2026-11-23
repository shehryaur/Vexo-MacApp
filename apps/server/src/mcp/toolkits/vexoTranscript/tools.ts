import { OrchestratorMcpFailure, VexoTranscriptContext } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { McpSchema, Tool, Toolkit } from "effect/ai";

import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const dependencies = [
  McpInvocationContext.McpInvocationContext,
  ThreadManagementService.ThreadManagementService,
];

const present = <T extends Tool.Any>(tool: T, title: string): T =>
  tool
    .annotate(Tool.Title, title)
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false)
    .annotate(Tool.Idempotent, true)
    .annotate(Tool.OpenWorld, true)
    .annotate(McpSchema.EnabledWhen, McpInvocationContext.hiddenFromOutsideClients) as T;

const limitField = () =>
  Schema.optional(
    Schema.Number.annotate({ description: "How many snippets to keep, from 1 to 20. Default 12." }),
  );
const threadField = () =>
  Schema.optional(
    Schema.String.annotate({
      description:
        "Existing thread this last conversation is for. Leave it out when the next message starts a new thread.",
    }),
  );

const VexoTranscriptRecentTool = present(
  Tool.make("vexo_transcript_recent", {
    description:
      "Recent conversation snippets. Reads VEXO_TRANSCRIPT_PLUGIN_URL when set, otherwise the local ingest store. context is the last conversation to send to a new or existing thread.",
    parameters: Schema.Struct({ limit: limitField(), threadId: threadField() }),
    success: VexoTranscriptContext,
    failure: OrchestratorMcpFailure,
    failureMode: "return",
    dependencies,
  }),
  "Recent transcript",
);

const VexoMemoryQueryTool = present(
  Tool.make("vexo_memory_query", {
    description:
      "Search conversation snippets from the transcript plug-in, or the local ingest store. context is the matching last conversation to send to a new or existing thread.",
    parameters: Schema.Struct({
      query: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(500)).annotate({
        description: "Words to match in the conversation.",
      }),
      limit: limitField(),
      threadId: threadField(),
    }),
    success: VexoTranscriptContext,
    failure: OrchestratorMcpFailure,
    failureMode: "return",
    dependencies,
  }),
  "Query conversation memory",
);

export const VexoTranscriptToolkit = Toolkit.make(VexoTranscriptRecentTool, VexoMemoryQueryTool);
