import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentConnectionPhase } from "@t3tools/client-runtime/connection";
import { threadKey } from "@t3tools/client-runtime/state/entities";
import {
  threadRuntimeIsActive,
  type EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import type { ThreadPendingApproval } from "@t3tools/client-runtime/state/thread-requests";
import {
  isListedThreadLineage,
  type ScopedThreadRef,
  type ServerProvider,
} from "@t3tools/contracts";
import { Atom } from "effect/reactivity";

import { isClientHostEnvironment } from "~/state/clientHostEnvironment";
import { useVisibleThreadShells } from "~/state/entities";
import {
  useEnvironmentProviders,
  useEnvironments,
  usePrimaryEnvironment,
} from "~/state/environments";
import { hostEnvironmentIdAtom } from "~/state/primaryEnvironment";
import { environmentThreadDetails, environmentThreadShells } from "~/state/threads";

const FALLBACK_HOSTNAME = "users-MacBook-Pro";
const SESSION_LIMIT = 8;

export type VexoAppId = "claude-code" | "codex" | "grokbot";

export type VexoLinkState = "connected" | "error" | "offline" | "connecting" | "unknown";

export interface VexoAppConnection {
  readonly status: "connected" | "not-connected";
  readonly sessionCount: number;
}

export interface VexoExtraApp {
  readonly id: string;
  readonly name: string;
  readonly sessionCount: number;
}

export interface VexoApprovalRow {
  readonly key: string;
  readonly thread: ScopedThreadRef;
  readonly title: string;
  readonly approval: ThreadPendingApproval | null;
}

export interface VexoSessionRow {
  readonly id: string;
  readonly title: string;
  readonly thread: ScopedThreadRef;
  readonly ready: boolean;
}

export interface VexoHomeModel {
  readonly hostname: string;
  readonly link: VexoLinkState;
  readonly apps: Readonly<Record<VexoAppId, VexoAppConnection>>;
  readonly extraApps: readonly VexoExtraApp[];
  readonly approvals: readonly VexoApprovalRow[];
  readonly sessions: readonly VexoSessionRow[];
}

const DISCONNECTED_APP: VexoAppConnection = { status: "not-connected", sessionCount: 0 };

let previousApprovals: ReadonlyArray<VexoApprovalRow> = [];

const vexoPendingApprovalsAtom = Atom.make((get) => {
  const next: VexoApprovalRow[] = [];
  for (const shell of get(environmentThreadShells.visibleThreadShellsAtom)) {
    if (!shell.hasPendingApprovals || shell.archivedAt !== null || shell.deletedAt !== null) {
      continue;
    }
    const thread = { environmentId: shell.environmentId, threadId: shell.id };
    const pending = get(environmentThreadDetails.pendingRequestsAtom(thread));
    if (pending === null) {
      next.push({
        key: `${threadKey(thread)}:pending`,
        thread,
        title: shell.title,
        approval: null,
      });
      continue;
    }
    for (const approval of pending.approvals) {
      next.push({
        key: `${threadKey(thread)}:${approval.requestId}`,
        thread,
        title: shell.title,
        approval,
      });
    }
  }
  next.sort((left, right) => {
    const byTime = (left.approval?.createdAt ?? "").localeCompare(right.approval?.createdAt ?? "");
    return byTime === 0 ? left.title.localeCompare(right.title) : byTime;
  });
  if (
    next.length === previousApprovals.length &&
    next.every((entry, index) => {
      const previous = previousApprovals[index];
      return (
        previous !== undefined &&
        previous.approval === entry.approval &&
        previous.title === entry.title &&
        previous.key === entry.key
      );
    })
  ) {
    return previousApprovals;
  }
  previousApprovals = next;
  return next;
}).pipe(Atom.withLabel("vexo-pending-approvals"));

export function useVexoHomeModel(): VexoHomeModel {
  const { environments } = useEnvironments();
  const primary = usePrimaryEnvironment();
  const hostEnvironmentId = useAtomValue(hostEnvironmentIdAtom);
  const providersByEnvironment = useEnvironmentProviders();
  const threads = useVisibleThreadShells();
  const approvals = useAtomValue(vexoPendingApprovalsAtom);
  const desktop = typeof window !== "undefined" && window.desktopBridge !== undefined;
  const local =
    environments.find((environment) =>
      isClientHostEnvironment(
        environment.environmentId,
        hostEnvironmentId,
        environment.entry.target,
        desktop,
      ),
    ) ?? null;
  const machine = local ?? primary;
  const providers =
    machine === null ? [] : (providersByEnvironment.get(machine.environmentId) ?? []);
  const machineThreads =
    machine === null
      ? threads
      : threads.filter((thread) => thread.environmentId === machine.environmentId);

  return {
    hostname: resolveHostname(machine?.serverConfig?.hostname),
    link: linkState(machine?.connection.phase),
    ...appConnections(providers, machineThreads),
    approvals,
    sessions: readySessions(machineThreads),
  };
}

function resolveHostname(configured: string | null | undefined): string {
  const fromServer = configured?.trim() ?? "";
  if (fromServer.length > 0) return fromServer;
  if (typeof window !== "undefined") {
    const fromLocation = window.location.hostname.trim();
    if (fromLocation.length > 0) return fromLocation;
  }
  return FALLBACK_HOSTNAME;
}

function linkState(phase: EnvironmentConnectionPhase | undefined): VexoLinkState {
  switch (phase) {
    case "connected":
      return "connected";
    case "error":
    case "unsupported":
      return "error";
    case "offline":
      return "offline";
    case "connecting":
    case "reconnecting":
    case "available":
      return "connecting";
    default:
      return "unknown";
  }
}

function providerIsLive(provider: ServerProvider): boolean {
  if (!provider.enabled || !provider.installed) return false;
  if (provider.availability === "unavailable") return false;
  if (provider.auth.status === "unauthenticated") return false;
  return provider.status === "ready" || provider.status === "warning";
}

function knownAppId(driver: string): VexoAppId | null {
  const key = driver.toLowerCase().replace(/[^a-z0-9]/gu, "");
  if (key.includes("claude")) return "claude-code";
  if (key.includes("codex")) return "codex";
  // Cursor and Grok share the Cursor / Grok home row (Grok models often run via Cursor).
  if (key.includes("cursor") || key.includes("grok")) return "grokbot";
  return null;
}

function listedSession(thread: EnvironmentThreadShell): boolean {
  return (
    thread.archivedAt === null &&
    thread.deletedAt === null &&
    thread.runtime?.status !== "failed" &&
    isListedThreadLineage(thread.lineage)
  );
}

function appConnections(
  providers: readonly ServerProvider[],
  threads: readonly EnvironmentThreadShell[],
): Pick<VexoHomeModel, "apps" | "extraApps"> {
  const sessionsByInstance = new Map<string, number>();
  for (const thread of threads) {
    if (!listedSession(thread)) continue;
    const id = thread.providerInstanceId;
    sessionsByInstance.set(id, (sessionsByInstance.get(id) ?? 0) + 1);
  }

  const apps: Record<VexoAppId, VexoAppConnection> = {
    "claude-code": DISCONNECTED_APP,
    codex: DISCONNECTED_APP,
    grokbot: DISCONNECTED_APP,
  };
  const extraApps: VexoExtraApp[] = [];
  for (const provider of providers) {
    if (!providerIsLive(provider)) continue;
    const sessionCount = sessionsByInstance.get(provider.instanceId) ?? 0;
    const appId = knownAppId(provider.driver);
    if (appId === null) {
      extraApps.push({
        id: provider.instanceId,
        name: provider.displayName ?? provider.driver,
        sessionCount,
      });
      continue;
    }
    const current = apps[appId];
    apps[appId] = {
      status: "connected",
      sessionCount: current.sessionCount + sessionCount,
    };
  }
  return { apps, extraApps };
}

function readySessions(threads: readonly EnvironmentThreadShell[]): VexoSessionRow[] {
  const byRecent = (left: EnvironmentThreadShell, right: EnvironmentThreadShell) =>
    right.updatedAt.localeCompare(left.updatedAt);
  const listed = threads.filter(listedSession);
  const ready = listed.filter((thread) => !threadRuntimeIsActive(thread.runtime)).sort(byRecent);
  const active = listed.filter((thread) => threadRuntimeIsActive(thread.runtime)).sort(byRecent);
  return [...ready, ...active].slice(0, SESSION_LIMIT).map((thread) => ({
    id: threadKey({ environmentId: thread.environmentId, threadId: thread.id }),
    title: thread.title.trim(),
    thread: { environmentId: thread.environmentId, threadId: thread.id },
    ready: !threadRuntimeIsActive(thread.runtime),
  }));
}
