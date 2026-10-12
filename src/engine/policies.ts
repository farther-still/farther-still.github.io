// Stat allocation is pluggable (ARCHITECTURE 5.6): the player's own choices, Auto-assign and the simulator's
// strategies are all one type, and all feed the same `Allocate` action.

import { sumPoints, zeroPoints } from './state';
import { STAT_KEYS } from './types';
import type { HeroStats, StatKey, StatPoints, StatSplit } from './types';

export type AllocationContext = { unspent: number; spent: StatPoints; hero: HeroStats };

/** Says how to spend unspent points. It may return fewer than `unspent`, never more. */
export type AllocationPolicy = (context: AllocationContext) => StatPoints;

/** The player's own entry on the Hero screen. */
export const manualPolicy =
  (points: StatPoints): AllocationPolicy =>
  () => ({ ...points });

/**
 * Spends every unspent point so that the run's totals follow a percentage split (GDD 8.2). Points that do not
 * divide evenly go to the stat furthest behind its percentage, ties going to the earlier stat in the order Life,
 * Damage, Defense, Dexterity, Luck.
 */
export const splitPolicy =
  (split: StatSplit): AllocationPolicy =>
  ({ unspent, spent }) => {
    const give = zeroPoints();
    if (!(unspent > 0)) return give;
    const total = sumPoints(spent) + unspent;
    // Whole shares first, when there are points enough to bring every stat up to its share. When there are not,
    // because points were spent by hand against the split, every point goes one at a time to whichever stat is
    // furthest behind, so the shortfall is spread and not paid to the first stat in line.
    const owed = zeroPoints();
    for (const key of STAT_KEYS) owed[key] = Math.max(0, Math.floor((total * split[key]) / 100) - spent[key]);
    let left = unspent;
    if (sumPoints(owed) <= unspent) {
      for (const key of STAT_KEYS) give[key] = owed[key];
      left -= sumPoints(owed);
    }
    while (left > 0) {
      let behind: StatKey = STAT_KEYS[0];
      let gap = Number.NEGATIVE_INFINITY;
      for (const key of STAT_KEYS) {
        const short = (total * split[key]) / 100 - (spent[key] + give[key]);
        // A stat with no share never takes a leftover point unless no stat has a share at all.
        if (split[key] > 0 && short > gap) {
          gap = short;
          behind = key;
        }
      }
      give[behind] += 1;
      left -= 1;
    }
    return give;
  };
