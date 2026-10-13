import { describe, expect, it } from 'vitest';
import { resolveBattle } from './battle';
import { canonicalJson } from './canonical';
import { combatantOf, deriveHero, dropChance, level, loadoutPrice, pointsEarned, remainingEnergy, salvageChance, salvagePool, startingEnergy, unspentPoints } from './formulas';
import { findPath, walkable } from './map';
import { xpForLevel } from './math/level';
import { streamRng } from './rng';
import { SAMPLE_BALANCE, sampleContent, sampleItem } from './sample.fixture';
import { emptyLoadout, freshRun, newGame, rollMark, zeroPoints } from './state';
import type { GameState } from './state';
import { fightBlock, repairRun, step } from './step';
import type { Action, GameEvent, RejectReason, StepResult } from './step';
import type { Balance, Content, EnemyDef, ItemId, Loadout, Mark, Position, SlotId, StatPoints } from './types';

// The reducer against GDD 2.2, 2.3, 2.5, 3.3, 3.4, 5.5, 7.3, 7.4, 7.7 and 7.8, in the sample world:
//
//   x 012345678        s001 (e001, level 2) at (3,3); s002 (e002, level 4) at (3,1); the gate boss s003
// y 1 #..2#...#        (e003, level 10) at (4,2); exit to z02 at (7,2), where s004 (e004, level 50) stands.
//   2 #...B..>#        Salvage site at (2,4); run start at (2,5); hidden tile x01 at (4,5); stash x02 at (5,5);
//   3 #..1#...#        door at (1,7), opened by key i004.
//   4 #.S.#####
//   5 #.@.%_###        e001 drops i002 at 50% and the key i004 at 100%. e002 drops i003 (cap 3) at 25% and
//   6 #...#####        i008 at 10%. e003 hands over the tool i005. e004 hands over i007.
//   7 #D#######
//
// Every state and the content are deep-frozen before each call, so a reducer that changed its arguments would throw.

const B: Balance = SAMPLE_BALANCE;

const deepFreeze = <T>(value: T): T => {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value)) deepFreeze(inner);
  }
  return value;
};

const must = <T>(value: T | undefined | null, what: string): T => {
  if (value === undefined || value === null) throw new Error(`test setup: no ${what}`);
  return value;
};

/**
 * The sample world plus one piece of armor, i900, that makes any fight in it a certain win: Life 3,060, Damage
 * 1,010, Defense 1,005, Dexterity 1,000. Nothing drops it and nothing sells it, so it changes no reward.
 */
const world: Content = deepFreeze(
  ((): Content => {
    const base = sampleContent();
    const mightyLegs = sampleItem('i900', 'legs', { level: 1, lines: { lifeFlat: 3000, damageFlat: 1000, defenseFlat: 1000, dexterityFlat: 1000 } });
    return { ...base, itemOrder: [...base.itemOrder, 'i900'], items: { ...base.items, i900: mightyLegs } };
  })(),
);

const START: Position = { zone: 'z01', x: 2, y: 5 };
/** Beside s001, s002 and the boss s003. */
const NEAR: Position = { zone: 'z01', x: 3, y: 2 };
/** Beside s004. */
const IN_Z2: Position = { zone: 'z02', x: 1, y: 1 };

const at = (x: number, y: number, zone = 'z01'): Position => ({ zone, x, y });

const loadoutOf = (slots: Partial<Record<SlotId, ItemId>>, name = ''): Loadout => {
  const loadout = emptyLoadout();
  return { name, slots: { ...loadout.slots, ...slots } };
};

/** A new game on `seed`, with any part of the run or the profile replaced. Seed 7 starts with no enemy marked. */
const game = (run: Partial<GameState['run']> = {}, profile: Partial<GameState['profile']> = {}, seed = 7): GameState => {
  const base = newGame(seed, world);
  return { profile: { ...base.profile, ...profile }, run: { ...base.run, ...run } };
};

/** A level 1 hero wearing i900, standing beside the three enemies of the first room. A `profile.items` passed here must include i900. */
const mighty = (run: Partial<GameState['run']> = {}, profile: Partial<GameState['profile']> = {}, seed = 7): GameState =>
  game({ position: NEAR, ...run }, { items: { i900: 1 }, loadouts: [loadoutOf({ legs: 'i900' }), emptyLoadout()], ...profile }, seed);

type Accepted = { state: GameState; events: GameEvent[] };

const accept = (state: GameState, action: Action, content: Content = world): Accepted => {
  const result = step(deepFreeze(state), action, content);
  if ('rejected' in result) throw new Error(`${action.type} was rejected: ${result.rejected}`);
  return result;
};

const apply = (state: GameState, ...actions: Action[]): GameState => actions.reduce((current, action) => accept(current, action).state, state);

const rejection = (state: GameState, action: Action, content: Content = world): RejectReason | null => {
  const result = step(deepFreeze(state), action, content);
  return 'rejected' in result ? result.rejected : null;
};

const eventOf = <K extends GameEvent['type']>(events: readonly GameEvent[], type: K): Extract<GameEvent, { type: K }> => {
  const found = events.find((event): event is Extract<GameEvent, { type: K }> => event.type === type);
  if (found === undefined) throw new Error(`there is no ${type} event`);
  return found;
};

const types = (events: readonly GameEvent[]): string[] => events.map((event) => event.type);

const fight = (state: GameState, spawn: string, content: Content = world): Accepted => accept(state, { type: 'Fight', spawn }, content);

const enemy = (id: string): EnemyDef => must(world.enemies[id], `enemy ${id}`);

const allPoints = (over: Partial<StatPoints>): StatPoints => ({ ...zeroPoints(), ...over });

describe('the test world', () => {
  it('starts a new game with nothing owned, on run 1, at the run start', () => {
    const state = newGame(7, world);
    expect(state.profile).toEqual({
      items: {},
      loadouts: [emptyLoadout(), emptyLoadout()],
      activeLoadout: 0,
      claimedBosses: [],
      gems: 0,
      waypointsVisited: [],
      waypointsUnlocked: [],
      bestiary: {},
      strongestEverBeaten: 0,
      secretsFound: [],
      autoAssign: { unlocked: false, on: false, split: { life: 30, damage: 30, defense: 30, dexterity: 10, luck: 0 } },
      hintsShown: [],
      counters: { runsStarted: 1, bestLevel: 1 },
    });
    expect(state.run).toEqual(freshRun(7, world));
    expect(state.run.position).toEqual(START);
    expect(level(state, B)).toBe(1);
    expect(state.run.gold).toBe(0);
    expect(remainingEnergy(state, world)).toBe(20);
  });

  it('makes the hero in i900 the certain winner these tests assume', () => {
    const hero = deriveHero(mighty(), world);
    expect([hero.level, hero.life, hero.damage, hero.defense, hero.dexterity]).toEqual([1, 3060, 1010, 1005, 1000]);
  });
});

describe('Fight: a win (GDD 3.4)', () => {
  it('charges the cost, adds XP and levels, adds gold, and updates the bestiary', () => {
    const before = mighty();
    const { state, events } = fight(before, 's002');
    expect(types(events)).toEqual(['Battle', 'Rewards']);
    expect(eventOf(events, 'Battle')).toMatchObject({ spawn: 's002', enemy: 'e002', win: true, heroMaxLife: 3060, enemyMaxLife: 72, enemyLifeLeft: 0 });
    // e002 is level 4 against a level 1 hero: 38 XP times the full underlevel bonus of 3. 114 XP is level 5.
    expect(eventOf(events, 'Rewards')).toMatchObject({ xp: 114, levelBefore: 1, levelAfter: 5, gold: 16, claimed: false, energyCost: 1, energyBack: 0, energyLeft: 19, mark: null });
    expect(state.run).toMatchObject({ xp: 114, gold: 16, energySpent: 1, energyPaidBack: 0, battleCount: 1, strongestBeaten: 4, lastEnemy: 'e002', bossesBeaten: [] });
    expect(state.run.tallies).toMatchObject({ wins: 1, losses: 0, claims: 0 });
    expect(state.profile.bestiary).toEqual({ e002: { timesBeaten: 1 } });
    expect(state.profile.strongestEverBeaten).toBe(4);
    expect(state.profile.counters).toEqual({ runsStarted: 1, bestLevel: 5 });
    expect(level(state, B)).toBe(5);
    expect(remainingEnergy(state, world)).toBe(19);
  });

  it('gives 5 stat points to spend for each level gained', () => {
    const { state } = fight(mighty(), 's002');
    expect(pointsEarned(state, B)).toBe(20);
    expect(unspentPoints(state, B)).toBe(20);
    expect(state.run.pointsSpent).toEqual(zeroPoints());
  });

  it('works the underlevel bonus out from the level the hero had going in', () => {
    // A level 2 hero against level 4 is a ratio of 2: 38 × 1.667 = 63. Had the bonus been taken after the
    // level-up it would have been 38.
    const { events } = fight(mighty({ xp: 10 }), 's002');
    expect(eventOf(events, 'Rewards')).toMatchObject({ xp: 63, levelBefore: 2, levelAfter: 4 });
  });

  it('counts wins in the bestiary and keeps the strongest kill, this run and ever', () => {
    let state = mighty({}, { items: { i900: 1 }, bestiary: { e002: { timesBeaten: 6 } }, strongestEverBeaten: 50 });
    state = fight(state, 's002').state;
    state = fight(state, 's001').state;
    state = fight(state, 's002').state;
    expect(state.profile.bestiary).toEqual({ e001: { timesBeaten: 1 }, e002: { timesBeaten: 8 } });
    expect(state.run.strongestBeaten).toBe(4);
    expect(state.profile.strongestEverBeaten).toBe(50);
    expect(state.run.lastEnemy).toBe('e002');
    expect(state.run.tallies.wins).toBe(3);
    expect(state.run.energySpent).toBe(3);
  });

  it('brings a normal enemy straight back, so fights chain on one spot (GDD 2.2)', () => {
    let state = mighty();
    for (let i = 0; i < 5; i += 1) state = fight(state, 's001').state;
    expect(state.run.tallies.wins).toBe(5);
    expect(state.run.position).toEqual(NEAR);
    expect(walkable(state, world, 'z01', 3, 3, 'step')).toBe(false);
  });

  it('resolves the battle on the battle stream at the battle counter, with the hero as they stand', () => {
    for (const battleCount of [0, 1, 17]) {
      const before = mighty({ battleCount });
      const expected = resolveBattle(deriveHero(before, world), combatantOf(enemy('e002')), streamRng(7, 'battle', battleCount), B, { log: true });
      const battle = eventOf(fight(before, 's002').events, 'Battle');
      expect(battle.log).toEqual(expected.log);
      expect(battle.rounds).toBe(expected.rounds);
      expect(battle.hitsTaken).toBe(expected.hitsTaken);
    }
  });

  it('adds Growth points for the levels gained while the Growth item is worn, and keeps them after it comes off', () => {
    // i007 carries Growth 1. The win takes the hero from level 1 to 5: four levels, four extra points.
    const wearing = mighty({}, { items: { i900: 1, i007: 1 }, loadouts: [loadoutOf({ legs: 'i900', acc1: 'i007' }), emptyLoadout()] });
    const won = fight(wearing, 's002').state;
    expect(won.run.growthPointsEarned).toBe(4);
    expect(unspentPoints(won, B)).toBe(24);
    const bare = apply(won, { type: 'Equip', loadout: 0, slot: 'acc1', item: null });
    expect(bare.run.growthPointsEarned).toBe(4);
    expect(unspentPoints(bare, B)).toBe(24);
    // Levels gained with it off earn nothing more.
    const later = fight({ ...bare, run: { ...bare.run, marks: {} } }, 's002').state;
    expect(later.run.growthPointsEarned).toBe(4);
    // And a hero who never wore it has none.
    expect(fight(mighty(), 's002').state.run.growthPointsEarned).toBe(0);
  });

  it('does not run Auto-assign, though GDD 3.4 lists it after Growth', () => {
    // QUESTION: GDD 3.4 says a win runs Auto-assign if it is on, and GDD 8.2 that it unlocks for good the first
    // time the hero reaches level 250. step.ts does neither: there is no SetAutoAssign action (ARCHITECTURE 5.2),
    // the points stay unspent, and `autoAssign.unlocked` never changes. The split itself exists as `splitPolicy`.
    const on = { unlocked: true, on: true, split: { life: 30, damage: 30, defense: 30, dexterity: 10, luck: 0 } };
    const { state } = fight(mighty({}, { items: { i900: 1 }, autoAssign: on }), 's002');
    expect(state.run.pointsSpent).toEqual(zeroPoints());
    expect(unspentPoints(state, B)).toBe(20);
    // One XP short of level 250, then a win.
    const nearly = mighty({ xp: xpForLevel(250, 10) - 1 });
    expect(level(nearly, B)).toBe(249);
    const after = fight(nearly, 's002').state;
    expect(level(after, B)).toBeGreaterThanOrEqual(250);
    expect(after.profile.autoAssign.unlocked).toBe(false);
  });
});

