// The simulated player, played for real: every strategy under both energy rules, through the engine's own `step`.
// Short playthroughs only: these check that a run obeys the rule it is played under and that a seed fixes
// everything. What the numbers come to is `npm run sim`'s to say.

import { describe, expect, it } from 'vitest';
import { contentFor, strategyNamed, strategyNames, variantNamed } from './config';
import type { Strategy } from './config';
import { formatCsv } from './csv';
import { claimProjections, goldEdges, itemsInDips } from './probes';
import { playthrough } from './run';
import type { Playthrough, RunRecord } from './run';

const FREE = contentFor('free', variantNamed('shipped'));
const CHARGED = contentFor('charged', variantNamed('shipped'));
const RUNS = 3;
/** The most an energy accessory adds in v1 (GDD 5.8): the slack a run's energy count is allowed. */
const ACCESSORY_MOST = 3;

const firstRun = (seed: number, strategy: Strategy, content: typeof FREE): RunRecord => {
  const run = playthrough(seed, 1, strategy, content).runs[0];
  if (run === undefined) throw new Error('test setup: no run');
  return run;
};

describe('a playthrough', () => {
  for (const name of strategyNames()) {
    const strategy = strategyNamed(name);

    it(`${name}: under free losses a run spends its energy on wins alone`, () => {
      const play = playthrough(3, RUNS, strategy, FREE);
      expect(play.runs).toHaveLength(RUNS);
      for (const run of play.runs) {
        const back = run.gatesBeaten.length * (1 + FREE.balance.energy.bossSurplus);
        expect(run.battles).toBe(run.wins + run.losses);
        expect(run.wins).toBeGreaterThan(0);
        expect(run.wins - back).toBeLessThanOrEqual(run.startingEnergy + ACCESSORY_MOST);
        expect(run.energyLeft).toBeGreaterThanOrEqual(0);
        expect(run.level).toBeGreaterThan(1);
        expect(Number.isFinite(run.wallChance) && run.wallChance >= 0 && run.wallChance <= 1).toBe(true);
      }
    });

    it(`${name}: under charged losses every fight joined is paid for`, () => {
      const play = playthrough(3, RUNS, strategy, CHARGED);
      for (const run of play.runs) {
        const back = run.gatesBeaten.length * (1 + CHARGED.balance.energy.bossSurplus);
        expect(run.wins + run.losses - back).toBeLessThanOrEqual(run.startingEnergy + ACCESSORY_MOST);
        expect(run.energyLeft).toBeGreaterThanOrEqual(0);
      }
    });
  }

  it('is fixed by its seed: the same seed gives the same runs and the same CSV bytes, another seed does not', () => {
    const strategy = strategyNamed('climb-then-collect');
    const once = playthrough(11, RUNS, strategy, FREE);
    const again = playthrough(11, RUNS, strategy, FREE);
    const other = playthrough(12, RUNS, strategy, FREE);
    const csv = (plays: Playthrough[]): string => formatCsv([{ rule: 'free', variant: 'shipped', strategy: strategy.name, content: FREE, plays }]);
    expect(again).toEqual(once);
    expect(csv([again])).toBe(csv([once]));
    expect(csv([other])).not.toBe(csv([once]));
    expect(csv([once, other]).trimEnd().split('\n')).toHaveLength(1 + 2 * RUNS);
  });

  it('plays the two rules apart: a player made to lose keeps its energy where a loss is free and runs dry where it is charged', () => {
    // It will fight anything, and gives nothing up.
    const reckless: Strategy = { ...strategyNamed('climb-then-collect'), name: 'reckless', minWinChance: 0, bossWinChance: 0, patience: 1000, bossPatience: 1000, shop: 'never', salvage: 'never' };
    const free = firstRun(5, reckless, FREE);
    const charged = firstRun(5, reckless, CHARGED);
    expect(free.losses).toBeGreaterThan(free.startingEnergy);
    expect(charged.losses).toBeGreaterThan(0);
    expect(charged.wins + charged.losses).toBe(charged.startingEnergy);
    expect(charged.energyLeft).toBe(0);
  });

  it('makes its last-gasp attempts at the boss on one point of energy where a loss is free, and on the energy held back where it is charged', () => {
    // It will try the boss at any odds with its last energy, five times.
    const desperate: Strategy = { ...strategyNamed('long-shot'), name: 'desperate', bossAtRunEnd: 0, bossReserve: 5, bossPatience: 5, shop: 'never' };
    const free = firstRun(7, desperate, FREE);
    const charged = firstRun(7, desperate, CHARGED);
    expect(free.gatesBeaten).toEqual([]);
    expect(free.wallFights).toBe(5);
    // The five attempts cost nothing, so every point of energy still went on a win.
    expect(free.wins).toBe(free.startingEnergy);
    expect(charged.wallFights).toBe(5);
    expect(charged.wins + charged.losses).toBe(charged.startingEnergy);
    expect(charged.wins).toBeLessThanOrEqual(charged.startingEnergy - 5);
  });
});

