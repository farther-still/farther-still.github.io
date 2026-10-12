// Hero level as a closed form (GDD 5.1). XP to go from level L to L + 1 is `perLevel × L`, so the total needed
// to reach level L is `perLevel × L × (L − 1) ÷ 2`. The 8 below comes from solving that quadratic for L.

/** Total XP needed to stand at `level`. */
export const xpForLevel = (level: number, perLevel: number): number => (perLevel * level * (level - 1)) / 2;

/**
 * The level a total XP gives. The square root is only a first guess: the answer is then corrected by exact
 * comparison, so a last-digit difference between browsers could not change a level (ARCHITECTURE 5.5).
 */
export const levelForXp = (xp: number, perLevel: number): number => {
  if (!(xp > 0) || !(perLevel > 0) || xp === Number.POSITIVE_INFINITY) return 1;
  let level = Math.max(1, Math.floor((1 + Math.sqrt(1 + (8 * xp) / perLevel)) / 2));
  // Past 2^53 a level and the one after it are the same double, so each loop also stops when a step no longer
  // changes the level. The game's largest XP is nowhere near that (GDD 6.1); this is so it can never hang.
  while (level > 1 && xpForLevel(level, perLevel) > xp && level - 1 !== level) level -= 1;
  while (xpForLevel(level + 1, perLevel) <= xp && level + 1 !== level) level += 1;
  return level;
};
