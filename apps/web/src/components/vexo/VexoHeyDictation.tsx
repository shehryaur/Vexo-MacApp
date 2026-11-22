/* oxlint-disable shadcn/no-arbitrary-values -- Matches the Vexo home chrome. */
import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { T, useGT } from "gt-react";
import { XIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { resolveSpeechPresentation } from "~/components/chat/ComposerSpeechButton";
import { VoiceInputSetup } from "~/components/chat/VoiceInputSetup";
import { useEnvironmentSpeechInput } from "~/speech/useEnvironmentSpeechInput";
import { cn } from "~/lib/utils";

import { submitHeyVexoTranscript } from "./heyVexo";

const FOCUS_RING =
  "cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-default";

export interface VexoSpeechTarget {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly projectName: string;
}

/**
 * Mac microphone stand-in for Hey Vexo.
 * Opens the existing voice-input session and sends the transcript as a new agent message.
 * There is no band and no Bluetooth path.
 */
export function VexoHeyDictation({
  target,
  busy,
  onSubmit,
  onClose,
}: {
  readonly target: VexoSpeechTarget;
  readonly busy: boolean;
  readonly onSubmit: ((prompt: string) => void) | undefined;
  readonly onClose: () => void;
}) {
  const gt = useGT();
  const draftRef = useRef("");
  const [draft, setDraft] = useState("");
  const speech = useEnvironmentSpeechInput({
    environmentId: target.environmentId,
    projectId: target.projectId,
    projectName: target.projectName,
    ownerKey: "vexo-home-hey-vexo",
    label: gt("Hey Vexo"),
    disabled: busy,
    readDraft: () => ({
      text: draftRef.current,
      selection: { start: draftRef.current.length, end: draftRef.current.length },
    }),
    commitDraft: (text) => {
      draftRef.current = text;
      setDraft(text);
    },
  });
  const start = speech.start;
  const cancel = speech.cancel;
  const available = speech.available;

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- starts this Mac's microphone while the dictation dialog is mounted and stops it on close
  useEffect(() => {
    if (!available || busy) return;
    void start();
    return () => {
      cancel();
    };
  }, [available, busy, start, cancel]);

  const presentation = resolveSpeechPresentation(speech.state, null);
  const liveText =
    speech.preview === null
      ? draft
      : `${speech.preview.committed}${speech.preview.tentative}`.trim();
  const preview = liveText.length > 0 ? liveText : null;
  const capturing =
    speech.state.phase === "recording" ||
    speech.state.phase === "transcribing" ||
    speech.state.phase === "post-processing" ||
    preview !== null;
  const close = () => {
    cancel();
    onClose();
  };
  const send = () => {
    if (busy || onSubmit === undefined || speech.preparing) return;
    speech.submitAfterDictation((text) => {
      void submitHeyVexoTranscript(text).then((prompt) => {
        if (prompt.length === 0 || onSubmit === undefined) return;
        onSubmit(prompt);
        onClose();
      });
    });
  };

  return (
    <>
      <div className="pointer-events-none absolute inset-y-0 right-0 left-60 z-20 flex justify-center px-6">
        <div
          role="dialog"
          tabIndex={-1}
          autoFocus
          data-vexo-hey-vexo=""
          aria-labelledby="vexo-hey-title"
          className="pointer-events-auto mt-[calc(var(--workspace-topbar-height)+4.5rem)] h-fit w-full max-w-sm rounded-2xl border border-white/10 bg-[#23262c] px-4 py-3.5 shadow-composer-dark outline-none"
          onKeyDown={(event) => {
            if (event.key === "Escape") close();
          }}
        >
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <h2 id="vexo-hey-title" className="text-[14px] font-medium text-white">
                <T>Hey Vexo</T>
              </h2>
              <p className="mt-1 text-[13px] leading-5 text-white/55">
                <T>Uses this Mac's microphone. Speak, then send it as a new message.</T>
              </p>
            </div>
            <button
              type="button"
              className={cn(
                "grid size-6 shrink-0 place-items-center rounded-md text-white/45 hover:bg-white/10 hover:text-white/80",
                FOCUS_RING,
              )}
              aria-label={gt("Close", { $context: "closes Hey Vexo dictation" })}
              onClick={close}
            >
              <XIcon className="size-3.5" strokeWidth={1.75} />
            </button>
          </div>
          <p className="mt-3 min-h-10 text-[13px] leading-5 text-white/80" aria-live="polite">
            {preview ??
              presentation.status ??
              (available ? (
                <span className="text-white/40">
                  <T>Listening…</T>
                </span>
              ) : (
                <span className="text-white/40">
                  <T>Voice input is not available on this Mac yet.</T>
                </span>
              ))}
          </p>
          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              className={cn(
                "h-8 rounded-lg px-3 text-[13px] text-white/70 hover:bg-white/8",
                FOCUS_RING,
              )}
              onClick={close}
            >
              <T>Cancel</T>
            </button>
            {capturing ? (
              <button
                type="button"
                disabled={busy || onSubmit === undefined || speech.preparing}
                className={cn(
                  "h-8 rounded-lg bg-white/14 px-3 text-[13px] text-white hover:bg-white/20 disabled:opacity-40",
                  FOCUS_RING,
                )}
                onClick={send}
              >
                <T>Send</T>
              </button>
            ) : (
              <button
                type="button"
                disabled={!available || busy}
                className={cn(
                  "h-8 rounded-lg bg-white/14 px-3 text-[13px] text-white hover:bg-white/20 disabled:opacity-40",
                  FOCUS_RING,
                )}
                onClick={() => {
                  void start();
                }}
              >
                <T>Start</T>
              </button>
            )}
          </div>
        </div>
      </div>
      <VoiceInputSetup
        environmentId={speech.transcriptionEnvironmentId}
        open={speech.setup.open}
        step={speech.setup.step}
        status={speech.status}
        model={speech.setup.model}
        language={speech.setup.language}
        downloading={speech.setup.downloading}
        error={speech.setup.error}
        onOpenChange={speech.setup.setOpen}
        onRetryCatalog={speech.setup.retryCatalog}
        onDownload={() => void speech.setup.download()}
        onCancelDownload={() => void speech.setup.cancelDownload()}
        onStartRecording={() => void speech.setup.startRecording()}
      />
    </>
  );
}