describe('Fight: rewards on their own stream (GDD 3.3, 5.5, 7.8)', () => {
  const SEEDS = 80;

  it('rolls each drop the enemy still holds, in order, then the gem, from the reward stream at the battle counter', () => {
    let dropped = 0;
    let gemmed = 0;
    for (let seed = 0; seed < SEEDS; seed += 1) {
      const { state, events } = fight(mighty({ marks: {}, battleCount: 3 }, {}, seed), 's002');
      const rolls = streamRng(seed, 'reward', 3);
      const expected: string[] = [];
      // e002: i003 at 25%, i008 at 10%. A normal enemy drops 1 gem 8% of the time.
      if (rolls.next() < 0.25) expected.push('i003');
      if (rolls.next() < 0.1) expected.push('i008');
      const gems = rolls.next() < 0.08 ? 1 : 0;
      const rewards = eventOf(events, 'Rewards');
      expect(rewards.drops).toEqual(expected);
      expect(rewards.gems).toBe(gems);
      expect(state.profile.gems).toBe(gems);
      expect(state.run.tallies.gemsGained).toBe(gems);
      expect(state.run.tallies.itemsGained).toEqual(expected);
      expect(state.profile.items).toEqual({ i900: 1, ...Object.fromEntries(expected.map((item) => [item, 1])) });
      dropped += expected.length;
      gemmed += gems;
    }
    // Both things happen somewhere in the sample, so the comparison above is not empty.
    expect(dropped).toBeGreaterThan(5);
    expect(gemmed).toBeGreaterThan(0);
  });

  it('always hands over a drop whose chance is 100%', () => {
    for (let seed = 0; seed < SEEDS; seed += 1) {
      const rewards = eventOf(fight(mighty({ marks: {} }, {}, seed), 's001').events, 'Rewards');
      expect(rewards.drops).toContain('i004');
      const first = streamRng(seed, 'reward', 0).next();
      expect(rewards.drops).toEqual(first < 0.5 ? ['i002', 'i004'] : ['i004']);
    }
  });

  it('draws the same reward rolls whatever the loadout does to the fight', () => {
    // Two heroes of the same Luck and Drop Bonus. The second carries a weapon, so the fight itself goes differently.
    const points = allPoints({ life: 300, damage: 30, defense: 30, dexterity: 30 });
    let fightsThatDiffer = 0;
    for (let seed = 0; seed < SEEDS; seed += 1) {
      const plain = game({ position: NEAR, pointsSpent: points, marks: {} }, {}, seed);
      const armed = game({ position: NEAR, pointsSpent: points, marks: {} }, { items: { i001: 1 }, loadouts: [loadoutOf({ weapon: 'i001' }), emptyLoadout()] }, seed);
      const first = fight(plain, 's002');
      const second = fight(armed, 's002');
      const firstBattle = eventOf(first.events, 'Battle');
      const secondBattle = eventOf(second.events, 'Battle');
      expect(firstBattle.win && secondBattle.win).toBe(true);
      if (canonicalJson(firstBattle.log) !== canonicalJson(secondBattle.log)) fightsThatDiffer += 1;
      const firstRewards = eventOf(first.events, 'Rewards');
      const secondRewards = eventOf(second.events, 'Rewards');
      expect(secondRewards.drops).toEqual(firstRewards.drops);
      expect(secondRewards.gems).toBe(firstRewards.gems);
      expect([secondRewards.xp, secondRewards.gold]).toEqual([firstRewards.xp, firstRewards.gold]);
    }
    expect(fightsThatDiffer).toBe(SEEDS);
  });

  it('stops a drop once the copy cap is reached, and no longer draws a roll for it (GDD 7.3)', () => {
    // i003 at its cap of 3: only i008 is rolled, then the gem.
    for (let seed = 0; seed < SEEDS; seed += 1) {
      const { state, events } = fight(mighty({ marks: {} }, { items: { i900: 1, i003: 3 } }, seed), 's002');
      const rolls = streamRng(seed, 'reward', 0);
      const expected = rolls.next() < 0.1 ? ['i008'] : [];
      const gems = rolls.next() < 0.08 ? 1 : 0;
      expect(eventOf(events, 'Rewards').drops).toEqual(expected);
      expect(eventOf(events, 'Rewards').gems).toBe(gems);
      expect(state.profile.items['i003']).toBe(3);
    }
    // Everything at its cap: the gem roll is the first number of the stream.
    for (let seed = 0; seed < SEEDS; seed += 1) {
      const { events } = fight(mighty({ marks: {} }, { items: { i900: 1, i003: 3, i008: 1 } }, seed), 's002');
      expect(eventOf(events, 'Rewards').drops).toEqual([]);
      expect(eventOf(events, 'Rewards').gems).toBe(streamRng(seed, 'reward', 0).next() < 0.08 ? 1 : 0);
    }
  });

  it('never takes an item past its copy cap over a run of wins', () => {
    let state = mighty({}, { items: { i900: 1, i003: 2 } });
    let drops = 0;
    for (let i = 0; i < 20; i += 1) {
      const result = fight(state, 's002');
      drops += eventOf(result.events, 'Rewards').drops.filter((item) => item === 'i003').length;
      state = result.state;
    }
    expect(drops).toBe(1);
    expect(state.profile.items['i003']).toBe(3);
    expect(state.profile.items['i008'] ?? 0).toBeLessThanOrEqual(1);
    expect(state.run.tallies.wins).toBe(20);
  });

  it('applies Drop Bonus, the Luck multiplier and the cap of 100% to each roll', () => {
    // Luck 1,400 against level 4 is the top of the Luck curve, ×5, and adds Drop Bonus too: i003's 25% becomes a certainty.
    const lucky = mighty({ pointsSpent: allPoints({ luck: 1400 }), marks: {} });
    const hero = deriveHero(lucky, world);
    expect(dropChance(25, enemy('e002'), hero, 0, B)).toBe(1);
    const second = dropChance(10, enemy('e002'), hero, 0, B);
    expect(second).toBeGreaterThan(0.7);
    for (let seed = 0; seed < 40; seed += 1) {
      const state = { ...lucky, run: { ...lucky.run, seed } };
      const rolls = streamRng(seed, 'reward', 0);
      rolls.next();
      const expected = rolls.next() < second ? ['i003', 'i008'] : ['i003'];
      expect(eventOf(fight(state, 's002').events, 'Rewards').drops).toEqual(expected);
    }
  });

  it('does not let Drop Bonus touch the gem roll (GDD 7.8)', () => {
    const lucky = mighty({ pointsSpent: allPoints({ luck: 100000 }), marks: {} }, { items: { i900: 1, i003: 3, i008: 1 } });
    let gems = 0;
    for (let seed = 0; seed < 200; seed += 1) {
      const got = eventOf(fight({ ...lucky, run: { ...lucky.run, seed } }, 's002').events, 'Rewards').gems;
      expect(got).toBe(streamRng(seed, 'reward', 0).next() < 0.08 ? 1 : 0);
      gems += got;
    }
    // 8% of 200 is 16.
    expect(gems).toBeGreaterThan(6);
    expect(gems).toBeLessThan(28);
  });
});

describe('Fight: bosses, payback and Claim (GDD 2.2, 2.3, 5.8, 7.8)', () => {
  it('pays an unclaimed boss’s cost back plus 2, and hands over its guaranteed drop', () => {
    const { state, events } = fight(mighty(), 's003');
    const rewards = eventOf(events, 'Rewards');
    // Level 10 boss against a level 1 hero: 352 XP × 3 = 1,056, which is level 15. Gold 10 × 4 × 3.
    expect(rewards).toMatchObject({ xp: 1056, levelAfter: 15, gold: 120, claimed: false, energyCost: 1, energyBack: 3, energyLeft: 22, drops: ['i005'], gems: 3 });
    expect(state.run).toMatchObject({ energySpent: 1, energyPaidBack: 3, bossesBeaten: ['e003'], strongestBeaten: 10 });
    expect(state.profile.claimedBosses).toEqual([]);
    expect(state.profile.items['i005']).toBe(1);
    expect(startingEnergy(state, B)).toBe(20);
    expect(remainingEnergy(state, world)).toBe(22);
  });

  it('lets a boss be fought once per run', () => {
    const beaten = fight(mighty(), 's003').state;
    expect(rejection(beaten, { type: 'Fight', spawn: 's003' })).toBe('boss-beaten');
    expect(fightBlock(beaten, 's003', world)).toBe('boss-beaten');
    // It is not back, and its tile is open.
    expect(walkable(beaten, world, 'z01', 4, 2, 'step')).toBe(true);
    expect(beaten.run.spawnCount).toBe(3);
  });

  it('pays the surplus again on a later run while the boss is unclaimed, but its gems on its first defeat ever only', () => {
    const first = fight(mighty(), 's003').state;
    const nextRun = apply(first, { type: 'NewRun', seed: 8 });
    const again = fight({ ...nextRun, run: { ...nextRun.run, position: NEAR } }, 's003');
    const rewards = eventOf(again.events, 'Rewards');
    expect(rewards).toMatchObject({ energyBack: 3, energyLeft: 22, gems: 0, claimed: false });
    // The tool is at its copy cap of 1, so it is not handed over twice.
    expect(rewards.drops).toEqual([]);
    expect(again.state.profile.gems).toBe(3);
    expect(again.state.profile.items['i005']).toBe(1);
    expect(again.state.profile.bestiary['e003']).toEqual({ timesBeaten: 2 });
  });

  it('gives a boss’s gems on a first win that follows losses', () => {
    const lost = fight(game({ position: NEAR }), 's003');
    expect(eventOf(lost.events, 'Battle').win).toBe(false);
    const geared: GameState = { ...lost.state, profile: { ...lost.state.profile, items: { i900: 1 }, loadouts: [loadoutOf({ legs: 'i900' }), emptyLoadout()] } };
    expect(eventOf(fight(geared, 's003').events, 'Rewards').gems).toBe(3);
  });

  it('gives 5 gems for a boss of Z5 to Z8', () => {
    const deeper: Content = deepFreeze({ ...world, zones: { ...world.zones, z01: { ...must(world.zones['z01'], 'zone'), balanceKey: 'Z5' } } });
    expect(eventOf(fight(mighty(), 's003', deeper).events, 'Rewards').gems).toBe(5);
  });

  it('never rolls a mark for a boss and never drops a gem by chance from one', () => {
    for (let seed = 0; seed < 60; seed += 1) {
      const state = mighty({}, { items: { i900: 1 }, bestiary: { e003: { timesBeaten: 1 } } }, seed);
      expect(state.run.marks['s003']).toBeUndefined();
      const result = fight(state, 's003');
      expect(eventOf(result.events, 'Rewards').gems).toBe(0);
      expect(result.state.run.spawnCount).toBe(state.run.spawnCount);
      expect(result.state.run.marks['s003']).toBeUndefined();
    }
  });

  const withTool = (run: Partial<GameState['run']> = {}, profile: Partial<GameState['profile']> = {}): GameState =>
    mighty(run, { items: { i900: 1, i005: 1 }, loadouts: [loadoutOf({ legs: 'i900', weapon: 'i005' }), loadoutOf({ legs: 'i900' })], ...profile });

  it('claims a boss beaten with the tool equipped: starting energy +3 at once, no surplus on that win', () => {
    const before = withTool();
    expect(deriveHero(before, world)).toMatchObject({ claim: true, damage: 101 });
    expect(startingEnergy(before, B)).toBe(20);
    const { state, events } = fight(before, 's003');
    expect(eventOf(events, 'Battle').win).toBe(true);
    // Charged 1, refunded 1, and the 3 from the Claim counts for this run: 20 + 3 − 1 + 1.
    expect(eventOf(events, 'Rewards')).toMatchObject({ claimed: true, energyCost: 1, energyBack: 1, energyLeft: 23 });
    expect(state.profile.claimedBosses).toEqual(['e003']);
    expect(startingEnergy(state, B)).toBe(23);
    expect(state.run).toMatchObject({ energySpent: 1, energyPaidBack: 1 });
    expect(remainingEnergy(state, world)).toBe(23);
    expect(state.run.tallies.claims).toBe(1);
  });

  it('refunds only the cost of a claimed boss from then on, tool or no tool', () => {
    const claimed = fight(withTool(), 's003').state;
    for (const activeLoadout of [0, 1]) {
      const nextRun = apply(claimed, { type: 'NewRun', seed: 9 }, { type: 'SwitchLoadout', index: activeLoadout });
      expect(remainingEnergy(nextRun, world)).toBe(23);
      const again = fight({ ...nextRun, run: { ...nextRun.run, position: NEAR } }, 's003');
      expect(eventOf(again.events, 'Rewards')).toMatchObject({ claimed: false, energyCost: 1, energyBack: 1, energyLeft: 23 });
      // Each boss can be claimed once, ever.
      expect(again.state.profile.claimedBosses).toEqual(['e003']);
      expect(again.state.run.tallies.claims).toBe(0);
    }
  });

  it('claims on a later run a boss first beaten without the tool', () => {
    const first = fight(mighty({}, { items: { i900: 1 }, loadouts: [loadoutOf({ legs: 'i900' }), loadoutOf({ legs: 'i900' })] }), 's003').state;
    expect(first.profile.items['i005']).toBe(1);
    const nextRun = apply(first, { type: 'NewRun', seed: 9 }, { type: 'Equip', loadout: 0, slot: 'weapon', item: 'i005' });
    const again = fight({ ...nextRun, run: { ...nextRun.run, position: NEAR } }, 's003');
    expect(eventOf(again.events, 'Rewards')).toMatchObject({ claimed: true, energyBack: 1, energyLeft: 23, gems: 0 });
  });

  it('does not claim with the tool owned but sitting in the other loadout', () => {
    const before = withTool({}, { activeLoadout: 1 });
    expect(deriveHero(before, world).claim).toBe(false);
    const { state, events } = fight(before, 's003');
    expect(eventOf(events, 'Rewards')).toMatchObject({ claimed: false, energyBack: 3 });
    expect(state.profile.claimedBosses).toEqual([]);
  });

  it('claims nothing from a normal enemy', () => {
    const { state, events } = fight(withTool(), 's001');
    expect(eventOf(events, 'Rewards')).toMatchObject({ claimed: false, energyBack: 0, energyLeft: 19 });
    expect(state.profile.claimedBosses).toEqual([]);
  });

  it('charges and refunds the zone’s cost where a fight costs 2', () => {
    const costly: Content = deepFreeze({ ...world, zones: { ...world.zones, z01: { ...must(world.zones['z01'], 'zone'), balanceKey: 'Z7' } } });
    const normal = fight(mighty(), 's002', costly);
    expect(eventOf(normal.events, 'Rewards')).toMatchObject({ energyCost: 2, energyBack: 0, energyLeft: 18 });
    const boss = fight(mighty(), 's003', costly);
    expect(eventOf(boss.events, 'Rewards')).toMatchObject({ energyCost: 2, energyBack: 4, energyLeft: 22 });
    const claim = fight(withTool(), 's003', costly);
    expect(eventOf(claim.events, 'Rewards')).toMatchObject({ claimed: true, energyCost: 2, energyBack: 2, energyLeft: 23 });
    // 1 energy left does not cover a cost of 2.
    expect(rejection(mighty({ energySpent: 19 }), { type: 'Fight', spawn: 's002' }, costly)).toBe('no-energy');
    expect(rejection(mighty({ energySpent: 18 }), { type: 'Fight', spawn: 's002' }, costly)).toBeNull();
  });
});

