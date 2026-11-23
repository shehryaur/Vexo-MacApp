import type { DesktopBridge, DesktopMacUnlockConfirmEvent } from "@t3tools/contracts";

export interface MacUnlockPrompt {
  readonly id: string;
}

type MacUnlockBridge = DesktopBridge["macUnlock"];

let prompts: readonly MacUnlockPrompt[] = [];
let respond: MacUnlockBridge["respondToUnlock"] | null = null;
const listeners = new Set<() => void>();

function publish() {
  for (const listener of listeners) listener();
}

function defaultBridge(): DesktopBridge | undefined {
  return typeof window === "undefined" ? undefined : window.desktopBridge;
}

export function subscribeMacUnlockConfirm(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function readMacUnlockConfirm(): MacUnlockPrompt | null {
  return prompts[0] ?? null;
}

/** Keeps unlock prompts that arrive before the dialog is on screen. */
export function startMacUnlockConfirmQueue(
  bridge: DesktopBridge | undefined = defaultBridge(),
): () => void {
  const macUnlock = bridge?.macUnlock;
  if (!macUnlock) return () => undefined;
  respond = macUnlock.respondToUnlock.bind(macUnlock);
  return macUnlock.onUnlockConfirm((event) => {
    applyMacUnlockConfirm(event);
  });
}

export function applyMacUnlockConfirm(event: DesktopMacUnlockConfirmEvent): void {
  if (!event.open) {
    if (!prompts.some((prompt) => prompt.id === event.id)) return;
    prompts = prompts.filter((prompt) => prompt.id !== event.id);
    publish();
    return;
  }
  if (prompts.some((prompt) => prompt.id === event.id)) return;
  prompts = [...prompts, { id: event.id }];
  publish();
}

export async function respondMacUnlockConfirm(approved: boolean): Promise<void> {
  const current = prompts[0];
  if (!current) return;
  prompts = prompts.slice(1);
  publish();
  try {
    await respond?.(current.id, approved);
  } catch {
    // A dropped answer is a deny. The desktop prompt also times out as a deny.
  }
}

export function resetMacUnlockConfirmForTests(): void {
  prompts = [];
  respond = null;
  publish();
}

/**
 * Unlocks this Mac for one task, then locks it again if the unlock was left behind.
 * Approve calls `unlock({ confirmed: true })`. Deny does not unlock or relock.
 */
export async function runMacUnlockTask<T>(
  work: () => Promise<T>,
  bridge: DesktopBridge | undefined = defaultBridge(),
): Promise<{ ok: true; value: T } | { ok: false; reason: string }> {
  const macUnlock = bridge?.macUnlock;
  if (!macUnlock) return { ok: false, reason: "unavailable" };
  const unlocked = await macUnlock.unlockForTask();
  if (!unlocked.ok) return unlocked;
  try {
    const value = await work();
    return { ok: true, value };
  } finally {
    await macUnlock.relockIfAbandoned();
  }
}
