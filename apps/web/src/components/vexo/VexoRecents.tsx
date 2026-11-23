/* oxlint-disable shadcn/no-arbitrary-values -- Matches the Vexo dark sidebar chrome. */

import { Link, useParams } from "@tanstack/react-router";
import { thrownErrorMessage } from "@t3tools/client-runtime/errors";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { threadKey } from "@t3tools/client-runtime/state/entities";
import { isThreadWorking } from "@t3tools/client-runtime/state/thread-inbox";
import {
  AuthOrchestrationOperateScope,
  isListedThreadLineage,
  type EnvironmentId,
  type ScopedThreadRef,
  type ServerProvider,
  type ThreadId,
} from "@t3tools/contracts";
import { T, useGT } from "gt-react";
import {
  CheckCircle2Icon,
  ChevronRightIcon,
  ClockIcon,
  PencilIcon,
  SearchIcon,
  XIcon,
} from "lucide-react";
import { useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";

import {
  hasUnseenCompletion,
  resolveSidebarRowStatus,
  type SidebarThreadStatus,
} from "~/components/Sidebar.logic";
import { getTriggerDisplayModelName } from "~/components/chat/providerIconUtils";
import { toastManager } from "~/components/ui/toast";
import { Tooltip, TooltipPopup, TooltipProvider, TooltipTrigger } from "~/components/ui/tooltip";
import { useRelativeTimeState } from "~/hooks/useRelativeTimeState";
import { useThreadActions } from "~/hooks/useThreadActions";
import { m } from "~/i18n/messages";
import { cn } from "~/lib/utils";
import { useProjects, useVisibleThreadShells } from "~/state/entities";
import { useEnvironmentProviders } from "~/state/environments";
import { readEnvironmentScope } from "~/state/session";
import { threadEnvironment } from "~/state/threads";
import { useOrchestrationCommand } from "~/state/use-orchestration-command";
import { buildThreadRouteParams } from "~/threadRoutes";

const FOCUS_RING =
  "cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";

const RECENTS_LIMIT = 120;

type VexoStatusTone = "working" | "warn" | "ok" | "error" | "muted";
type RecentsBucket = "active" | "working" | "settled";

export interface VexoRecentRow {
  readonly id: string;
  readonly title: string;
  readonly projectName: string;
  readonly modelLabel: string;
  readonly updatedAt: string;
  readonly settledAt: string | null;
  readonly bucket: RecentsBucket;
  readonly status: SidebarThreadStatus;
  readonly statusLabel: string | null;
  readonly statusTone: VexoStatusTone | null;
  readonly thread: ScopedThreadRef;
}

function projectKey(environmentId: string, projectId: string): string {
  return `${environmentId}:${projectId}`;
}

function resolveModelLabel(
  thread: {
    readonly environmentId: EnvironmentId;
    readonly modelSelection: { readonly instanceId: string; readonly model: string };
    readonly runtime: { readonly providerInstanceId: string } | null;
  },
  providersByEnvironment: ReadonlyMap<EnvironmentId, readonly ServerProvider[]>,
): string {
  const instanceId = thread.runtime?.providerInstanceId ?? thread.modelSelection.instanceId;
  const providers = providersByEnvironment.get(thread.environmentId) ?? [];
  const provider = providers.find((entry) => entry.instanceId === instanceId) ?? null;
  const selected = provider?.models.find((model) => model.slug === thread.modelSelection.model);
  if (selected !== undefined) {
    return getTriggerDisplayModelName(selected, provider?.driver);
  }
  const slug = thread.modelSelection.model.trim();
  return slug.length > 0 ? slug : "";
}

function statusPresentation(
  status: SidebarThreadStatus,
  showDone: boolean,
  gt: (message: string, variables?: { readonly $context?: string }) => string,
): { label: string; tone: VexoStatusTone } | null {
  switch (status) {
    case "preparing":
      return { label: gt("Setting up"), tone: "working" };
    case "working":
      return { label: gt("Working", { $context: "thread status" }), tone: "working" };
    case "waiting":
      return { label: gt("Waiting", { $context: "thread status" }), tone: "muted" };
    case "approval":
      return { label: gt("Approval", { $context: "thread status: needs approval" }), tone: "warn" };
    case "input":
      return { label: gt("Input", { $context: "thread status: needs user input" }), tone: "warn" };
    case "request":
      return { label: gt("Request", { $context: "thread status: guest request" }), tone: "warn" };
    case "limited":
      return {
        label: gt("Limited", { $context: "thread status: usage limited" }),
        tone: "warn",
      };
    case "failed":
      return { label: gt("Failed", { $context: "thread status" }), tone: "error" };
    case "ready":
      return showDone ? { label: gt("Done", { $context: "thread status" }), tone: "ok" } : null;
    default:
      return null;
  }
}

function toneClass(tone: VexoStatusTone): string {
  switch (tone) {
    case "working":
      return "text-[#6cb6ff]";
    case "warn":
      return "text-[#e6b15a]";
    case "ok":
      return "text-[#3ddc84]";
    case "error":
      return "text-[#ff6b6b]";
    case "muted":
      return "text-white/45";
  }
}

function toneDot(tone: VexoStatusTone): string {
  switch (tone) {
    case "working":
      return "bg-[#0a84ff]";
    case "warn":
      return "bg-[#e6b15a]";
    case "ok":
      return "bg-[#3ddc84]";
    case "error":
      return "bg-[#ff6b6b]";
    case "muted":
      return "bg-white/35";
  }
}

function bucketOf(
  thread: Parameters<typeof isThreadWorking>[0] & {
    readonly settledOverride?: "settled" | "active" | null;
  },
): RecentsBucket {
  if (thread.settledOverride === "settled") return "settled";
  if (isThreadWorking(thread)) return "working";
  return "active";
}

export function useVexoRecentThreads(query: string): readonly VexoRecentRow[] {
  const gt = useGT();
  const threads = useVisibleThreadShells();
  const projects = useProjects();
  const providersByEnvironment = useEnvironmentProviders();
  const normalized = query.trim().toLowerCase();

  const projectNames = new Map<string, string>();
  for (const project of projects) {
    const title = project.title.trim();
    mapProjectName(
      projectNames,
      projectKey(project.environmentId, project.id),
      title.length > 0 ? title : project.workspaceRoot.split("/").at(-1) || "Project",
    );
  }

  const listed = threads
    .filter(
      (thread) =>
        thread.archivedAt === null &&
        thread.deletedAt === null &&
        isListedThreadLineage(thread.lineage),
    )
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, RECENTS_LIMIT)
    .map((thread) => {
      const ref = { environmentId: thread.environmentId, threadId: thread.id };
      const status = resolveSidebarRowStatus({
        ...thread,
        lastVisitedAt: thread.lastVisitedAt,
      });
      const showDone =
        status === "ready" &&
        hasUnseenCompletion({ ...thread, lastVisitedAt: thread.lastVisitedAt });
      const presentation = statusPresentation(status, showDone, gt);
      const projectName =
        projectNames.get(projectKey(thread.environmentId, thread.projectId)) ??
        gt("Project", { $context: "fallback project name" });
      const modelLabel = resolveModelLabel(thread, providersByEnvironment);
      const bucket = bucketOf(thread);
      return {
        id: threadKey(ref),
        title: thread.title.trim(),
        projectName,
        modelLabel,
        updatedAt: thread.updatedAt,
        settledAt: thread.settledAt,
        bucket,
        status,
        statusLabel: presentation?.label ?? null,
        statusTone: presentation?.tone ?? null,
        thread: ref,
      } satisfies VexoRecentRow;
    });

  const filtered =
    normalized.length === 0
      ? listed
      : listed.filter((row) => {
          const haystack = `${row.title} ${row.projectName} ${row.modelLabel} ${row.statusLabel ?? ""}`;
          return haystack.toLowerCase().includes(normalized);
        });

  const settled = filtered
    .filter((row) => row.bucket === "settled")
    .sort((left, right) => {
      const leftAt = left.settledAt ?? left.updatedAt;
      const rightAt = right.settledAt ?? right.updatedAt;
      return rightAt.localeCompare(leftAt);
    });

  return [
    ...filtered.filter((row) => row.bucket === "working"),
    ...filtered.filter((row) => row.bucket === "active"),
    ...settled,
  ];
}

