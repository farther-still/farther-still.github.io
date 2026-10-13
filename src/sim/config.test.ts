// What a simulation is run with: strategies and variants by name, the energy rule, and the recorded playthrough.

import { describe, expect, it } from 'vitest';
import { loadBundledContent } from '../content';
import { RECORDED, contentFor, labelOf, ruleInForce, strategyNamed, strategyNames, variantNamed, variantNames } from './config';
import type { Variant } from './config';

const SHIPPED = loadBundledContent();
const variant = (over: Partial<Variant>): Variant => ({ name: 'test', about: 'A test variant.', set: {}, drops: {}, ...over });

describe('strategies and variants', () => {
  it('reads every strategy in the file, the four the phase asked for among them', () => {
    expect(strategyNames()).toEqual(expect.arrayContaining(['climb-then-collect', 'long-shot', 'cautious', 'like-michael']));
    for (const name of strategyNames()) {
      const strategy = strategyNamed(name);
      expect(strategy.name).toBe(name);
      expect(strategy.split.life + strategy.split.damage + strategy.split.defense + strategy.split.dexterity + strategy.split.luck).toBe(100);
    }
  });

  it('keeps the Phase 3b player as it was, so its figures can be set beside GDD 13.5', () => {
    expect(strategyNamed('climb-then-collect')).toMatchObject({ minWinChance: 0.6, bossWinChance: 0.35, patience: 4, bossPatience: 4, bossAtRunEnd: null, farmAtRatio: 1.6, shop: 'dearest', salvage: 'always', forecastTrials: 150 });
  });

  it('refuses a name that is not in the file, and says which names are', () => {
    expect(() => strategyNamed('nobody')).toThrow(/no strategy called "nobody".*climb-then-collect/);
    expect(() => variantNamed('nothing')).toThrow(/no variant called "nothing".*shipped/);
    // A name every object answers to is not an entry.
    expect(() => strategyNamed('constructor')).toThrow(/no strategy/);
  });

  it('has a variant that changes nothing', () => {
    expect(variantNames()).toContain('shipped');
    expect(variantNamed('shipped')).toMatchObject({ set: {}, drops: {} });
  });
});

describe('contentFor', () => {
  it('gives the shipped game back when asked for the shipped rule and variant', () => {
    const content = contentFor('shipped', variantNamed('shipped'));
    expect(content.balance).toEqual(SHIPPED.balance);
    expect(content.enemies).toEqual(SHIPPED.enemies);
    expect(content.items).toEqual(SHIPPED.items);
  });

  it('sets the energy switch for a rule, and nothing else', () => {
    const free = contentFor('free', variantNamed('shipped'));
    const charged = contentFor('charged', variantNamed('shipped'));
    expect(free.balance.energy.chargeLosses).toBe(false);
    expect(charged.balance.energy.chargeLosses).toBe(true);
    expect({ ...charged.balance, energy: { ...charged.balance.energy, chargeLosses: false } }).toEqual(free.balance);
    expect(charged.enemies).toEqual(SHIPPED.enemies);
    expect(ruleInForce(free)).toBe('free');
    expect(ruleInForce(charged)).toBe('charged');
  });

  it('lays a variant’s numbers over the balance table and leaves the rest alone', () => {
    const content = contentFor('free', variant({ set: { 'energy.base': 24, 'zones.Z1.fightCost': 2 } }));
    expect(content.balance.energy.base).toBe(24);
    expect(content.balance.zones['Z1']?.fightCost).toBe(2);
    expect(content.balance.energy.perClaim).toBe(SHIPPED.balance.energy.perClaim);
    expect(content.balance.hero).toEqual(SHIPPED.balance.hero);
    // The shipped content is not touched by building a variant of it.
    expect(loadBundledContent().balance.energy.base).toBe(SHIPPED.balance.energy.base);
  });

  it('recomputes what the balance table feeds, so a variant is the game those numbers would make', () => {
    const boss = SHIPPED.enemyOrder.find((id) => SHIPPED.enemies[id]?.boss === true) ?? '';
    const softer = contentFor('free', variant({ set: { 'enemy.boss.life': 1 } }));
    expect(softer.enemies[boss]?.stats.life).toBeLessThan(SHIPPED.enemies[boss]?.stats.life ?? 0);
  });

  it('stops on a path that names nothing, or a value of the wrong kind, instead of adding a field', () => {
    expect(() => contentFor('free', variant({ set: { 'energy.bse': 24 } }))).toThrow(/"energy\.bse", which is not in data\/balance\.json/);
    expect(() => contentFor('free', variant({ set: { 'nowhere.at.all': 1 } }))).toThrow(/not in data\/balance\.json/);
    expect(() => contentFor('free', variant({ set: { 'energy.chargeLosses': 1 } }))).toThrow(/to a number, where data\/balance\.json has a boolean/);
    // A number the schema refuses stops it too.
    expect(() => contentFor('free', variant({ set: { 'energy.base': -1 } }))).toThrow();
  });

  it('changes one drop by enemy and item, and refuses a drop no enemy has', () => {
    const enemy = SHIPPED.enemyOrder.map((id) => SHIPPED.enemies[id]).find((entry) => entry !== undefined && entry.drops.some((drop) => drop.chance < 100));
    const drop = enemy?.drops.find((entry) => entry.chance < 100);
    if (enemy === undefined || drop === undefined) throw new Error('test setup: no drop under 100%');
    const content = contentFor('free', variant({ drops: { [`${enemy.id}/${drop.item}`]: 77 } }));
    expect(content.enemies[enemy.id]?.drops.find((entry) => entry.item === drop.item)?.chance).toBe(77);
    const others = (table: typeof SHIPPED.enemies): unknown => SHIPPED.enemyOrder.filter((id) => id !== enemy.id).map((id) => table[id]?.drops);
    expect(others(content.enemies)).toEqual(others(SHIPPED.enemies));
    expect(() => contentFor('free', variant({ drops: { 'e999/i999': 10 } }))).toThrow(/sets the drop "e999\/i999", which no enemy has/);
  });

  it('labels a configuration by the rule in force, the variant and the strategy', () => {
    const config = { rule: 'shipped' as const, variant: variantNamed('shipped'), strategy: strategyNamed('cautious') };
    expect(labelOf(config, contentFor('shipped', config.variant))).toBe(`${SHIPPED.balance.energy.chargeLosses ? 'charged' : 'free'} · shipped · cautious`);
    expect(labelOf({ ...config, rule: 'charged' }, contentFor('charged', config.variant))).toBe('charged · shipped · cautious');
  });
});

describe('the recorded playthrough', () => {
  it('holds what docs/STATUS.md records of the phone review: the gate on run 10, runs 2 to 9, a mean of 2:42', () => {
    expect(RECORDED.gateRun).toBe(10);
    expect(RECORDED.gateTries).toEqual({ min: 4, max: 5 });
    expect(RECORDED.rule).toBe('free');
    expect(RECORDED.runs.map((run) => run.run)).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
    expect(RECORDED.runs.map((run) => run.level)).toEqual([13, 15, 20, 32, 40, 45, 53, 51]);
    const seconds = RECORDED.runs.map((run) => run.seconds);
    expect(Math.min(...seconds)).toBe(110);
    expect(Math.max(...seconds)).toBe(204);
    expect(Math.round(seconds.reduce((total, value) => total + value, 0) / seconds.length)).toBe(162);
  });
});