describe('Fight: a loss (GDD 2.2, 3.4)', () => {
  // A new hero with no gear cannot beat the level 10 boss.
  const weak = (run: Partial<GameState['run']> = {}, profile: Partial<GameState['profile']> = {}): GameState => game({ position: NEAR, ...run }, profile);

  it('charges nothing, loses nothing, and marks the enemy seen', () => {
    const before = weak({ gold: 55, xp: 12 }, { items: { i003: 1 }, gems: 4 });
    const { state, events } = fight(before, 's003');
    expect(types(events)).toEqual(['Battle']);
    const battle = eventOf(events, 'Battle');
    expect(battle.win).toBe(false);
    // What the loss summary is built from (GDD 3.5).
    expect(battle.enemyMaxLife).toBe(480);
    expect(battle.enemyLifeLeft).toBeGreaterThan(0);
    expect(battle.hitsTaken).toBeGreaterThanOrEqual(2);

    expect(state.profile).toEqual({ ...before.profile, bestiary: { e003: { timesBeaten: 0 } } });
    expect(state.run).toEqual({ ...before.run, battleCount: 1, lastEnemy: 'e003', tallies: { ...before.run.tallies, losses: 1 } });
    expect(remainingEnergy(state, world)).toBe(20);
  });

  it('leaves the count of earlier wins alone', () => {
    const { state } = fight(weak({}, { bestiary: { e003: { timesBeaten: 2 } } }), 's003');
    expect(state.profile.bestiary['e003']).toEqual({ timesBeaten: 2 });
  });

  it('advances the battle counter, so a retry is a new battle (GDD 3.3)', () => {
    const first = fight(weak(), 's003');
    const second = fight(first.state, 's003');
    expect(second.state.run.battleCount).toBe(2);
    expect(second.state.run.tallies.losses).toBe(2);
    const hero = deriveHero(weak(), world);
    expect(eventOf(first.events, 'Battle').log).toEqual(resolveBattle(hero, combatantOf(enemy('e003')), streamRng(7, 'battle', 0), B, { log: true }).log);
    expect(eventOf(second.events, 'Battle').log).toEqual(resolveBattle(hero, combatantOf(enemy('e003')), streamRng(7, 'battle', 1), B, { log: true }).log);
  });

  it('does not count a boss as beaten, so it can be fought again and still blocks the way', () => {
    const { state } = fight(weak(), 's003');
    expect(state.run.bossesBeaten).toEqual([]);
    expect(fightBlock(state, 's003', world)).toBeNull();
    expect(walkable(state, world, 'z01', 4, 2, 'step')).toBe(false);
  });

  it('costs no energy however often the hero loses', () => {
    let state = weak();
    for (let i = 0; i < 30; i += 1) state = fight(state, 's003').state;
    expect(state.run.tallies).toMatchObject({ wins: 0, losses: 30 });
    expect(state.run.energySpent).toBe(0);
    expect(remainingEnergy(state, world)).toBe(20);
  });
});

describe('Fight: a loss when the balance table charges losses (GDD 2.2, DV-10)', () => {
  const charging: Content = deepFreeze({ ...world, balance: { ...B, energy: { ...B.energy, chargeLosses: true } } });
  const weak = (run: Partial<GameState['run']> = {}): GameState => game({ position: NEAR, ...run });

  it('is off in the sample balance, which holds the GDD’s starting values', () => {
    expect(B.energy.chargeLosses).toBe(false);
  });

  it('charges the fight’s cost, pays nothing back, and changes nothing else a free loss would not', () => {
    const before = weak({ gold: 55, xp: 12 });
    const free = fight(before, 's003');
    const { state, events } = fight(before, 's003', charging);
    expect(types(events)).toEqual(['Battle']);
    expect(events).toEqual(free.events);
    expect(state.profile).toEqual(free.state.profile);
    expect(state.run).toEqual({ ...free.state.run, energySpent: 1 });
    expect(state.run.energyPaidBack).toBe(0);
    expect(remainingEnergy(state, charging)).toBe(19);
  });

  it('charges a retry again, and stops at an empty tank without going below it', () => {
    let state = weak();
    for (let i = 0; i < 20; i += 1) state = fight(state, 's003', charging).state;
    expect(state.run.tallies).toMatchObject({ wins: 0, losses: 20 });
    expect(state.run.energySpent).toBe(20);
    expect(remainingEnergy(state, charging)).toBe(0);
    expect(rejection(state, { type: 'Fight', spawn: 's003' }, charging)).toBe('no-energy');
    expect(fightBlock(state, 's003', charging)).toBe('no-energy');
  });

  it('charges the zone’s cost where a fight costs 2', () => {
    const costly: Content = deepFreeze({ ...charging, zones: { ...charging.zones, z01: { ...must(charging.zones['z01'], 'zone'), balanceKey: 'Z7' } } });
    const { state } = fight(weak(), 's003', costly);
    expect(state.run.energySpent).toBe(2);
    expect(remainingEnergy(state, costly)).toBe(18);
    expect(rejection(weak({ energySpent: 19 }), { type: 'Fight', spawn: 's003' }, costly)).toBe('no-energy');
  });

  it('leaves a win exactly as it is with the switch off', () => {
    const normal = fight(mighty(), 's001');
    expect(fight(mighty(), 's001', charging)).toEqual(normal);
    const boss = fight(mighty(), 's003');
    expect(fight(mighty(), 's003', charging)).toEqual(boss);
    expect(eventOf(boss.events, 'Rewards')).toMatchObject({ energyCost: 1, energyBack: 3, energyLeft: 22 });
  });
});

describe('Fight: when it cannot start (GDD 2.2)', () => {
  it('rejects a spawn that does not exist', () => {
    expect(rejection(mighty(), { type: 'Fight', spawn: 's999' })).toBe('unknown-spawn');
    expect(rejection(mighty(), { type: 'Fight', spawn: '' })).toBe('unknown-spawn');
    expect(rejection(mighty(), { type: 'Fight', spawn: 'e001' })).toBe('unknown-spawn');
    expect(fightBlock(mighty(), 's999', world)).toBe('unknown-spawn');
  });

  it('rejects an enemy the hero is not standing beside', () => {
    expect(rejection(mighty({ position: START }), { type: 'Fight', spawn: 's001' })).toBe('not-adjacent');
    expect(rejection(mighty({ position: NEAR }), { type: 'Fight', spawn: 's004' })).toBe('not-adjacent');
    // Same coordinates as beside s004, wrong zone.
    expect(rejection(mighty({ position: at(1, 1) }), { type: 'Fight', spawn: 's004' })).toBe('not-adjacent');
    expect(rejection(mighty({ position: IN_Z2 }), { type: 'Fight', spawn: 's004' })).toBeNull();
    expect(rejection(mighty({ position: at(2, 4) }), { type: 'Fight', spawn: 's001' })).toBeNull();
  });

  it('rejects a fight whose cost is more than the energy left', () => {
    expect(rejection(mighty({ energySpent: 19 }), { type: 'Fight', spawn: 's001' })).toBeNull();
    expect(rejection(mighty({ energySpent: 20 }), { type: 'Fight', spawn: 's001' })).toBe('no-energy');
    expect(rejection(mighty({ energySpent: 20, energyPaidBack: 1 }), { type: 'Fight', spawn: 's001' })).toBeNull();
    expect(fightBlock(mighty({ energySpent: 20 }), 's001', world)).toBe('no-energy');
    // A boss needs its cost up front too, though it pays it back.
    expect(rejection(mighty({ energySpent: 20 }), { type: 'Fight', spawn: 's003' })).toBe('no-energy');
  });

  it('spends exactly the starting energy over a run of wins, then stops', () => {
    let state = mighty();
    let wins = 0;
    // Bounded, so a reducer that never ran out of energy would fail here instead of running for ever.
    while (wins < 100 && fightBlock(state, 's001', world) === null) {
      state = fight(state, 's001').state;
      wins += 1;
    }
    expect(wins).toBe(20);
    expect(remainingEnergy(state, world)).toBe(0);
    expect(rejection(state, { type: 'Fight', spawn: 's001' })).toBe('no-energy');
  });

  it('counts an energy accessory only while it is worn (GDD 2.2)', () => {
    // Out of energy, with the +2 accessory i006 owned but not worn.
    const spent = mighty({ energySpent: 20 }, { items: { i900: 1, i006: 1 } });
    expect(rejection(spent, { type: 'Fight', spawn: 's001' })).toBe('no-energy');
    const wearing = apply(spent, { type: 'Equip', loadout: 0, slot: 'acc1', item: 'i006' });
    expect(remainingEnergy(wearing, world)).toBe(2);
    const fought = apply(wearing, { type: 'Fight', spawn: 's001' }, { type: 'Fight', spawn: 's001' });
    expect(remainingEnergy(fought, world)).toBe(0);
    expect(rejection(fought, { type: 'Fight', spawn: 's001' })).toBe('no-energy');
    // Taking it off lowers remaining energy at once: 20 − 22 shows as 0.
    const off = apply(fought, { type: 'Equip', loadout: 0, slot: 'acc1', item: null });
    expect(remainingEnergy(off, world)).toBe(0);
    expect(off.run.energySpent).toBe(22);
  });

  it('rejects a fight once the battle counter is at the largest exact whole number', () => {
    expect(rejection(mighty({ battleCount: Number.MAX_SAFE_INTEGER }), { type: 'Fight', spawn: 's001' })).toBe('count-limit');
  });

  it('says through fightBlock exactly what step would reject, and null for a fight that can start', () => {
    const cases: Array<[GameState, string]> = [
      [mighty(), 's001'],
      [mighty(), 's003'],
      [mighty({ position: START }), 's001'],
      [mighty({ energySpent: 20 }), 's002'],
      [mighty({ bossesBeaten: ['e003'] }), 's003'],
      [mighty(), 's404'],
    ];
    for (const [state, spawn] of cases) expect(fightBlock(state, spawn, world)).toBe(rejection(state, { type: 'Fight', spawn }));
    expect(fightBlock(mighty(), 's001', world)).toBeNull();
  });

  it('leaves the state untouched when it rejects', () => {
    const state = mighty({ energySpent: 20 });
    const before = canonicalJson(state);
    expect(rejection(state, { type: 'Fight', spawn: 's001' })).toBe('no-energy');
    expect(canonicalJson(state)).toBe(before);
  });
});

