/* oxlint-disable shadcn/no-arbitrary-values -- The Vexo start screen copies the recorded dark chrome instead of the app theme. */

/*
 * Hey Vexo uses this Mac's microphone through voice input when a project is open.
 * Lid-closed toggles a user-space caffeinate hold. The band control reports a local
 * scan and does not pair. Timeline stays on its own panel.
 */
import { Link, useNavigate } from "@tanstack/react-router";
import { msg, T, useGT, useMessages, Var } from "gt-react";
import {
  AppWindowIcon,
  ArrowUpIcon,
  CalendarDaysIcon,
  CircleIcon,
  InfoIcon,
  LaptopIcon,
  MicIcon,
  ShieldIcon,
  SquarePenIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";

import type {
  DesktopFrontWindowCapture,
  DesktopVexoAwakeStatus,
  DesktopVexoBandStatus,
} from "@t3tools/contracts";
import type { MessageResolver } from "~/i18n/messages";
import { cn } from "~/lib/utils";
import { buildThreadRouteParams } from "~/threadRoutes";
import { ClaudeAI, CursorIcon, OpenAI } from "../Icons";
import { Tooltip, TooltipPopup, TooltipProvider, TooltipTrigger } from "~/components/ui/tooltip";
import { CAPTURE_THREAD_PROMPT, capturedWindowDataUrl, getFrontWindowCapture } from "./capture";
import {
  useVexoHomeModel,
  type VexoAppConnection,
  type VexoAppId,
  type VexoApprovalRow,
  type VexoExtraApp,
  type VexoLinkState,
  type VexoSessionRow,
} from "./useVexoHomeModel";
import type { VexoSpeechTarget } from "./VexoHeyDictation";
import { VexoMark } from "./VexoMark";
import { VexoRecents } from "./VexoRecents";
import { VexoTimelinePanel } from "./VexoTimelinePanel";
import {
  readAwakeStatus,
  readBandStatus,
  removeAwakeSetup,
  scanBand,
  setAwakeActive,
} from "./vexoDeviceStatus";

const DEFAULT_DISPLAY_NAME = "Shehryar";
const FOCUS_RING =
  "cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-default";

type AppConnection = "connected" | "not-connected";

const AI_APPS = [
  {
    id: "claude-code",
    name: msg("Claude Code"),
    disconnectedDetail: msg(
      "Open a new terminal and start Claude. Allow the Vexo channel if prompted.",
    ),
  },
  {
    id: "codex",
    name: msg("Codex"),
    disconnectedDetail: msg("No connected sessions."),
  },
  {
    id: "grokbot",
    name: msg("Cursor / Grok"),
    disconnectedDetail: msg("No connected sessions. Start Cursor or Grok from a project in Vexo."),
  },
] as const satisfies readonly {
  readonly id: VexoAppId;
  readonly name: string;
  readonly disconnectedDetail: string;
}[];

const CONNECTED_SESSIONS = msg(
  "{count, plural, one {{count} connected session} other {{count} connected sessions}}",
);
const NO_CONNECTED_SESSIONS = msg("No connected sessions.");
const DEMO_SESSION = { id: "note-name", title: msg("Note Shehryar's name") } as const;
const UNTITLED_SESSION = msg("Untitled");
const APPROVAL_FALLBACK = msg("Approval");

function monogram(name: string): string {
  const parts = name.split(/\s+/u).filter((part) => part.length > 0);
  const first = parts[0];
  const second = parts[1];
  if (first !== undefined && second !== undefined) {
    return `${first[0] ?? ""}${second[0] ?? ""}`.toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

type DayPart = "morning" | "afternoon" | "evening";

function dayPartForHour(hour: number): DayPart {
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  return "evening";
}

const SPLASH_PATTERN = encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="56" height="48" viewBox="0 0 56 48" fill="none">
    <path fill="#171b22" stroke="#171b22" stroke-width="1.6" stroke-linejoin="round" d="M14 2.2 20.2 13H7.8Z"/>
    <path fill="#171b22" stroke="#171b22" stroke-width="1.6" stroke-linejoin="round" d="M42 2.2 48.2 13H35.8Z"/>
    <path fill="#12161c" stroke="#12161c" stroke-width="1.6" stroke-linejoin="round" d="M28 13.2 21.8 2.4h12.4Z"/>
    <path fill="#12161c" stroke="#12161c" stroke-width="1.6" stroke-linejoin="round" d="M0 13.2-6.2 2.4h12.4Z"/>
    <path fill="#12161c" stroke="#12161c" stroke-width="1.6" stroke-linejoin="round" d="M56 13.2 49.8 2.4h12.4Z"/>
    <path fill="#171b22" stroke="#171b22" stroke-width="1.6" stroke-linejoin="round" d="M0 26.2 6.2 37H-6.2Z"/>
    <path fill="#171b22" stroke="#171b22" stroke-width="1.6" stroke-linejoin="round" d="M28 26.2 34.2 37H21.8Z"/>
    <path fill="#171b22" stroke="#171b22" stroke-width="1.6" stroke-linejoin="round" d="M56 26.2 62.2 37H49.8Z"/>
    <path fill="#12161c" stroke="#12161c" stroke-width="1.6" stroke-linejoin="round" d="M14 37.2 7.8 26.4h12.4Z"/>
    <path fill="#12161c" stroke="#12161c" stroke-width="1.6" stroke-linejoin="round" d="M42 37.2 35.8 26.4h12.4Z"/>
  </svg>`,
);

export interface VexoHomeProps {
  readonly displayName?: string;
  readonly hostname?: string;
  readonly busy?: boolean;
  readonly onSubmit?: (prompt: string) => void;
  readonly onNewChat?: () => void;
  readonly onCaptureAttached?: (capture: DesktopFrontWindowCapture) => void;
  /** Kept for callers; mic opens voice settings — wake word is not a click modal. */
  readonly speechTarget?: VexoSpeechTarget;
  /**
   * When true, only the home dashboard renders — VexoShell already owns the
   * sidebar and outer chrome so New chat stays inside the same frame.
   */
  readonly framed?: boolean;
}

export function VexoHome({
  displayName = DEFAULT_DISPLAY_NAME,
  hostname: hostnameProp,
  busy = false,
  onSubmit,
  onNewChat,
  onCaptureAttached,
  framed = false,
}: VexoHomeProps) {
  const navigate = useNavigate();
  const model = useVexoHomeModel();
  const [showSplash, setShowSplash] = useState(!framed);
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [awake, setAwake] = useState<DesktopVexoAwakeStatus | null>(null);
  const [awakePending, setAwakePending] = useState(false);
  const [band, setBand] = useState<DesktopVexoBandStatus | null>(null);
  const [bandOpen, setBandOpen] = useState(false);
  const [bandScanning, setBandScanning] = useState(false);
  const [dayPart] = useState(() => dayPartForHour(new Date().getHours()));
  const hostname = hostnameProp ?? model.hostname;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- keeps the desktop awake and band status in step with this mounted home
  useEffect(() => {
    let cancelled = false;
    void readAwakeStatus().then((next) => {
      if (!cancelled) setAwake(next);
    });
    void readBandStatus().then((next) => {
      if (!cancelled) setBand(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const toggleAwake = () => {
    if (awake === null || awakePending) return;
    setAwakePending(true);
    void setAwakeActive(!awake.active).then((next) => {
      setAwake(next);
      setAwakePending(false);
    });
  };
  const removeAwakePermission = () => {
    if (awakePending) return;
    setAwakePending(true);
    void removeAwakeSetup().then((next) => {
      setAwake(next);
      setAwakePending(false);
    });
  };
  const toggleBand = () => {
    setBandOpen((open) => !open);
  };
  const runBandScan = () => {
    if (bandScanning) return;
    setBandScanning(true);
    void scanBand().then((next) => {
      setBand(next);
      setBandScanning(false);
    });
  };
  const openVoiceSettings = () => {
    setBandOpen(false);
    // Hey Vexo is wake-word / voice input — not a click-to-record modal.
    void navigate({ to: "/settings/voice", replace: false });
  };

  const panelInset = framed ? "left-0" : "left-72";
  const dashboard = (
    <>
      {timelineOpen && !framed ? (
        <VexoTimelinePanel
          onClose={() => {
            setTimelineOpen(false);
          }}
        />
      ) : (
        <VexoMain
          dayPart={dayPart}
          displayName={displayName}
          hostname={hostname}
          link={model.link}
          apps={model.apps}
          extraApps={model.extraApps}
          approvals={model.approvals}
          sessions={model.sessions}
          busy={busy}
          onSubmit={onSubmit}
          onCaptureAttached={onCaptureAttached}
          awake={awake}
          awakePending={awakePending}
          band={band}
          bandOpen={bandOpen}
          onToggleAwake={toggleAwake}
          onRemoveAwakeSetup={removeAwakePermission}
          onToggleBand={toggleBand}
        />
      )}
      {bandOpen ? (
        <BandPanel
          band={band}
          scanning={bandScanning}
          insetClassName={panelInset}
          onScan={runBandScan}
          onClose={() => {
            setBandOpen(false);
          }}
        />
      ) : null}
    </>
  );

  if (framed) {
    return (
      <div data-vexo-home="" className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        {dashboard}
      </div>
    );
  }

  return (
    <div data-vexo-home="" className="fixed inset-0 z-40 flex bg-[#141518] text-[#eceff3]">
      <div className="drag-region absolute inset-x-0 top-0 z-20 h-[var(--workspace-topbar-height)]" />
      <div inert={showSplash} className="relative flex min-h-0 min-w-0 flex-1">
        <VexoSidebar
          displayName={displayName}
          busy={busy}
          timelineOpen={timelineOpen}
          onNewChat={onNewChat}
          onVoiceSettings={openVoiceSettings}
          onToggleTimeline={() => {
            setTimelineOpen((open) => !open);
          }}
          onSettings={() => {
            void navigate({ to: "/settings/general", replace: false });
          }}
        />
        {dashboard}
      </div>
      {showSplash ? (
        <VexoSplash
          onDone={() => {
            setShowSplash(false);
          }}
        />
      ) : null}
    </div>
  );
}

function VexoSplash({ onDone }: { readonly onDone: () => void }) {
  const gt = useGT();
  const splashName = gt("Vexo", { $context: "product name" });
  return (
    <>
      <style>
        {`
          @keyframes vexo-splash-out {
            0%, 62% { opacity: 1; }
            100% { opacity: 0; }
          }
          @keyframes vexo-mark-in {
            from { opacity: 0; transform: scale(0.96); }
            to { opacity: 1; transform: scale(1); }
          }
          @media (prefers-reduced-motion: reduce) {
            [data-vexo-splash],
            [data-vexo-mark] { animation-duration: 1ms !important; }
          }
        `}
      </style>
      <div
        data-vexo-splash=""
        className="absolute inset-0 z-30 flex items-center justify-center"
        style={{
          backgroundColor: "#0c0e12",
          backgroundImage: `url("data:image/svg+xml,${SPLASH_PATTERN}")`,
          backgroundSize: "56px 48px",
          animation: "vexo-splash-out 1.15s ease forwards",
        }}
        onAnimationEnd={(event) => {
          if (event.animationName === "vexo-splash-out") onDone();
        }}
      >
        <span
          data-vexo-mark=""
          className="flex flex-col items-center gap-4"
          style={{ animation: "vexo-mark-in 0.45s ease both" }}
        >
          <span className="size-20">
            <VexoMark label={splashName} />
          </span>
          {splashName === "Vexo" ? null : (
            <span className="text-[15px] font-medium tracking-tight text-white/80">
              {splashName}
            </span>
          )}
        </span>
      </div>
    </>
  );
}

function VexoSidebar({
  displayName,
  busy,
  timelineOpen,
  onNewChat,
  onVoiceSettings,
  onToggleTimeline,
  onSettings,
}: {
  readonly displayName: string;
  readonly busy: boolean;
  readonly timelineOpen: boolean;
  readonly onNewChat: (() => void) | undefined;
  readonly onVoiceSettings: () => void;
  readonly onToggleTimeline: () => void;
  readonly onSettings: () => void;
}) {
  const gt = useGT();
  const initials = monogram(displayName);
  const railBtn =
    "grid size-11 place-items-center rounded-xl text-white/60 hover:bg-white/8 hover:text-white/90";
  const railActive = "bg-white/14 text-white hover:bg-white/14 hover:text-white";

  return (
    <aside className="flex w-72 shrink-0 border-r border-white/8 bg-[#141518]">
      <div className="flex w-16 shrink-0 flex-col items-center gap-1 border-r border-white/6 pt-[var(--workspace-topbar-height)] pb-4">
        <div className="flex h-12 items-center justify-center text-white">
          <span className="size-7">
            <VexoMark label={gt("Vexo", { $context: "product name" })} />
          </span>
        </div>
        <TooltipProvider delay={1000} closeDelay={150} timeout={400}>
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  aria-pressed={timelineOpen}
                  aria-label={gt("Timeline", { $context: "opens the daily timeline view" })}
                  className={cn(railBtn, timelineOpen && railActive, FOCUS_RING)}
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
                  aria-label={gt("Voice", { $context: "opens Hey Vexo and wake-word settings" })}
                  className={cn(railBtn, FOCUS_RING)}
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
      <div className="flex min-w-0 flex-1 flex-col pt-[var(--workspace-topbar-height)]">
        <div className="flex h-12 items-center px-3.5">
          <span className="min-w-0 truncate text-[17px] font-semibold tracking-tight">
            <T>Vexo</T>
          </span>
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
    </aside>
  );
}

function VexoMain({
  dayPart,
  displayName,
  hostname,
  link,
  apps,
  extraApps,
  approvals,
  sessions,
  busy,
  onSubmit,
  onCaptureAttached,
  awake,
  awakePending,
  band,
  bandOpen,
  onToggleAwake,
  onRemoveAwakeSetup,
  onToggleBand,
}: {
  readonly dayPart: DayPart;
  readonly displayName: string;
  readonly hostname: string;
  readonly link: VexoLinkState;
  readonly apps: Readonly<Record<VexoAppId, VexoAppConnection>>;
  readonly extraApps: readonly VexoExtraApp[];
  readonly approvals: readonly VexoApprovalRow[];
  readonly sessions: readonly VexoSessionRow[];
  readonly busy: boolean;
  readonly onSubmit: ((prompt: string) => void) | undefined;
  readonly onCaptureAttached?: ((capture: DesktopFrontWindowCapture) => void) | undefined;
  readonly awake: DesktopVexoAwakeStatus | null;
  readonly awakePending: boolean;
  readonly band: DesktopVexoBandStatus | null;
  readonly bandOpen: boolean;
  readonly onToggleAwake: () => void;
  readonly onRemoveAwakeSetup: () => void;
  readonly onToggleBand: () => void;
}) {
  return (
    <main className="relative min-w-0 flex-1">
      <div className="scrollbar-gutter-both h-full overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[720px] flex-col px-6 pt-[calc(var(--workspace-topbar-height)+1.75rem)] pb-28">
          <StatusRow
            hostname={hostname}
            link={link}
            awake={awake}
            awakePending={awakePending}
            band={band}
            bandOpen={bandOpen}
            onToggleAwake={onToggleAwake}
            onRemoveAwakeSetup={onRemoveAwakeSetup}
            onToggleBand={onToggleBand}
          />
          <h1 className="mt-10 text-center text-[28px] font-semibold tracking-tight text-white">
            <Greeting dayPart={dayPart} name={displayName} />
          </h1>
          <p className="mt-2 text-center text-[15px] text-white/50">
            <T>What can Vexo help you with?</T>
          </p>
          <VexoComposer busy={busy} onSubmit={onSubmit} />
          <ApprovalsCard approvals={approvals} />
          <AiAppsCard apps={apps} extraApps={extraApps} />
          <SessionsSection sessions={sessions} />
        </div>
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-5 flex justify-center px-4">
        <CaptureBar busy={busy} onSubmit={onSubmit} onCaptureAttached={onCaptureAttached} />
      </div>
    </main>
  );
}

function Greeting({ dayPart, name }: { readonly dayPart: DayPart; readonly name: string }) {
  if (dayPart === "morning") {
    return (
      <T>
        Good morning, <Var>{name}</Var>
      </T>
    );
  }
  if (dayPart === "afternoon") {
    return (
      <T>
        Good afternoon, <Var>{name}</Var>
      </T>
    );
  }
  return (
    <T>
      Good evening, <Var>{name}</Var>
    </T>
  );
}

function StatusRow({
  hostname,
  link,
  awake,
  awakePending,
  band,
  bandOpen,
  onToggleAwake,
  onRemoveAwakeSetup,
  onToggleBand,
}: {
  readonly hostname: string;
  readonly link: VexoLinkState;
  readonly awake: DesktopVexoAwakeStatus | null;
  readonly awakePending: boolean;
  readonly band: DesktopVexoBandStatus | null;
  readonly bandOpen: boolean;
  readonly onToggleAwake: () => void;
  readonly onRemoveAwakeSetup: () => void;
  readonly onToggleBand: () => void;
}) {
  const gt = useGT();
  const holding = awake?.active === true;
  const awakeLabel =
    awake === null
      ? gt("Lid-closed: …")
      : awake.mode === "lid-closed"
        ? gt("Lid-closed: On")
        : awake.mode === "user-space"
          ? gt("Lid-closed: Idle only")
          : gt("Lid-closed: Off");
  const bandText =
    band === null
      ? gt("Band: …")
      : band.state === "connected"
        ? gt("Band: Connected")
        : gt("Band: Not found");
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-2 text-[13px]">
        <button
          type="button"
          aria-describedby="vexo-awake-note"
          aria-pressed={holding}
          disabled={awake === null || awakePending}
          data-vexo-awake={holding ? "on" : "off"}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1",
            holding
              ? "border-[#3ddc84]/40 bg-[#3ddc84]/12 text-[#7ddea8]"
              : "border-[#e0a33a]/35 bg-[#e0a33a]/12 text-[#e6b15a]",
            FOCUS_RING,
          )}
          onClick={onToggleAwake}
        >
          <LaptopIcon className="size-3.5" strokeWidth={1.75} />
          {awakeLabel}
        </button>
        <span className="text-white/75">{hostname}</span>
        <MachineLink link={link} label={machineLinkLabel(link, gt)} />
        <span
          data-vexo-band={band?.state ?? "unknown"}
          className={band?.state === "connected" ? "text-[#7ddea8]" : "text-white/55"}
        >
          {bandText}
        </span>
        <button
          type="button"
          aria-pressed={bandOpen}
          aria-label={gt("Vexo band scan", {
            $context: "shows nearby radios and does not pair",
          })}
          className={cn(
            "grid size-6 place-items-center rounded-md text-white/35 hover:bg-white/6 hover:text-white/70",
            FOCUS_RING,
          )}
          onClick={onToggleBand}
        >
          <InfoIcon className="size-3.5" />
        </button>
      </div>
      <p id="vexo-awake-note" className="text-[12px] leading-4 text-white/40">
        {awake?.detail ?? <T>Checking the awake hold.</T>}
        {awake?.lidClosedReady && !holding ? (
          <>
            {" "}
            <button
              type="button"
              disabled={awakePending}
              className={cn("underline underline-offset-2 hover:text-white/70", FOCUS_RING)}
              onClick={onRemoveAwakeSetup}
            >
              <T>Remove lid-closed permission</T>
            </button>
          </>
        ) : null}
      </p>
    </div>
  );
}

function machineLinkLabel(
  link: VexoLinkState,
  gt: (message: string, variables?: { readonly $context?: string }) => string,
): string | null {
  if (link === "connected") return gt("Connected", { $context: "this Mac is reachable" });
  if (link === "error") return gt("Error", { $context: "this Mac is not reachable" });
  if (link === "offline") return gt("Offline", { $context: "this Mac is not reachable" });
  if (link === "connecting") return gt("Connecting", { $context: "this Mac is connecting" });
  return null;
}

function MachineLink({
  link,
  label,
}: {
  readonly link: VexoLinkState;
  readonly label: string | null;
}) {
  if (label === null) return null;
  const connected = link === "connected";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5",
        connected ? "text-white/80" : "text-white/55",
      )}
    >
      <span className={cn("size-1.5 rounded-full", connected ? "bg-[#3ddc84]" : "bg-white/35")} />
      {label}
    </span>
  );
}

function VexoComposer({
  busy,
  onSubmit,
}: {
  readonly busy: boolean;
  readonly onSubmit: ((prompt: string) => void) | undefined;
}) {
  const gt = useGT();
  const [prompt, setPrompt] = useState("");
  const canSend = !busy && onSubmit !== undefined && prompt.trim().length > 0;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const next = prompt.trim();
    if (!canSend || next.length === 0) return;
    onSubmit?.(next);
    setPrompt("");
  };

  return (
    <form onSubmit={submit} className="mt-7">
      <label className="sr-only" htmlFor="vexo-ask">
        <T>Ask Vexo</T>
      </label>
      <div className="flex h-12 items-center gap-1 rounded-full border border-white/10 bg-[#23262c] pr-1.5 pl-4">
        <input
          id="vexo-ask"
          value={prompt}
          disabled={busy}
          onChange={(event) => {
            setPrompt(event.target.value);
          }}
          placeholder={gt("Ask Vexo...")}
          className="min-w-0 flex-1 bg-transparent text-[14px] text-white outline-none placeholder:text-white/35 disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={!canSend}
          aria-label={gt("Send", { $context: "verb, sends the composer message" })}
          className={cn(
            "grid size-8 place-items-center rounded-full",
            FOCUS_RING,
            canSend ? "bg-white/16 text-white hover:bg-white/24" : "bg-white/8 text-white/30",
          )}
        >
          <ArrowUpIcon className="size-4" strokeWidth={1.75} />
        </button>
      </div>
    </form>
  );
}

function SurfaceCard({ children }: { readonly children: ReactNode }) {
  return (
    <section className="mt-4 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.025]">
      {children}
    </section>
  );
}

function ApprovalsCard({ approvals }: { readonly approvals: readonly VexoApprovalRow[] }) {
  const m = useMessages();
  const untitled = m(APPROVAL_FALLBACK);
  return (
    <SurfaceCard>
      <div className="px-4 py-3.5">
        <div className="flex items-center gap-2">
          <ShieldIcon className="size-4 text-white/70" strokeWidth={1.75} />
          <h2 className="text-[14px] font-medium text-white">
            <T>Approvals</T>
          </h2>
        </div>
        {approvals.length === 0 ? (
          <p className="mt-1.5 pl-6 text-[13px] leading-5 text-white/45">
            <T>Nothing is waiting for you. Requests from Claude and Codex appear here.</T>
          </p>
        ) : (
          <ul className="mt-2 space-y-1 pl-6">
            {approvals.map((approval) => (
              <li key={approval.key}>
                <Link
                  to="/$environmentId/$threadId"
                  params={buildThreadRouteParams(approval.thread)}
                  className={cn(
                    "block truncate text-left text-[13px] leading-5 text-white/80 hover:text-white",
                    FOCUS_RING,
                  )}
                >
                  {approvalLabel(approval, untitled)}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </SurfaceCard>
  );
}

function approvalLabel(approval: VexoApprovalRow, fallback: string): string {
  const title = approval.title.trim() || fallback;
  const detail = approval.approval?.detail?.trim() || approval.approval?.reason?.trim() || "";
  return detail.length > 0 ? `${title}: ${detail}` : title;
}

function AiAppsCard({
  apps,
  extraApps,
}: {
  readonly apps: Readonly<Record<VexoAppId, VexoAppConnection>>;
  readonly extraApps: readonly VexoExtraApp[];
}) {
  const m = useMessages();
  return (
    <SurfaceCard>
      <div className="px-4 pt-3.5 pb-2">
        <div className="flex items-center gap-2">
          <span className="grid size-4 place-items-center text-white/70" aria-hidden>
            <AppWindowIcon className="size-4" strokeWidth={1.75} />
          </span>
          <h2 className="text-[14px] font-medium text-white">
            <T>AI apps</T>
          </h2>
        </div>
        <p className="mt-1 pl-6 text-[13px] text-white/45">
          <T>Live connections to your assistants on this Mac.</T>
        </p>
      </div>
      <ul className="divide-y divide-white/8 border-t border-white/8">
        {AI_APPS.map((app) => {
          const connection = apps[app.id];
          return (
            <li key={app.id} className="flex items-start gap-3 px-4 py-3">
              <span className="mt-0.5">
                <AppMark id={app.id} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[14px] font-medium text-white">{m(app.name)}</div>
                <p className="mt-0.5 text-[13px] leading-5 text-white/45">
                  {appDetail(connection, m(app.disconnectedDetail), m)}
                </p>
              </div>
              <AppStatusLabel status={connection.status} />
            </li>
          );
        })}
        {extraApps.map((app) => (
          <li key={app.id} className="flex items-start gap-3 px-4 py-3">
            <span className="mt-0.5">
              <AppMark id={app.id} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[14px] font-medium text-white">{app.name}</div>
              <p className="mt-0.5 text-[13px] leading-5 text-white/45">
                {sessionCountDetail(app.sessionCount, m)}
              </p>
            </div>
            <AppStatusLabel status="connected" />
          </li>
        ))}
      </ul>
    </SurfaceCard>
  );
}

function appDetail(
  connection: VexoAppConnection,
  disconnectedDetail: string,
  m: MessageResolver,
): string {
  if (connection.status !== "connected") return disconnectedDetail;
  return sessionCountDetail(connection.sessionCount, m);
}

function sessionCountDetail(count: number, m: MessageResolver): string {
  if (count === 0) return m(NO_CONNECTED_SESSIONS);
  return m(CONNECTED_SESSIONS, { count });
}

function AppMark({ id }: { readonly id: VexoAppId | string }) {
  if (id === "claude-code") {
    return <ClaudeAI className="size-4" aria-hidden />;
  }
  if (id === "codex") {
    return <OpenAI className="size-4 fill-white" aria-hidden />;
  }
  if (id === "grokbot") {
    return <CursorIcon className="size-4 fill-white" aria-hidden />;
  }
  return (
    <span
      className="inline-flex size-4 items-center justify-center rounded-sm bg-white/10 text-[9px] font-semibold text-white/70"
      aria-hidden
    >
      {monogram(id).slice(0, 1)}
    </span>
  );
}

function AppStatusLabel({ status }: { readonly status: AppConnection }) {
  const gt = useGT();
  const connected = status === "connected";
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 pt-0.5 text-[12px]",
        connected ? "text-[#3ddc84]" : "text-white/40",
      )}
    >
      <span className={cn("size-1.5 rounded-full", connected ? "bg-[#3ddc84]" : "bg-white/35")} />
      {connected
        ? gt("Connected", { $context: "assistant connection status" })
        : gt("Not connected", { $context: "assistant connection status" })}
    </span>
  );
}

function SessionsSection({ sessions }: { readonly sessions: readonly VexoSessionRow[] }) {
  const gt = useGT();
  const m = useMessages();
  const untitled = m(UNTITLED_SESSION);
  const readyLabel = gt("Ready", { $context: "session status" });
  const workingLabel = gt("Working", { $context: "session status" });
  return (
    <section className="mt-6">
      <div className="flex items-center justify-between px-1">
        <h2 className="text-[14px] font-medium text-white/90">
          <T>Sessions on this Mac</T>
        </h2>
        <button
          type="button"
          className={cn("text-[13px] text-white/55 hover:text-white/80", FOCUS_RING)}
        >
          <T context="opens the full session list">See All</T>
        </button>
      </div>
      <ul className="mt-2">
        {sessions.length === 0 ? (
          <SessionRow
            title={m(DEMO_SESSION.title)}
            ready
            readyLabel={readyLabel}
            workingLabel={workingLabel}
          />
        ) : (
          sessions.map((session) => (
            <li key={session.id}>
              <Link
                to="/$environmentId/$threadId"
                params={buildThreadRouteParams(session.thread)}
                className={cn(
                  "flex items-center gap-3 rounded-xl px-1 py-2 hover:bg-white/5",
                  FOCUS_RING,
                )}
              >
                <SessionBody
                  title={session.title || untitled}
                  ready={session.ready}
                  readyLabel={readyLabel}
                  workingLabel={workingLabel}
                />
              </Link>
            </li>
          ))
        )}
      </ul>
    </section>
  );
}

function SessionRow({
  title,
  ready,
  readyLabel,
  workingLabel,
}: {
  readonly title: string;
  readonly ready: boolean;
  readonly readyLabel: string;
  readonly workingLabel: string;
}) {
  return (
    <li className="flex items-center gap-3 rounded-xl px-1 py-2">
      <SessionBody
        title={title}
        ready={ready}
        readyLabel={readyLabel}
        workingLabel={workingLabel}
      />
    </li>
  );
}

function SessionBody({
  title,
  ready,
  readyLabel,
  workingLabel,
}: {
  readonly title: string;
  readonly ready: boolean;
  readonly readyLabel: string;
  readonly workingLabel: string;
}) {
  return (
    <>
      <span className="grid size-7 place-items-center rounded-full border border-white/15 text-white/60">
        <CircleIcon className="size-3.5" strokeWidth={1.75} />
      </span>
      <span className="min-w-0 flex-1 truncate text-[14px] text-white/90">{title}</span>
      <span
        className={cn(
          "inline-flex items-center gap-1.5 text-[12px]",
          ready ? "text-[#3ddc84]" : "text-white/55",
        )}
      >
        <span className={cn("size-1.5 rounded-full", ready ? "bg-[#3ddc84]" : "bg-white/35")} />
        {ready ? readyLabel : workingLabel}
      </span>
    </>
  );
}

function CaptureBar({
  busy,
  onSubmit,
  onCaptureAttached,
}: {
  readonly busy: boolean;
  readonly onSubmit: ((prompt: string) => void) | undefined;
  readonly onCaptureAttached?: ((capture: DesktopFrontWindowCapture) => void) | undefined;
}) {
  const [capturing, setCapturing] = useState(false);
  const capture = () => {
    if (busy || capturing) return;
    setCapturing(true);
    void getFrontWindowCapture()
      .then((captured) => {
        if (captured && capturedWindowDataUrl(captured) && onCaptureAttached) {
          onCaptureAttached(captured);
          return;
        }
        onSubmit?.(CAPTURE_THREAD_PROMPT);
      })
      .finally(() => {
        setCapturing(false);
      });
  };
  return (
    <div className="pointer-events-auto flex items-center rounded-full border border-white/10 bg-[#2a2e34] p-1.5 shadow-composer-dark">
      <TooltipProvider delay={1000} closeDelay={150} timeout={400}>
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                disabled={busy || capturing}
                onClick={capture}
                className={cn(
                  "inline-flex h-8 items-center rounded-full bg-[#0a84ff] px-3.5 text-[13px] font-medium text-white hover:bg-[#2493ff] disabled:opacity-50",
                  FOCUS_RING,
                )}
              />
            }
          >
            <T context="button, starts a screen capture">Capture</T>
          </TooltipTrigger>
          <TooltipPopup side="top">
            <T>Capture front window</T>
          </TooltipPopup>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}

function BandPanel({
  band,
  scanning,
  onScan,
  onClose,
  insetClassName = "left-60",
}: {
  readonly band: DesktopVexoBandStatus | null;
  readonly scanning: boolean;
  readonly onScan: () => void;
  readonly onClose: () => void;
  readonly insetClassName?: string;
}) {
  const gt = useGT();
  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-y-0 right-0 z-20 flex justify-center px-6",
        insetClassName,
      )}
    >
      <div
        role="dialog"
        tabIndex={-1}
        autoFocus
        data-vexo-band-panel=""
        aria-labelledby="vexo-band-title"
        className="pointer-events-auto mt-[calc(var(--workspace-topbar-height)+4.5rem)] h-fit w-full max-w-sm rounded-2xl border border-white/10 bg-[#23262c] px-4 py-3.5 shadow-composer-dark outline-none"
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose();
        }}
      >
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 id="vexo-band-title" className="text-[14px] font-medium text-white">
              <T>Band</T>
            </h2>
            <p className="mt-1 text-[13px] leading-5 text-white/55">
              {band?.detail ?? <T>Checking radios that look like a Vexo band.</T>}
            </p>
            <p className="mt-1 text-[13px] leading-5 text-white/55">
              <T>This does not pair the band.</T>
            </p>
            {band && band.matches.length > 0 ? (
              <ul className="mt-2 space-y-1 text-[13px] text-white/75">
                {band.matches.map((match) => (
                  <li key={`${match.id}:${match.name}`}>
                    {match.name.trim().length > 0 ? match.name : gt("Unnamed radio")}
                    {match.connected ? gt(" · connected") : gt(" · not connected")}
                  </li>
                ))}
              </ul>
            ) : null}
            <button
              type="button"
              disabled={scanning}
              className={cn(
                "mt-3 inline-flex h-8 items-center rounded-full bg-white/10 px-3 text-[13px] text-white hover:bg-white/16 disabled:opacity-50",
                FOCUS_RING,
              )}
              onClick={onScan}
            >
              {scanning ? <T>Scanning…</T> : <T>Scan nearby</T>}
            </button>
          </div>
          <button
            type="button"
            className={cn(
              "grid size-6 shrink-0 place-items-center rounded-md text-white/45 hover:bg-white/10 hover:text-white/80",
              FOCUS_RING,
            )}
            aria-label={gt("Close", { $context: "dismisses the band scan" })}
            onClick={onClose}
          >
            <XIcon className="size-3.5" strokeWidth={1.75} />
          </button>
        </div>
      </div>
    </div>
  );
}

