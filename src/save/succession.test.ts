import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { payload, record, recordV1, unsealed } from '../../tests/helpers';
import type { GameState } from '../engine';
import { RUN_LOG_LIMIT } from './constants';
import { checksumOf, serializeRecord } from './record';
import type { RunLogEntry, SavePayload } from './schema';
import { backedUpPayload, succeeds } from './succession';

type Profile = GameState['profile'];
type Run = GameState['run'];

// The sample save: run 3 of a game, five battles in, with runs 1 and 2 filed in its log.
const base = payload();
const withProfile = (change: Partial<Profile>, from: SavePayload = base): SavePayload => ({ ...from, game: { ...from.game, profile: { ...from.game.profile, ...change } } });
const withRun = (change: Partial<Run>, from: SavePayload = base): SavePayload => ({ ...from, game: { ...from.game, run: { ...from.game.run, ...change } } });
const withTallies = (change: Partial<Run['tallies']>, from: SavePayload = base): SavePayload => withRun({ tallies: { ...from.game.run.tallies, ...change } }, from);
const withApp = (change: Partial<SavePayload['app']>, from: SavePayload = base): SavePayload => ({ ...from, app: { ...from.app, ...change } });

const sealedText = (fields: Record<string, unknown>): string => JSON.stringify({ ...fields, checksum: checksumOf(fields) });

/** `from` played on: its run finished and filed, and the next begun with a seed of its own. */
const nextRun = (from: SavePayload = base, filed: Partial<RunLogEntry> = {}): SavePayload => {
  const run = from.game.profile.counters.runsStarted;
  const entry: RunLogEntry = {
    run,
    startedAt: from.app.runTiming.startedAt,
    endedAt: from.app.runTiming.startedAt + 600_000,
    activeMs: from.app.runTiming.activeMs + 60_000,
    wins: from.game.run.tallies.wins + 4,
    losses: from.game.run.tallies.losses,
    level: 9,
    strongest: 10,
    ...filed,
  };
  return {
    game: {
      profile: { ...from.game.profile, counters: { ...from.game.profile.counters, runsStarted: run + 1 } },
      run: { ...from.game.run, seed: from.game.run.seed + 1, battleCount: 0, xp: 0, gold: 0, energySpent: 0, salvageUsed: false, tallies: { wins: 0, losses: 0, itemsGained: [], claims: 0, gemsGained: 0 } },
    },
    app: { ...from.app, runTiming: { startedAt: entry.endedAt, activeMs: 0 }, runLog: [...from.app.runLog, entry].slice(-RUN_LOG_LIMIT) },
  };
};

describe('succeeds: the same game', () => {
  it('says yes of a save and itself', () => {
    expect(succeeds(base, base)).toBe(true);
    expect(succeeds(nextRun(), nextRun())).toBe(true);
  });

  it('says no of a game begun at another moment, even one that is ahead in every count', () => {
    const tracking = { ...base.app.exportTracking, trackingSince: base.app.exportTracking.trackingSince + 1 };
    const another = withApp({ exportTracking: tracking }, nextRun(withProfile({ items: { ...base.game.profile.items, i008: 1 } })));
    expect(succeeds(another, base)).toBe(false);
    expect(succeeds(base, another)).toBe(false);
    // The same save but for that one moment.
    expect(succeeds(withApp({ exportTracking: tracking }), base)).toBe(false);
  });
});

