// @effect-diagnostics globalDate:off
/** How long a holder may go without `touch` before the desktop lease drops. */
export const LEASE_IDLE_MS = 120_000;

export type LeaseInfo = {
  owner: string;
  acquiredAt: number;
  lastActiveAt: number;
};

export type AcquireResult =
  | { ok: true; owner: string }
  | { ok: false; reason: "held"; owner: string }
  | { ok: false; reason: "invalid_thread" };

export type ReleaseResult = { ok: true } | { ok: false; reason: "not_holder"; owner: string };

type Lease = LeaseInfo;

let lease: Lease | null = null;
let now = (): number => Date.now();

function expire(): void {
  if (lease && now() - lease.lastActiveAt >= LEASE_IDLE_MS) {
    lease = null;
  }
}

/** Take the single desktop lease. The same thread may acquire again to refresh it. */
export function acquire(threadId: string): AcquireResult {
  const owner = threadId.trim();
  if (owner === "") return { ok: false, reason: "invalid_thread" };
  expire();
  if (lease && lease.owner !== owner) {
    return { ok: false, reason: "held", owner: lease.owner };
  }
  const at = now();
  if (!lease) {
    lease = { owner, acquiredAt: at, lastActiveAt: at };
  } else {
    lease.lastActiveAt = at;
  }
  return { ok: true, owner };
}

/** Drop the lease. Only the holder may release it. Releasing twice is fine. */
export function release(threadId: string): ReleaseResult {
  const owner = threadId.trim();
  expire();
  if (!lease) return { ok: true };
  if (lease.owner !== owner) return { ok: false, reason: "not_holder", owner: lease.owner };
  lease = null;
  return { ok: true };
}

/** Current holder, or null when the lease is free or past its idle window. */
export function current(): LeaseInfo | null {
  expire();
  return lease ? { ...lease } : null;
}

export function heldBy(threadId: string): boolean {
  expire();
  return lease?.owner === threadId.trim();
}

/** Refresh the idle timer. Actions call this; a thread can call it while it thinks. */
export function touch(threadId: string): boolean {
  if (!heldBy(threadId)) return false;
  if (lease) lease.lastActiveAt = now();
  return true;
}

/** Human override. Clears the lease immediately so the holder can no longer act. */
export function abort(): { owner: string | null } {
  const owner = lease?.owner ?? null;
  lease = null;
  return { owner };
}

export function setLeaseNowForTests(fn: () => number): void {
  now = fn;
}

export function resetLeaseForTests(): void {
  lease = null;
  now = () => Date.now();
}