describe('marked enemies (GDD 5.5)', () => {
  it('rolls a mark for each normal enemy when the run starts, in spawn order, and none for a boss', () => {
    for (let seed = 0; seed < 300; seed += 1) {
      const run = newGame(seed, world).run;
      const expected: Record<string, Mark> = {};
      // s003 is the boss: it takes no roll, so s004 has the third.
      for (const [index, spawn] of ['s001', 's002', 's004'].entries()) {
        const mark = rollMark(seed, index, B);
        if (mark !== null) expected[spawn] = mark;
      }
      expect(run.marks).toEqual(expected);
      expect(run.spawnCount).toBe(3);
    }
  });

  it('marks about 8% of enemies, with XP, drops and gold in a 45 : 29 : 26 split and +100% and +200% evenly', () => {
    const total = 40000;
    let marked = 0;
    const seen = { xp: 0, drops: 0, gold: 0 };
    let single = 0;
    for (let counter = 0; counter < total; counter += 1) {
      const mark = rollMark(12345, counter, B);
      if (mark === null) continue;
      marked += 1;
      seen[mark.stat] += 1;
      expect([100, 200]).toContain(mark.percent);
      if (mark.percent === 100) single += 1;
    }
    expect(Math.abs(marked / total - 0.08)).toBeLessThan(0.01);
    expect(Math.abs(seen.xp / marked - 0.45)).toBeLessThan(0.03);
    expect(Math.abs(seen.drops / marked - 0.29)).toBeLessThan(0.03);
    expect(Math.abs(seen.gold / marked - 0.26)).toBeLessThan(0.03);
    expect(Math.abs(single / marked - 0.5)).toBeLessThan(0.03);
  });

  it('gives the same mark for the same seed and counter', () => {
    for (let counter = 0; counter < 200; counter += 1) expect(rollMark(99, counter, B)).toEqual(rollMark(99, counter, B));
  });

  it('pays the mark’s bonus on the win and uses the mark up', () => {
    // Seed 39 starts with s001 marked for +200% gold. Its next roll, the fourth of the run, marks nothing.
    const before = mighty({}, {}, 39);
    expect(before.run.marks).toEqual({ s001: { stat: 'gold', percent: 200 } });
    expect(rollMark(39, 3, B)).toBeNull();
    const { state, events } = fight(before, 's001');
    const rewards = eventOf(events, 'Rewards');
    // e001 carries 8 gold and 21 XP; a level 1 hero has a ratio of 2 to it, so 35 XP.
    expect(rewards).toMatchObject({ gold: 24, xp: 35, mark: { stat: 'gold', percent: 200 } });
    expect(state.run.marks).toEqual({});
    expect(state.run.spawnCount).toBe(4);
    // The next win there is plain.
    expect(eventOf(fight(state, 's001').events, 'Rewards')).toMatchObject({ gold: 8, mark: null });
  });

  it('rolls the mark again each time the enemy respawns', () => {
    // On seed 7 nothing is marked at the start and the fourth roll of the run is +100% gold.
    const before = mighty();
    expect(before.run.marks).toEqual({});
    expect(rollMark(7, 3, B)).toEqual({ stat: 'gold', percent: 100 });
    const first = fight(before, 's002').state;
    expect(first.run.marks).toEqual({ s002: { stat: 'gold', percent: 100 } });
    expect(first.run.spawnCount).toBe(4);
    const second = fight(first, 's002');
    expect(eventOf(second.events, 'Rewards')).toMatchObject({ gold: 32, mark: { stat: 'gold', percent: 100 } });
    expect(second.state.run.spawnCount).toBe(5);

    // Every respawn takes the next roll of the spawn stream, whichever enemy it is.
    let state = mighty({}, {}, 123);
    for (let i = 0; i < 12; i += 1) {
      const spawn = i % 2 === 0 ? 's001' : 's002';
      const counter = state.run.spawnCount;
      const others = Object.fromEntries(Object.entries(state.run.marks).filter(([id]) => id !== spawn));
      state = fight(state, spawn).state;
      const rolled = rollMark(123, counter, B);
      expect(state.run.marks).toEqual(rolled === null ? others : { ...others, [spawn]: rolled });
      expect(state.run.spawnCount).toBe(counter + 1);
    }
  });

  it('doubles or triples XP for an XP mark and leaves gold alone', () => {
    const plain = eventOf(fight(mighty({ marks: {} }), 's002').events, 'Rewards');
    const doubled = eventOf(fight(mighty({ marks: { s002: { stat: 'xp', percent: 100 } } }), 's002').events, 'Rewards');
    const tripled = eventOf(fight(mighty({ marks: { s002: { stat: 'xp', percent: 200 } } }), 's002').events, 'Rewards');
    expect([plain.xp, doubled.xp, tripled.xp]).toEqual([114, 228, 342]);
    expect([plain.gold, doubled.gold, tripled.gold]).toEqual([16, 16, 16]);
  });

  it('multiplies each drop chance for a drops mark, and neither XP nor gold nor gems', () => {
    for (let seed = 0; seed < 80; seed += 1) {
      const state = mighty({ marks: { s002: { stat: 'drops', percent: 200 } } }, {}, seed);
      const rewards = eventOf(fight(state, 's002').events, 'Rewards');
      // 25% and 10%, each times 3.
      const rolls = streamRng(seed, 'reward', 0);
      const expected: string[] = [];
      if (rolls.next() < 0.75) expected.push('i003');
      if (rolls.next() < 0.3) expected.push('i008');
      expect(rewards.drops).toEqual(expected);
      expect(rewards.gems).toBe(rolls.next() < 0.08 ? 1 : 0);
      expect([rewards.xp, rewards.gold]).toEqual([114, 16]);
    }
  });

  it('applies a mark only to the enemy that carries it', () => {
    const state = mighty({ marks: { s001: { stat: 'gold', percent: 200 } } });
    const rewards = eventOf(fight(state, 's002').events, 'Rewards');
    expect(rewards).toMatchObject({ gold: 16, mark: null });
  });

  it('is not cleared by a loss', () => {
    // A new hero cannot beat the level 50 enemy at s004.
    const mark: Mark = { stat: 'xp', percent: 200 };
    const before = game({ position: IN_Z2, marks: { s004: mark, s001: { stat: 'gold', percent: 100 } } });
    const { state, events } = fight(before, 's004');
    expect(eventOf(events, 'Battle').win).toBe(false);
    expect(state.run.marks).toEqual(before.run.marks);
    expect(state.run.spawnCount).toBe(before.run.spawnCount);
    const again = fight(state, 's004').state;
    expect(again.run.marks).toEqual(before.run.marks);
  });

  it('keeps the other enemies’ marks through a win', () => {
    const state = mighty({ marks: { s001: { stat: 'gold', percent: 200 }, s004: { stat: 'xp', percent: 100 } } }, {}, 39);
    const after = fight(state, 's001').state;
    expect(after.run.marks).toEqual({ s004: { stat: 'xp', percent: 100 } });
  });
});

describe('Step (GDD 7.7, 8.3)', () => {
  const move = (dx: number, dy: number): Action => ({ type: 'Step', dx, dy });

  it('moves one tile and reports where to', () => {
    const { state, events } = accept(game(), move(0, -1));
    expect(state.run.position).toEqual(at(2, 4));
    expect(events).toEqual([{ type: 'Moved', to: at(2, 4) }]);
    expect(apply(game(), move(-1, -1)).run.position).toEqual(at(1, 4));
    expect(apply(game(), move(1, 1)).run.position).toEqual(at(3, 6));
  });

  it('changes nothing but the position, and costs no energy', () => {
    const before = game({ gold: 5, battleCount: 3 });
    const after = apply(before, move(0, -1), move(0, -1), move(-1, 0));
    expect(after.profile).toEqual(before.profile);
    expect(after.run).toEqual({ ...before.run, position: at(1, 3) });
    expect(remainingEnergy(after, world)).toBe(20);
  });

  it('is still allowed with no energy left', () => {
    expect(apply(game({ energySpent: 20 }), move(0, -1)).run.position).toEqual(at(2, 4));
  });

  it('rejects a step into a wall, onto an enemy, or past an enemy’s corner', () => {
    expect(rejection(game({ position: at(1, 1) }), move(-1, 0))).toBe('blocked');
    expect(rejection(game({ position: at(1, 1) }), move(0, -1))).toBe('blocked');
    expect(rejection(game({ position: at(2, 3) }), move(1, 0))).toBe('blocked');
    expect(rejection(game({ position: at(2, 3) }), move(1, -1))).toBe('blocked');
    expect(rejection(game({ position: at(3, 4) }), move(1, 1))).toBe('blocked');
  });

  it('rejects anything that is not one tile in one of eight directions', () => {
    for (const [dx, dy] of [
      [0, 0],
      [2, 0],
      [0, -2],
      [0.5, 0],
      [0, 0.5],
      [Number.NaN, 0],
      [1, Number.POSITIVE_INFINITY],
    ]) {
      expect(rejection(game(), move(dx ?? 0, dy ?? 0))).toBe('blocked');
    }
  });

  it('is blocked by the gate boss until it is beaten this run, and by nothing after', () => {
    const before = mighty();
    expect(rejection(before, move(1, 0))).toBe('blocked');
    const beaten = fight(before, 's003').state;
    const through = apply(beaten, move(1, 0), move(1, 0));
    expect(through.run.position).toEqual(at(5, 2));
    // A new run puts the gate back (GDD 2.2).
    const nextRun = apply(through, { type: 'NewRun', seed: 3 });
    expect(rejection({ ...nextRun, run: { ...nextRun.run, position: NEAR } }, move(1, 0))).toBe('blocked');
  });

  it('carries the hero through an exit into the next zone', () => {
    const beaten = mighty({ bossesBeaten: ['e003'], position: at(6, 2) });
    const { state, events } = accept(beaten, move(1, 0));
    expect(state.run.position).toEqual(IN_Z2);
    expect(events).toEqual([
      { type: 'Moved', to: IN_Z2 },
      { type: 'ZoneEntered', zone: 'z02' },
    ]);
    // And back: z02's exit at (3,2) leads to (6,2) in z01.
    const back = accept({ ...state, run: { ...state.run, position: at(2, 2, 'z02') } }, move(1, 0));
    expect(back.state.run.position).toEqual(at(6, 2));
    expect(types(back.events)).toEqual(['Moved', 'ZoneEntered']);
  });

  it('opens the door for a hero holding the key, and not otherwise', () => {
    expect(rejection(game({ position: at(1, 6) }), move(0, 1))).toBe('blocked');
    const holder = game({ position: at(1, 6) }, { items: { i004: 1 } });
    expect(apply(holder, move(0, 1), move(0, 1)).run.position).toEqual(at(1, 8));
  });

  it('finds a hidden tile by stepping onto it, once, and remembers it', () => {
    const beside = game({ position: at(3, 5) });
    expect(findPath(beside, world, at(3, 5), { x: 5, y: 5 })).toBeNull();
    const { state, events } = accept(beside, move(1, 0));
    expect(state.run.position).toEqual(at(4, 5));
    expect(events).toEqual([
      { type: 'Moved', to: at(4, 5) },
      { type: 'SecretFound', secret: 'x01' },
    ]);
    expect(state.profile.secretsFound).toEqual(['x01']);
    // Now a tapped route may use it.
    expect(findPath(state, world, at(3, 5), { x: 5, y: 5 })).not.toBeNull();
    // Stepping off and on again finds nothing new.
    const off = accept(state, move(-1, 0));
    const on = accept(off.state, move(1, 0));
    expect(types(on.events)).toEqual(['Moved']);
    expect(on.state.profile.secretsFound).toEqual(['x01']);
  });

  it('walks a tapped route as a list of single steps', () => {
    let state = mighty({ bossesBeaten: ['e003'], position: START });
    const route = must(findPath(state, world, START, { x: 6, y: 2 }), 'route');
    for (const tile of route) state = apply(state, move(tile.x - state.run.position.x, tile.y - state.run.position.y));
    expect(state.run.position).toEqual(at(6, 2));
    expect(route).toHaveLength(7);
  });
});

