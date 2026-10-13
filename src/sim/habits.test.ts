// The habits a strategy sets, one at a time, in the engine's small sample world: two normal enemies (s001, level
// 2, and s002, level 4), a gate boss (s003, level 10) and one enemy past it (s004, level 50). The world is small
// enough that what a habit should do can be worked out by hand, which the real content is not.

import { describe, expect, it } from 'vitest';
import { newGame, remainingEnergy } from '../engine';
import type { Content, EnemyDef, GameState } from '../engine';
import { SAMPLE_BALANCE, sampleContent, sampleItem } from '../engine/sample.fixture';
import { strategyNamed } from './config';
import type { Strategy } from './config';
import { newPlayer } from './player';
import type { Player } from './player';
import { lastGasp, playRun } from './run';
import type { RunRecord } from './run';

/** The sample world plus one piece of armor that wins any fight in it. Nothing drops it and nothing sells it. */
const withMight = (content: Content): Content => ({
  ...content,
  itemOrder: [...content.itemOrder, 'i900'],
  items: { ...content.items, i900: sampleItem('i900', 'legs', { level: 1, lines: { lifeFlat: 3000, damageFlat: 1000, defenseFlat: 1000, dexterityFlat: 1000 } }) },
});

const FREE = withMight(sampleContent());
const CHARGED = withMight(sampleContent({ ...SAMPLE_BALANCE, energy: { ...SAMPLE_BALANCE.energy, chargeLosses: true } }));

/** The Phase 3b player with nothing to spend on: each test turns on the one habit it is about. */
const PLAIN: Strategy = { ...strategyNamed('climb-then-collect'), name: 'plain', shop: 'never', salvage: 'never', farmAtRatio: null };

const game = (profile: Partial<GameState['profile']> = {}, run: Partial<GameState['run']> = {}, content: Content = FREE): GameState => {
  const base = newGame(7, content);
  return { profile: { ...base.profile, ...profile }, run: { ...base.run, ...run } };
};
/** A new game whose hero owns the armor, so that it wins whatever it fights. */
const mighty = (profile: Partial<GameState['profile']> = {}, content: Content = FREE): GameState => game({ items: { i900: 1 }, ...profile }, {}, content);

const play = (state: GameState, strategy: Strategy, content: Content = FREE, prepare: (player: Player) => void = () => {}): { player: Player; record: RunRecord } => {
  const player = newPlayer(state);
  prepare(player);
  return { player, record: playRun(player, strategy, content, 1) };
};

/** A world with one enemy made certain to win, so that a fight with it is certain to be a loss. */
const unbeatable = (id: string, content: Content = FREE): Content => {
  const enemy = content.enemies[id] as EnemyDef;
  return { ...content, enemies: { ...content.enemies, [id]: { ...enemy, stats: { ...enemy.stats, life: 1e12, damage: 1e12 } } } };
};

/** A chance no forecast reaches: a strategy given this never fights a boss in the ordinary way. */
const NEVER = 2;

describe('giving an enemy up', () => {
  it('leaves a normal enemy after exactly `patience` losses and goes on to the next', () => {
    // It fights the strongest enemy it can reach whatever the odds, and never the boss, so the level 4 enemy is the strongest it can reach.
    const stubborn = (patience: number): Strategy => ({ ...PLAIN, minWinChance: 0, bossWinChance: NEVER, patience, bossPatience: 9 });
    for (const patience of [1, 3]) {
      const { player, record } = play(mighty(), stubborn(patience), unbeatable('e002'));
      expect(player.fightsAt.get('s002')).toBe(patience);
      expect(player.shunned.has('s002')).toBe(true);
      expect(record.losses).toBe(patience);
      // Every point of energy then went on the enemy it could beat.
      expect(player.fightsAt.get('s001')).toBe(record.wins);
      expect(record.wins).toBe(record.startingEnergy);
    }
  });

  it('leaves a boss after exactly `bossPatience` losses, which is its own number', () => {
    // A new hero with no gear cannot beat the level 10 boss, and this one tries it at any odds.
    const { player, record } = play(game(), { ...PLAIN, minWinChance: 0, bossWinChance: 0, patience: 7, bossPatience: 2 });
    expect(player.fightsAt.get('s003')).toBe(2);
    expect(player.shunned.has('s003')).toBe(true);
    expect(record.wall).toBe('e003');
    expect(record.wallFights).toBe(2);
    expect(record.gatesBeaten).toEqual([]);
  });
});

