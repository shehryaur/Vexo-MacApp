/* oxlint-disable shadcn/no-arbitrary-values -- The Vexo chrome matches the recorded dark Mac host UI. */

import { useLocation, useNavigate } from "@tanstack/react-router";
import { T, useGT } from "gt-react";
import { CalendarDaysIcon, MicIcon, SquarePenIcon, SquareTerminalIcon } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { cn } from "~/lib/utils";
import { Tooltip, TooltipPopup, TooltipProvider, TooltipTrigger } from "~/components/ui/tooltip";
import { isAppModalPage } from "../sidebar/mainAppLocation";
import { useVexoDraftStart } from "./useVexoDraftStart";
import { VexoMark } from "./VexoMark";
import { VexoRecents } from "./VexoRecents";
import { VexoSessionsPanel } from "./VexoSessionsPanel";
import { VexoTimelinePanel } from "./VexoTimelinePanel";

const DEFAULT_DISPLAY_NAME = "Shehryar";
const FOCUS_RING =
  "cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-default";

const RAIL_BTN =
  "grid size-11 place-items-center rounded-xl text-white/60 hover:bg-white/8 hover:text-white/90";
const RAIL_BTN_ACTIVE = "bg-white/14 text-white hover:bg-white/14 hover:text-white";

function monogram(name: string): string {
  const parts = name.split(/\s+/u).filter((part) => part.length > 0);
  const first = parts[0];
  const second = parts[1];
  if (first !== undefined && second !== undefined) {
    return `${first[0] ?? ""}${second[0] ?? ""}`.toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

/**
 * Persistent Mac chrome: Vexo sidebar stays mounted while home, drafts, and
 * threads swap in the main pane so New chat never jumps to the stock T3 shell.
 */
export function VexoShell({
  children,
  displayName = DEFAULT_DISPLAY_NAME,
}: {
  readonly children: ReactNode;
  readonly displayName?: string;
}) {
  const navigate = useNavigate();
  const { startState, openDraft } = useVexoDraftStart();
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const modalPage = useLocation({ select: (location) => isAppModalPage(location.pathname) });

  // Portaled modals (Settings) sit outside [data-vexo-shell]; keep the same grey
  // tokens on <html> so open/close does not flash stock black.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- synchronizes the root html element dataset while VexoShell is mounted
  useEffect(() => {
    document.documentElement.dataset.vexoMac = "";
    return () => {
      delete document.documentElement.dataset.vexoMac;
    };
  }, []);

  const closeOverlays = () => {
    setTimelineOpen(false);
    setSessionsOpen(false);
  };

  /** Vexo AI home — the framed start surface (composer + Mac status). */
  const openVexoAi = () => {
    closeOverlays();
    void navigate({ to: "/", replace: false });
  };

  const openSettings = () => {
    closeOverlays();
    void navigate({ to: "/settings/general", replace: false });
  };

  const openVoiceSettings = () => {
    closeOverlays();
    // Hey Vexo is wake-word / voice input — not a click-to-record modal.
    void navigate({ to: "/settings/voice", replace: false });
  };

  return (
    <div data-vexo-shell="" className="flex h-dvh min-h-0 w-full bg-[#141518] text-[#eceff3]">
      <div className="drag-region absolute inset-x-0 top-0 z-20 h-[var(--workspace-topbar-height)]" />
      <VexoSidebar
        displayName={displayName}
        busy={startState.opening}
        timelineOpen={timelineOpen}
        sessionsOpen={sessionsOpen}
        onHome={openVexoAi}
        onSettings={openSettings}
        onVoiceSettings={openVoiceSettings}
        onNewChat={() => {
          setTimelineOpen(false);
          setSessionsOpen(false);
          openDraft();
        }}
        onToggleTimeline={() => {
          setSessionsOpen(false);
          setTimelineOpen((open) => !open);
        }}
        onToggleSessions={() => {
          setTimelineOpen(false);
          setSessionsOpen((open) => !open);
        }}
      />
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-[#141518] [&>main]:h-full! [&>main]:min-h-0 [&>main]:md:h-full!">
        {/* Settings and Usage render their modal through children, so the panels step aside. */}
        {modalPage ? (
          children
        ) : sessionsOpen ? (
          <VexoSessionsPanel
            onClose={() => {
              setSessionsOpen(false);
            }}
          />
        ) : timelineOpen ? (
          <VexoTimelinePanel
            onClose={() => {
              setTimelineOpen(false);
            }}
          />
        ) : (
          children
        )}
      </div>
    </div>
  );
}

function VexoSidebar({
  displayName,
  busy,
  timelineOpen,
  sessionsOpen,
  onNewChat,
  onToggleTimeline,
  onToggleSessions,
  onHome,
  onSettings,
  onVoiceSettings,
}: {
  readonly displayName: string;
  readonly busy: boolean;
  readonly timelineOpen: boolean;
  readonly sessionsOpen: boolean;
  readonly onNewChat: (() => void) | undefined;
  readonly onToggleTimeline: () => void;
  readonly onToggleSessions: () => void;
  readonly onHome: () => void;
  readonly onSettings: () => void;
  readonly onVoiceSettings: () => void;
}) {
  const gt = useGT();
  const initials = monogram(displayName);

  return (
    <aside
      className={cn(
        "flex shrink-0 border-r border-white/8 bg-[#141518]",
        sessionsOpen ? "w-16" : "w-72",
      )}
    >
      <div className="flex w-16 shrink-0 flex-col items-center gap-1 border-r border-white/6 pt-[var(--workspace-topbar-height)] pb-4">
        <TooltipProvider delay={1000} closeDelay={150} timeout={400}>
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  className={cn(
                    "flex h-12 items-center justify-center text-white hover:text-white/85",
                    FOCUS_RING,
                  )}
                  aria-label={gt("Vexo AI", { $context: "opens the Vexo AI home interface" })}
                  onClick={onHome}
                />
              }
            >
              <span className="size-7">
                <VexoMark label={gt("Vexo", { $context: "product name" })} />
              </span>
            </TooltipTrigger>
            <TooltipPopup side="right">
              <T>Vexo AI</T>
            </TooltipPopup>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  aria-pressed={timelineOpen}
                  aria-label={gt("Timeline", { $context: "opens the daily timeline view" })}
                  className={cn(RAIL_BTN, timelineOpen && RAIL_BTN_ACTIVE, FOCUS_RING)}
                  onClick={onToggleTimeline}
                />
              }
            >
              <CalendarDaysIcon className="size-5" strokeWidth={1.75} />
            </TooltipTrigger>
            <TooltipPopup side="right">
              <T>Timeline</T>
            </TooltipPopup>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  aria-pressed={sessionsOpen}
                  aria-label={gt("Sessions", {
                    $context: "opens Claude Codex and Grok sessions found on this Mac",
                  })}
                  className={cn(RAIL_BTN, sessionsOpen && RAIL_BTN_ACTIVE, FOCUS_RING)}
                  onClick={onToggleSessions}
                />
              }
            >
              <SquareTerminalIcon className="size-5" strokeWidth={1.75} />
            </TooltipTrigger>
            <TooltipPopup side="right">
              <T>Sessions</T>
            </TooltipPopup>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  aria-label={gt("Voice", {
                    $context: "opens voice settings; Hey Vexo listens for the wake phrase, not this button",
                  })}
                  className={cn(RAIL_BTN, FOCUS_RING)}
                  onClick={onVoiceSettings}
                />
              }
            >
              <MicIcon className="size-5" strokeWidth={1.75} />
            </TooltipTrigger>
            <TooltipPopup side="right">
              <T>Voice</T>
            </TooltipPopup>
          </Tooltip>
          <div className="mt-auto">
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    className={cn(
                      "grid size-10 place-items-center rounded-full bg-white/12 text-[12px] font-semibold tracking-wide text-white/90 hover:bg-white/18",
                      FOCUS_RING,
                    )}
                    aria-label={gt("Settings", { $context: "opens account and Mac settings" })}
                    onClick={onSettings}
                  />
                }
              >
                {initials}
              </TooltipTrigger>
              <TooltipPopup side="right">
                <T>Settings</T>
              </TooltipPopup>
            </Tooltip>
          </div>
        </TooltipProvider>
      </div>
      {sessionsOpen ? null : (
        <div className="flex min-w-0 flex-1 flex-col pt-[var(--workspace-topbar-height)]">
          <div className="flex h-12 items-center px-3.5">
            <button
              type="button"
              className={cn(
                "min-w-0 truncate text-left text-[17px] font-semibold tracking-tight text-white hover:text-white/85",
                FOCUS_RING,
              )}
              onClick={onHome}
            >
              <T>Vexo</T>
            </button>
          </div>
          <button
            type="button"
            disabled={busy || onNewChat === undefined}
            className={cn(
              "mx-2.5 flex h-11 items-center gap-2.5 rounded-xl px-2.5 text-left text-[14px] text-white/90 hover:bg-white/6 disabled:opacity-50",
              FOCUS_RING,
            )}
            onClick={() => {
              onNewChat?.();
            }}
          >
            <SquarePenIcon className="size-5 text-white/55" strokeWidth={1.75} />
            <T>New chat</T>
          </button>
          <button
            type="button"
            aria-pressed={timelineOpen}
            className={cn(
              "mx-2.5 flex h-11 items-center gap-2.5 rounded-xl px-2.5 text-left text-[14px] hover:bg-white/6",
              timelineOpen ? "bg-white/10 text-white" : "text-white/90",
              FOCUS_RING,
            )}
            onClick={onToggleTimeline}
          >
            <CalendarDaysIcon className="size-5 text-white/55" strokeWidth={1.75} />
            <T>Timeline</T>
          </button>
          <VexoRecents
            onOpenThread={() => {
              if (timelineOpen) onToggleTimeline();
            }}
          />
        </div>
      )}
    </aside>
  );
}