describe('Allocate (GDD 2.2, 4.1)', () => {
  // Level 10: 45 points earned.
  const leveled = (run: Partial<GameState['run']> = {}): GameState => game({ xp: 450, ...run });
  const spend = (points: Partial<StatPoints>): Action => ({ type: 'Allocate', points: allPoints(points) });

  it('spends points and raises the stats they buy', () => {
    const { state, events } = accept(leveled(), spend({ life: 10, damage: 20, defense: 5, dexterity: 5, luck: 5 }));
    expect(state.run.pointsSpent).toEqual({ life: 10, damage: 20, defense: 5, dexterity: 5, luck: 5 });
    expect(events).toEqual([{ type: 'Allocated', points: { life: 10, damage: 20, defense: 5, dexterity: 5, luck: 5 } }]);
    expect(unspentPoints(state, B)).toBe(0);
    const hero = deriveHero(state, world);
    expect([hero.life, hero.damage, hero.defense, hero.dexterity, hero.luck]).toEqual([90, 30, 10, 5, 5]);
  });

  it('adds to what was spent before', () => {
    const state = apply(leveled(), spend({ life: 1 }), spend({ life: 2, luck: 3 }), spend({ damage: 4 }));
    expect(state.run.pointsSpent).toEqual({ life: 3, damage: 4, defense: 0, dexterity: 0, luck: 3 });
    expect(unspentPoints(state, B)).toBe(35);
  });

  it('rejects spending more than is unspent', () => {
    expect(rejection(leveled(), spend({ damage: 46 }))).toBe('bad-points');
    expect(rejection(leveled(), spend({ life: 20, damage: 20, luck: 6 }))).toBe('bad-points');
    expect(rejection(leveled(), spend({ damage: 45 }))).toBeNull();
    expect(rejection(leveled({ pointsSpent: allPoints({ life: 45 }) }), spend({ damage: 1 }))).toBe('bad-points');
    expect(rejection(game(), spend({ damage: 1 }))).toBe('bad-points');
  });

  it('counts Growth points as points to spend', () => {
    expect(rejection(leveled({ growthPointsEarned: 3 }), spend({ damage: 48 }))).toBeNull();
    expect(rejection(leveled({ growthPointsEarned: 3 }), spend({ damage: 49 }))).toBe('bad-points');
  });

  it('cannot be taken back: nothing negative, fractional or empty is accepted', () => {
    const spent = leveled({ pointsSpent: allPoints({ life: 10 }) });
    expect(rejection(spent, spend({ life: -1 }))).toBe('bad-points');
    expect(rejection(spent, spend({ life: -5, damage: 5 }))).toBe('bad-points');
    expect(rejection(spent, spend({ damage: 0.5 }))).toBe('bad-points');
    expect(rejection(spent, spend({ damage: Number.NaN }))).toBe('bad-points');
    expect(rejection(spent, spend({ damage: Number.POSITIVE_INFINITY }))).toBe('bad-points');
    expect(rejection(spent, spend({}))).toBe('bad-points');
  });

  it('rejects a points object that is missing, or missing a stat', () => {
    expect(rejection(leveled(), { type: 'Allocate' } as unknown as Action)).toBe('bad-points');
    expect(rejection(leveled(), { type: 'Allocate', points: null } as unknown as Action)).toBe('bad-points');
    expect(rejection(leveled(), { type: 'Allocate', points: 5 } as unknown as Action)).toBe('bad-points');
    expect(rejection(leveled(), { type: 'Allocate', points: { life: 1 } } as unknown as Action)).toBe('bad-points');
    expect(rejection(leveled(), { type: 'Allocate', points: { life: '1', damage: 0, defense: 0, dexterity: 0, luck: 0 } } as unknown as Action)).toBe('bad-points');
  });

  it('spends the points a win has just given', () => {
    const won = fight(mighty(), 's002').state;
    const state = apply(won, spend({ damage: 20 }));
    expect(deriveHero(state, world).damage).toBe(1030);
    expect(rejection(state, spend({ damage: 1 }))).toBe('bad-points');
  });
});

describe('Equip, SwitchLoadout and RenameLoadout (GDD 7.1)', () => {
  const owner = (items: Record<string, number>, profile: Partial<GameState['profile']> = {}): GameState => game({}, { items, ...profile });
  const equip = (slot: SlotId, item: ItemId | null, loadout = 0): Action => ({ type: 'Equip', loadout, slot, item });

  it('puts an owned item in the slot of its kind', () => {
    const { state, events } = accept(owner({ i001: 1, i002: 1 }), equip('weapon', 'i001'));
    expect(state.profile.loadouts[0]?.slots.weapon).toBe('i001');
    expect(events).toEqual([{ type: 'Equipped', loadout: 0, slot: 'weapon', item: 'i001' }]);
    const both = apply(state, equip('body', 'i002'));
    const hero = deriveHero(both, world);
    expect([hero.damage, hero.defense, hero.life]).toEqual([20, 10, 80]);
  });

  it('takes an item off again', () => {
    const state = apply(owner({ i001: 1 }), equip('weapon', 'i001'), equip('weapon', null));
    expect(state.profile.loadouts[0]?.slots.weapon).toBeNull();
    expect(deriveHero(state, world).damage).toBe(10);
  });

  it('rejects an item that is not owned, does not exist, or does not fit the slot', () => {
    expect(rejection(owner({}), equip('weapon', 'i001'))).toBe('not-owned');
    expect(rejection(owner({ i001: 0 }), equip('weapon', 'i001'))).toBe('not-owned');
    expect(rejection(owner({}), equip('weapon', 'i999'))).toBe('unknown-item');
    expect(rejection(owner({ i001: 1 }), equip('head', 'i001'))).toBe('wrong-slot');
    expect(rejection(owner({ i002: 1 }), equip('weapon', 'i002'))).toBe('wrong-slot');
    expect(rejection(owner({ i003: 1 }), equip('weapon', 'i003'))).toBe('wrong-slot');
    expect(rejection(owner({ i008: 1 }), equip('acc1', 'i008'))).toBe('wrong-slot');
    expect(rejection(owner({ i001: 1 }), { type: 'Equip', loadout: 0, slot: 'pocket', item: 'i001' } as unknown as Action)).toBe('wrong-slot');
  });

  it('never lets a key be worn', () => {
    for (const slot of ['weapon', 'head', 'acc1', 'acc5'] as const) expect(rejection(owner({ i004: 1 }), equip(slot, 'i004'))).toBe('wrong-slot');
  });

  it('lets an accessory go in any of the five accessory slots', () => {
    for (const slot of ['acc1', 'acc2', 'acc3', 'acc4', 'acc5'] as const) {
      expect(apply(owner({ i003: 1 }), equip(slot, 'i003')).profile.loadouts[0]?.slots[slot]).toBe('i003');
    }
  });

  it('lets every owned copy be worn at once, and no more than are owned', () => {
    const two = apply(owner({ i003: 2 }), equip('acc1', 'i003'), equip('acc2', 'i003'));
    expect(deriveHero(two, world).dexterity).toBe(10);
    expect(rejection(two, equip('acc3', 'i003'))).toBe('not-owned');
    const three = apply(owner({ i003: 3 }), equip('acc1', 'i003'), equip('acc2', 'i003'), equip('acc5', 'i003'));
    expect(deriveHero(three, world).dexterity).toBe(15);
    // Putting a copy in a slot that already holds one changes nothing and needs no further copy.
    expect(rejection(two, equip('acc2', 'i003'))).toBeNull();
  });

  it('lets the same item sit in more than one loadout', () => {
    const state = apply(owner({ i001: 1 }), equip('weapon', 'i001', 0), equip('weapon', 'i001', 1));
    expect(state.profile.loadouts.map((loadout) => loadout.slots.weapon)).toEqual(['i001', 'i001']);
  });

  it('rejects a loadout that does not exist', () => {
    for (const loadout of [2, -1, 0.5, Number.NaN]) expect(rejection(owner({ i001: 1 }), equip('weapon', 'i001', loadout))).toBe('bad-loadout');
    expect(rejection(owner({ i001: 1 }), { type: 'Equip', loadout: '0', slot: 'weapon', item: 'i001' } as unknown as Action)).toBe('bad-loadout');
  });

  it('changes the hero only when the loadout that changed is the active one', () => {
    const state = apply(owner({ i001: 1 }), equip('weapon', 'i001', 1));
    expect(deriveHero(state, world).damage).toBe(10);
    const { state: switched, events } = accept(state, { type: 'SwitchLoadout', index: 1 });
    expect(events).toEqual([{ type: 'LoadoutSwitched', index: 1 }]);
    expect(switched.profile.activeLoadout).toBe(1);
    expect(deriveHero(switched, world).damage).toBe(20);
  });

  it('moves remaining energy with the loadout that carries the energy accessory', () => {
    const state = apply(owner({ i006: 1 }), equip('acc1', 'i006', 1));
    expect(remainingEnergy(state, world)).toBe(20);
    const switched = apply(state, { type: 'SwitchLoadout', index: 1 });
    expect(remainingEnergy(switched, world)).toBe(22);
    expect(remainingEnergy(apply(switched, { type: 'SwitchLoadout', index: 0 }), world)).toBe(20);
  });

  it('rejects a switch to a loadout that does not exist', () => {
    for (const index of [2, 5, -1, 0.5, Number.NaN]) expect(rejection(game(), { type: 'SwitchLoadout', index })).toBe('bad-loadout');
  });

  it('renames a loadout, up to 16 characters', () => {
    const { state, events } = accept(game(), { type: 'RenameLoadout', index: 1, name: 'Climb' });
    expect(state.profile.loadouts.map((loadout) => loadout.name)).toEqual(['', 'Climb']);
    expect(events).toEqual([{ type: 'LoadoutRenamed', index: 1 }]);
    expect(rejection(game(), { type: 'RenameLoadout', index: 0, name: 'x'.repeat(16) })).toBeNull();
    expect(rejection(game(), { type: 'RenameLoadout', index: 0, name: 'x'.repeat(17) })).toBe('bad-name');
    expect(rejection(game(), { type: 'RenameLoadout', index: 0, name: '' })).toBeNull();
    expect(rejection(game(), { type: 'RenameLoadout', index: 2, name: 'a' })).toBe('bad-loadout');
    expect(rejection(game(), { type: 'RenameLoadout', index: 0, name: 7 } as unknown as Action)).toBe('bad-name');
  });
});

