import { thrownErrorMessage } from "@t3tools/client-runtime/errors";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  DEFAULT_SERVER_SETTINGS,
  type DesktopFrontWindowCapture,
  type ModelSelection,
} from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import { msg } from "gt-react";
import { useRef, useState } from "react";

import { useComposerDraftStore } from "../../composerDraftStore";
import { useNewThreadHandler } from "../../hooks/useHandleNewThread";
import { m } from "../../i18n/messages";
import { newMessageId, newThreadId } from "../../lib/utils";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import { readProject, useProjects, useVisibleThreadShells } from "../../state/entities";
import { environmentServerConfigsAtom } from "../../state/server";
import { threadEnvironment } from "../../state/threads";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";
import { DEFAULT_INTERACTION_MODE } from "../../types";
import { toastManager } from "../ui/toast";
import { sortScopedProjectsForSidebar } from "../Sidebar.logic";
import {
  attachCapturedWindowToDraft,
  CAPTURE_THREAD_PROMPT,
  capturedWindowDataUrl,
} from "./capture";
import { resolveVexoAskModelSelection } from "./resolveVexoAskModel";
import type { VexoSpeechTarget } from "./VexoHeyDictation";

export function useVexoHomeProject() {
  const projects = useProjects();
  const threads = useVisibleThreadShells();
  const mostRecentProject =
    sortScopedProjectsForSidebar(
      projects.filter((project) => project.archivedAt == null),
      threads,
      "updated_at",
    )[0] ?? null;

  const speechTarget: VexoSpeechTarget | undefined =
    mostRecentProject === null
      ? undefined
      : {
          environmentId: mostRecentProject.environmentId,
          projectId: mostRecentProject.id,
          projectName: mostRecentProject.title,
        };

  return { mostRecentProject, speechTarget };
}

function askTitleSeed(prompt: string): string {
  const trimmed = prompt.trim().replace(/\s+/gu, " ");
  if (trimmed.length <= 72) return trimmed;
  return `${trimmed.slice(0, 71)}…`;
}

