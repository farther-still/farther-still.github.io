import { describe, expect, it } from 'vitest';
import { SKIP_WAITING_MESSAGE, UpdateController } from './update';
import type { ContainerLike, RegistrationLike, WorkerLike } from './update';

// A stand-in for the browser's service worker machinery, driven by hand.
const fakeBrowser = (options: { controlled: boolean; waiting?: boolean; registerFails?: boolean }) => {
  const sent: unknown[] = [];
  const reloads: string[] = [];
  const logged: string[] = [];
  let controllerChange: () => void = () => undefined;
  let updateFound: () => void = () => undefined;
  let fireTimer: () => void = () => undefined;
  let timerCancelled = false;
  let controlled = options.controlled;

  const makeWorker = (state: string): WorkerLike & { set: (next: string) => void } => {
    let stateChange: () => void = () => undefined;
    const worker = {
      state,
      postMessage: (message: unknown) => sent.push(message),
      addEventListener: (_type: 'statechange', listener: () => void) => {
        stateChange = listener;
      },
      set: (next: string) => {
        worker.state = next;
        stateChange();
      },
    };
    return worker;
  };

  const registration: RegistrationLike & { updates: number } = {
    waiting: options.waiting === true ? makeWorker('installed') : null,
    installing: null,
    updates: 0,
    update: () => {
      registration.updates += 1;
      return Promise.resolve();
    },
    addEventListener: (_type, listener) => {
      updateFound = listener;
    },
  };

  const container: ContainerLike = {
    hasController: () => controlled,
    register: () => (options.registerFails === true ? Promise.reject(new Error('no worker')) : Promise.resolve(registration)),
    onControllerChange: (listener) => {
      controllerChange = listener;
    },
  };

  const controller = new UpdateController({
    container,
    reload: () => reloads.push('reload'),
    log: (kind) => logged.push(kind),
    timer: (fire) => {
      fireTimer = fire;
      return () => {
        timerCancelled = true;
      };
    },
  });

  return {
    controller,
    registration,
    sent,
    reloads,
    logged,
    /** A new version starts installing, then finishes and waits. */
    newVersionArrives: () => {
      const worker = makeWorker('installing');
      registration.installing = worker;
      updateFound();
      worker.set('installed');
      registration.waiting = worker;
      registration.installing = null;
    },
    controllerChanges: () => {
      controlled = true;
      controllerChange();
    },
    timeOut: () => fireTimer(),
    timerCancelled: () => timerCancelled,
  };
};

describe('UpdateController', () => {
  it('is unsupported where there is no service worker, and does nothing', async () => {
    const reloads: string[] = [];
    const controller = new UpdateController({ container: null, reload: () => reloads.push('reload'), log: () => undefined, timer: () => () => undefined });
    await controller.start('/sw.js', '/');
    expect(controller.state).toBe('unsupported');
    await controller.check();
    expect(await controller.apply('new-run-sheet')).toBe('nothing-waiting');
    expect(reloads).toEqual([]);
  });

  it('does not call the first install an update, and does not reload when that worker claims the page', async () => {
    const browser = fakeBrowser({ controlled: false });
    await browser.controller.start('/sw.js', '/');
    // First install: a worker installs while no worker controls the page, then claims it.
    browser.newVersionArrives();
    expect(browser.controller.state).toBe('idle');
    browser.controllerChanges();
    expect(browser.controller.state).toBe('idle');
    expect(browser.reloads).toEqual([]);
    expect(browser.sent).toEqual([]);
  });

  it('shows "ready" when a new version has installed, and still reloads nothing', async () => {
    const browser = fakeBrowser({ controlled: true });
    let told = 0;
    browser.controller.subscribe(() => {
      told += 1;
    });
    await browser.controller.start('/sw.js', '/');
    expect(browser.controller.state).toBe('idle');
    browser.newVersionArrives();
    expect(browser.controller.state).toBe('ready');
    expect(told).toBe(1);
    expect(browser.sent).toEqual([]);
    expect(browser.reloads).toEqual([]);
  });

  it('shows "ready" at startup when a version was already waiting', async () => {
    const browser = fakeBrowser({ controlled: true, waiting: true });
    await browser.controller.start('/sw.js', '/');
    expect(browser.controller.state).toBe('ready');
  });

  it('notices a version that was already part-way through installing when the page registered', async () => {
    const browser = fakeBrowser({ controlled: true });
    const sent: unknown[] = [];
    let finish: () => void = () => undefined;
    const installing = {
      state: 'installing',
      postMessage: (message: unknown) => sent.push(message),
      addEventListener: (_type: 'statechange', listener: () => void) => {
        finish = listener;
      },
    };
    browser.registration.installing = installing;
    await browser.controller.start('/sw.js', '/');
    expect(browser.controller.state).toBe('idle');
    installing.state = 'installed';
    browser.registration.waiting = installing;
    browser.registration.installing = null;
    finish();
    expect(browser.controller.state).toBe('ready');
    void browser.controller.apply('new-run-sheet');
    expect(sent).toEqual([SKIP_WAITING_MESSAGE]);
  });

  it('never reloads on a controller change the player did not ask for', async () => {
    const browser = fakeBrowser({ controlled: true });
    await browser.controller.start('/sw.js', '/');
    browser.newVersionArrives();
    browser.controllerChanges();
    browser.controllerChanges();
    expect(browser.reloads).toEqual([]);
  });

  it('reloads only after the new-run sheet applies the update and the new version has taken over', async () => {
    const browser = fakeBrowser({ controlled: true });
    await browser.controller.start('/sw.js', '/');
    browser.newVersionArrives();
    const applying = browser.controller.apply('new-run-sheet');
    expect(browser.sent).toEqual([SKIP_WAITING_MESSAGE]);
    // Asked, but the new version has not taken over yet: still no reload.
    expect(browser.reloads).toEqual([]);
    browser.controllerChanges();
    expect(await applying).toBe('reloading');
    expect(browser.reloads).toEqual(['reload']);
    expect(browser.timerCancelled()).toBe(true);
    // A later controller change does not reload a second time.
    browser.controllerChanges();
    expect(browser.reloads).toEqual(['reload']);
  });

  it('does nothing when asked to apply with no version waiting', async () => {
    const browser = fakeBrowser({ controlled: true });
    await browser.controller.start('/sw.js', '/');
    expect(await browser.controller.apply('new-run-sheet')).toBe('nothing-waiting');
    expect(browser.sent).toEqual([]);
    browser.controllerChanges();
    expect(browser.reloads).toEqual([]);
  });

  it('gives up without reloading if the new version never takes over', async () => {
    const browser = fakeBrowser({ controlled: true });
    await browser.controller.start('/sw.js', '/');
    browser.newVersionArrives();
    const applying = browser.controller.apply('new-run-sheet');
    browser.timeOut();
    expect(await applying).toBe('timed-out');
    // Having given up, a late controller change must not reload under the player.
    browser.controllerChanges();
    expect(browser.reloads).toEqual([]);
  });

  it('asks the browser to look for a new version when checked', async () => {
    const browser = fakeBrowser({ controlled: true });
    await browser.controller.start('/sw.js', '/');
    await browser.controller.check();
    await browser.controller.check();
    expect(browser.registration.updates).toBe(2);
  });

  it('logs a failed registration instead of throwing', async () => {
    const browser = fakeBrowser({ controlled: true, registerFails: true });
    await browser.controller.start('/sw.js', '/');
    expect(browser.logged).toEqual(['service-worker']);
    expect(browser.controller.state).toBe('idle');
  });
});
