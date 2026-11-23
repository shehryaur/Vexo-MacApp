/* oxlint-disable shadcn/no-arbitrary-values -- Matches the Vexo dark Mac host chrome. */

import type { DesktopVexoCliSession } from "@t3tools/contracts";
import { T, useGT } from "gt-react";
import {
  CheckIcon,
  MessageSquareIcon,
  PencilIcon,
  RotateCwIcon,
  SearchIcon,
  SquareTerminalIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { ClaudeAI, CursorIcon, OpenAI } from "../Icons";
import { cn } from "~/lib/utils";
import { readCliSessions, renameCliSession, resumeCliSession } from "./vexoDeviceStatus";

const FOCUS_RING =
  "cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";

type ProviderFilter = "all" | "claude" | "codex" | "grok";

function shortenHome(path: string): string {
  // Renderer cannot read os.homedir; replace common absolute home prefixes.
  const match = path.match(/^\/Users\/[^/]+(\/.*)?$/u);
  if (match) return `~${match[1] ?? ""}`;
  return path;
}

function folderLabel(cwd: string): string {
  const shortened = shortenHome(cwd);
  const parts = shortened.split("/").filter((part) => part.length > 0);
  const last = parts.at(-1);
  return last && last !== "~" ? last : shortened;
}

function ProviderGlyph({ provider }: { readonly provider: DesktopVexoCliSession["provider"] }) {
  if (provider === "claude" || provider === "antigravity") {
    return <ClaudeAI className="size-4 text-[#d97757]" />;
  }
  if (provider === "codex") {
    return <OpenAI className="size-4 text-white/80" />;
  }
  // "grok" sessions come from cursor-agent, so they show as Cursor.
  if (provider === "grok") {
    return <CursorIcon className="size-4 fill-white/80" aria-hidden />;
  }
  return (
    <span className="grid size-4 place-items-center rounded-full bg-white/15 text-[9px] font-semibold text-white/80">
      ?
    </span>
  );
}

function stateLabel(
  state: DesktopVexoCliSession["state"],
  gt: (message: string, variables?: { readonly $context?: string }) => string,
): string {
  switch (state) {
    case "ready":
      return gt("Ready", { $context: "CLI session status" });
    case "busy":
      return gt("Busy", { $context: "CLI session status" });
    case "setup":
      return gt("Setup", { $context: "CLI session status" });
    case "idle":
      return gt("Idle", { $context: "CLI session exists but is not bridged right now" });
    case "offline":
    default:
      return gt("Offline", { $context: "CLI session status" });
  }
}

function stateTone(state: DesktopVexoCliSession["state"]): string {
  switch (state) {
    case "ready":
      return "text-[#3ddc84] bg-[#3ddc84]/12";
    case "busy":
      return "text-[#6cb6ff] bg-[#0a84ff]/15";
    case "setup":
      return "text-[#e6b15a] bg-[#e6b15a]/12";
    case "idle":
      return "text-white/55 bg-white/8";
    case "offline":
    default:
      return "text-white/45 bg-white/6";
  }
}

export function VexoSessionsPanel({ onClose }: { readonly onClose: () => void }) {
  const gt = useGT();
  const [sessions, setSessions] = useState<readonly DesktopVexoCliSession[]>([]);
  const [detail, setDetail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ProviderFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [resumeBusy, setResumeBusy] = useState(false);
  const [resumeNote, setResumeNote] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ readonly id: string; readonly value: string } | null>(
    null,
  );
  const [renameBusy, setRenameBusy] = useState(false);
  const [renameNote, setRenameNote] = useState<{ readonly id: string; readonly text: string } | null>(
    null,
  );

  const saveRename = (session: DesktopVexoCliSession) => {
    if (renaming === null || renaming.id !== session.id || renameBusy) return;
    setRenameBusy(true);
    void renameCliSession({ id: session.id, provider: session.provider, title: renaming.value }).then(
      (result) => {
        setRenameBusy(false);
        const title = result.title;
        if (!result.ok || title === undefined) {
          setRenameNote({ id: session.id, text: result.detail });
          return;
        }
        setSessions((current) =>
          current.map((row) => (row.id === session.id ? { ...row, title } : row)),
        );
        setRenaming(null);
        setRenameNote(
          session.connected
            ? {
                id: session.id,
                text: gt(
                  "Renamed. This session is running and may bring back its old name. Use /rename inside it to be sure.",
                ),
              }
            : null,
        );
      },
    );
  };

  const refresh = () => {
    setLoading(true);
    void readCliSessions().then((next) => {
      setSessions(next.sessions);
      setDetail(next.detail);
      setLoading(false);
    });
  };

  const continueSession = (session: DesktopVexoCliSession) => {
    if (resumeBusy) return;
    setResumeBusy(true);
    setResumeNote(null);
    void resumeCliSession({
      id: session.id,
      provider: session.provider,
      cwd: session.cwd,
    })
      .then((result) => {
        setResumeNote(result.detail);
        setResumeBusy(false);
        if (result.ok) refresh();
      })
      .catch(() => {
        setResumeNote(gt("Could not open Terminal for this session."));
        setResumeBusy(false);
      });
  };

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- loads connector sessions when the panel opens
  useEffect(() => {
    refresh();
  }, []);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return sessions.filter((session) => {
      if (filter !== "all") {
        if (filter === "claude" && session.provider !== "claude" && session.provider !== "antigravity") {
          return false;
        }
        if (filter === "codex" && session.provider !== "codex") return false;
        if (filter === "grok" && session.provider !== "grok") return false;
      }
      if (normalized.length === 0) return true;
      const haystack = `${session.title} ${session.cwd} ${session.provider} ${session.model ?? ""}`;
      return haystack.toLowerCase().includes(normalized);
    });
  }, [filter, query, sessions]);

  const groups = useMemo(() => {
    const byCwd = new Map<string, DesktopVexoCliSession[]>();
    for (const session of filtered) {
      const list = byCwd.get(session.cwd) ?? [];
      list.push(session);
      byCwd.set(session.cwd, list);
    }
    return [...byCwd.entries()]
      .map(([cwd, rows]) => ({
        cwd,
        label: folderLabel(cwd),
        path: shortenHome(cwd),
        sessions: rows,
      }))
      .sort((left, right) => left.label.localeCompare(right.label));
  }, [filtered]);

  const selected = sessions.find((session) => session.id === selectedId) ?? null;

  return (
    <div data-vexo-sessions="" className="flex min-h-0 min-w-0 flex-1">
      <section className="flex w-[320px] shrink-0 flex-col border-r border-white/8 bg-[#141518]">
        <div className="flex h-12 items-center gap-2.5 px-3.5 pt-[var(--workspace-topbar-height)]">
          <SquareTerminalIcon className="size-5 text-white/55" strokeWidth={1.75} />
          <h1 className="min-w-0 flex-1 truncate text-[17px] font-semibold tracking-tight">
            <T>Sessions</T>
          </h1>
          <button
            type="button"
            className={cn(
              "grid size-7 place-items-center rounded-md text-white/45 hover:bg-white/6 hover:text-white/80",
              FOCUS_RING,
            )}
            aria-label={gt("Refresh sessions", { $context: "reloads CLI sessions from this Mac" })}
            onClick={refresh}
          >
            <RotateCwIcon className={cn("size-3.5", loading && "animate-spin")} strokeWidth={1.75} />
          </button>
          <button
            type="button"
            className={cn(
              "grid size-7 place-items-center rounded-md text-white/45 hover:bg-white/6 hover:text-white/80",
              FOCUS_RING,
            )}
            aria-label={gt("Close sessions", { $context: "returns to the Vexo home view" })}
            onClick={onClose}
          >
            <XIcon className="size-3.5" strokeWidth={1.75} />
          </button>
        </div>

        <div className="px-3 pb-2">
          <label className="flex h-8 items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-2">
            <SearchIcon className="size-3.5 text-white/40" strokeWidth={1.75} />
            <input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
              }}
              placeholder={gt("Search", { $context: "search field placeholder" })}
              aria-label={gt("Search sessions", { $context: "filters discovered CLI sessions" })}
              className="min-w-0 flex-1 bg-transparent text-[12px] text-white outline-none placeholder:text-white/35"
            />
          </label>
          <div className="mt-2 flex flex-wrap gap-1">
            {(
              [
                ["all", gt("All")],
                ["claude", "Claude"],
                ["codex", "Codex"],
                ["grok", "Cursor"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                aria-pressed={filter === id}
                className={cn(
                  "inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[11px]",
                  filter === id
                    ? "bg-white/12 text-white"
                    : "bg-white/4 text-white/55 hover:bg-white/8 hover:text-white/80",
                  FOCUS_RING,
                )}
                onClick={() => {
                  setFilter(id);
                }}
              >
                {id === "claude" ? <ClaudeAI className="size-3 text-[#d97757]" /> : null}
                {id === "codex" ? <OpenAI className="size-3" /> : null}
                {id === "grok" ? <CursorIcon className="size-3 fill-current" aria-hidden /> : null}
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          {loading && sessions.length === 0 ? (
            <p className="px-2 py-3 text-[13px] text-white/40">
              <T>Looking for sessions on this Mac…</T>
            </p>
          ) : groups.length === 0 ? (
            <p className="px-2 py-3 text-[13px] text-white/40">
              {detail ?? <T>No sessions found.</T>}
            </p>
          ) : (
            groups.map((group) => (
              <div key={group.cwd} className="mb-3">
                <div className="px-2 py-1">
                  <p className="truncate text-[12px] font-medium text-white/80">{group.label}</p>
                  <p className="truncate text-[11px] text-white/35">{group.path}</p>
                </div>
                <ul className="space-y-0.5">
                  {group.sessions.map((session) => {
                    const selectedRow = session.id === selectedId;
                    return (
                      <li key={`${session.provider}:${session.id}`}>
                        <button
                          type="button"
                          aria-current={selectedRow ? "true" : undefined}
                          className={cn(
                            "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left",
                            selectedRow ? "bg-white/10 text-white" : "hover:bg-white/5",
                            FOCUS_RING,
                          )}
                          onClick={() => {
                            setSelectedId(session.id);
                            setResumeNote(null);
                          }}
                          onDoubleClick={() => {
                            setSelectedId(session.id);
                            continueSession(session);
                          }}
                        >
                          <ProviderGlyph provider={session.provider} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13px] text-white/90">
                              {session.title.trim().length > 0
                                ? session.title
                                : gt("Untitled", { $context: "fallback session title" })}
                            </span>
                            <span className="block truncate text-[11px] text-white/35">
                              {session.model?.trim() || group.path}
                            </span>
                          </span>
                          <span
                            className={cn(
                              "inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px]",
                              stateTone(session.state),
                            )}
                          >
                            <span className="size-1 rounded-full bg-current opacity-80" />
                            {stateLabel(session.state, gt)}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-[#141518]">
        <div className="drag-region absolute inset-x-0 top-0 h-[var(--workspace-topbar-height)]" />
        {selected === null ? (
          <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
            <MessageSquareIcon className="size-10 text-white/25" strokeWidth={1.5} />
            <h2 className="mt-4 text-[18px] font-medium text-white">
              <T>Choose a session</T>
            </h2>
            <p className="mt-2 max-w-sm text-[13px] leading-5 text-white/45">
              <T>
                Open a Claude or Codex session to follow its work, answer requests and send
                follow-ups.
              </T>
            </p>
          </div>
        ) : (
          <div className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center px-6">
            <div className="flex items-center gap-3">
              <ProviderGlyph provider={selected.provider} />
              <div className="min-w-0 flex-1">
                {renaming?.id === selected.id ? (
                  <form
                    className="flex items-center gap-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      saveRename(selected);
                    }}
                  >
                    <input
                      ref={(node) => {
                        node?.focus();
                      }}
                      value={renaming.value}
                      maxLength={160}
                      disabled={renameBusy}
                      aria-label={gt("Session name", { $context: "rename a Claude CLI session" })}
                      className="min-w-0 flex-1 rounded-md border border-white/15 bg-white/5 px-2 py-1 text-[16px] text-white outline-none focus:border-white/40"
                      onChange={(event) => {
                        setRenaming({ id: selected.id, value: event.target.value });
                      }}
                      onKeyDown={(event) => {
                        if (event.key !== "Escape") return;
                        event.preventDefault();
                        setRenaming(null);
                      }}
                    />
                    <button
                      type="submit"
                      disabled={renameBusy}
                      aria-label={gt("Save name", { $context: "saves the new session name" })}
                      className={cn(
                        "grid size-8 place-items-center rounded-md text-white/70 hover:bg-white/10 hover:text-white",
                        FOCUS_RING,
                      )}
                    >
                      <CheckIcon className="size-4" strokeWidth={1.75} />
                    </button>
                  </form>
                ) : (
                  <div className="flex min-w-0 items-center gap-1.5">
                    <h2 className="truncate text-[18px] font-medium text-white">
                      {selected.title.trim().length > 0
                        ? selected.title
                        : gt("Untitled", { $context: "fallback session title" })}
                    </h2>
                    {selected.provider === "claude" ? (
                      <button
                        type="button"
                        aria-label={gt("Rename session", { $context: "renames a Claude CLI session" })}
                        className={cn(
                          "grid size-7 shrink-0 place-items-center rounded-md text-white/45 hover:bg-white/10 hover:text-white/85",
                          FOCUS_RING,
                        )}
                        onClick={() => {
                          setRenameNote(null);
                          setRenaming({ id: selected.id, value: selected.title });
                        }}
                      >
                        <PencilIcon className="size-3.5" strokeWidth={1.75} />
                      </button>
                    ) : null}
                  </div>
                )}
                <p className="truncate text-[13px] text-white/45">{shortenHome(selected.cwd)}</p>
                {renameNote?.id === selected.id ? (
                  <p className="mt-1 text-[12px] leading-5 text-white/50">{renameNote.text}</p>
                ) : null}
              </div>
            </div>
            <dl className="mt-6 space-y-3 text-[13px]">
              <div className="flex justify-between gap-4 border-b border-white/8 pb-2">
                <dt className="text-white/40">
                  <T>Provider</T>
                </dt>
                <dd className="capitalize text-white/85">{selected.provider}</dd>
              </div>
              <div className="flex justify-between gap-4 border-b border-white/8 pb-2">
                <dt className="text-white/40">
                  <T>Status</T>
                </dt>
                <dd className={cn(stateTone(selected.state).split(" ")[0])}>
                  {stateLabel(selected.state, gt)}
                </dd>
              </div>
              {selected.model ? (
                <div className="flex justify-between gap-4 border-b border-white/8 pb-2">
                  <dt className="text-white/40">
                    <T>Model</T>
                  </dt>
                  <dd className="truncate text-white/85">{selected.model}</dd>
                </div>
              ) : null}
            </dl>
            <button
              type="button"
              disabled={resumeBusy || (selected.provider !== "claude" && selected.provider !== "antigravity" && selected.provider !== "codex")}
              className={cn(
                "mt-6 inline-flex h-10 items-center justify-center rounded-lg px-4 text-[13px] font-medium",
                resumeBusy
                  ? "bg-white/10 text-white/45"
                  : "bg-white text-[#141518] hover:bg-white/90",
                FOCUS_RING,
              )}
              onClick={() => {
                continueSession(selected);
              }}
            >
              {resumeBusy
                ? gt("Opening…", { $context: "resuming a CLI session in Terminal" })
                : gt("Continue in Terminal", {
                    $context: "resume this Claude or Codex session in Terminal",
                  })}
            </button>
            <p className="mt-3 text-[12px] leading-5 text-white/40">
              {resumeNote ?? (
                <T>
                  Opens Terminal and resumes this CLI thread with its full history, so you can keep
                  chatting where you left off.
                </T>
              )}
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
