import { workspaceAreaProps } from "../lib/workspaceFocus";
import { RefreshIcon } from "~/components/ui/refresh-icon";
import { createFileRoute } from "@tanstack/react-router";
import { T, useGT } from "gt-react";

import { isElectron } from "../env";
import { NoProjectsHero } from "../components/NoProjectsHero";
import { VexoHome } from "../components/vexo/VexoHome";
import { useVexoDraftStart } from "../components/vexo/useVexoDraftStart";
import { Button } from "../components/ui/button";
import { HostedEmptyState } from "../components/HostedEmptyState";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../components/ui/empty";
import { SidebarInset } from "../components/ui/sidebar";
import { WorkspacePageHeader } from "../components/WorkspacePageHeader";
import { useAllEnvironmentShellsBootstrapped } from "../state/entities";
import { useEnvironments } from "../state/environments";
import { isMacPlatform } from "../lib/utils";

function ChatIndexRouteView() {
  const { authGateState } = Route.useRouteContext();
  const { environments, isReady } = useEnvironments();

  if (authGateState.status === "hosted-static") {
    if (!isReady) return null;
    if (environments.length === 0) return <HostedEmptyState />;
  }

  return <IndexDraftLanding />;
}

function IndexDraftLanding() {
  const bootstrapped = useAllEnvironmentShellsBootstrapped();
  const {
    mostRecentProject,
    speechTarget,
    startState,
    asking,
    openDraft,
    askVexo,
    handleCaptureAttached,
    clearFailure,
  } = useVexoDraftStart();
  const framed = isElectron && isMacPlatform(navigator.platform);

  if (startState.failed) {
    return (
      <DraftStartError
        onRetry={() => {
          clearFailure();
        }}
      />
    );
  }

  if (mostRecentProject !== null) {
    return (
      <VexoHome
        framed={framed}
        busy={startState.opening || asking}
        {...(speechTarget === undefined ? {} : { speechTarget })}
        onNewChat={() => {
          openDraft();
        }}
        onSubmit={(prompt) => {
          // Stay on Vexo home — Haiku runs the job; Recents shows Working.
          void askVexo(prompt);
        }}
        onCaptureAttached={handleCaptureAttached}
      />
    );
  }
  // A pending environment cannot prove the workspace is empty.
  return bootstrapped ? <NoProjectsHero /> : null;
}

function DraftStartError({ onRetry }: { readonly onRetry: () => void }) {
  const gt = useGT();
  const contentArea = workspaceAreaProps("home", 1, gt("Home", { $context: "the home screen" }));
  return (
    <SidebarInset
      {...contentArea}
      role="main"
      className="h-dvh min-h-0 overflow-hidden overscroll-y-none"
    >
      {isElectron ? <WorkspacePageHeader electron /> : null}
      <Empty className="flex-1">
        <EmptyHeader className="max-w-md">
          <EmptyTitle>
            <T>Couldn’t start a new thread</T>
          </EmptyTitle>
          <EmptyDescription>
            <T>The project is still available. Try opening the draft again.</T>
          </EmptyDescription>
          <div className="mt-5 flex justify-center">
            <Button size="sm" onClick={onRetry}>
              <RefreshIcon size="md" />
              <T>Try again</T>
            </Button>
          </div>
        </EmptyHeader>
      </Empty>
    </SidebarInset>
  );
}

export const Route = createFileRoute("/_chat/")({
  component: ChatIndexRouteView,
});
