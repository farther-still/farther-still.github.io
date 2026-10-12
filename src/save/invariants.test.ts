import { describe, expect, it } from 'vitest';
import { CONTENT, UNOWNED_ITEM, game, record, suspectGame } from '../../tests/helpers';
import { emptyLoadout, repairRun } from '../engine';
import type { Content, GameState, ItemId, SlotId } from '../engine';
import { sampleGame } from '../engine/sample.fixture';
import { classify } from './classify';
import { checkInvariants } from './invariants';
import { gameStateSchema } from './schema';

type Profile = GameState['profile'];
type Run = GameState['run'];

// The sample world has no waypoint, and three rules are about them, so these tests add one.
const WORLD: Content = { ...CONTENT, waypoints: { w01: { id: 'w01', zone: 'z01', x: 1, y: 1 } } };

const withProfile = (changes: Partial<Profile>): GameState => game({ profile: changes });
const withRun = (changes: Partial<Run>): GameState => game({ run: changes });
const base = game();

/** The sample game with cells of one loadout changed. */
const wearing = (cells: Partial<Record<SlotId, ItemId | null>>, index = 0): GameState =>
  withProfile({ loadouts: base.profile.loadouts.map((loadout, at) => (at === index ? { ...loadout, slots: { ...loadout.slots, ...cells } } : loadout)) });

const split = (life: number, damage: number, defense: number, dexterity: number, luck: number): Profile['autoAssign'] => ({
  unlocked: true,
  on: true,
  split: { life, damage, defense, dexterity, luck },
});