export function useVexoDraftStart() {
  const { mostRecentProject, speechTarget } = useVexoHomeProject();
  const handleNewThread = useNewThreadHandler();
  const startThreadTurn = useOrchestrationCommand(threadEnvironment.startTurn, {
    reportFailure: false,
  });
  const openingRef = useRef(false);
  const askingRef = useRef(false);
  const [startState, setStartState] = useState({ failed: false, opening: false });
  const [asking, setAsking] = useState(false);

  const openDraft = (prompt?: string) => {
    if (openingRef.current || mostRecentProject === null) return;
    const projectRef = scopeProjectRef(mostRecentProject.environmentId, mostRecentProject.id);
    if (readProject(projectRef) === null) {
      setStartState({ failed: true, opening: false });
      return;
    }
    openingRef.current = true;
    setStartState({ failed: false, opening: true });
    void handleNewThread(projectRef, {
      replace: true,
      ...(prompt === undefined ? {} : { prompt }),
    })
      .then((opened) => {
        openingRef.current = false;
        if (opened === null) {
          setStartState({ failed: true, opening: false });
          return;
        }
        // Shell stays mounted across the draft route; clear busy so New chat works again.
        setStartState({ failed: false, opening: false });
      })
      .catch(() => {
        openingRef.current = false;
        setStartState({ failed: true, opening: false });
      });
  };

  const handleCaptureAttached = (capture: DesktopFrontWindowCapture) => {
    if (!capturedWindowDataUrl(capture)) {
      openDraft(CAPTURE_THREAD_PROMPT);
      return;
    }
    if (openingRef.current || mostRecentProject === null) return;
    const projectRef = scopeProjectRef(mostRecentProject.environmentId, mostRecentProject.id);
    if (readProject(projectRef) === null) {
      setStartState({ failed: true, opening: false });
      return;
    }
    openingRef.current = true;
    setStartState({ failed: false, opening: true });
    void handleNewThread(projectRef, { replace: true })
      .then(async (opened) => {
        if (opened === null) {
          openingRef.current = false;
          setStartState({ failed: true, opening: false });
          return;
        }
        let attached = false;
        try {
          attached = await attachCapturedWindowToDraft(opened.draftId, capture);
        } catch {
          attached = false;
        }
        if (!attached) {
          useComposerDraftStore.getState().setPrompt(opened.draftId, CAPTURE_THREAD_PROMPT);
        }
        openingRef.current = false;
        setStartState({ failed: false, opening: false });
      })
      .catch(() => {
        openingRef.current = false;
        setStartState({ failed: true, opening: false });
      });
  };

  const clearFailure = () => {
    openingRef.current = false;
    setStartState({ failed: false, opening: false });
  };

  /**
   * Ask Vexo on the home surface: start a Claude Haiku thread in the project and
   * stay on home (no agent dashboard navigation). Progress shows under Recents.
   */
  const askVexo = (prompt: string): Promise<boolean> => {
    const text = prompt.trim();
    if (text.length === 0 || askingRef.current || mostRecentProject === null) {
      return Promise.resolve(false);
    }
    const projectRef = scopeProjectRef(mostRecentProject.environmentId, mostRecentProject.id);
    if (readProject(projectRef) === null) {
      toastManager.add({
        type: "error",
        title: m(msg("Couldn’t start Ask Vexo")),
        description: m(msg("The project is no longer available.")),
      });
      return Promise.resolve(false);
    }

    const environmentServerConfigs = appAtomRegistry.get(environmentServerConfigsAtom);
    const serverConfig = environmentServerConfigs.get(mostRecentProject.environmentId);
    const providers = serverConfig?.providers ?? [];
    const modelSelection: ModelSelection | null = resolveVexoAskModelSelection(providers);
    if (modelSelection === null) {
      toastManager.add({
        type: "error",
        title: m(msg("Claude isn’t ready")),
        description: m(msg("Connect Claude to run Ask Vexo with a small Haiku model.")),
      });
      return Promise.resolve(false);
    }

    const settings = serverConfig?.settings ?? DEFAULT_SERVER_SETTINGS;
    const runtimeMode = resolveProjectSettings(
      settings,
      mostRecentProject.id,
      mostRecentProject,
    ).settings.defaultRuntimeMode;
    const threadId = newThreadId();
    const createdAt = new Date().toISOString();
    const title = askTitleSeed(text);

    askingRef.current = true;
    setAsking(true);

    return startThreadTurn({
      environmentId: mostRecentProject.environmentId,
      input: {
        threadId,
        message: {
          messageId: newMessageId(),
          role: "user",
          text,
          attachments: [],
        },
        modelSelection,
        titleSeed: title,
        runtimeMode,
        interactionMode: DEFAULT_INTERACTION_MODE,
        bootstrap: {
          createThread: {
            projectId: mostRecentProject.id,
            title,
            modelSelection,
            runtimeMode,
            interactionMode: DEFAULT_INTERACTION_MODE,
            branch: null,
            worktreePath: null,
            createdAt,
          },
        },
        createdAt,
      },
    })
      .then((result) => {
        askingRef.current = false;
        setAsking(false);
        if (result._tag === "Failure") {
          if (!isAtomCommandInterrupted(result)) {
            const error = squashAtomCommandFailure(result);
            toastManager.add({
              type: "error",
              title: m(msg("Couldn’t start Ask Vexo")),
              description: thrownErrorMessage(error, m) ?? m(msg("Try again in a moment.")),
            });
          }
          return false;
        }
        toastManager.add({
          type: "success",
          title: m(msg("Vexo is on it")),
          description: m(msg("Working in Recents — staying on home.")),
        });
        return true;
      })
      .catch((error: unknown) => {
        askingRef.current = false;
        setAsking(false);
        toastManager.add({
          type: "error",
          title: m(msg("Couldn’t start Ask Vexo")),
          description: thrownErrorMessage(error, m) ?? m(msg("Try again in a moment.")),
        });
        return false;
      });
  };

  return {
    mostRecentProject,
    speechTarget,
    startState,
    asking,
    openDraft,
    askVexo,
    handleCaptureAttached,
    clearFailure,
  };
}
