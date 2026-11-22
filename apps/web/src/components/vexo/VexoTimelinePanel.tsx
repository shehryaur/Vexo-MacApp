/* oxlint-disable shadcn/no-arbitrary-values -- Matches the Vexo home chrome. */
import type { VexoTimelineActivity, VexoTimelineDayView, VexoTodo } from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import * as Effect from "effect/Effect";
import { useGT } from "gt-react";
import { CalendarDaysIcon, RotateCwIcon, XIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { PrimaryEnvironmentHttpClient } from "~/environments/primary/httpClient";
import { runPrimaryHttp } from "~/lib/runtime";
import { cn } from "~/lib/utils";

const FOCUS_RING =
  "cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";

type TimelineView =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly day: VexoTimelineDayView }
  | { readonly status: "error"; readonly message: string };

function localDay(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

async function loadTimelineDay(unreachable: string): Promise<TimelineView> {
  const day = localDay();
  return runPrimaryHttp(
    PrimaryEnvironmentHttpClient.pipe(
      Effect.flatMap((client) => client.vexo.timelineDay({ headers: {}, query: { day } })),
      Effect.map((view): TimelineView => ({ status: "ready", day: view })),
      Effect.orElseSucceed((): TimelineView => ({ status: "error", message: unreachable })),
    ),
  ).catch(() => ({ status: "error", message: unreachable }));
}

export function VexoTimelinePanel({ onClose }: { readonly onClose: () => void }) {
  const gt = useGT();
  const unreachable = gt("Could not reach Timeline.");
  const [view, setView] = useState<TimelineView>({ status: "loading" });
  const reload = () => {
    setView({ status: "loading" });
    void loadTimelineDay(unreachable).then(setView);
  };

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- loads this day's timeline from the environment while the panel is mounted
  useEffect(() => {
    let cancelled = false;
    void loadTimelineDay(unreachable).then((next) => {
      if (!cancelled) setView(next);
    });
    return () => {
      cancelled = true;
    };
  }, [unreachable]);

  return (
    <main data-vexo-timeline="" className="relative min-w-0 flex-1">
      <div className="scrollbar-gutter-both h-full overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[720px] flex-col px-6 pt-[calc(var(--workspace-topbar-height)+1.75rem)] pb-28">
          <div className="flex items-center gap-2">
            <h1 className="text-[22px] font-semibold tracking-tight text-white">
              {gt("Timeline")}
            </h1>
            <button
              type="button"
              className={cn(
                "grid size-8 place-items-center rounded-lg text-white/55 hover:bg-white/8 hover:text-white/85",
                FOCUS_RING,
              )}
              aria-label={gt("Refresh timeline", { $context: "loads the day again" })}
              onClick={reload}
            >
              <RotateCwIcon className="size-4" strokeWidth={1.75} />
            </button>
            <button
              type="button"
              className={cn(
                "ml-auto grid size-8 place-items-center rounded-lg text-white/55 hover:bg-white/8 hover:text-white/85",
                FOCUS_RING,
              )}
              aria-label={gt("Close timeline", { $context: "returns to the main view" })}
              onClick={onClose}
            >
              <XIcon className="size-4" strokeWidth={1.75} />
            </button>
          </div>
          {view.status === "loading" ? (
            <p className="mt-8 text-[14px] text-white/50">{gt("Loading timeline.")}</p>
          ) : view.status === "error" ? (
            <p className="mt-8 text-[14px] text-white/50">{view.message}</p>
          ) : (
            <TimelineBody day={view.day} />
          )}
        </div>
      </div>
    </main>
  );
}

function TimelineBody({ day }: { readonly day: VexoTimelineDayView }) {
  const gt = useGT();
  if (!day.configured) {
    return (
      <div className="mt-16 flex flex-col items-center text-center">
        <div className="grid size-16 place-items-center rounded-2xl bg-white/6">
          <CalendarDaysIcon className="size-8 text-white/40" strokeWidth={1.5} />
        </div>
        <h2 className="mt-5 text-[16px] font-medium text-white">{gt("Timeline not configured")}</h2>
        <p className="mt-2 max-w-xs text-[14px] leading-5 text-white/50">
          {gt("Add a memory plug-in base URL to list this day's activities.")}
        </p>
        <Link
          to="/settings/timeline"
          className={cn(
            "mt-6 rounded-xl border border-white/10 bg-[#1e2024] px-4 py-3 text-[13px] text-white/80 hover:bg-white/6",
            FOCUS_RING,
          )}
        >
          {gt("Open Timeline settings")}
        </Link>
      </div>
    );
  }

  return (
    <div className="mt-6">
      <p className="text-[13px] text-white/45">{day.day}</p>
      {day.notice ? <p className="mt-3 text-[14px] text-white/60">{day.notice}</p> : null}
      {day.activities.length === 0 && (day.todos?.length ?? 0) === 0 && !day.notice ? (
        <p className="mt-6 text-[14px] text-white/50">{gt("Nothing on this day.")}</p>
      ) : null}
      {day.activities.length > 0 ? (
        <ul className="mt-4 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.025]">
          {day.activities.map((activity) => (
            <ActivityRow key={activity.id} activity={activity} />
          ))}
        </ul>
      ) : null}
      {(day.todos?.length ?? 0) > 0 ? (
        <ul className="mt-4 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.025]">
          {day.todos?.map((todo) => (
            <TodoRow key={todo.id} todo={todo} />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function ActivityRow({ activity }: { readonly activity: VexoTimelineActivity }) {
  const title = activity.title?.trim() || activity.kind;
  return (
    <li className="border-b border-white/8 px-4 py-3 last:border-b-0">
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate text-[14px] text-white">{title}</span>
        {activity.startedAt ? (
          <span className="shrink-0 text-[12px] text-white/40">{activity.startedAt}</span>
        ) : null}
      </div>
      {activity.description ? (
        <p className="mt-1 text-[13px] leading-5 text-white/50">{activity.description}</p>
      ) : null}
    </li>
  );
}

function TodoRow({ todo }: { readonly todo: VexoTodo }) {
  return (
    <li className="flex items-baseline justify-between gap-3 border-b border-white/8 px-4 py-3 last:border-b-0">
      <span className="min-w-0 truncate text-[14px] text-white">{todo.title}</span>
      <span className="shrink-0 text-[12px] text-white/40">{todo.status}</span>
    </li>
  );
}
