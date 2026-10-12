import { describe, expect, it } from 'vitest';
import { deriveHero, unspentPoints } from './formulas';
import { manualPolicy, splitPolicy } from './policies';
import { SAMPLE_BALANCE, sampleContent, sampleGame } from './sample.fixture';
import { sumPoints, zeroPoints } from './state';
import { step } from './step';
import { STAT_KEYS } from './types';
import type { StatPoints, StatSplit } from './types';

// GDD 8.2, the Auto-assign row: a percentage for each of the five stats. Points that do not divide evenly go to
// the stat furthest behind its percentage, ties going to the earlier stat in the order Life, Damage, Defense,
// Dexterity, Luck. ARCHITECTURE 5.6: every policy feeds the same Allocate action.

const content = sampleContent();
const hero = deriveHero(sampleGame(), content);

const split = (life: number, damage: number, defense: number, dexterity: number, luck: number): StatSplit => ({ life, damage, defense, dexterity, luck });
const points = (life: number, damage: number, defense: number, dexterity: number, luck: number): StatPoints => ({ life, damage, defense, dexterity, luck });

const give = (shares: StatSplit, unspent: number, spent: StatPoints = zeroPoints()): StatPoints => splitPolicy(shares)({ unspent, spent, hero });

const SPLITS: StatSplit[] = [
  split(30, 30, 30, 10, 0),
  split(20, 20, 20, 20, 20),
  split(50, 25, 25, 0, 0),
  split(40, 30, 20, 10, 0),
  split(34, 33, 33, 0, 0),
  split(1, 1, 1, 1, 96),
  split(0, 0, 0, 0, 100),
  split(100, 0, 0, 0, 0),
  split(0, 50, 0, 50, 0),
  split(7, 13, 29, 31, 20),
];

