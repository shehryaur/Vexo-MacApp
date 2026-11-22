export { abort, acquire, current, release } from "./lease.ts";
export type { AcquireResult, LeaseInfo, ReleaseResult } from "./lease.ts";

export { listWindows, observeFront } from "./observe.ts";
export type { Bounds, FrontWindow, ObserveFailure, WindowInfo } from "./observe.ts";

export { click, key, typeText } from "./act.ts";
export type { ActResult, ActionTarget, Point } from "./act.ts";

export {
  askBeforeUnlockFromStored,
  clearPassword,
  isUnlockInProgress,
  passwordStored,
  readAskBeforeUnlock,
  readPendingUnlockPrompt,
  relock,
  relockIfAbandoned,
  requestUnlockConfirmation,
  savePassword,
  unlock,
  unlockGeneration,
  writeAskBeforeUnlock,
  writeUnlockDecision,
} from "./unlock.ts";
export type { RelockResult, UnlockConfirmationResult, UnlockResult } from "./unlock.ts";

export { captureFrame } from "./screen.ts";
export type { Frame } from "./screen.ts";

export { fetchTimeline } from "./timeline.ts";
export type { TimelineFetchResult } from "./timeline.ts";

export { awakeStatus, setAwake } from "./awake.ts";
export type { AwakeStatus } from "./awake.ts";

export { bandScan, bandStatus } from "./band.ts";
export type { BandStatus } from "./band.ts";