describe('succeeds: what is kept between runs', () => {
  const [firstLoadout] = base.game.profile.loadouts;
  if (firstLoadout === undefined) throw new Error('the sample save has no loadout');

  // Each row: something the other save keeps that this one does not. One difference is enough.
  it.each<[string, Partial<Profile>]>([
    ['an item it does not own', { items: { ...base.game.profile.items, i008: 1 } }],
    ['one more copy of an item', { items: { ...base.game.profile.items, i003: 3 } }],
    ['a Claim', { claimedBosses: [...base.game.profile.claimedBosses, 'e004'] }],
    ['one more win over an enemy', { bestiary: { ...base.game.profile.bestiary, e002: { timesBeaten: 10 } } }],
    ['an enemy it has never met', { bestiary: { ...base.game.profile.bestiary, e009: { timesBeaten: 0 } } }],
    ['a secret', { secretsFound: [...base.game.profile.secretsFound, 'x03'] }],
    ['a waypoint visited', { waypointsVisited: ['w01'] }],
    ['a waypoint unlocked', { waypointsUnlocked: ['w01'] }],
    ['a loadout slot bought', { loadouts: [...base.game.profile.loadouts, { ...firstLoadout, name: 'Third' }] }],
    ['a hint shown', { hintsShown: [...base.game.profile.hintsShown, 'gear'] }],
    ['a stronger enemy beaten', { strongestEverBeaten: base.game.profile.strongestEverBeaten + 1 }],
    ['a higher best level', { counters: { ...base.game.profile.counters, bestLevel: base.game.profile.counters.bestLevel + 1 } }],
    ['Auto-assign unlocked', { autoAssign: { ...base.game.profile.autoAssign, unlocked: true } }],
  ])('says no where the other save keeps %s, and yes the other way round', (_what, more) => {
    const ahead = withProfile(more);
    expect(succeeds(base, ahead)).toBe(false);
    expect(succeeds(ahead, base)).toBe(true);
  });

  it('says no of two saves that each keep something the other does not', () => {
    const one = withProfile({ items: { ...base.game.profile.items, i008: 1 } });
    const other = withProfile({ secretsFound: [...base.game.profile.secretsFound, 'x03'] });
    expect(succeeds(one, other)).toBe(false);
    expect(succeeds(other, one)).toBe(false);
  });
});

describe('succeeds: the same run, further on', () => {
  it('says no of a run with the same number and another seed: a run begun again is another run', () => {
    expect(succeeds(withRun({ seed: base.game.run.seed + 1 }), base)).toBe(false);
    // However far the second one has been played.
    expect(succeeds(withRun({ seed: base.game.run.seed + 1, battleCount: 90, xp: 9000 }), base)).toBe(false);
  });

  it('says no of a run begun at another moment', () => {
    expect(succeeds(withApp({ runTiming: { ...base.app.runTiming, startedAt: base.app.runTiming.startedAt + 1 } }), base)).toBe(false);
  });

  // Each row is `base` with one count that only goes up in a run, raised. `base` is then the earlier state.
  it.each<[string, SavePayload]>([
    ['more battles', withRun({ battleCount: base.game.run.battleCount + 1 })],
    ['more energy spent', withRun({ energySpent: base.game.run.energySpent + 1 })],
    ['more XP', withRun({ xp: base.game.run.xp + 1 })],
    ['more wins', withTallies({ wins: base.game.run.tallies.wins + 1 })],
    ['more losses', withTallies({ losses: base.game.run.tallies.losses + 1 })],
    ['more Claims this run', withTallies({ claims: base.game.run.tallies.claims + 1 })],
    ['Salvage used', withRun({ salvageUsed: true })],
    ['more time played', withApp({ runTiming: { ...base.app.runTiming, activeMs: base.app.runTiming.activeMs + 1 } })],
    ['a gem gained and tallied', withTallies({ gemsGained: base.game.run.tallies.gemsGained + 1 }, withProfile({ gems: base.game.profile.gems + 1 }))],
    ['gems spent', withProfile({ gems: base.game.profile.gems - 3 })],
  ])('says yes of the state with %s, and no the other way round', (_what, later) => {
    expect(succeeds(later, base)).toBe(true);
    expect(succeeds(base, later)).toBe(false);
  });

  it('says no where gems are there that were neither held before nor gained in this run', () => {
    expect(succeeds(withProfile({ gems: base.game.profile.gems + 1 }), base)).toBe(false);
  });

  // What a later state changes freely, either way. None of it can say which of two saves is the later.
  it.each<[string, SavePayload]>([
    ['another loadout in use', withProfile({ activeLoadout: 1 })],
    ['a loadout renamed', withProfile({ loadouts: base.game.profile.loadouts.map((loadout, index) => (index === 0 ? { ...loadout, name: 'Renamed' } : loadout)) })],
    ['Auto-assign set another way', withProfile({ autoAssign: { unlocked: false, on: false, split: { life: 100, damage: 0, defense: 0, dexterity: 0, luck: 0 } } })],
    ['other gold', withRun({ gold: 0 })],
    ['points spent another way', withRun({ pointsSpent: { life: 13, damage: 0, defense: 0, dexterity: 0, luck: 0 } })],
    ['the hero somewhere else', withRun({ position: { zone: 'z01', x: 3, y: 2 } })],
    ['other settings', withApp({ settings: { ...base.app.settings, playbackSpeed: 4 } })],
    ['an export recorded', withApp({ exportTracking: { ...base.app.exportTracking, lastExportAt: 5, runsAtLastExport: 3 } })],
  ])('does not judge %s', (_what, other) => {
    expect(succeeds(other, base)).toBe(true);
    expect(succeeds(base, other)).toBe(true);
  });
});