describe('splitPolicy (GDD 8.2)', () => {
  it('spends exactly the unspent points, in whole points, none of them negative', () => {
    const spentBefore: StatPoints[] = [zeroPoints(), points(3, 0, 0, 0, 0), points(10, 10, 10, 10, 10), points(0, 0, 0, 0, 77), points(5, 1, 0, 2, 9), points(200, 0, 3, 0, 0)];
    for (const shares of SPLITS) {
      for (const spent of spentBefore) {
        for (let unspent = 0; unspent <= 64; unspent += 1) {
          const given = give(shares, unspent, spent);
          expect(sumPoints(given)).toBe(unspent);
          for (const key of STAT_KEYS) {
            expect(Number.isInteger(given[key])).toBe(true);
            expect(given[key]).toBeGreaterThanOrEqual(0);
          }
        }
      }
    }
    for (const shares of SPLITS) expect(sumPoints(give(shares, 123457))).toBe(123457);
  });

  it('follows the percentages when the points divide evenly', () => {
    expect(give(split(30, 30, 30, 10, 0), 100)).toEqual(points(30, 30, 30, 10, 0));
    expect(give(split(30, 30, 30, 10, 0), 10)).toEqual(points(3, 3, 3, 1, 0));
    expect(give(split(50, 25, 25, 0, 0), 1000)).toEqual(points(500, 250, 250, 0, 0));
    expect(give(split(20, 20, 20, 20, 20), 5)).toEqual(points(1, 1, 1, 1, 1));
    expect(give(split(7, 13, 29, 31, 20), 300)).toEqual(points(21, 39, 87, 93, 60));
    expect(give(split(0, 0, 0, 0, 100), 45)).toEqual(points(0, 0, 0, 0, 45));
  });

  it('gives a point that does not divide evenly to the stat furthest behind its percentage', () => {
    // 7 points at 30/30/30/10: shares of 2.1, 2.1, 2.1 and 0.7. Dexterity, at 0 of 0.7, is furthest behind.
    expect(give(split(30, 30, 30, 10, 0), 7)).toEqual(points(2, 2, 2, 1, 0));
    // 1 point at 40/30/20/10: Life is 0.4 behind, more than any other.
    expect(give(split(40, 30, 20, 10, 0), 1)).toEqual(points(1, 0, 0, 0, 0));
    // 2 points at 10/20/30/40: shares 0.2, 0.4, 0.6, 0.8. Luck first, then Dexterity.
    expect(give(split(0, 10, 20, 30, 40), 2)).toEqual(points(0, 0, 0, 1, 1));
    // 9 points at 30/30/30/10: 2.7, 2.7, 2.7, 0.9. Dexterity is 0.9 behind; then the three at 0.7 tie.
    expect(give(split(30, 30, 30, 10, 0), 9)).toEqual(points(3, 3, 2, 1, 0));
    // 45 points, a level 10 hero's: 13.5, 13.5, 13.5, 4.5. All four are 0.5 behind and two points are left.
    expect(give(split(30, 30, 30, 10, 0), 45)).toEqual(points(14, 14, 13, 4, 0));
  });

  it('breaks a tie in favour of the earlier stat: Life, Damage, Defense, Dexterity, Luck', () => {
    expect(give(split(20, 20, 20, 20, 20), 1)).toEqual(points(1, 0, 0, 0, 0));
    expect(give(split(20, 20, 20, 20, 20), 2)).toEqual(points(1, 1, 0, 0, 0));
    expect(give(split(20, 20, 20, 20, 20), 3)).toEqual(points(1, 1, 1, 0, 0));
    expect(give(split(20, 20, 20, 20, 20), 4)).toEqual(points(1, 1, 1, 1, 0));
    expect(give(split(20, 20, 20, 20, 20), 6)).toEqual(points(2, 1, 1, 1, 1));
    expect(give(split(0, 0, 50, 50, 0), 1)).toEqual(points(0, 0, 1, 0, 0));
    expect(give(split(0, 50, 0, 0, 50), 3)).toEqual(points(0, 2, 0, 0, 1));
    expect(give(split(25, 25, 25, 25, 0), 3)).toEqual(points(1, 1, 1, 0, 0));
  });

  it('never gives a leftover point to a stat with no share', () => {
    for (let unspent = 1; unspent <= 40; unspent += 1) {
      const given = give(split(0, 50, 0, 50, 0), unspent);
      expect([given.life, given.defense, given.luck]).toEqual([0, 0, 0]);
      const one = give(split(0, 0, 0, 100, 0), unspent);
      expect(one).toEqual(points(0, 0, 0, unspent, 0));
    }
  });

  it('keeps the run’s totals within a point of each percentage as levels come in five points at a time', () => {
    for (const shares of SPLITS) {
      let spent = zeroPoints();
      for (let levelsGained = 1; levelsGained <= 300; levelsGained += 1) {
        const given = give(shares, 5, spent);
        expect(sumPoints(given)).toBe(5);
        const next = zeroPoints();
        for (const key of STAT_KEYS) next[key] = spent[key] + given[key];
        spent = next;
        const total = sumPoints(spent);
        expect(total).toBe(5 * levelsGained);
        for (const key of STAT_KEYS) expect(Math.abs(spent[key] - (total * shares[key]) / 100)).toBeLessThan(1);
      }
    }
  });

  it('measures "behind" against the run’s totals, so it makes up for points spent by hand', () => {
    // 10 points went into Damage by hand. With 10 more at 50/50, the totals should be 10 and 10.
    expect(give(split(50, 50, 0, 0, 0), 10, points(0, 10, 0, 0, 0))).toEqual(points(10, 0, 0, 0, 0));
    // 4 more: the totals are 14, so 7 each, and Damage already has 10. All 4 go to Life.
    expect(give(split(50, 50, 0, 0, 0), 4, points(0, 10, 0, 0, 0))).toEqual(points(4, 0, 0, 0, 0));
    // Already on the split: 3 and 3 with 2 more gives 4 and 4.
    expect(give(split(50, 50, 0, 0, 0), 2, points(3, 3, 0, 0, 0))).toEqual(points(1, 1, 0, 0, 0));
  });

  it('spreads the points over the stats behind when there are too few to bring them all level', () => {
    // 100 points went into Life by hand, and 5 arrive at 20% each. The four other stats are each 21 behind, so
    // each point goes to whichever is furthest behind at that moment, ties to the earlier stat: 2, 1, 1, 1.
    expect(give(split(20, 20, 20, 20, 20), 5, points(100, 0, 0, 0, 0))).toEqual(points(0, 2, 1, 1, 1));
  });

  it('gives nothing when there is nothing to spend', () => {
    expect(give(split(30, 30, 30, 10, 0), 0)).toEqual(zeroPoints());
    expect(give(split(30, 30, 30, 10, 0), -5)).toEqual(zeroPoints());
    expect(give(split(30, 30, 30, 10, 0), Number.NaN)).toEqual(zeroPoints());
  });

  it('does not change the points already spent or the split it was given', () => {
    const shares = Object.freeze(split(30, 30, 30, 10, 0));
    const spent = Object.freeze(points(1, 2, 3, 4, 5));
    expect(sumPoints(splitPolicy(shares)({ unspent: 20, spent, hero }))).toBe(20);
    expect(spent).toEqual(points(1, 2, 3, 4, 5));
  });

  it('returns points the Allocate action accepts, leaving none unspent', () => {
    // A level 10 hero has 45 points.
    const base = sampleGame();
    const state = { ...base, run: { ...base.run, xp: 450 } };
    const unspent = unspentPoints(state, SAMPLE_BALANCE);
    expect(unspent).toBe(45);
    const given = splitPolicy(base.profile.autoAssign.split)({ unspent, spent: state.run.pointsSpent, hero: deriveHero(state, content) });
    const result = step(state, { type: 'Allocate', points: given }, content);
    if ('rejected' in result) throw new Error(`rejected: ${result.rejected}`);
    expect(result.state.run.pointsSpent).toEqual(points(14, 14, 13, 4, 0));
    expect(unspentPoints(result.state, SAMPLE_BALANCE)).toBe(0);
  });
});

describe('manualPolicy (ARCHITECTURE 5.6)', () => {
  it('returns what the player entered, whatever the context', () => {
    const entered = points(1, 2, 3, 4, 5);
    const policy = manualPolicy(entered);
    expect(policy({ unspent: 100, spent: zeroPoints(), hero })).toEqual(entered);
    expect(policy({ unspent: 0, spent: points(9, 9, 9, 9, 9), hero })).toEqual(entered);
  });

  it('hands back a copy, so the caller’s object is never the one the reducer sees', () => {
    const entered = points(1, 2, 3, 4, 5);
    const returned = manualPolicy(entered)({ unspent: 100, spent: zeroPoints(), hero });
    expect(returned).not.toBe(entered);
    returned.life = 99;
    expect(entered.life).toBe(1);
  });
});