describe('the probes', () => {
  const band = (key: string): { levelMin: number; levelMax: number; goldPerLevel: number } => {
    const row = FREE.balance.zones[key];
    if (row === undefined) throw new Error(`test setup: no zone ${key}`);
    return row;
  };

  it('finds the fall in goldAt at each of the seven zone edges, and where it is made up', () => {
    const edges = goldEdges(FREE.balance);
    expect(edges.map((edge) => `${edge.from}>${edge.to}`)).toEqual(['Z1>Z2', 'Z2>Z3', 'Z3>Z4', 'Z4>Z5', 'Z5>Z6', 'Z6>Z7', 'Z7>Z8']);
    expect(edges[0]).toMatchObject({ topLevel: band('Z1').levelMax, topGold: band('Z1').levelMax * band('Z1').goldPerLevel, nextLevel: band('Z2').levelMin, nextGold: band('Z2').levelMin * band('Z2').goldPerLevel });
    for (const edge of edges) {
      const next = band(edge.to);
      expect(edge.fall).toBeGreaterThan(0);
      expect(edge.fall).toBeLessThan(0.5);
      // The level it names is the first at which goldAt is back, and not one later.
      expect(edge.recoversAt * next.goldPerLevel).toBeGreaterThanOrEqual(edge.topGold - 1e-6);
      expect((edge.recoversAt - 1) * next.goldPerLevel).toBeLessThan(edge.topGold - 1e-6);
      expect(edge.shareOfBand).toBeGreaterThan(0);
      expect(edge.shareOfBand).toBeLessThan(0.2);
    }
  });

  it('names a shop item whose level sits where goldAt is still below the band before', () => {
    const sold = FREE.itemOrder.map((id) => FREE.items[id]).find((item) => item !== undefined && item.priceFactor !== null);
    const edge = goldEdges(FREE.balance)[0];
    if (sold === undefined || edge === undefined) throw new Error('test setup: no shop item');
    const moved = (level: number): typeof FREE => ({ ...FREE, items: { ...FREE.items, [sold.id]: { ...sold, level } } });
    expect(itemsInDips(moved(edge.nextLevel))).toContain(sold.id);
    expect(itemsInDips(moved(edge.recoversAt - 1))).toContain(sold.id);
    expect(itemsInDips(moved(edge.recoversAt))).not.toContain(sold.id);
    expect(itemsInDips(moved(edge.topLevel))).not.toContain(sold.id);
  });

  it('puts a Claim far above a plain win over the same boss, because the tool cuts Damage', () => {
    const projections = claimProjections(FREE, strategyNamed('climb-then-collect').split);
    expect(projections.length).toBeGreaterThan(0);
    for (const entry of projections) {
      expect(FREE.enemies[entry.boss]?.boss).toBe(true);
      if (entry.plain.half === null || entry.plain.most === null || entry.withTool.half === null || entry.withTool.most === null) throw new Error('a boss with a reference loadout should fall at some level');
      expect(entry.plain.most).toBeGreaterThanOrEqual(entry.plain.half);
      expect(entry.withTool.most).toBeGreaterThanOrEqual(entry.withTool.half);
      expect(entry.withTool.half).toBeGreaterThan(entry.plain.half * 2);
    }
  });
});
