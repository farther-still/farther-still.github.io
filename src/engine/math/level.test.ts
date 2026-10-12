import { describe, expect, it } from 'vitest';
import { makeRng } from '../rng';
import { levelForXp, xpForLevel } from './level';

// GDD 5.1, at its starting value: XP to go from level L to L + 1 is 10 × L.
const PER_LEVEL = 10;

describe('xpForLevel (GDD 5.1)', () => {
  it('is 5 × L × (L − 1) in total to reach level L', () => {
    for (let level = 1; level <= 2000; level += 1) expect(xpForLevel(level, PER_LEVEL)).toBe(5 * level * (level - 1));
    // The v1 and full-scope peaks of GDD 6.1.
    expect(xpForLevel(3e6, PER_LEVEL)).toBe(5 * 3e6 * (3e6 - 1));
    expect(xpForLevel(3e10, PER_LEVEL)).toBe(5 * 3e10 * (3e10 - 1));
  });

  it('costs 10 × L to go from level L to L + 1', () => {
    for (let level = 1; level <= 2000; level += 1) expect(xpForLevel(level + 1, PER_LEVEL) - xpForLevel(level, PER_LEVEL)).toBe(10 * level);
  });

  it('needs nothing to stand at level 1', () => {
    expect(xpForLevel(1, PER_LEVEL)).toBe(0);
  });
});

describe('levelForXp (GDD 5.1)', () => {
  it('gives the first few boundaries', () => {
    const cases: Array<[number, number]> = [
      [0, 1],
      [1, 1],
      [9, 1],
      [10, 2],
      [29, 2],
      [30, 3],
      [59, 3],
      [60, 4],
      [99, 4],
      [100, 5],
      [449, 9],
      [450, 10],
      [49499, 99],
      [49500, 100],
    ];
    for (const [xp, level] of cases) expect(levelForXp(xp, PER_LEVEL)).toBe(level);
  });

  it('turns over exactly at every level boundary', () => {
    for (let level = 2; level <= 3000; level += 1) {
      const needed = xpForLevel(level, PER_LEVEL);
      expect(levelForXp(needed, PER_LEVEL)).toBe(level);
      expect(levelForXp(needed - 1, PER_LEVEL)).toBe(level - 1);
      expect(levelForXp(needed + 1, PER_LEVEL)).toBe(level);
    }
  });

  it('turns over exactly at the boundaries a v1 run ends near, and at the last ones whose XP is an exact whole number', () => {
    for (const level of [250, 40000, 1200000, 3000000, 42000000]) {
      const needed = xpForLevel(level, PER_LEVEL);
      expect(Number.isSafeInteger(needed)).toBe(true);
      expect(levelForXp(needed, PER_LEVEL)).toBe(level);
      expect(levelForXp(needed - 1, PER_LEVEL)).toBe(level - 1);
    }
  });

  it('gives level L for the XP that level L needs, past the sizes where the square root is exact', () => {
    // Full scope reaches hero levels of 3e10 (GDD 6.1). Up there the XP for a level is no longer an exact whole
    // number and the square root can come out a hair low, which is what the correction by comparison is for.
    let checked = 0;
    for (let level = 50000000; level < 60000000000; level = Math.floor(level * 1.0031) + 1) {
      expect(levelForXp(xpForLevel(level, PER_LEVEL), PER_LEVEL)).toBe(level);
      checked += 1;
    }
    expect(checked).toBeGreaterThan(2000);
    for (const level of [1e8, 1e9, 1e10, 3e10, 44721359550]) expect(levelForXp(xpForLevel(level, PER_LEVEL), PER_LEVEL)).toBe(level);
  });

  it('agrees with counting levels up one at a time', () => {
    let level = 1;
    for (let xp = 0; xp <= 30000; xp += 1) {
      while (xp >= 5 * (level + 1) * level) level += 1;
      expect(levelForXp(xp, PER_LEVEL)).toBe(level);
    }
  });

  it('puts every XP total from 0 to 1e22 inside its own level', () => {
    const inside = (xp: number): void => {
      const level = levelForXp(xp, PER_LEVEL);
      expect(Number.isInteger(level)).toBe(true);
      expect(level).toBeGreaterThanOrEqual(1);
      expect(xpForLevel(level, PER_LEVEL)).toBeLessThanOrEqual(xp);
      expect(xp).toBeLessThan(xpForLevel(level + 1, PER_LEVEL));
    };
    // A geometric sweep: about 3,900 totals, each 1.3% above the last, with their neighbours.
    for (let xp = 1; xp <= 1e22; xp *= 1.013) {
      const whole = Math.floor(xp);
      inside(whole);
      inside(whole + 1);
      inside(Math.max(0, whole - 1));
    }
    // And scattered ones, drawn from the engine's own generator so the list is the same on every run.
    const rng = makeRng([5, 1, 22, 2026]);
    for (let i = 0; i < 4000; i += 1) {
      let scale = 1;
      const decades = Math.floor(rng.next() * 23);
      for (let d = 0; d < decades; d += 1) scale *= 10;
      inside(Math.floor(rng.next() * scale));
    }
    inside(0);
    inside(1e22);
  });

  it('accepts a total that is not a whole number', () => {
    expect(levelForXp(9.99, PER_LEVEL)).toBe(1);
    expect(levelForXp(10.01, PER_LEVEL)).toBe(2);
  });

  it('gives level 1 for a total or a rate that is not a positive number', () => {
    expect(levelForXp(-1, PER_LEVEL)).toBe(1);
    expect(levelForXp(-1e22, PER_LEVEL)).toBe(1);
    expect(levelForXp(Number.NaN, PER_LEVEL)).toBe(1);
    expect(levelForXp(500, 0)).toBe(1);
    expect(levelForXp(500, -10)).toBe(1);
    expect(levelForXp(500, Number.NaN)).toBe(1);
  });

  it('follows the rate it is given, not a built-in 10', () => {
    // Twice the XP per level needs twice the total for the same level.
    for (const xp of [0, 19, 20, 59, 60, 123456, 9.9e12]) expect(levelForXp(xp * 2, PER_LEVEL * 2)).toBe(levelForXp(xp, PER_LEVEL));
    expect(xpForLevel(4, 7)).toBe(42);
    expect(levelForXp(41, 7)).toBe(3);
    expect(levelForXp(42, 7)).toBe(4);
  });

  it('never goes down as XP goes up', () => {
    let previous = 1;
    for (let xp = 0; xp < 1e21; xp = xp * 1.5 + 7) {
      const level = levelForXp(xp, PER_LEVEL);
      expect(level).toBeGreaterThanOrEqual(previous);
      previous = level;
    }
  });
});
