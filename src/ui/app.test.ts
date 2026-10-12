// The app's startup and recovery wiring, driven through the real `startApp` with a stand-in DOM and a fake
// IndexedDB. These tests exist because the first verifier pass lost a save through this wiring while every
// function underneath it was correct: the recovery screen acted on what it had read at startup, which after an
// unreadable start was nothing.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installFakeDom } from '../../tests/fake-dom';
import type { FakeDom } from '../../tests/fake-dom';
import { BUILD, dump, freshIndexedDb, game, record } from '../../tests/helpers';
import { LocalBackend } from '../save';
import type { SavePayload } from '../save';
import { startApp } from './app';

const OPTIONS = { ...BUILD, serviceWorker: false, baseUrl: '/' };

let dom: FakeDom;

beforeEach(() => {
  freshIndexedDb();
  dom = installFakeDom();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** What is in storage now, read through a connection of its own. */
const storage = async (): Promise<Awaited<ReturnType<typeof dump>>> => {
  const backend = new LocalBackend();
  const snapshot = await dump(backend);
  (await backend.handle()).close();
  return snapshot;
};

const seed = async (fill: (backend: LocalBackend) => Promise<void>): Promise<void> => {
  const backend = new LocalBackend();
  await fill(backend);
  (await backend.handle()).close();
};

/** The next `count` attempts to open the database throw, as when storage will not open at launch. */
const failOpens = (count: number): void => {
  const factory = indexedDB;
  const open = factory.open.bind(factory);
  let left = count;
  factory.open = ((...args: Parameters<IDBFactory['open']>) => {
    if (left > 0) {
      left -= 1;
      throw new Error('simulated: storage would not open');
    }
    return open(...args);
  }) as IDBFactory['open'];
};

const hotGame = async (): Promise<SavePayload['game'] | undefined> =>
  ((await storage()).slots['hot'] as { payload: SavePayload } | undefined)?.payload.game;

const seqOf = (raw: unknown): number => (raw as { seq: number }).seq;

/** Waits until the game screen is showing the given run. The recovery screen can mention runs too. */
const gameShows = (run: number): Promise<void> =>
  vi.waitFor(() => {
    expect(dom.buttons()).toContain('Count + 1');
    expect(dom.text()).toContain(`Run ${run} |`);
  });

describe('startApp', () => {
  it('starts a new game on an empty device, and saves a tap before showing it', async () => {
    await startApp(dom.root, OPTIONS);
    expect(dom.text()).toContain('Run 1');
    expect(dom.buttons()).toContain('Count + 1');
    expect(seqOf((await storage()).slots['hot'])).toBe(1);

    dom.tap('Count + 1');
    await vi.waitFor(() => expect(dom.text()).toContain('Counter | 1'));
    expect((await hotGame())?.run.counter).toBe(1);
  });

  it('starts one run, not two, when "Start the run" is tapped twice', async () => {
    await startApp(dom.root, OPTIONS);
    dom.tap('New run');
    dom.tap('Start the run');
    dom.tap('Start the run');
    await gameShows(2);
    const after = await storage();
    expect((await hotGame())?.profile.runsStarted).toBe(2);
    expect(Object.keys(after.slots).sort()).toEqual(['checkpoint-0', 'hot']);
  });

  it('writes an unsaved step when the app is hidden', async () => {
    await startApp(dom.root, OPTIONS);
    dom.tap('Step + 1');
    await vi.waitFor(() => expect(dom.text()).toContain('not saved yet'));
    expect((await hotGame())?.run.steps).toBe(0);
    dom.fire('pagehide');
    await vi.waitFor(async () => expect((await hotGame())?.run.steps).toBe(1));
  });

  it('loads the saved game on a normal start and writes nothing', async () => {
    await seed(async (backend) => {
      await backend.write(record('checkpoint-0', 40, game({ profile: { runsStarted: 8 } })));
      await backend.write(record('hot', 57, game({ profile: { runsStarted: 12 } })));
    });
    const before = await storage();
    await startApp(dom.root, OPTIONS);
    expect(dom.text()).toContain('Run 12');
    expect((await storage()).slots).toEqual(before.slots);
  });
});

describe('recovery wiring', () => {
  it('after an unreadable start offers only what writes nothing, and changes nothing', async () => {
    await seed(async (backend) => {
      await backend.write(record('checkpoint-0', 40, game({ profile: { runsStarted: 8 } })));
      await backend.write(record('hot', 57, game({ profile: { runsStarted: 12 } })));
      await backend.addQuarantine([
        { slot: 'hot', kind: 'kept', reason: 'replaced-by-import', raw: record('hot', 20, game({ profile: { runsStarted: 5 } })) },
      ]);
    });
    const before = await storage();
    failOpens(1);

    await startApp(dom.root, OPTIONS);
    await vi.waitFor(() => expect(dom.text()).toContain('could not be opened or read'));
    // Give the screen time to list the set-aside saves it can now read; it must still not offer them.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(dom.buttons()).toEqual(['Export everything as it is', 'Try again']);
    expect(await storage()).toEqual(before);

    // Trying again loads the real save. The tap replaces the screen at once, so there is nothing left to tap twice.
    dom.tap('Try again');
    expect(dom.buttons()).toEqual([]);
    await gameShows(12);
    expect(await storage()).toEqual(before);
    dom.tap('Count + 1');
    await vi.waitFor(async () => expect(seqOf((await storage()).slots['hot'])).toBe(58));
  });

  it('sets aside what is in storage at the moment of the choice, not what was read when the screen opened', async () => {
    await seed(async (backend) => {
      await backend.write(record('checkpoint-0', 7, game({ profile: { runsStarted: 2 } })));
      await backend.write(record('hot', 9, game({ profile: { runsStarted: 3, equipped: 'd02' } })));
    });
    await startApp(dom.root, OPTIONS);
    await vi.waitFor(() => expect(dom.text()).toContain('fails a consistency check'));
    expect(dom.buttons()).toEqual([
      'Export everything as it is',
      'Try again',
      'Use hot anyway (run 3)',
      expect.stringMatching(/^Use checkpoint-0 \(run 2,/),
      'Start a new game…',
    ]);
    const untouched = await storage();
    expect(untouched.quarantine).toEqual([]);

    // Something else writes the hot slot while the screen is open.
    const later = record('hot', 30, game({ profile: { runsStarted: 9 } }));
    await seed((backend) => backend.write(later));

    dom.tap(/^Use checkpoint-0/);
    dom.tap(/^Use checkpoint-0/);
    await gameShows(2);
    const after = await storage();
    expect(after.quarantine).toMatchObject([{ kind: 'kept', reason: 'set-aside', slot: 'hot', seq: 30, raw: later }]);
    expect(after.slots['hot']).toMatchObject({ seq: 31, payload: { game: { profile: { runsStarted: 2 } } } });

    // One game is running, not two: one tap is one write.
    dom.tap('Count + 1');
    await vi.waitFor(async () => expect(seqOf((await storage()).slots['hot'])).toBe(32));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(seqOf((await storage()).slots['hot'])).toBe(32);
  });

  it('starts a new game from the recovery screen only after setting everything aside', async () => {
    await seed(async (backend) => {
      await backend.write(record('hot', 9, game({ profile: { runsStarted: 3, equipped: 'd02' } })));
    });
    await startApp(dom.root, OPTIONS);
    await vi.waitFor(() => expect(dom.buttons()).toContain('Start a new game…'));
    dom.tap('Start a new game…');
    // The first tap only asks; nothing has been written, and a redraw of the screen does not forget the question.
    expect((await storage()).quarantine).toEqual([]);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(dom.buttons()).not.toContain('Start a new game…');
    dom.tap(/^Tap again to start a new game/);
    await gameShows(1);
    const after = await storage();
    expect(after.quarantine).toMatchObject([{ kind: 'kept', reason: 'suspect', slot: 'hot', seq: 9 }]);
    expect(after.slots['hot']).toMatchObject({ seq: 10, payload: { game: { profile: { runsStarted: 1 } } } });
  });
});
