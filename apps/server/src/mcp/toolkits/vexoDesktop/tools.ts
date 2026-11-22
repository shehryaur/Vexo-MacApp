import { OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { McpSchema, Tool, Toolkit } from "effect/ai";

import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const dependencies = [
  McpInvocationContext.McpInvocationContext,
  ThreadManagementService.ThreadManagementService,
];

const Bounds = Schema.Struct({
  x: Schema.Number,
  y: Schema.Number,
  width: Schema.Number,
  height: Schema.Number,
});

const WindowInfo = Schema.Struct({
  windowId: Schema.Number,
  title: Schema.String,
  app: Schema.String,
  bounds: Bounds,
});

const targetFields = {
  role: Schema.optional(Schema.String.annotate({ description: "Accessibility role, when known." })),
  subrole: Schema.optional(
    Schema.String.annotate({ description: "Accessibility subrole, when known." }),
  ),
  title: Schema.optional(
    Schema.String.annotate({
      description: "Element title. A password, passcode, or passwd title is refused.",
    }),
  ),
  windowId: Schema.optional(
    Schema.Number.annotate({
      description: "Window to raise first. Use windowId from vexo_list_windows.",
    }),
  ),
};

const present = <T extends Tool.Any>(
  tool: T,
  title: string,
  options: {
    readonly readOnly: boolean;
    readonly destructive: boolean;
    readonly idempotent: boolean;
    readonly openWorld: boolean;
  },
): T =>
  tool
    .annotate(Tool.Title, title)
    .annotate(Tool.Readonly, options.readOnly)
    .annotate(Tool.Destructive, options.destructive)
    .annotate(Tool.Idempotent, options.idempotent)
    .annotate(Tool.OpenWorld, options.openWorld)
    .annotate(McpSchema.EnabledWhen, McpInvocationContext.hiddenFromOutsideClients) as T;

const read = { readOnly: true, destructive: false, idempotent: true, openWorld: false };
const look = { readOnly: true, destructive: false, idempotent: false, openWorld: true };
const act = { readOnly: false, destructive: true, idempotent: false, openWorld: true };

const VexoDesktopStatusTool = present(
  Tool.make("vexo_desktop_status", {
    description:
      "Report who holds the desktop lease, whether a login password is stored, and whether unlock is in progress. Never returns the password.",
    success: Schema.Struct({
      leaseOwner: Schema.NullOr(Schema.String),
      passwordStored: Schema.Boolean,
      unlockInProgress: Schema.Boolean,
    }),
    failure: OrchestratorMcpFailure,
    failureMode: "return",
    dependencies,
  }),
  "Desktop status",
  read,
);

const VexoListWindowsTool = present(
  Tool.make("vexo_list_windows", {
    description:
      "List on-screen windows front to back: windowId, title, app, and bounds in points. Does not capture pixels.",
    success: Schema.Struct({ windows: Schema.Array(WindowInfo) }),
    failure: OrchestratorMcpFailure,
    failureMode: "return",
    dependencies,
  }),
  "List windows",
  read,
);

const VexoObserveTool = present(
  Tool.make("vexo_observe", {
    description:
      "Capture the front window and return its metadata plus imagePath, a temp JPEG. Bytes stay in that file. Returns an error instead of a capture while the session is locked or unlock is running.",
    success: Schema.Struct({
      windowId: WindowInfo.fields.windowId,
      title: WindowInfo.fields.title,
      app: WindowInfo.fields.app,
      bounds: WindowInfo.fields.bounds,
      imagePath: Schema.String,
    }),
    failure: OrchestratorMcpFailure,
    failureMode: "return",
    dependencies,
  }),
  "Observe front window",
  look,
);

const VexoCaptureFrameTool = present(
  Tool.make("vexo_capture_frame", {
    description:
      "Capture the whole display. Returns imagePath, a temp JPEG, or redacted when the session is locked or unlock is running. Bytes stay in the file.",
    success: Schema.Union([
      Schema.Struct({ imagePath: Schema.String }),
      Schema.Struct({ redacted: Schema.Literal(true) }),
    ]),
    failure: OrchestratorMcpFailure,
    failureMode: "return",
    dependencies,
  }),
  "Capture display",
  look,
);

const VexoLeaseAcquireTool = present(
  Tool.make("vexo_lease_acquire", {
    description:
      "Take this thread's exclusive desktop lease. Calling again refreshes the 120 second idle timer. vexo_click, vexo_type, and vexo_key require it. Unavailable in plan mode.",
    success: Schema.Struct({ owner: Schema.String }),
    failure: OrchestratorMcpFailure,
    failureMode: "return",
    dependencies,
  }),
  "Acquire desktop lease",
  { ...act, idempotent: true },
);

const VexoLeaseReleaseTool = present(
  Tool.make("vexo_lease_release", {
    description:
      "Release the desktop lease if this thread holds it. Releasing a free lease succeeds.",
    success: Schema.Struct({ released: Schema.Literal(true) }),
    failure: OrchestratorMcpFailure,
    failureMode: "return",
    dependencies,
  }),
  "Release desktop lease",
  { readOnly: false, destructive: false, idempotent: true, openWorld: false },
);

const VexoLeaseAbortTool = present(
  Tool.make("vexo_lease_abort", {
    description:
      "Clear the desktop lease immediately, including when another thread holds it. Later clicks from the previous holder are refused. Unavailable in plan mode.",
    success: Schema.Struct({ owner: Schema.NullOr(Schema.String) }),
    failure: OrchestratorMcpFailure,
    failureMode: "return",
    dependencies,
  }),
  "Abort desktop lease",
  { ...act, idempotent: true, openWorld: false },
);

const VexoClickTool = present(
  Tool.make("vexo_click", {
    description:
      "Click a point in screen points. This thread must hold the lease from vexo_lease_acquire. Refuses a password field. Unavailable in plan mode.",
    parameters: Schema.Struct({
      x: Schema.Number.annotate({ description: "Screen x, points, origin top-left." }),
      y: Schema.Number.annotate({ description: "Screen y, points, origin top-left." }),
      ...targetFields,
    }),
    success: Schema.Struct({ ok: Schema.Literal(true) }),
    failure: OrchestratorMcpFailure,
    failureMode: "return",
    dependencies,
  }),
  "Click",
  act,
);

const VexoTypeTool = present(
  Tool.make("vexo_type", {
    description:
      "Type text. This thread must hold the desktop lease. The text is not logged and is not returned. Refuses a password field. Unavailable in plan mode.",
    parameters: Schema.Struct({
      text: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(20_000)).annotate({
        description: "Text to type. Not echoed in the result.",
      }),
      ...targetFields,
    }),
    success: Schema.Struct({ ok: Schema.Literal(true) }),
    failure: OrchestratorMcpFailure,
    failureMode: "return",
    dependencies,
  }),
  "Type",
  act,
);