describe('succeeds: a later run', () => {
  it('says yes of the next run of the same game, and of the one after, and no the other way round', () => {
    const next = nextRun();
    const after = nextRun(next);
    expect(succeeds(next, base)).toBe(true);
    expect(succeeds(after, base)).toBe(true);
    expect(succeeds(after, next)).toBe(true);
    expect(succeeds(base, next)).toBe(false);
    expect(succeeds(next, after)).toBe(false);
  });

  it('says no where the run the other save was in is not in the log', () => {
    const next = nextRun();
    expect(succeeds(withApp({ runLog: base.app.runLog }, next), base)).toBe(false);
  });

  // The run the other save was in, as this save filed it, must be that run finished: not one begun at another
  // moment, nor one with less in it than the other save already had.
  it.each<[string, Partial<RunLogEntry>]>([
    ['begun at another moment', { startedAt: base.app.runTiming.startedAt + 1 }],
    ['with fewer wins than the other save already had', { wins: base.game.run.tallies.wins - 1 }],
    ['with fewer losses', { losses: base.game.run.tallies.losses - 1 }],
    ['with less time played', { activeMs: base.app.runTiming.activeMs - 1 }],
  ])('says no where that run is filed %s', (_what, filed) => {
    expect(succeeds(nextRun(base, filed), base)).toBe(false);
  });

  it('says no where a run the other save had finished is filed differently, in any one particular', () => {
    const next = nextRun();
    const [first] = next.app.runLog;
    if (first === undefined) throw new Error('the sample save has no finished run');
    const changes: Partial<RunLogEntry>[] = [{ startedAt: first.startedAt + 1 }, { endedAt: first.endedAt + 1 }, { activeMs: first.activeMs + 1 }, { wins: first.wins + 1 }, { losses: first.losses + 1 }, { level: first.level + 1 }, { strongest: first.strongest + 1 }];
    for (const change of changes) {
      const replayed = withApp({ runLog: [{ ...first, ...change }, ...next.app.runLog.slice(1)] }, next);
      expect(succeeds(replayed, base), JSON.stringify(change)).toBe(false);
      expect(succeeds(replayed, next), JSON.stringify(change)).toBe(false);
    }
  });

  it('says no where a run the other save had finished is missing from a log that is not full', () => {
    const next = nextRun();
    expect(succeeds(withApp({ runLog: next.app.runLog.slice(1) }, next), base)).toBe(false);
  });

  it('does not hold a full log to the runs it has let go', () => {
    // Play on until the log is full and has dropped its oldest runs.
    let later = base;
    for (let i = 0; i < RUN_LOG_LIMIT + 5; i += 1) later = nextRun(later);
    expect(later.app.runLog).toHaveLength(RUN_LOG_LIMIT);
    expect((later.app.runLog[0]?.run ?? 0) > base.game.profile.counters.runsStarted).toBe(true);
    expect(succeeds(later, base)).toBe(true);
    // A log that merely lacks them, without being full, is another matter.
    expect(succeeds(withApp({ runLog: later.app.runLog.slice(-50) }, later), base)).toBe(false);
  });

  it('holds a full log to every run that is still within it', () => {
    // A game played far enough that its log is full, and an earlier state of it from inside that stretch.
    const states: SavePayload[] = [base];
    for (let i = 0; i < RUN_LOG_LIMIT + 60; i += 1) states.push(nextRun(states[states.length - 1]));
    const later = states[states.length - 1];
    const earlier = states[states.length - 40];
    if (later === undefined || earlier === undefined) throw new Error('the game was not played far enough');
    expect(later.app.runLog).toHaveLength(RUN_LOG_LIMIT);
    expect(succeeds(later, earlier)).toBe(true);
    // The same log with one run inside it filed another way, and with that run gone and an older one in its
    // place so that the log is still full: neither is the earlier save played further.
    const inside = earlier.app.runLog[earlier.app.runLog.length - 1];
    const dropped = states[states.length - 2]?.app.runLog[0];
    if (inside === undefined || dropped === undefined) throw new Error('no run to change');
    const changed = withApp({ runLog: later.app.runLog.map((entry) => (entry.run === inside.run ? { ...entry, wins: entry.wins + 1 } : entry)) }, later);
    expect(succeeds(changed, earlier)).toBe(false);
    const without = withApp({ runLog: [dropped, ...later.app.runLog.filter((entry) => entry.run !== inside.run)] }, later);
    expect(without.app.runLog).toHaveLength(RUN_LOG_LIMIT);
    expect(without.app.runLog.some((entry) => entry.run === inside.run)).toBe(false);
    expect(succeeds(without, earlier)).toBe(false);
  });

  it('says no of a later run that keeps less, whatever its log says', () => {
    const next = nextRun();
    expect(succeeds(withProfile({ items: { i001: 1 } }, next), base)).toBe(false);
  });
});

