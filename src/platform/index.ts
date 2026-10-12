export { bandBelow, canShareFile, copyText, downloadTextFile, isStandalone, readScreen, requestPersistence, shareTextFile } from './device';
export type { PersistStatus, ScreenReading, ShareOutcome } from './device';
export { captureGlobalErrors, createDiagnostics } from './diagnostics';
export type { Diagnostics } from './diagnostics';
export { SKIP_WAITING_MESSAGE, UpdateController, browserContainer } from './update';
export type { ApplyOutcome, ApplySource, ContainerLike, RegistrationLike, UpdateDeps, UpdateState, WorkerLike } from './update';
