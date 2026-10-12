// The update controller (ARCHITECTURE section 9). A new version downloads in the background and waits. The page
// reloads onto it only after the player asks: from the new-run sheet during play, or from the recovery screen
// when no game is loaded. Nothing else here reloads the page, and `update.test.ts` holds it to that.

export type UpdateState = 'unsupported' | 'idle' | 'ready';

export type ApplySource = 'new-run-sheet' | 'recovery-screen';

export type ApplyOutcome = 'reloading' | 'nothing-waiting' | 'timed-out';

/** The parts of a service worker this controller uses, so tests can stand in for the browser. */
export type WorkerLike = {
  state: string;
  postMessage: (message: unknown) => void;
  addEventListener: (type: 'statechange', listener: () => void) => void;
};

export type RegistrationLike = {
  waiting: WorkerLike | null;
  installing: WorkerLike | null;
  update: () => Promise<unknown>;
  addEventListener: (type: 'updatefound', listener: () => void) => void;
};

export type ContainerLike = {
  /** True when a worker already controls this page, which is what makes a newly installed one an update. */
  hasController: () => boolean;
  register: (url: string, scope: string) => Promise<RegistrationLike>;
  onControllerChange: (listener: () => void) => void;
};

export type UpdateDeps = {
  /** Null where service workers do not exist: the plain-HTTP LAN dev server, or the dev build. */
  container: ContainerLike | null;
  reload: () => void;
  log: (kind: string, message: string) => void;
  /** Calls `fire` after `ms`; returns a canceller. */
  timer: (fire: () => void, ms: number) => () => void;
};

export const SKIP_WAITING_MESSAGE = { type: 'SKIP_WAITING' } as const;

const APPLY_TIMEOUT_MS = 8000;

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export class UpdateController {
  private registration: RegistrationLike | null = null;
  private current: UpdateState;
  private applying: (() => void) | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly deps: UpdateDeps) {
    this.current = deps.container === null ? 'unsupported' : 'idle';
  }

  get state(): UpdateState {
    return this.current;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async start(workerUrl: string, scope: string): Promise<void> {
    const { container } = this.deps;
    if (container === null) return;
    container.onControllerChange(() => {
      // A change of controller the player did not ask for (the first install claiming the page) reloads nothing.
      if (this.applying !== null) this.applying();
    });
    try {
      const registration = await container.register(workerUrl, scope);
      this.registration = registration;
      if (registration.waiting !== null && container.hasController()) this.setReady();
      const watch = (worker: WorkerLike | null): void => {
        if (worker === null) return;
        worker.addEventListener('statechange', () => {
          if (worker.state === 'installed' && container.hasController()) this.setReady();
        });
      };
      // A new version may already be part-way through installing when the page registers.
      watch(registration.installing);
      registration.addEventListener('updatefound', () => watch(registration.installing));
    } catch (error) {
      this.deps.log('service-worker', `registration failed: ${message(error)}`);
    }
  }

  /** Asked each time the app returns to the foreground, so an app that is only ever resumed still learns of updates. */
  async check(): Promise<void> {
    try {
      await this.registration?.update();
    } catch {
      // Offline, or the server is unreachable. The next foreground asks again.
    }
  }

  /** Hands control to the waiting version and reloads once it has taken over. */
  apply(source: ApplySource): Promise<ApplyOutcome> {
    const waiting = this.registration?.waiting ?? null;
    if (waiting === null || this.current !== 'ready') return Promise.resolve('nothing-waiting');
    this.deps.log('update', `applying the waiting version from the ${source}`);
    return new Promise((resolve) => {
      const cancel = this.deps.timer(() => {
        this.applying = null;
        resolve('timed-out');
      }, APPLY_TIMEOUT_MS);
      this.applying = () => {
        this.applying = null;
        cancel();
        resolve('reloading');
        this.deps.reload();
      };
      waiting.postMessage(SKIP_WAITING_MESSAGE);
    });
  }

  private setReady(): void {
    if (this.current === 'ready') return;
    this.current = 'ready';
    for (const listener of this.listeners) listener();
  }
}

/** Wraps the browser's service worker container. Returns null where there is none. */
export const browserContainer = (nav: Navigator): ContainerLike | null => {
  if (!('serviceWorker' in nav) || nav.serviceWorker === undefined) return null;
  const workers = nav.serviceWorker;
  return {
    hasController: () => workers.controller !== null,
    register: (url, scope) => workers.register(url, { scope, updateViaCache: 'none' }),
    onControllerChange: (listener) => workers.addEventListener('controllerchange', listener),
  };
};