describe('backedUpPayload: reading a backup file as a save this build can trust', () => {
  it('reads a record as this build writes it', () => {
    const saved = record('hot', 12);
    expect(backedUpPayload(serializeRecord(saved))).toEqual(saved.payload);
    expect(backedUpPayload(`  ${JSON.stringify(saved)}\n`)).toEqual(saved.payload);
  });

  it('reads the frozen fixture of the current version', () => {
    const text = readFileSync(fileURLToPath(new URL('../../tests/fixtures/saves/v2.json', import.meta.url)), 'utf8');
    expect(backedUpPayload(text)).not.toBeNull();
  });

  it('migrates an older version first, as a loaded record is', () => {
    const old = backedUpPayload(JSON.stringify(recordV1('hot', 7)));
    expect(old).not.toBeNull();
    expect(old?.game.profile.counters.runsStarted).toBe(1);
  });

  it.each<[string, string]>([
    ['nothing', ''],
    ['text that is not JSON', 'not json'],
    ['JSON that is not a record', '[1,2,3]'],
    ['a record whose checksum does not match', JSON.stringify({ ...record('hot', 12), seq: 13 })],
    ['a record with no checksum', JSON.stringify(unsealed(record('hot', 12)))],
    ['a newer save version', sealedText({ ...unsealed(record('hot', 12)), saveVersion: 3 })],
    ['a version that is not a number', sealedText({ ...unsealed(record('hot', 12)), saveVersion: '2' })],
    ['a payload in another shape', sealedText({ ...unsealed(record('hot', 12)), payload: { game: {}, app: {} } })],
    ['a payload with a field this build does not know', sealedText({ ...unsealed(record('hot', 12)), payload: { ...record('hot', 12).payload, extra: 1 } })],
    ['a version there is no migration from', sealedText({ ...unsealed(record('hot', 12)), saveVersion: 0 })],
  ])('gives null for %s', (_what, text) => {
    expect(backedUpPayload(text)).toBeNull();
  });
});
