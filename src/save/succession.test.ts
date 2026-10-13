import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { game, payload, record, recordV1, unsealed } from '../../tests/helpers';
import type { GameState } from '../engine';
import { checksumOf, serializeRecord } from './record';
import type { SavePayload } from './schema';
import { backedUpPayload, succeeds } from './succession';

type Profile = GameState['profile'];

const withProfile = (change: Partial<Profile>): SavePayload => payload(game({ profile: change }));

const base = payload();
const sealedText = (fields: Record<string, unknown>): string => JSON.stringify({ ...fields, checksum: checksumOf(fields) });

describe('succeeds: may one save take the place of another without asking', () => {
  it('says yes of a save and itself, and of the same holdings later in a run or in a later run', () => {
    expect(succeeds(base, base)).toBe(true);
    const laterRun = payload(game({ profile: { counters: { runsStarted: 9, bestLevel: 6 } }, run: { battleCount: 0, gold: 0, xp: 0 } }));
    expect(succeeds(laterRun, base)).toBe(true);
    expect(succeeds(base, laterRun)).toBe(false);
  });

  it('says no of a game begun at another moment, even one that holds everything the other does and more', () => {
    const another: SavePayload = { ...withProfile({ items: { ...base.game.profile.items, i008: 1 } }), app: { ...base.app, exportTracking: { ...base.app.exportTracking, trackingSince: base.app.exportTracking.trackingSince + 1 } } };
    expect(succeeds(another, base)).toBe(false);
    expect(succeeds(base, another)).toBe(false);
  });

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
    ['a stronger enemy beaten', { strongestEverBeaten: base.game.profile.strongestEverBeaten + 1 }],
    ['a higher best level', { counters: { ...base.game.profile.counters, bestLevel: base.game.profile.counters.bestLevel + 1 } }],
    ['a later run', { counters: { ...base.game.profile.counters, runsStarted: base.game.profile.counters.runsStarted + 1 } }],
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

  // What is left out on purpose: none of these is lost by a later state taking an earlier one's place.
  it.each<[string, Partial<Profile>]>([
    ['more gems, which are spent', { gems: base.game.profile.gems + 50 }],
    ['another loadout in use', { activeLoadout: 1 }],
    ['Auto-assign switched on with another split', { autoAssign: { unlocked: false, on: false, split: { life: 100, damage: 0, defense: 0, dexterity: 0, luck: 0 } } }],
    ['more hints shown', { hintsShown: [...base.game.profile.hintsShown, 'gear'] }],
  ])('does not count %s', (_what, other) => {
    expect(succeeds(base, withProfile(other))).toBe(true);
  });

  it('does not count settings, export tracking apart from the moment the game began, run times or anything in the run', () => {
    const other: SavePayload = {
      game: game({ run: { gold: 9999, xp: 5000, battleCount: 90, energySpent: 19 } }),
      app: { ...base.app, settings: { ...base.app.settings, playbackSpeed: 4 }, exportTracking: { ...base.app.exportTracking, lastExportAt: 5, runsAtLastExport: 3 }, runLog: [] },
    };
    expect(succeeds(base, other)).toBe(true);
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