describe('Buy and BuyLoadoutSlot (GDD 5.7, 7.3)', () => {
  it('sells a shop item for k × goldAt(item level), from anywhere', () => {
    // i001: k 8 at item level 3 in Z1, 8 × 3 × 4 = 96.
    const { state, events } = accept(game({ gold: 100, position: IN_Z2 }), { type: 'Buy', item: 'i001' });
    expect(events).toEqual([{ type: 'Bought', item: 'i001', price: 96 }]);
    expect(state.run.gold).toBe(4);
    expect(state.profile.items).toEqual({ i001: 1 });
    expect(state.run.tallies.itemsGained).toEqual(['i001']);
    expect(remainingEnergy(state, world)).toBe(20);
  });

  it('sells at exactly the price and not a coin under', () => {
    expect(rejection(game({ gold: 96 }), { type: 'Buy', item: 'i001' })).toBeNull();
    expect(rejection(game({ gold: 95 }), { type: 'Buy', item: 'i001' })).toBe('no-gold');
    expect(rejection(game({ gold: 0 }), { type: 'Buy', item: 'i006' })).toBe('no-gold');
    expect(apply(game({ gold: 120 }), { type: 'Buy', item: 'i006' }).run.gold).toBe(0);
  });

  it('rejects an item that is not sold, does not exist, or is at its copy cap', () => {
    const rich = game({ gold: 1e6 });
    expect(rejection(rich, { type: 'Buy', item: 'i002' })).toBe('not-for-sale');
    expect(rejection(rich, { type: 'Buy', item: 'i005' })).toBe('not-for-sale');
    expect(rejection(rich, { type: 'Buy', item: 'i999' })).toBe('unknown-item');
    const bought = apply(rich, { type: 'Buy', item: 'i001' });
    expect(rejection(bought, { type: 'Buy', item: 'i001' })).toBe('cap-reached');
    expect(bought.run.gold).toBe(1e6 - 96);
  });

  it('rejects a name every object answers to, which is not an item', () => {
    const rich = game({ gold: 1e6 });
    for (const item of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf']) expect(rejection(rich, { type: 'Buy', item })).toBe('unknown-item');
  });

  it('is still allowed with no energy left', () => {
    expect(rejection(game({ gold: 96, energySpent: 20 }), { type: 'Buy', item: 'i001' })).toBeNull();
  });

  it('sells the third loadout for 60 × goldAt(1,000), and the next two for more', () => {
    const { state, events } = accept(game({ gold: 150000 }), { type: 'BuyLoadoutSlot' });
    expect(events).toEqual([{ type: 'LoadoutBought', price: 150000 }]);
    expect(state.run.gold).toBe(0);
    expect(state.profile.loadouts).toEqual([emptyLoadout(), emptyLoadout(), emptyLoadout()]);
    expect(state.profile.activeLoadout).toBe(0);
    expect(rejection(game({ gold: 149999 }), { type: 'BuyLoadoutSlot' })).toBe('no-gold');

    const rich: GameState = { ...state, run: { ...state.run, gold: 2880000 + 19800000 } };
    expect(loadoutPrice(rich, B)).toBe(2880000);
    const five = apply(rich, { type: 'BuyLoadoutSlot' }, { type: 'BuyLoadoutSlot' });
    expect(five.profile.loadouts).toHaveLength(5);
    expect(five.run.gold).toBe(0);
    expect(rejection({ ...five, run: { ...five.run, gold: 1e12 } }, { type: 'BuyLoadoutSlot' })).toBe('loadouts-full');
  });

  it('lets a bought loadout be equipped, switched to and renamed', () => {
    const state = apply(game({ gold: 150096 }), { type: 'BuyLoadoutSlot' }, { type: 'Buy', item: 'i001' }, { type: 'Equip', loadout: 2, slot: 'weapon', item: 'i001' }, { type: 'SwitchLoadout', index: 2 }, { type: 'RenameLoadout', index: 2, name: 'Third' });
    expect(deriveHero(state, world).damage).toBe(20);
    expect(state.profile.loadouts[2]?.name).toBe('Third');
  });
});

describe('Salvage (GDD 7.4)', () => {
  // e001 was beaten on some run, and this run's strongest kill is level 10: the pool is e001's two drops, and
  // 1,440 gold is an even chance (36 × 10 × 4).
  const ready = (run: Partial<GameState['run']> = {}, profile: Partial<GameState['profile']> = {}, seed = 7): GameState =>
    game({ gold: 1440, strongestBeaten: 10, ...run }, { bestiary: { e001: { timesBeaten: 1 } }, ...profile }, seed);

  it('stands beside a Salvage site at the run start', () => {
    expect(salvagePool(ready(), world)).toEqual(['i002', 'i004']);
    expect(salvageChance(ready(), B, false)).toBeCloseTo(0.5, 12);
    expect(rejection(ready(), { type: 'Salvage', boost: false })).toBeNull();
  });

  it('takes all gold and the run’s one attempt, and on success gives one item from the pool', () => {
    // On seed 7 the Salvage stream's first roll is 0.065, under the chance, and its second picks the first of the pool.
    const { state, events } = accept(ready(), { type: 'Salvage', boost: false });
    expect(events).toHaveLength(1);
    expect(eventOf(events, 'Salvaged')).toMatchObject({ success: true, item: 'i002', goldSpent: 1440, boosted: false });
    expect(eventOf(events, 'Salvaged').chance).toBeCloseTo(0.5, 12);
    expect(state.run.gold).toBe(0);
    expect(state.run.salvageUsed).toBe(true);
    expect(state.profile.items).toEqual({ i002: 1 });
    expect(state.run.tallies.itemsGained).toEqual(['i002']);
    expect(state.profile.gems).toBe(0);
  });

  it('still uses up the gold and the attempt when it fails', () => {
    // On seed 4 the first roll is 0.81.
    const { state, events } = accept(ready({}, {}, 4), { type: 'Salvage', boost: false });
    expect(eventOf(events, 'Salvaged')).toMatchObject({ success: false, item: null, goldSpent: 1440 });
    expect(state.run.gold).toBe(0);
    expect(state.run.salvageUsed).toBe(true);
    expect(state.profile.items).toEqual({});
    expect(state.run.tallies.itemsGained).toEqual([]);
  });

  it('succeeds when the Salvage stream’s first roll is under the chance, and picks with its second', () => {
    let successes = 0;
    for (let seed = 0; seed < 200; seed += 1) {
      const rolls = streamRng(seed, 'salvage', 0);
      const success = rolls.next() < 0.5;
      const picked = rolls.next() < 0.5 ? 'i002' : 'i004';
      const event = eventOf(accept(ready({}, {}, seed), { type: 'Salvage', boost: false }).events, 'Salvaged');
      expect(event.success).toBe(success);
      expect(event.item).toBe(success ? picked : null);
      if (success) successes += 1;
    }
    expect(successes).toBeGreaterThan(70);
    expect(successes).toBeLessThan(130);
  });

  it('allows one attempt per run, and another on the next run', () => {
    const used = apply(ready(), { type: 'Salvage', boost: false });
    expect(rejection({ ...used, run: { ...used.run, gold: 500 } }, { type: 'Salvage', boost: false })).toBe('salvage-used');
    const nextRun = apply(used, { type: 'NewRun', seed: 11 });
    expect(nextRun.run.salvageUsed).toBe(false);
    // The pool depends on this run's strongest kill, so it is empty until something is beaten again.
    expect(rejection({ ...nextRun, run: { ...nextRun.run, gold: 500 } }, { type: 'Salvage', boost: false })).toBe('empty-pool');
    expect(rejection({ ...nextRun, run: { ...nextRun.run, gold: 500, strongestBeaten: 2 } }, { type: 'Salvage', boost: false })).toBeNull();
  });

  it('can be used from anywhere, and gives there exactly what it gives at a site (DV-9)', () => {
    // On the site, beside it, across the room from it, and in a zone that has none.
    const ON_SITE = at(2, 4);
    const places = [ON_SITE, START, at(1, 3), at(3, 5), at(2, 2), NEAR, at(1, 6), IN_Z2];
    // Seed 7 succeeds and seed 4 fails; a boosted attempt is paid for the same way wherever it is made.
    for (const [seed, boost] of [[7, false], [4, false], [7, true]] as const) {
      const profile = { bestiary: { e001: { timesBeaten: 1 } }, gems: 30 };
      const atSite = accept(ready({ position: ON_SITE }, profile, seed), { type: 'Salvage', boost });
      for (const position of places) {
        const here = accept(ready({ position }, profile, seed), { type: 'Salvage', boost });
        expect(here.events, `seed ${seed} at ${position.zone} ${position.x},${position.y}`).toEqual(atSite.events);
        // The hero has not moved, and nothing else differs.
        expect(here.state).toEqual({ ...atSite.state, run: { ...atSite.state.run, position } });
      }
    }
    // Every other rule holds away from a site as it does on one.
    expect(rejection(ready({ position: IN_Z2, salvageUsed: true }), { type: 'Salvage', boost: false })).toBe('salvage-used');
    expect(rejection(ready({ position: IN_Z2, gold: 0 }), { type: 'Salvage', boost: false })).toBe('no-gold');
    expect(rejection(ready({ position: IN_Z2, strongestBeaten: 1 }), { type: 'Salvage', boost: false })).toBe('empty-pool');
    expect(rejection(ready({ position: IN_Z2 }), { type: 'Salvage', boost: true })).toBe('no-gems');
  });

  it('takes no gold and uses no attempt when the pool is empty', () => {
    const empty = game({ gold: 1440, strongestBeaten: 10 });
    const before = canonicalJson(empty);
    expect(rejection(empty, { type: 'Salvage', boost: false })).toBe('empty-pool');
    expect(canonicalJson(empty)).toBe(before);
    // Everything the pool could hold is owned.
    expect(rejection(ready({}, { bestiary: { e001: { timesBeaten: 1 } }, items: { i002: 1, i004: 1 } }), { type: 'Salvage', boost: false })).toBe('empty-pool');
    // The enemy was beaten before, but nothing this run is as strong as it.
    expect(rejection(ready({ strongestBeaten: 1 }), { type: 'Salvage', boost: false })).toBe('empty-pool');
  });

  it('is rejected with no gold to put in', () => {
    expect(rejection(ready({ gold: 0 }), { type: 'Salvage', boost: false })).toBe('no-gold');
  });

  it('doubles the chance for 25 gems, to at most 100%', () => {
    expect(rejection(ready({}, { bestiary: { e001: { timesBeaten: 1 } }, gems: 24 }), { type: 'Salvage', boost: true })).toBe('no-gems');
    // An even chance doubled is a certainty, on every seed.
    for (let seed = 0; seed < 60; seed += 1) {
      const { state, events } = accept(ready({}, { bestiary: { e001: { timesBeaten: 1 } }, gems: 30 }, seed), { type: 'Salvage', boost: true });
      expect(eventOf(events, 'Salvaged')).toMatchObject({ success: true, chance: 1, boosted: true, goldSpent: 1440 });
      expect(state.profile.gems).toBe(5);
    }
    // 160 gold is 10%; boosted, 20%.
    const low = eventOf(accept(ready({ gold: 160 }, { bestiary: { e001: { timesBeaten: 1 } }, gems: 25 }), { type: 'Salvage', boost: true }).events, 'Salvaged');
    expect(low.chance).toBeCloseTo(0.2, 12);
    // Without the boost no gems are spent.
    expect(apply(ready({}, { bestiary: { e001: { timesBeaten: 1 } }, gems: 30 }), { type: 'Salvage', boost: false }).profile.gems).toBe(30);
  });

  it('spends the gems of a boosted attempt that fails', () => {
    // 160 gold boosted is 20%; on seed 4 the first roll is 0.81.
    const { state, events } = accept(ready({ gold: 160 }, { bestiary: { e001: { timesBeaten: 1 } }, gems: 25 }, 4), { type: 'Salvage', boost: true });
    expect(eventOf(events, 'Salvaged').success).toBe(false);
    expect(state.profile.gems).toBe(0);
  });

  it('picks each item in the pool equally often', () => {
    const pool = ['i002', 'i003', 'i004', 'i005', 'i008'];
    const counts: Record<string, number> = {};
    const runs = 500;
    for (let seed = 0; seed < runs; seed += 1) {
      const state = ready({}, { bestiary: { e001: { timesBeaten: 1 }, e002: { timesBeaten: 1 }, e003: { timesBeaten: 1 } }, gems: 25 }, seed);
      expect(salvagePool(state, world)).toEqual(pool);
      const item = must(eventOf(accept(state, { type: 'Salvage', boost: true }).events, 'Salvaged').item, 'salvaged item');
      counts[item] = (counts[item] ?? 0) + 1;
    }
    expect(Object.keys(counts).sort()).toEqual(pool);
    // 100 each on average; a fair pick stays within about 35 of that.
    for (const item of pool) expect(Math.abs((counts[item] ?? 0) - runs / pool.length)).toBeLessThan(35);
  });

  it('costs no energy and works with none left', () => {
    const state = apply(ready({ energySpent: 20 }), { type: 'Salvage', boost: false });
    expect(state.run.energySpent).toBe(20);
    expect(state.run.salvageUsed).toBe(true);
  });
});

describe('CollectStash and MarkHintShown (GDD 7.8, 8.4)', () => {
  // The stash x02 is at (5,5), reached over the hidden tile (4,5).
  const beside = (run: Partial<GameState['run']> = {}, profile: Partial<GameState['profile']> = {}): GameState => game({ position: at(4, 5), ...run }, { secretsFound: ['x01'], ...profile });

  it('pays the stash’s gold and remembers that it was found', () => {
    const { state, events } = accept(beside({ gold: 3 }), { type: 'CollectStash', secret: 'x02' });
    expect(events).toEqual([{ type: 'StashCollected', secret: 'x02', gold: 40 }]);
    expect(state.run.gold).toBe(43);
    expect(state.run.stashesCollected).toEqual(['x02']);
    expect(state.profile.secretsFound).toEqual(['x01', 'x02']);
  });

  it('pays once per run, and again on the next run', () => {
    const collected = apply(beside(), { type: 'CollectStash', secret: 'x02' });
    expect(rejection(collected, { type: 'CollectStash', secret: 'x02' })).toBe('already-collected');
    const nextRun = apply(collected, { type: 'NewRun', seed: 2 });
    expect(nextRun.run.stashesCollected).toEqual([]);
    const again = apply({ ...nextRun, run: { ...nextRun.run, position: at(4, 5) } }, { type: 'CollectStash', secret: 'x02' });
    expect(again.run.gold).toBe(40);
    expect(again.profile.secretsFound).toEqual(['x01', 'x02']);
  });

  it('must be collected from beside it or on it', () => {
    expect(rejection(game(), { type: 'CollectStash', secret: 'x02' })).toBe('not-adjacent');
    expect(rejection(beside({ position: at(3, 5) }), { type: 'CollectStash', secret: 'x02' })).toBe('not-adjacent');
    expect(rejection(beside({ position: at(5, 5) }), { type: 'CollectStash', secret: 'x02' })).toBeNull();
    expect(rejection(beside({ position: at(4, 5, 'z02') }), { type: 'CollectStash', secret: 'x02' })).toBe('not-adjacent');
  });

  it('rejects a secret that is not a stash', () => {
    expect(rejection(beside(), { type: 'CollectStash', secret: 'x99' })).toBe('unknown-secret');
    expect(rejection(beside(), { type: 'CollectStash', secret: 'x01' })).toBe('unknown-secret');
    expect(rejection(beside(), { type: 'CollectStash', secret: 'constructor' })).toBe('unknown-secret');
  });

  it('records a hint as shown, once', () => {
    const { state, events } = accept(game(), { type: 'MarkHintShown', hint: 'map' });
    expect(events).toEqual([{ type: 'HintShown', hint: 'map' }]);
    expect(state.profile.hintsShown).toEqual(['map']);
    expect(rejection(state, { type: 'MarkHintShown', hint: 'map' })).not.toBeNull();
    expect(apply(state, { type: 'MarkHintShown', hint: 'salvage' }).profile.hintsShown).toEqual(['map', 'salvage']);
    expect(rejection(game(), { type: 'MarkHintShown', hint: 'nonsense' })).toBe('unknown-hint');
  });
});

describe('NewRun and the reset ledger (GDD 2.4, 2.5)', () => {
  /** A state with every field of both halves away from its starting value. */
  const played = (): GameState => ({
    profile: {
      items: { i001: 1, i003: 2, i004: 1, i005: 1 },
      loadouts: [loadoutOf({ weapon: 'i001', acc1: 'i003' }, 'Fight'), loadoutOf({ weapon: 'i005' }, 'Claim'), loadoutOf({ acc2: 'i003' })],
      activeLoadout: 1,
      claimedBosses: ['e003'],
      gems: 12,
      waypointsVisited: ['w01'],
      waypointsUnlocked: ['w01'],
      bestiary: { e001: { timesBeaten: 4 }, e002: { timesBeaten: 0 }, e003: { timesBeaten: 2 } },
      strongestEverBeaten: 10,
      secretsFound: ['x01', 'x02'],
      autoAssign: { unlocked: true, on: true, split: { life: 20, damage: 40, defense: 20, dexterity: 10, luck: 10 } },
      hintsShown: ['map', 'hero'],
      counters: { runsStarted: 6, bestLevel: 40 },
    },
    run: {
      seed: 7,
      battleCount: 31,
      spawnCount: 20,
      xp: 5000,
      pointsSpent: { life: 30, damage: 40, defense: 20, dexterity: 10, luck: 5 },
      growthPointsEarned: 12,
      gold: 777,
      energySpent: 9,
      energyPaidBack: 3,
      bossesBeaten: ['e003'],
      strongestBeaten: 10,
      lastEnemy: 'e003',
      salvageUsed: true,
      position: { zone: 'z02', x: 1, y: 2 },
      marks: { s002: { stat: 'xp', percent: 100 } },
      stashesCollected: ['x02'],
      tallies: { wins: 30, losses: 1, itemsGained: ['i001', 'i005'], claims: 1, gemsGained: 5 },
    },
  });

  it('resets every row of the left column', () => {
    const { state } = accept(played(), { type: 'NewRun', seed: 99 });
    const run = state.run;
    // Level and XP.
    expect(run.xp).toBe(0);
    expect(level(state, B)).toBe(1);
    // Stat points, spent and unspent; Growth gains from gear.
    expect(run.pointsSpent).toEqual(zeroPoints());
    expect(run.growthPointsEarned).toBe(0);
    expect(unspentPoints(state, B)).toBe(0);
    // Gold.
    expect(run.gold).toBe(0);
    // Energy spent and boss paybacks received.
    expect([run.energySpent, run.energyPaidBack]).toEqual([0, 0]);
    // Bosses beaten this run.
    expect(run.bossesBeaten).toEqual([]);
    // Strongest enemy beaten this run, and the last enemy fought.
    expect(run.strongestBeaten).toBe(0);
    expect(run.lastEnemy).toBeNull();
    // The Salvage attempt.
    expect(run.salvageUsed).toBe(false);
    // Hero position.
    expect(run.position).toEqual(START);
    // Run seed, battle counter, spawn counter: the spawn counter stands at the three rolls made for the new run.
    expect([run.seed, run.battleCount, run.spawnCount]).toEqual([99, 0, 3]);
    // Marked-enemy rolls and stashes collected.
    expect(run.marks).toEqual(freshRun(99, world).marks);
    expect(run.stashesCollected).toEqual([]);
    // This run's tallies.
    expect(run.tallies).toEqual({ wins: 0, losses: 0, itemsGained: [], claims: 0, gemsGained: 0 });
    // Nothing else is in `run`, and all of it is what a first run on that seed would have.
    expect(run).toEqual(freshRun(99, world));
    expect(Object.keys(run).sort()).toEqual(
      ['battleCount', 'bossesBeaten', 'energyPaidBack', 'energySpent', 'gold', 'growthPointsEarned', 'lastEnemy', 'marks', 'pointsSpent', 'position', 'salvageUsed', 'seed', 'spawnCount', 'stashesCollected', 'strongestBeaten', 'tallies', 'xp'].sort(),
    );
  });

  it('keeps every row of the right column', () => {
    const before = played();
    const { state, events } = accept(before, { type: 'NewRun', seed: 99 });
    const profile = state.profile;
    // Items owned, with copy counts; keys are items.
    expect(profile.items).toEqual({ i001: 1, i003: 2, i004: 1, i005: 1 });
    // Loadouts: contents, the active one, slots bought.
    expect(profile.loadouts).toEqual(before.profile.loadouts);
    expect(profile.loadouts).toHaveLength(3);
    expect(profile.activeLoadout).toBe(1);
    // Permanent energy: the set of bosses claimed.
    expect(profile.claimedBosses).toEqual(['e003']);
    // Gems.
    expect(profile.gems).toBe(12);
    // Waypoints visited and unlocked.
    expect([profile.waypointsVisited, profile.waypointsUnlocked]).toEqual([['w01'], ['w01']]);
    // Bestiary: enemies seen, times beaten.
    expect(profile.bestiary).toEqual({ e001: { timesBeaten: 4 }, e002: { timesBeaten: 0 }, e003: { timesBeaten: 2 } });
    // Strongest enemy ever beaten.
    expect(profile.strongestEverBeaten).toBe(10);
    // Secrets discovered on the map.
    expect(profile.secretsFound).toEqual(['x01', 'x02']);
    // Auto-assign: unlocked flag, on or off, saved split.
    expect(profile.autoAssign).toEqual(before.profile.autoAssign);
    // First-time explanations already shown.
    expect(profile.hintsShown).toEqual(['map', 'hero']);
    // Lifetime counters: the run count goes up by one and nothing else moves.
    expect(profile.counters).toEqual({ runsStarted: 7, bestLevel: 40 });
    expect(events).toEqual([{ type: 'RunStarted', run: 7 }]);
    expect(profile).toEqual({ ...before.profile, counters: { runsStarted: 7, bestLevel: 40 } });
    expect(Object.keys(profile).sort()).toEqual(
      ['activeLoadout', 'autoAssign', 'bestiary', 'claimedBosses', 'counters', 'gems', 'hintsShown', 'items', 'loadouts', 'secretsFound', 'strongestEverBeaten', 'waypointsUnlocked', 'waypointsVisited'].sort(),
    );
  });

  it('starts the next run a little stronger: permanent energy and kept gear count at once', () => {
    const { state } = accept(played(), { type: 'NewRun', seed: 99 });
    // 20 + 3 for the one boss claimed.
    expect(remainingEnergy(state, world)).toBe(23);
    // The active loadout still holds the tool.
    expect(deriveHero(state, world).claim).toBe(true);
    // The key still opens the door, the hidden tile is still known, and the gate boss is back.
    expect(walkable(state, world, 'z01', 1, 7, 'path')).toBe(true);
    expect(walkable(state, world, 'z01', 4, 5, 'path')).toBe(true);
    expect(walkable(state, world, 'z01', 4, 2, 'step')).toBe(false);
  });

  it('can be started at any time, from a state that has done nothing', () => {
    const { state, events } = accept(newGame(7, world), { type: 'NewRun', seed: 0 });
    expect(events).toEqual([{ type: 'RunStarted', run: 2 }]);
    expect(state.run).toEqual(freshRun(0, world));
    expect(accept(state, { type: 'NewRun', seed: 4294967295 }).state.profile.counters.runsStarted).toBe(3);
  });

  it('rejects a seed that is not a whole number of 32 unsigned bits', () => {
    for (const seed of [-1, 0.5, 4294967296, Number.NaN, Number.POSITIVE_INFINITY]) expect(rejection(played(), { type: 'NewRun', seed })).toBe('bad-seed');
    expect(rejection(played(), { type: 'NewRun', seed: '7' } as unknown as Action)).toBe('bad-seed');
    expect(rejection(played(), { type: 'NewRun' } as unknown as Action)).toBe('bad-seed');
  });

  it('rejects a run past the largest exact whole number', () => {
    const state = played();
    const full: GameState = { ...state, profile: { ...state.profile, counters: { ...state.profile.counters, runsStarted: Number.MAX_SAFE_INTEGER } } };
    expect(rejection(full, { type: 'NewRun', seed: 1 })).toBe('count-limit');
  });

  it('gives a different run for a different seed', () => {
    const marks = new Set<string>();
    for (let seed = 0; seed < 100; seed += 1) marks.add(canonicalJson(accept(played(), { type: 'NewRun', seed }).state.run.marks));
    expect(marks.size).toBeGreaterThan(5);
  });
});

describe('step never throws and never changes its arguments (ARCHITECTURE 5.1)', () => {
  // Three states that between them give every action something to act on: beside the enemies; beside the Salvage
  // site; and beside the stash with gold enough for the shop and a loadout.
  const busy = (): GameState => mighty({ gold: 5000, xp: 450, strongestBeaten: 10 }, { items: { i900: 1, i001: 1, i003: 2, i006: 1 }, gems: 60, bestiary: { e001: { timesBeaten: 1 } } });
  const atSite = (): GameState => ({ ...busy(), run: { ...busy().run, position: START } });
  const rich = (): GameState => game({ gold: 200000, position: at(4, 5) }, { secretsFound: ['x01'] });
  const STATES = [busy, atSite, rich, (): GameState => newGame(3, world)];

  /** One call to `step` that must not throw. The result is typed as what `step` can really hand back. */
  const attempt = (state: GameState, action: unknown): StepResult | undefined => {
    let result: StepResult | undefined;
    expect(() => {
      result = step(state, action as Action, world);
    }, JSON.stringify(action)).not.toThrow();
    return result;
  };

  const VALID: Action[] = [
    { type: 'Step', dx: -1, dy: 0 },
    { type: 'Fight', spawn: 's001' },
    { type: 'Fight', spawn: 's003' },
    { type: 'Allocate', points: { life: 1, damage: 2, defense: 3, dexterity: 4, luck: 5 } },
    { type: 'Equip', loadout: 0, slot: 'weapon', item: 'i001' },
    { type: 'Equip', loadout: 1, slot: 'acc3', item: 'i003' },
    { type: 'SwitchLoadout', index: 1 },
    { type: 'RenameLoadout', index: 0, name: 'Name' },
    { type: 'Buy', item: 'i006' },
    { type: 'Buy', item: 'i001' },
    { type: 'BuyLoadoutSlot' },
    { type: 'Salvage', boost: true },
    { type: 'Salvage', boost: false },
    { type: 'CollectStash', secret: 'x02' },
    { type: 'MarkHintShown', hint: 'gear' },
    { type: 'NewRun', seed: 5 },
  ];

  const MALFORMED: unknown[] = [
    { type: 'NewRun' },
    { type: 'NewRun', seed: '7' },
    { type: 'NewRun', seed: null },
    { type: 'NewRun', seed: {} },
    { type: 'Step' },
    { type: 'Step', dx: '1', dy: 0 },
    { type: 'Step', dx: null, dy: null },
    { type: 'Step', dx: 1e9, dy: -1e9 },
    { type: 'Step', dx: {}, dy: [] },
    { type: 'Fight' },
    { type: 'Fight', spawn: 7 },
    { type: 'Fight', spawn: null },
    { type: 'Fight', spawn: {} },
    { type: 'Fight', spawn: 'constructor' },
    { type: 'Fight', spawn: '__proto__' },
    { type: 'Fight', spawn: 'toString' },
    { type: 'Allocate' },
    { type: 'Allocate', points: null },
    { type: 'Allocate', points: 5 },
    { type: 'Allocate', points: 'all' },
    { type: 'Allocate', points: {} },
    { type: 'Allocate', points: [1, 0, 0, 0, 0] },
    { type: 'Allocate', points: { life: 1 } },
    { type: 'Allocate', points: { life: '1', damage: 0, defense: 0, dexterity: 0, luck: 0 } },
    { type: 'Allocate', points: { life: -1, damage: 2, defense: 0, dexterity: 0, luck: 0 } },
    { type: 'Equip' },
    { type: 'Equip', loadout: 0 },
    { type: 'Equip', loadout: 0, slot: 'weapon' },
    { type: 'Equip', loadout: '0', slot: 'weapon', item: null },
    { type: 'Equip', loadout: 'length', slot: 'weapon', item: null },
    { type: 'Equip', loadout: 0, slot: 'constructor', item: null },
    { type: 'Equip', loadout: 0, slot: '__proto__', item: null },
    { type: 'Equip', loadout: 0, slot: 'weapon', item: 'constructor' },
    { type: 'Equip', loadout: 0, slot: 'weapon', item: '__proto__' },
    { type: 'Equip', loadout: 0, slot: 'weapon', item: 7 },
    { type: 'Equip', loadout: -1, slot: 'weapon', item: 'i001' },
    { type: 'SwitchLoadout' },
    { type: 'SwitchLoadout', index: '1' },
    { type: 'SwitchLoadout', index: 'length' },
    { type: 'SwitchLoadout', index: null },
    { type: 'RenameLoadout' },
    { type: 'RenameLoadout', index: 0 },
    { type: 'RenameLoadout', index: 0, name: 5 },
    { type: 'RenameLoadout', index: 0, name: null },
    { type: 'RenameLoadout', index: 'x', name: 'a' },
    { type: 'Buy' },
    { type: 'Buy', item: 5 },
    { type: 'Buy', item: null },
    { type: 'Buy', item: 'constructor' },
    { type: 'Buy', item: '__proto__' },
    { type: 'Buy', item: 'toString' },
    { type: 'Buy', item: 'hasOwnProperty' },
    { type: 'CollectStash' },
    { type: 'CollectStash', secret: null },
    { type: 'CollectStash', secret: 'constructor' },
    { type: 'CollectStash', secret: '__proto__' },
    { type: 'MarkHintShown' },
    { type: 'MarkHintShown', hint: 'constructor' },
    { type: 'MarkHintShown', hint: 7 },
  ];

  it('accepts or rejects every well-formed action without throwing, from frozen arguments', () => {
    for (const make of STATES) {
      for (const action of VALID) {
        const state = deepFreeze(make());
        const before = canonicalJson(state);
        const result = attempt(state, action);
        expect(result).toBeDefined();
        expect(canonicalJson(state)).toBe(before);
        // Whatever comes back can be saved: no NaN, no undefined, nothing that is not plain data.
        expect(() => canonicalJson(result)).not.toThrow();
      }
    }
  });

  it('accepts each of those actions from at least one of the states, so the check above reaches the code that writes', () => {
    for (const action of VALID) {
      const accepted = STATES.filter((make) => !('rejected' in step(deepFreeze(make()), action, world)));
      expect(accepted.length, JSON.stringify(action)).toBeGreaterThan(0);
    }
  });

  it('rejects every malformed action without throwing, and writes nothing', () => {
    for (const make of STATES) {
      for (const shape of MALFORMED) {
        const state = deepFreeze(make());
        const before = canonicalJson(state);
        const result = attempt(state, shape);
        expect(result, JSON.stringify(shape)).toBeDefined();
        expect(result !== undefined && 'rejected' in result, JSON.stringify(shape)).toBe(true);
        expect(canonicalJson(state)).toBe(before);
      }
    }
  });

  it('treats a Salvage boost that is not a boolean as a yes or a no, and still returns plain numbers', () => {
    for (const boost of [undefined, null, 0, 1, 'yes', '']) {
      const result = attempt(deepFreeze(atSite()), { type: 'Salvage', boost });
      expect(result).toBeDefined();
      if (result !== undefined && !('rejected' in result)) {
        expect(result.state.run.gold).toBe(0);
        expect([35, 60]).toContain(result.state.profile.gems);
      }
    }
  });

  it('turns away an action type it does not know, and anything that is not an action', () => {
    // `step` promises `{ state, events }` or `{ rejected }`, whatever it is handed. That covers the three actions
    // ARCHITECTURE 5.2 lists as not built yet (Travel, UnlockWaypoint, SetAutoAssign), which a newer build's
    // save or a stray caller could send.
    for (const shape of [{ type: 'Nope' }, { type: 'constructor' }, { type: undefined }, {}, { type: 'Travel', waypoint: 'w01' }, { type: 'UnlockWaypoint', waypoint: 'w01' }, { type: 'SetAutoAssign', on: true, split: { life: 100, damage: 0, defense: 0, dexterity: 0, luck: 0 } }]) {
      expect(attempt(deepFreeze(busy()), shape)).toEqual({ rejected: 'unknown-action' });
    }
    for (const junk of [null, undefined, 7, 'Fight', true]) expect(attempt(deepFreeze(busy()), junk)).toEqual({ rejected: 'unknown-action' });
  });

  it('never changes the content', () => {
    const before = canonicalJson(world);
    let state = mighty();
    for (const action of VALID) {
      const result = step(deepFreeze(state), action, world);
      if (!('rejected' in result)) state = result.state;
    }
    expect(canonicalJson(world)).toBe(before);
    expect(Object.isFrozen(world.balance)).toBe(true);
  });
});

describe('replay (GDD 6.3)', () => {
  // A new hero with no gear, so fights go both ways. Rejected actions are part of the record.
  const SCRIPT: Action[] = [
    { type: 'MarkHintShown', hint: 'map' },
    { type: 'Step', dx: 0, dy: -1 },
    { type: 'Salvage', boost: false },
    { type: 'Step', dx: 0, dy: -1 },
    { type: 'Step', dx: 0, dy: -1 },
    { type: 'Fight', spawn: 's001' },
    { type: 'Fight', spawn: 's001' },
    { type: 'Allocate', points: { life: 0, damage: 5, defense: 0, dexterity: 0, luck: 0 } },
    { type: 'Fight', spawn: 's001' },
    { type: 'Fight', spawn: 's002' },
    { type: 'Fight', spawn: 's001' },
    { type: 'Allocate', points: { life: 2, damage: 2, defense: 1, dexterity: 0, luck: 0 } },
    { type: 'Buy', item: 'i001' },
    { type: 'Equip', loadout: 0, slot: 'weapon', item: 'i001' },
    { type: 'Equip', loadout: 0, slot: 'body', item: 'i002' },
    { type: 'Fight', spawn: 's002' },
    { type: 'Fight', spawn: 's002' },
    { type: 'Step', dx: 1, dy: 0 },
    { type: 'Fight', spawn: 's003' },
    { type: 'Step', dx: 1, dy: 0 },
    { type: 'Step', dx: -1, dy: 0 },
    { type: 'Step', dx: 0, dy: 1 },
    { type: 'Step', dx: 0, dy: 1 },
    { type: 'Salvage', boost: false },
    { type: 'SwitchLoadout', index: 1 },
    { type: 'RenameLoadout', index: 1, name: 'Spare' },
    { type: 'Fight', spawn: 's001' },
    { type: 'NewRun', seed: 2026 },
    { type: 'Step', dx: 1, dy: 0 },
    { type: 'Step', dx: 1, dy: 0 },
    { type: 'CollectStash', secret: 'x02' },
    { type: 'Step', dx: -1, dy: 0 },
    { type: 'Step', dx: -1, dy: -1 },
    { type: 'Step', dx: 0, dy: -1 },
    { type: 'Step', dx: 0, dy: -1 },
    { type: 'Fight', spawn: 's001' },
    { type: 'Fight', spawn: 's002' },
    { type: 'BuyLoadoutSlot' },
  ];

  const replay = (seed: number): { results: StepResult[]; last: GameState } => {
    let state = newGame(seed, world);
    const results: StepResult[] = [];
    for (const action of SCRIPT) {
      const result = step(deepFreeze(state), action, world);
      results.push(result);
      if (!('rejected' in result)) state = result.state;
    }
    return { results, last: state };
  };

  it('gives a deep-equal state and deep-equal events for the same seed and actions', () => {
    const first = replay(31337);
    const second = replay(31337);
    expect(second.results).toEqual(first.results);
    expect(second.last).toEqual(first.last);
    expect(canonicalJson(second.last)).toBe(canonicalJson(first.last));
  });

  it('really plays: fights are fought, things are bought, a second run starts', () => {
    const { results, last } = replay(31337);
    const accepted = results.filter((result) => !('rejected' in result)).length;
    expect(accepted).toBeGreaterThan(20);
    expect(last.profile.counters.runsStarted).toBe(2);
    expect(Object.keys(last.profile.bestiary).length).toBeGreaterThanOrEqual(2);
    expect(last.profile.secretsFound).toContain('x01');
  });

  it('gives a different game for a different seed', () => {
    const texts = new Set([1, 2, 3, 4, 5, 6].map((seed) => canonicalJson(replay(seed).last)));
    expect(texts.size).toBeGreaterThan(1);
  });
});

describe('repairRun (ARCHITECTURE 7.3)', () => {
  it('returns the same object when nothing needs repair', () => {
    const fresh = deepFreeze(newGame(7, world));
    expect(repairRun(fresh, world)).toBe(fresh);
    let state = mighty();
    for (const spawn of ['s001', 's002', 's003', 's001']) state = fight(state, spawn).state;
    state = apply(state, { type: 'Allocate', points: allPoints({ damage: 10 }) }, { type: 'Step', dx: 1, dy: 0 });
    const frozen = deepFreeze(state);
    expect(repairRun(frozen, world)).toBe(frozen);
  });

  it('leaves a hero standing on a beaten boss’s tile, on a found or unfound hidden tile, or in an open doorway', () => {
    const onGate = deepFreeze(game({ position: at(4, 2), bossesBeaten: ['e003'] }));
    expect(repairRun(onGate, world)).toBe(onGate);
    const onHidden = deepFreeze(game({ position: at(4, 5) }));
    expect(repairRun(onHidden, world)).toBe(onHidden);
    const inDoorway = deepFreeze(game({ position: at(1, 7) }, { items: { i004: 1 } }));
    expect(repairRun(inDoorway, world)).toBe(inDoorway);
  });

  it('moves a hero who stands where nobody can to the run start', () => {
    const cases: Position[] = [at(0, 0), at(4, 1), at(3, 3), at(4, 2), at(1, 7), at(-1, 2), at(50, 50), at(1, 1, 'z99'), at(2, 1, 'z02')];
    for (const position of cases) {
      const state = deepFreeze(game({ position, gold: 9, xp: 30 }));
      const repaired = repairRun(state, world);
      expect(repaired).not.toBe(state);
      expect(repaired.run.position).toEqual(START);
      expect(repaired.run).toEqual({ ...state.run, position: START });
      expect(repaired.profile).toBe(state.profile);
    }
  });

  it('drops IDs the content no longer has from the run', () => {
    const state = deepFreeze(
      game({
        bossesBeaten: ['e003', 'e999', 'e001'],
        stashesCollected: ['x02', 'x99', 'x01'],
        marks: { s001: { stat: 'xp', percent: 100 }, s999: { stat: 'gold', percent: 200 }, s003: { stat: 'drops', percent: 100 } },
        lastEnemy: 'e999',
        tallies: { wins: 3, losses: 1, itemsGained: ['i001', 'i999', 'i003'], claims: 0, gemsGained: 2 },
      }),
    );
    const repaired = repairRun(state, world);
    // e999 is gone; e001 is no boss, so it was never one to have beaten.
    expect(repaired.run.bossesBeaten).toEqual(['e003']);
    // x99 is gone; x01 is a hidden tile, not a stash.
    expect(repaired.run.stashesCollected).toEqual(['x02']);
    // s999 is gone; s003 holds a boss, which carries no mark.
    expect(repaired.run.marks).toEqual({ s001: { stat: 'xp', percent: 100 } });
    expect(repaired.run.lastEnemy).toBeNull();
    expect(repaired.run.tallies).toEqual({ wins: 3, losses: 1, itemsGained: ['i001', 'i003'], claims: 0, gemsGained: 2 });
    expect(repaired.profile).toBe(state.profile);
    // Everything else in the run is as it was.
    expect({ ...repaired.run, bossesBeaten: 0, stashesCollected: 0, marks: 0, lastEnemy: 0, tallies: 0 }).toEqual({ ...state.run, bossesBeaten: 0, stashesCollected: 0, marks: 0, lastEnemy: 0, tallies: 0 });
  });

  it('keeps a last enemy the content still has', () => {
    const state = deepFreeze(game({ lastEnemy: 'e002' }));
    expect(repairRun(state, world)).toBe(state);
  });

  it('judges the position after dropping bosses the content no longer counts as beaten', () => {
    // The hero stands on the gate's tile on the strength of a boss ID that is not one.
    const state = deepFreeze(game({ position: at(4, 2), bossesBeaten: ['e001'] }));
    const repaired = repairRun(state, world);
    expect(repaired.run.bossesBeaten).toEqual([]);
    expect(repaired.run.position).toEqual(START);
  });

  it('returns overspent points', () => {
    // Level 3 has earned 10 points; 11 are spent.
    const state = deepFreeze(game({ xp: 30, pointsSpent: allPoints({ life: 5, damage: 6 }) }));
    const repaired = repairRun(state, world);
    expect(repaired.run.pointsSpent).toEqual(zeroPoints());
    expect(unspentPoints(repaired, B)).toBe(10);
    expect(repaired.run.xp).toBe(30);
    expect(repaired.profile).toBe(state.profile);
  });

  it('leaves points alone when they are covered, counting Growth', () => {
    const exact = deepFreeze(game({ xp: 30, pointsSpent: allPoints({ life: 5, damage: 5 }) }));
    expect(repairRun(exact, world)).toBe(exact);
    const withGrowth = deepFreeze(game({ xp: 30, growthPointsEarned: 2, pointsSpent: allPoints({ life: 6, damage: 6 }) }));
    expect(repairRun(withGrowth, world)).toBe(withGrowth);
    const over = deepFreeze(game({ xp: 30, growthPointsEarned: 2, pointsSpent: allPoints({ life: 7, damage: 6 }) }));
    expect(repairRun(over, world).run.pointsSpent).toEqual(zeroPoints());
  });

  it('never alters the profile, whatever it holds', () => {
    const state = deepFreeze(
      game(
        { position: at(0, 0), bossesBeaten: ['e999'], lastEnemy: 'e999', xp: 0, pointsSpent: allPoints({ luck: 3 }) },
        { items: { i999: 4, i001: 1 }, claimedBosses: ['e999'], bestiary: { e999: { timesBeaten: 2 } }, secretsFound: ['x99'], waypointsVisited: ['w99'], loadouts: [loadoutOf({ weapon: 'i999' }), emptyLoadout()] },
      ),
    );
    const before = canonicalJson(state.profile);
    const repaired = repairRun(state, world);
    expect(repaired).not.toBe(state);
    expect(repaired.profile).toBe(state.profile);
    expect(canonicalJson(repaired.profile)).toBe(before);
  });

  it('needs no second pass', () => {
    const state = deepFreeze(game({ position: at(0, 0), bossesBeaten: ['e999'], marks: { s999: { stat: 'xp', percent: 100 } }, xp: 0, pointsSpent: allPoints({ luck: 3 }) }));
    const once = repairRun(state, world);
    expect(repairRun(once, world)).toBe(once);
  });

  it('repairs against the content it is given', () => {
    // A build whose content has lost the second zone: a hero left there goes back to the start.
    const base = sampleContent();
    const smaller: Content = deepFreeze({ ...base, zoneOrder: ['z01'], zones: { z01: must(base.zones['z01'], 'zone') } });
    const state = deepFreeze(game({ position: IN_Z2 }));
    expect(repairRun(state, world)).toBe(state);
    expect(repairRun(state, smaller).run.position).toEqual(START);
  });
});