function mapProjectName(map: Map<string, string>, key: string, value: string) {
  map.set(key, value);
}

export function VexoRecents({
  onOpenThread,
}: {
  readonly onOpenThread?: (() => void) | undefined;
}) {
  const gt = useGT();
  const actions = useThreadActions();
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  // Settled stays collapsed so finished chats stay out of the way until opened.
  const [openBuckets, setOpenBuckets] = useState<ReadonlySet<RecentsBucket>>(
    () => new Set<RecentsBucket>(["working", "active"]),
  );
  const recents = useVexoRecentThreads(query);
  const [renaming, setRenaming] = useState<{ id: string; value: string; original: string } | null>(
    null,
  );
  const updateThreadMetadata = useOrchestrationCommand(threadEnvironment.updateMetadata, {
    reportFailure: false,
  });
  const params = useParams({ strict: false });
  const activeId =
    typeof params.environmentId === "string" && typeof params.threadId === "string"
      ? threadKey({
          environmentId: params.environmentId as EnvironmentId,
          threadId: params.threadId as ThreadId,
        })
      : null;

  const working = recents.filter((row) => row.bucket === "working");
  const active = recents.filter((row) => row.bucket === "active");
  const settled = recents.filter((row) => row.bucket === "settled");
  const groups = [
    {
      id: "working" as const,
      label: gt("Working", { $context: "recents section for running chats" }),
      rows: working,
    },
    {
      id: "active" as const,
      label: gt("Active", { $context: "recents section for open chats" }),
      rows: active,
    },
    {
      id: "settled" as const,
      label: gt("Settled", { $context: "recents section for finished chats" }),
      rows: settled,
    },
  ];

  const toggleBucket = (id: RecentsBucket) => {
    setOpenBuckets((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const settleRow = (row: VexoRecentRow) => {
    void actions.settleThread(row.thread);
  };

  const reactivateRow = (row: VexoRecentRow) => {
    void actions.unsettleThread(row.thread);
  };

  const startRename = (row: VexoRecentRow) => {
    if (!readEnvironmentScope(row.thread.environmentId, AuthOrchestrationOperateScope)) return;
    setRenaming({ id: row.id, value: row.title, original: row.title });
  };

  const commitRename = (row: VexoRecentRow) => {
    if (renaming === null || renaming.id !== row.id) return;
    const trimmed = renaming.value.trim();
    const original = renaming.original;
    setRenaming(null);
    if (trimmed.length === 0) {
      toastManager.add({ type: "warning", title: gt("Thread title cannot be empty") });
      return;
    }
    if (trimmed === original) return;
    void (async () => {
      const result = await updateThreadMetadata({
        environmentId: row.thread.environmentId,
        input: { threadId: row.thread.threadId, title: trimmed },
      });
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        toastManager.add({
          type: "error",
          title: gt("Failed to rename thread"),
          description:
            thrownErrorMessage(squashAtomCommandFailure(result), m) ?? gt("An error occurred."),
        });
      }
    })();
  };

  return (
    <TooltipProvider delay={1000} closeDelay={150} timeout={400}>
      <div className="mt-3 flex min-h-0 flex-1 flex-col">
        <div className="flex items-center gap-2 px-3.5 text-[13px] text-white/45">
          <ClockIcon className="size-4" strokeWidth={1.75} />
          <span>
            <T context="heading for the recent chat list">Recents</T>
          </span>
          {searchOpen ? (
            <input
              autoFocus
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key !== "Escape") return;
                setSearchOpen(false);
                setQuery("");
              }}
              placeholder={gt("Search", { $context: "search field placeholder" })}
              aria-label={gt("Search recents", { $context: "filters the recent chat list" })}
              className={cn(
                "ml-auto h-7 w-28 rounded-md border border-white/10 bg-white/8 px-2 text-[12px] text-white outline-none placeholder:text-white/35",
                FOCUS_RING,
              )}
            />
          ) : (
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    className={cn(
                      "ml-auto grid size-8 place-items-center rounded-lg text-white/45 hover:bg-white/6 hover:text-white/75",
                      FOCUS_RING,
                    )}
                    aria-label={gt("Search recents", { $context: "filters the recent chat list" })}
                    onClick={() => {
                      setSearchOpen(true);
                    }}
                  />
                }
              >
                <SearchIcon className="size-4" strokeWidth={1.75} />
              </TooltipTrigger>
              <TooltipPopup side="top">
                <T>Search recents</T>
              </TooltipPopup>
            </Tooltip>
          )}
          {searchOpen || query.length > 0 ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    className={cn(
                      "grid size-8 place-items-center rounded-lg text-white/45 hover:bg-white/6 hover:text-white/75",
                      FOCUS_RING,
                    )}
                    aria-label={gt("Clear search", { $context: "clears the recent chat search" })}
                    onClick={() => {
                      setSearchOpen(false);
                      setQuery("");
                    }}
                  />
                }
              >
                <XIcon className="size-4" strokeWidth={1.75} />
              </TooltipTrigger>
              <TooltipPopup side="top">
                <T>Clear search</T>
              </TooltipPopup>
            </Tooltip>
          ) : null}
        </div>
        <div className="mt-1.5 min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          {recents.length === 0 ? (
            <p className="px-2 py-2 text-[13px] text-white/40">
              {query.trim().length > 0 ? <T>No matching chats</T> : <T>No chats yet</T>}
            </p>
          ) : (
            groups.map((group) => {
              if (group.rows.length === 0) return null;
              const open = openBuckets.has(group.id) || query.trim().length > 0;
              return (
                <section key={group.id} className="mb-2">
                  <button
                    type="button"
                    aria-expanded={open}
                    className={cn(
                      "flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-[12px] font-medium text-white/55 hover:bg-white/6 hover:text-white/80",
                      FOCUS_RING,
                    )}
                    onClick={() => {
                      toggleBucket(group.id);
                    }}
                  >
                    <ChevronRightIcon
                      className={cn("size-3.5 shrink-0 transition-transform", open && "rotate-90")}
                      strokeWidth={2}
                    />
                    <span className="min-w-0 flex-1 truncate">{group.label}</span>
                    <span className="tabular-nums text-white/35">{group.rows.length}</span>
                  </button>
                  {open ? (
                    <ul className="mt-0.5 space-y-0.5">
                      {group.rows.map((recent) => {
                        const selected = recent.id === activeId;
                        const title =
                          recent.title.length > 0
                            ? recent.title
                            : gt("Untitled", { $context: "fallback thread title" });
                        if (renaming !== null && renaming.id === recent.id) {
                          return (
                            <li key={recent.id} className="rounded-xl bg-white/10 px-2.5 py-2">
                              <span className="block truncate text-[11px] text-white/45">
                                {recent.projectName}
                              </span>
                              <RecentRenameInput
                                value={renaming.value}
                                onChange={(value) => {
                                  setRenaming({ ...renaming, value });
                                }}
                                onCommit={() => {
                                  commitRename(recent);
                                }}
                                onCancel={() => {
                                  setRenaming(null);
                                }}
                              />
                            </li>
                          );
                        }
                        return (
                          <li key={recent.id} className="group/row relative">
                            <Link
                              to="/$environmentId/$threadId"
                              params={buildThreadRouteParams(recent.thread)}
                              aria-current={selected ? "page" : undefined}
                              onClick={(event) => {
                                // The second click of a double-click renames instead of reopening.
                                if (event.detail > 1) return;
                                if (recent.bucket === "settled") {
                                  reactivateRow(recent);
                                }
                                onOpenThread?.();
                              }}
                              onDoubleClick={(event) => {
                                if (
                                  event.metaKey ||
                                  event.ctrlKey ||
                                  event.shiftKey ||
                                  event.altKey
                                )
                                  return;
                                event.preventDefault();
                                startRename(recent);
                              }}
                              onKeyDown={(event) => {
                                if (event.key !== "F2") return;
                                event.preventDefault();
                                startRename(recent);
                              }}
                              className={cn(
                                "block rounded-xl px-2.5 py-2 text-left",
                                selected
                                  ? "bg-white/10 text-white"
                                  : "text-white/85 hover:bg-white/6",
                                FOCUS_RING,
                              )}
                            >
                              <div
                                className={cn(
                                  "flex items-center gap-1.5",
                                  recent.bucket !== "settled" ? "pr-14" : "pr-7",
                                )}
                              >
                                <span className="min-w-0 flex-1 truncate text-[11px] text-white/45">
                                  {recent.projectName}
                                </span>
                                <RecentTime
                                  iso={recent.updatedAt}
                                  className="transition-opacity duration-150 group-hover/row:opacity-0 group-focus-within/row:opacity-0"
                                />
                              </div>
                              <div className="mt-0.5 flex items-start gap-2">
                                <span
                                  className={cn(
                                    "mt-1.5 size-1.5 shrink-0 rounded-full",
                                    recent.statusTone !== null
                                      ? toneDot(recent.statusTone)
                                      : "bg-white/25",
                                  )}
                                  aria-hidden
                                />
                                <span className="min-w-0 flex-1 truncate text-[13px] leading-5">
                                  {title}
                                </span>
                              </div>
                              <div className="mt-0.5 flex items-center gap-1.5 pl-3.5 text-[11px]">
                                <span className="min-w-0 truncate text-white/40">
                                  {recent.modelLabel}
                                </span>
                                {recent.statusLabel !== null && recent.statusTone !== null ? (
                                  <>
                                    <span className="text-white/20" aria-hidden>
                                      ·
                                    </span>
                                    <span className={cn("shrink-0", toneClass(recent.statusTone))}>
                                      {recent.statusLabel}
                                    </span>
                                  </>
                                ) : null}
                              </div>
                            </Link>
                            <div className="absolute top-1.5 right-1.5 flex items-center">
                              <Tooltip>
                                <TooltipTrigger
                                  render={
                                    <button
                                      type="button"
                                      className={cn(
                                        "grid size-7 place-items-center rounded-md text-white/0 group-hover/row:text-white/45 hover:bg-white/8 hover:text-white/80 focus-visible:text-white/80",
                                        FOCUS_RING,
                                      )}
                                      aria-label={gt("Rename", {
                                        $context: "renames this chat",
                                      })}
                                      onClick={(event) => {
                                        event.preventDefault();
                                        event.stopPropagation();
                                        startRename(recent);
                                      }}
                                    />
                                  }
                                >
                                  <PencilIcon className="size-3.5" strokeWidth={1.75} />
                                </TooltipTrigger>
                                <TooltipPopup side="top">
                                  <T>Rename</T>
                                </TooltipPopup>
                              </Tooltip>
                              {recent.bucket !== "settled" ? (
                                <Tooltip>
                                  <TooltipTrigger
                                    render={
                                      <button
                                        type="button"
                                        className={cn(
                                          "grid size-7 place-items-center rounded-md text-white/0 group-hover/row:text-white/45 hover:bg-white/8 hover:text-white/80",
                                          FOCUS_RING,
                                        )}
                                        aria-label={gt("Settle", {
                                          $context: "moves this chat into the Settled section",
                                        })}
                                        onClick={(event) => {
                                          event.preventDefault();
                                          event.stopPropagation();
                                          settleRow(recent);
                                        }}
                                      />
                                    }
                                  >
                                    <CheckCircle2Icon className="size-3.5" strokeWidth={1.75} />
                                  </TooltipTrigger>
                                  <TooltipPopup side="top">
                                    <T>Settle</T>
                                  </TooltipPopup>
                                </Tooltip>
                              ) : null}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  ) : null}
                </section>
              );
            })
          )}
        </div>
      </div>
    </TooltipProvider>
  );
}

function RecentTime({
  iso,
  className,
}: {
  readonly iso: string;
  readonly className?: string | undefined;
}) {
  const state = useRelativeTimeState(iso);
  if (state.status !== "relative") return null;
  return (
    <span className={cn("shrink-0 text-[11px] text-white/35 tabular-nums", className)}>
      {state.value}
    </span>
  );
}

// Mounted only while renaming, so each rename starts uncommitted.
function RecentRenameInput({
  value,
  onChange,
  onCommit,
  onCancel,
}: {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly onCommit: () => void;
  readonly onCancel: () => void;
}) {
  const gt = useGT();
  // Enter and Escape blur the input as it unmounts; that blur must not commit again.
  const settledRef = useRef(false);
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation();
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Enter") {
      event.preventDefault();
      settledRef.current = true;
      onCommit();
    } else if (event.key === "Escape") {
      event.preventDefault();
      settledRef.current = true;
      onCancel();
    }
  };
  return (
    <input
      autoFocus
      value={value}
      dir="auto"
      aria-label={gt("Thread title")}
      onChange={(event) => {
        onChange(event.target.value);
      }}
      onFocus={(event) => {
        event.currentTarget.select();
      }}
      onKeyDown={handleKeyDown}
      onBlur={() => {
        if (!settledRef.current) onCommit();
      }}
      className="mt-0.5 w-full rounded-md border border-white/15 bg-white/8 px-1.5 py-0.5 text-[13px] leading-5 text-white outline-none focus:border-white/35"
    />
  );
}
