// GDD D-40 against the real loop. `succeeds` is unit-tested beside its code on saves made by hand. Here the saves
// are made by playing: every save a game writes is held to "yes" against every save it wrote before, so that
// ordinary play can never find the cloud backup left alone; and saves made by going back and playing again are
// held to "no" against the game they left.

import { beforeEach, describe, expect, it } from 'vitest';
import { BUILD, CONTENT, FIXED_NOW, freshIndexedDb, payload } from '../../tests/helpers';
import { HINT_IDS, SLOT_IDS, STAT_KEYS } from '../engine';
import type { Action } from '../engine';
import { LocalBackend, SaveWriter, cursorFor, succeeds } from '../save';
import type { SavePayload } from '../save';
import { GameController } from './controller';

/** A small generator with a seed, so that a failure can be played again. Not the engine's: this is test input. */
const dice = (seed: number): ((sides: number) => number) => {
  let state = seed >>> 0;
  return (sides) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return Math.floor((state / 4294967296) * sides);
  };
};

const ITEMS = ['i001', 'i002', 'i003', 'i004', 'i005', 'i006', 'i007', 'i008'];
const SPAWNS = ['s001', 's001', 's002', 's002', 's003', 's004'];

const anyAction = (roll: (sides: number) => number): Action => {
  const pick = <T>(from: readonly T[]): T => from[roll(from.length)] as T;
  switch (roll(12)) {
    case 0:
    case 1:
    case 2:
    case 3:
      return { type: 'Fight', spawn: pick(SPAWNS) };
    case 4:
      return { type: 'Step', dx: pick([-1, 0, 1]), dy: pick([-1, 0, 1]) };
    case 5:
      return { type: 'Allocate', points: { life: 0, damage: 0, defense: 0, dexterity: 0, luck: 0, [pick(STAT_KEYS)]: 1 } };
    case 6:
      return { type: 'Equip', loadout: roll(3), slot: pick(SLOT_IDS), item: roll(4) === 0 ? null : pick(ITEMS) };
    case 7:
      return { type: 'RenameLoadout', index: roll(3), name: pick(['', 'One', 'Two', 'Boss']) };
    case 8:
      return { type: 'Buy', item: pick(ITEMS) };
    case 9:
      return roll(2) === 0 ? { type: 'BuyLoadoutSlot' } : { type: 'CollectStash', secret: pick(['x01', 'x02', 'x03']) };
    case 10:
      return { type: 'Salvage', boost: roll(2) === 0 };
    default:
      return { type: 'MarkHintShown', hint: pick(HINT_IDS) };
  }
};

type Played = { saves: SavePayload[]; actions: number; runs: number };

/**
 * Plays `steps` moves of a game from `from` through the real controller and writer, and gives back every save
 * it wrote, in order. `clock` and `seeds` are the game's own: another game, or the same one played again, is
 * handed others, as it would have on a phone.
 */
const play = async (from: SavePayload, steps: number, roll: (sides: number) => number, startClock: number, firstSeed: number): Promise<Played> => {
  freshIndexedDb();
  let clock = startClock;
  let seed = firstSeed;
  const writer = new SaveWriter({ store: new LocalBackend(), build: BUILD, content: CONTENT, now: () => clock, log: () => undefined }, cursorFor([]), null);
  const controller = new GameController({ content: CONTENT, writer, build: BUILD, randomSeed: () => (seed += 7919), now: () => clock }, from);
  const saves: SavePayload[] = [];
  let actions = 0;
  let runs = 0;
  const note = (): void => {
    const saved = controller.lastSaved?.payload;
    if (saved !== undefined && saves[saves.length - 1] !== saved) saves.push(saved);
  };
  for (let step = 0; step < steps; step += 1) {
    clock += 1000 + roll(40_000);
    const kind = roll(30);
    if (kind === 0) {
      if ((await controller.newRun()).kind === 'done') runs += 1;
    } else if (kind === 1) {
      await controller.updateApp((app) => ({ ...app, settings: { ...app.settings, playbackSpeed: ([1, 2, 4] as const)[roll(3)] ?? 1 } }));
    } else if ((await controller.dispatch(anyAction(roll))).kind === 'done') {
      actions += 1;
    }
    note();
  }
  await controller.flush();
  note();
  return { saves, actions, runs };
};

beforeEach(() => {
  freshIndexedDb();
});

describe.each([20261013, 7, 123456])('a game played from seed %i', (seed) => {
  it('never writes a save that fails against a save it wrote before', async () => {
    const played = await play(payload(), 700, dice(seed), FIXED_NOW, seed);
    // The walk is worth something only if it went somewhere: fights, runs, and many saves.
    expect(played.saves.length).toBeGreaterThan(100);
    expect(played.actions).toBeGreaterThan(80);
    expect(played.runs).toBeGreaterThan(5);
    expect(played.saves.some((save) => save.game.run.tallies.wins > 0)).toBe(true);
    const refused: string[] = [];
    played.saves.forEach((later, j) => {
      for (let i = 0; i <= j; i += 1) {
        const earlier = played.saves[i];
        if (earlier !== undefined && !succeeds(later, earlier)) refused.push(`${i} then ${j}`);
      }
    });
    expect(refused).toEqual([]);
  });

  it('refuses every earlier save against a later one that has anything more to show', async () => {
    const played = await play(payload(), 300, dice(seed), FIXED_NOW, seed);
    const last = played.saves[played.saves.length - 1];
    if (last === undefined) throw new Error('nothing was saved');
    let taken = 0;
    for (const earlier of played.saves) {
      const behind =
        earlier.game.profile.counters.runsStarted < last.game.profile.counters.runsStarted ||
        earlier.game.run.battleCount < last.game.run.battleCount ||
        earlier.app.runTiming.activeMs < last.app.runTiming.activeMs;
      if (!behind) continue;
      taken += 1;
      expect(succeeds(earlier, last)).toBe(false);
    }
    expect(taken).toBeGreaterThan(40);
  });

  it('refuses a game that went back and was played again, at every save it then writes', async () => {
    const first = await play(payload(), 300, dice(seed), FIXED_NOW, seed);
    const last = first.saves[first.saves.length - 1];
    // Go back to a save from before the last three runs, as a phone does when its newest saves cannot be read.
    const back = first.saves.find((save) => save.game.profile.counters.runsStarted === (last?.game.profile.counters.runsStarted ?? 0) - 3);
    if (last === undefined || back === undefined) throw new Error('the first game did not run long enough to go back three runs');
    // The same game, taken up again later, and played another way.
    const again = await play(back, 500, dice(seed + 1), FIXED_NOW + 86_400_000, seed + 500_000);
    expect(again.runs).toBeGreaterThan(5);
    const passed = again.saves.filter((save) => succeeds(save, last));
    expect(passed).toEqual([]);
    // It did get past the first game by every count there is, so it is not being refused for being behind.
    const furthest = again.saves[again.saves.length - 1];
    expect((furthest?.game.profile.counters.runsStarted ?? 0) > last.game.profile.counters.runsStarted).toBe(true);
  });
});