describe('a run in which the gate falls', () => {
  const { player, record } = play(mighty(), PLAIN);

  it('beats the boss, is paid its energy back, and goes through to what stands behind it', () => {
    expect(record.gatesBeaten).toEqual(['e003']);
    expect(record.wall).toBe('e003');
    expect(record.wallFights).toBe(1);
    expect(record.firstKills.sort()).toEqual(['e003', 'e004']);
    expect(record.zoneReached).toBe(2);
    expect(record.strongest).toBe(50);
    // 20 energy. The boss costs 1 and pays back 3, so 22 are left after it: 23 wins, none lost.
    expect(record.startingEnergy).toBe(20);
    expect(record.wins).toBe(23);
    expect(record.losses).toBe(0);
    expect(record.energyLeft).toBe(0);
    expect(remainingEnergy(player.state, FREE)).toBe(0);
  });

  it('records the wall as the hero stood against it at the end: stronger than it, and all but sure to win', () => {
    expect(record.power).toBeGreaterThan(1);
    expect(record.wallChance).toBeGreaterThan(0.95);
  });

  it('is handed the tool and counts it as a drop and a persistent gain', () => {
    expect(record.drops).toContain('i005');
    expect(record.itemsGained).toContain('i005');
    expect(record.persistentGain).toBe(true);
    expect(record.claims).toBe(0);
  });

  it('counts no hard win when every win was a first try, and counts the ones that took more than the target allows', () => {
    expect(record.hardWins).toBe(0);
    // Three earlier wins this run, as the player keeps them: two took more than 3 tries, one took exactly 3.
    const earlier = play(mighty(), PLAIN, FREE, (prepared) => prepared.tries.push(5, 4, 3));
    expect(FREE.balance.pacing.hardWinTries).toBe(3);
    expect(earlier.record.hardWins).toBe(2);
  });
});

describe('a persistent gain', () => {
  it('is not recorded for a run that gains nothing new', () => {
    // Everything the enemies it will fight can give is already owned to its cap, and the boss is already claimed.
    const full = mighty({ items: { i900: 1, i002: 1, i003: 3, i004: 1, i005: 1, i007: 1, i008: 1 }, claimedBosses: ['e003'] });
    const { record } = play(full, PLAIN);
    expect(record.wins).toBeGreaterThan(0);
    expect(record.claims).toBe(0);
    expect(record.itemsGained).toEqual([]);
    expect(record.drops).toEqual([]);
    expect(record.persistentGain).toBe(false);
  });
});

describe('going back for drops', () => {
  it('turns to the enemies it has outgrown only when the strategy says to', () => {
    const stays = play(mighty(), { ...PLAIN, farmAtRatio: null }).record;
    expect(stays.firstKills.sort()).toEqual(['e003', 'e004']);
    // With the habit on, the hero outgrows the level 50 enemy within the run and goes back for what e001 still holds.
    const goesBack = play(mighty(), { ...PLAIN, farmAtRatio: 1.6 }).record;
    expect(goesBack.level).toBeGreaterThanOrEqual(80);
    expect(goesBack.firstKills).toContain('e001');
    expect(goesBack.drops).toContain('i004');
  });
});

describe('the shop', () => {
  // The run earns far more gold than the two things on sale cost. One of them is an energy accessory, +2.
  it('buys nothing when the strategy never shops', () => {
    expect(play(mighty(), { ...PLAIN, shop: 'never' }).record.bought).toEqual([]);
  });

  it('buys as soon as it can afford to when it shops after every win, so the energy accessory pays within the run', () => {
    const { record } = play(mighty(), { ...PLAIN, shop: 'dearest' });
    expect([...record.bought].sort()).toEqual(['i001', 'i006']);
    expect(record.wins).toBe(25);
  });

  it('buys the same things once the run is spent when it shops at the end, too late for this run', () => {
    const { record } = play(mighty(), { ...PLAIN, shop: 'run-end' });
    expect([...record.bought].sort()).toEqual(['i001', 'i006']);
    expect(record.wins).toBe(23);
  });
});