const VexoKeyTool = present(
  Tool.make("vexo_key", {
    description:
      "Press one key: return, enter, escape, esc, tab, space, delete, backspace, forwarddelete, left, right, up, or down. This thread must hold the desktop lease. Unavailable in plan mode.",
    parameters: Schema.Struct({
      key: Schema.String.annotate({ description: "Key name." }),
      ...targetFields,
    }),
    success: Schema.Struct({ ok: Schema.Literal(true) }),
    failure: OrchestratorMcpFailure,
    failureMode: "return",
    dependencies,
  }),
  "Press key",
  act,
);

const VexoUnlockTool = present(
  Tool.make("vexo_unlock", {
    description:
      "Type the stored login password into a locked session. Pass confirmed: true. When Ask before unlocking is on, this waits for the person to approve the Mac app dialog, and only that approval unlocks the screen. The password is never returned. Unavailable in plan mode.",
    parameters: Schema.Struct({
      confirmed: Schema.Boolean.annotate({
        description:
          "Must be true to ask. When Ask before unlocking is on, this does not unlock by itself.",
      }),
    }),
    success: Schema.Struct({ unlocked: Schema.Literal(true) }),
    failure: OrchestratorMcpFailure,
    failureMode: "return",
    dependencies,
  }),
  "Unlock screen",
  act,
);

const VexoRelockTool = present(
  Tool.make("vexo_relock", {
    description:
      "Lock the screen. Uses CGSession -suspend when that binary exists, otherwise Control-Command-Q through System Events. Unavailable in plan mode.",
    success: Schema.Struct({ relocked: Schema.Boolean }),
    failure: OrchestratorMcpFailure,
    failureMode: "return",
    dependencies,
  }),
  "Lock screen",
  { ...act, idempotent: true },
);

const VexoRelockIfAbandonedTool = present(
  Tool.make("vexo_relock_if_abandoned", {
    description:
      "Lock the screen when a previous unlock left its marker and nobody holds the lease. relocked is false when there is nothing to do. Unavailable in plan mode.",
    success: Schema.Struct({ relocked: Schema.Boolean }),
    failure: OrchestratorMcpFailure,
    failureMode: "return",
    dependencies,
  }),
  "Relock if abandoned",
  act,
);

const VexoPasswordStoredTool = present(
  Tool.make("vexo_password_stored", {
    description: "Whether a Mac login password is stored for unlock. Never returns the password.",
    success: Schema.Struct({ stored: Schema.Boolean }),
    failure: OrchestratorMcpFailure,
    failureMode: "return",
    dependencies,
  }),
  "Password stored",
  read,
);

const VexoSavePasswordTool = present(
  Tool.make("vexo_save_password", {
    description:
      "Store the Mac login password in the login keychain for vexo_unlock. Full-access threads only. The password is never returned or logged.",
    parameters: Schema.Struct({
      password: Schema.String.check(Schema.isMinLength(1)).annotate({
        description: "Mac login password. Not included in the result.",
      }),
    }),
    success: Schema.Struct({ saved: Schema.Literal(true) }),
    failure: OrchestratorMcpFailure,
    failureMode: "return",
    dependencies,
  }),
  "Save login password",
  act,
);

const VexoClearPasswordTool = present(
  Tool.make("vexo_clear_password", {
    description:
      "Delete the stored Mac login password from the login keychain. Does not return the password. Unavailable in plan mode.",
    success: Schema.Struct({ cleared: Schema.Literal(true) }),
    failure: OrchestratorMcpFailure,
    failureMode: "return",
    dependencies,
  }),
  "Clear login password",
  { ...act, idempotent: true, openWorld: false },
);

export const VexoDesktopToolkit = Toolkit.make(
  VexoDesktopStatusTool,
  VexoListWindowsTool,
  VexoObserveTool,
  VexoCaptureFrameTool,
  VexoLeaseAcquireTool,
  VexoLeaseReleaseTool,
  VexoLeaseAbortTool,
  VexoClickTool,
  VexoTypeTool,
  VexoKeyTool,
  VexoUnlockTool,
  VexoRelockTool,
  VexoRelockIfAbandonedTool,
  VexoPasswordStoredTool,
  VexoSavePasswordTool,
  VexoClearPasswordTool,
);
