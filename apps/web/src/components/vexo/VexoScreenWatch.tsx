/* oxlint-disable shadcn/no-arbitrary-values -- Matches the Vexo home chrome. */
/**
 * View-only Mac screen for the web client.
 * A phone uses this same panel in a mobile browser pointed at the environment
 * server. Nothing here sends clicks, taps, or keystrokes.
 */
import {
  EnvironmentAuthInvalidError,
  EnvironmentScopeRequiredError,
  VexoScreenCaptureError,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { useGT } from "gt-react";
import { XIcon } from "lucide-react";
import { useEffect, useEffectEvent, useState } from "react";

import { PrimaryEnvironmentHttpClient } from "~/environments/primary/httpClient";
import { runPrimaryHttp } from "~/lib/runtime";
import { cn } from "~/lib/utils";

const FRAME_INTERVAL_MS = 500;
const FOCUS_RING =
  "cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";

const isCaptureError = Schema.is(VexoScreenCaptureError);
const isAuthError = Schema.is(EnvironmentAuthInvalidError);
const isScopeError = Schema.is(EnvironmentScopeRequiredError);

type WatchView =
  | { readonly status: "loading" }
  | { readonly status: "frame"; readonly src: string }
  | { readonly status: "redacted" }
  | { readonly status: "error"; readonly message: string };

async function loadFrame(copy: {
  readonly signIn: string;
  readonly forbidden: string;
  readonly unreachable: string;
}): Promise<WatchView> {
  return runPrimaryHttp(
    PrimaryEnvironmentHttpClient.pipe(
      Effect.flatMap((client) => client.vexo.screenFrame({ headers: {} })),
      Effect.map((frame): WatchView =>
        frame.status === "redacted"
          ? { status: "redacted" }
          : { status: "frame", src: `data:image/jpeg;base64,${frame.jpegBase64}` },
      ),
      Effect.catch((error) =>
        Effect.succeed<WatchView>({
          status: "error",
          message: isCaptureError(error)
            ? error.detail
            : isAuthError(error)
              ? copy.signIn
              : isScopeError(error)
                ? copy.forbidden
                : copy.unreachable,
        }),
      ),
    ),
  ).catch(() => ({ status: "error", message: copy.unreachable }));
}

export function VexoScreenWatch({ onClose }: { readonly onClose: () => void }) {
  const gt = useGT();
  const [view, setView] = useState<WatchView>({ status: "loading" });
  // Effect Event: the poller reads the latest translated copy without a ref or effect dep.
  const loadFrameNow = useEffectEvent(() =>
    loadFrame({
      signIn: gt("Sign in to watch this Mac."),
      forbidden: gt("This session cannot watch the screen."),
      unreachable: gt("Could not reach the screen."),
    }),
  );

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- polls the view-only screen frame while this panel is mounted
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      const started = Date.now();
      void loadFrameNow()
        .then((next) => {
          if (!cancelled) setView(next);
        })
        .finally(() => {
          if (cancelled) return;
          const wait = Math.max(0, FRAME_INTERVAL_MS - (Date.now() - started));
          timer = setTimeout(tick, wait);
        });
    };
    tick();
    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, []);

  return (
    <div data-vexo-screen="" className="flex h-full min-w-0 flex-1 flex-col bg-black text-white">
      <div className="flex h-14 items-center gap-3 px-4 pt-[var(--workspace-topbar-height)]">
        <h1 className="text-[15px] font-medium">{gt("Screen")}</h1>
        <span className="text-[13px] text-white/45">{gt("View only")}</span>
        <button
          type="button"
          className={cn(
            "ml-auto grid size-8 place-items-center rounded-md text-white/60 hover:bg-white/10 hover:text-white",
            FOCUS_RING,
          )}
          aria-label={gt("Close screen", { $context: "leaves the view-only Mac screen" })}
          onClick={onClose}
        >
          <XIcon className="size-4" strokeWidth={1.75} />
        </button>
      </div>
      <div className="relative min-h-0 flex-1">
        {view.status === "frame" ? (
          <img
            src={view.src}
            alt={gt("Mac screen")}
            className="pointer-events-none h-full w-full object-contain"
          />
        ) : (
          <div className="grid h-full place-items-center px-6 text-center">
            {view.status === "loading" ? (
              <p className="text-[14px] text-white/55">{gt("Waiting for the Mac screen…")}</p>
            ) : null}
            {view.status === "redacted" ? (
              <p role="status" className="text-[15px] text-white/80">
                {gt("Locked / redacted")}
              </p>
            ) : null}
            {view.status === "error" ? (
              <p role="alert" className="max-w-md text-[14px] leading-6 text-white/80">
                {view.message}
              </p>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