describe('Salvage', () => {
  // An enemy beaten in an earlier run still holds two items, so the pool is not empty and the run ends with gold.
  const before = (): GameState => mighty({ items: { i900: 1 }, bestiary: { e002: { timesBeaten: 1 } } });

  it('is tried once at the end of a run by a strategy that uses it', () => {
    const { record, player } = play(before(), { ...PLAIN, salvage: 'always' });
    expect(record.salvageTried).toBe(true);
    expect(player.state.run.salvageUsed).toBe(true);
    expect(player.state.run.gold).toBe(0);
    if (record.salvaged !== null) expect(['i003', 'i008']).toContain(record.salvaged);
  });

  it('is left alone by a strategy that does not', () => {
    const { record, player } = play(before(), { ...PLAIN, salvage: 'never' });
    expect(record.salvageTried).toBe(false);
    expect(record.salvaged).toBeNull();
    expect(player.state.run.salvageUsed).toBe(false);
    expect(player.state.run.gold).toBeGreaterThan(0);
  });
});

describe('the last-gasp attempt at a boss', () => {
  // A new hero with no gear, which the boss always beats, and a strategy that will try it at any odds, up to 5 times.
  const desperate: Strategy = { ...PLAIN, bossAtRunEnd: 0, bossReserve: 5, bossPatience: 5 };
  const withLeft = (left: number, content: Content): Player => newPlayer(game({}, { energySpent: content.balance.energy.base - left }, content));

  it('where a loss is free, is made on the last point of energy and not before', () => {
    expect(lastGasp(withLeft(20, FREE), desperate, FREE)).toBeNull();
    expect(lastGasp(withLeft(2, FREE), desperate, FREE)).toBeNull();
    expect(lastGasp(withLeft(1, FREE), desperate, FREE)).toMatchObject({ spawn: { id: 's003' }, withTool: false });
    expect(lastGasp(withLeft(0, FREE), desperate, FREE)).toBeNull();
  });

  it('where a loss is charged, is made on the energy the strategy holds back and not before', () => {
    expect(lastGasp(withLeft(6, CHARGED), desperate, CHARGED)).toBeNull();
    expect(lastGasp(withLeft(5, CHARGED), desperate, CHARGED)).toMatchObject({ spawn: { id: 's003' } });
    expect(lastGasp(withLeft(1, CHARGED), desperate, CHARGED)).toMatchObject({ spawn: { id: 's003' } });
    expect(lastGasp(withLeft(2, CHARGED), { ...desperate, bossReserve: 1 }, CHARGED)).toBeNull();
  });

  it('is not made by a strategy without the habit, below the odds it asks for, past its patience, or at a boss already beaten', () => {
    expect(lastGasp(withLeft(1, FREE), { ...desperate, bossAtRunEnd: null }, FREE)).toBeNull();
    expect(lastGasp(withLeft(1, FREE), { ...desperate, bossAtRunEnd: 0.5 }, FREE)).toBeNull();
    const tired = withLeft(1, FREE);
    tired.lastGaspLosses.set('s003', 5);
    expect(lastGasp(tired, desperate, FREE)).toBeNull();
    tired.lastGaspLosses.set('s003', 4);
    expect(lastGasp(tired, desperate, FREE)).not.toBeNull();
    const beaten = newPlayer(game({}, { energySpent: 19, bossesBeaten: ['e003'] }));
    expect(lastGasp(beaten, desperate, FREE)).toBeNull();
  });

  it('in a whole run costs nothing where a loss is free, and five points where it is charged', () => {
    const always: Strategy = { ...desperate, minWinChance: 0, bossWinChance: NEVER, patience: 1000 };
    const free = play(game(), always, unbeatable('e003')).record;
    const charged = play(game({}, {}, CHARGED), always, unbeatable('e003', CHARGED)).record;
    expect(free.wallFights).toBe(5);
    expect(charged.wallFights).toBe(5);
    // The five attempts are the last five fights of the charged run, so everything before them was spent elsewhere.
    expect(charged.wins + charged.losses).toBe(charged.startingEnergy);
    expect(free.wins).toBe(free.startingEnergy);
  });
});