describe('checkInvariants', () => {
  it('passes a game in progress and a new game', () => {
    expect(checkInvariants(game(), CONTENT)).toEqual([]);
    expect(checkInvariants(game(), WORLD)).toEqual([]);
    expect(checkInvariants(sampleGame(), CONTENT)).toEqual([]);
  });

  it('passes what is unusual but allowed', () => {
    const allowed: GameState[] = [
      // Every copy of an accessory worn at once, and each loadout counted by itself: both wear the one body piece.
      wearing({ acc3: 'i003' }, 1),
      withProfile({ items: { ...base.profile.items, i003: 3 }, loadouts: [...base.profile.loadouts, emptyLoadout(), emptyLoadout(), emptyLoadout()] }),
      // An item owned in no copy, an enemy met and never beaten, and the last loadout in use.
      withProfile({ items: { ...base.profile.items, i008: 0 }, bestiary: { e001: { timesBeaten: 0 } }, activeLoadout: 1 }),
      withProfile({ waypointsVisited: ['w01'], waypointsUnlocked: ['w01'] }),
      withProfile({ waypointsVisited: ['w01'], autoAssign: split(0, 0, 0, 0, 100) }),
      // The two ends of the seed range, and XP past what a whole number holds exactly (GDD 6.2).
      withRun({ seed: 0, xp: 0 }),
      withRun({ seed: 0xffffffff, xp: 2 ** 60 }),
    ];
    for (const state of allowed) expect(checkInvariants(state, WORLD)).toEqual([]);
  });

  // One row per rule: a game that breaks that rule and no other, and exactly what is reported.
  const broken: ReadonlyArray<readonly [string, GameState, string[]]> = [
    ['a negative count of an item', withProfile({ items: { ...base.profile.items, i004: -1 } }), ['negative count for i004']],
    ['an owned item that is not in content', withProfile({ items: { ...base.profile.items, i999: 1 } }), ['unknown item i999 owned']],

    ['fewer loadouts than a new game has', withProfile({ loadouts: base.profile.loadouts.slice(0, 1) }), ['1 loadouts']],
    ['more loadouts than can be bought', withProfile({ loadouts: [...base.profile.loadouts, emptyLoadout(), emptyLoadout(), emptyLoadout(), emptyLoadout()] }), ['6 loadouts']],
    ['an active loadout past the end of the list', withProfile({ activeLoadout: 2 }), ['the active loadout does not exist']],
    ['an active loadout before the start of the list', withProfile({ activeLoadout: -1 }), ['the active loadout does not exist']],
    ['a loadout wearing an item that is not in content', wearing({ head: 'i999' }), ['unknown item i999 in loadout 1']],
    ['armor in a cell of another kind', wearing({ body: null, head: 'i002' }), ['item i002 is in the wrong slot of loadout 1']],
    ['a weapon in an accessory cell', wearing({ weapon: null, acc5: 'i001' }), ['item i001 is in the wrong slot of loadout 1']],
    ['an accessory in an armor cell', wearing({ acc2: null, finger: 'i003' }), ['item i003 is in the wrong slot of loadout 1']],
    ['a key worn, in the second loadout', wearing({ acc4: 'i004' }, 1), ['item i004 is in the wrong slot of loadout 2']],
    ['a loadout wearing an item that is not owned', suspectGame(), [`loadout 1 wears 1 of ${UNOWNED_ITEM} but 0 are owned`]],
    ['a loadout wearing more copies than are owned', wearing({ acc3: 'i003' }), ['loadout 1 wears 3 of i003 but 2 are owned']],
    ['a second loadout wearing more copies than are owned', wearing({ acc2: 'i003', acc3: 'i003' }, 1), ['loadout 2 wears 3 of i003 but 2 are owned']],

    ['a claimed enemy that is not a boss', withProfile({ claimedBosses: ['e001'] }), ['claimed e001, which is not a boss']],
    ['a claimed enemy that is not in content', withProfile({ claimedBosses: ['e003', 'e999'] }), ['claimed e999, which is not a boss']],
    ['a boss claimed twice', withProfile({ claimedBosses: ['e003', 'e003'] }), ['a boss is claimed twice']],
    ['a bestiary entry for an enemy that is not in content', withProfile({ bestiary: { ...base.profile.bestiary, e999: { timesBeaten: 1 } } }), ['unknown enemy e999 in the bestiary']],
    ['a negative number of wins', withProfile({ bestiary: { ...base.profile.bestiary, e001: { timesBeaten: -1 } } }), ['negative wins against e001']],

    ['a found secret that is not in content', withProfile({ secretsFound: ['x01', 'x99'] }), ['unknown secret x99']],
    ['a visited waypoint that is not in content', withProfile({ waypointsVisited: ['w01', 'w99'] }), ['unknown waypoint w99']],
    ['an unlocked waypoint that is not in content', withProfile({ waypointsVisited: ['w01'], waypointsUnlocked: ['w99'] }), ['unknown waypoint w99', 'waypoint w99 is unlocked but was never visited']],
    ['a waypoint unlocked but never visited', withProfile({ waypointsUnlocked: ['w01'] }), ['waypoint w01 is unlocked but was never visited']],
    ['a secret listed twice', withProfile({ secretsFound: ['x01', 'x02', 'x01'] }), ['a list in the profile holds an entry twice']],
    ['a visited waypoint listed twice', withProfile({ waypointsVisited: ['w01', 'w01'] }), ['a list in the profile holds an entry twice']],
    ['an unlocked waypoint listed twice', withProfile({ waypointsVisited: ['w01'], waypointsUnlocked: ['w01', 'w01'] }), ['a list in the profile holds an entry twice']],
    ['a hint listed twice', withProfile({ hintsShown: ['map', 'hero', 'map'] }), ['a list in the profile holds an entry twice']],

    ['an Auto-assign split over 100', withProfile({ autoAssign: split(30, 30, 30, 10, 10) }), ['the Auto-assign split does not add up to 100']],
    ['an Auto-assign split under 100', withProfile({ autoAssign: split(0, 0, 0, 0, 0) }), ['the Auto-assign split does not add up to 100']],
    ['an Auto-assign split that reaches 100 with a negative share', withProfile({ autoAssign: split(110, -10, 0, 0, 0) }), ['the Auto-assign split does not add up to 100']],

    ['negative gems', withProfile({ gems: -1 }), ['negative gems']],
    ['a negative strongest enemy ever beaten', withProfile({ strongestEverBeaten: -1 }), ['negative strongest enemy']],
    ['no run started', withProfile({ counters: { runsStarted: 0, bestLevel: 6 } }), ['runsStarted is below 1']],
    ['a best level below 1', withProfile({ counters: { runsStarted: 3, bestLevel: 0 } }), ['bestLevel is below 1']],

    ['a negative run seed', withRun({ seed: -1 }), ['the run seed is out of range']],
    ['a run seed past 32 bits', withRun({ seed: 2 ** 32 }), ['the run seed is out of range']],
    ['a negative battle count', withRun({ battleCount: -1 }), ['negative battleCount']],
    ['a negative spawn count', withRun({ spawnCount: -1 }), ['negative spawnCount']],
    ['negative XP', withRun({ xp: -1 }), ['negative xp']],
    ['negative Growth points', withRun({ growthPointsEarned: -1 }), ['negative growthPointsEarned']],
    ['negative gold', withRun({ gold: -1 }), ['negative gold']],
    ['negative energy spent', withRun({ energySpent: -1 }), ['negative energySpent']],
    ['negative energy paid back', withRun({ energyPaidBack: -1 }), ['negative energyPaidBack']],
    ['a negative strongest enemy beaten this run', withRun({ strongestBeaten: -1 }), ['negative strongestBeaten']],
    ['a negative tally of wins', withRun({ tallies: { ...base.run.tallies, wins: -1 } }), ['negative wins']],
    ['a negative tally of losses', withRun({ tallies: { ...base.run.tallies, losses: -1 } }), ['negative losses']],
    ['a negative tally of claims', withRun({ tallies: { ...base.run.tallies, claims: -1 } }), ['negative claims']],
    ['a negative tally of gems', withRun({ tallies: { ...base.run.tallies, gemsGained: -1 } }), ['negative gemsGained']],
    ['XP with a fraction', withRun({ xp: 74.5 }), ['xp is not a whole number']],
    ['negative points spent', withRun({ pointsSpent: { ...base.run.pointsSpent, luck: -1 } }), ['negative points spent']],
  ];

  it.each(broken)('reports %s', (_name, state, problems) => {
    expect(checkInvariants(state, WORLD)).toEqual(problems);
    // The schema has nothing to say about any of these, which is why the rule exists: the record is intact,
    // and it is the invariant that makes it suspect.
    expect(gameStateSchema.safeParse(state).success).toBe(true);
    expect(classify('hot', record('hot', 3, state), WORLD)).toMatchObject({ kind: 'suspect', seq: 3, migrated: false, problems });
  });

  it('reports every broken rule, not only the first', () => {
    const state = game({ profile: { gems: -1, claimedBosses: ['e001'], counters: { runsStarted: 0, bestLevel: 0 } }, run: { gold: -1, xp: 0.5 } });
    expect(checkInvariants(state, WORLD)).toEqual([
      'claimed e001, which is not a boss',
      'negative gems',
      'runsStarted is below 1',
      'bestLevel is below 1',
      'negative gold',
      'xp is not a whole number',
    ]);
  });

  it('does not change the game it checks', () => {
    const state = suspectGame();
    const before = structuredClone(state);
    checkInvariants(state, WORLD);
    expect(state).toEqual(before);
  });

  describe('what a run says about content', () => {
    // Content can change under a run in progress. Bringing the run back in line is the job of the engine's
    // `repairRun` (ARCHITECTURE 7.3), so none of these makes a record suspect: it loads as good and is repaired.
    const stale: ReadonlyArray<readonly [string, Partial<Run>, Partial<Run>]> = [
      ['a beaten boss that is not in content', { bossesBeaten: ['e999'] }, { bossesBeaten: [] }],
      ['a beaten enemy that is not a boss', { bossesBeaten: ['e003', 'e001'] }, { bossesBeaten: ['e003'] }],
      ['a mark on a spawn that is not in content', { marks: { s001: { stat: 'xp', percent: 100 }, s999: { stat: 'gold', percent: 200 } } }, { marks: { s001: { stat: 'xp', percent: 100 } } }],
      ['a mark on a boss', { marks: { s003: { stat: 'drops', percent: 100 } } }, { marks: {} }],
      ['a position off the map', { position: { zone: 'z01', x: -1, y: -1 } }, { position: WORLD.start }],
      ['a position inside a wall', { position: { zone: 'z01', x: 0, y: 0 } }, { position: WORLD.start }],
      ['a position in a zone that is not in content', { position: { zone: 'z99', x: 1, y: 1 } }, { position: WORLD.start }],
      ['a last enemy that is not in content', { lastEnemy: 'e999' }, { lastEnemy: null }],
      ['a collected stash that is not in content', { stashesCollected: ['x02', 'x99'] }, { stashesCollected: ['x02'] }],
      ['a gained item that is not in content', { tallies: { ...base.run.tallies, itemsGained: ['i003', 'i999'] } }, { tallies: { ...base.run.tallies, itemsGained: ['i003'] } }],
      ['more points spent than the run has earned', { pointsSpent: { life: 400, damage: 0, defense: 0, dexterity: 0, luck: 0 } }, { pointsSpent: { life: 0, damage: 0, defense: 0, dexterity: 0, luck: 0 } }],
    ];

    it.each(stale)('does not report %s, which run repair settles', (_name, changes, settled) => {
      const state = withRun(changes);
      expect(checkInvariants(state, WORLD)).toEqual([]);
      expect(classify('hot', record('hot', 3, state), WORLD)).toMatchObject({ kind: 'good', migrated: false });

      const repaired = repairRun(state, WORLD);
      expect(repaired).not.toBe(state);
      expect(repaired.profile).toBe(state.profile);
      expect(repaired.run).toEqual({ ...state.run, ...settled });
      // Repaired once, it is settled: still a good record, and a second repair finds nothing to do.
      expect(repairRun(repaired, WORLD)).toBe(repaired);
      expect(classify('hot', record('hot', 4, repaired), WORLD).kind).toBe('good');
    });

    it('leaves a run that fits its content alone', () => {
      const state = game();
      expect(repairRun(state, WORLD)).toBe(state);
    });
  });
});
