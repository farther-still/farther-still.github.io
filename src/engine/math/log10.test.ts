import { describe, expect, it } from 'vitest';
import { log10 } from './log10';

// GDD 6.3 and ARCHITECTURE 5.5: the engine's own log10, tested against known values to a stated tolerance.
// `Math.log10` is banned here as it is in the engine, so every expected value below was worked out outside the
// test, to 40 digits, and written in as the nearest number a double can hold: log10(2) = 0.30102999566398120,
// log10(3) = 0.47712125471966244 and log10(7) = 0.84509804001425683 to 17 places.

/** The tolerance the function's own header states. */
const STATED = 1e-14;

const off = (value: number, expected: number): number => Math.abs(log10(value) - expected);

describe('log10', () => {
  it('is exact at every power of ten from 1 to 1e22', () => {
    const powers = [1, 1e1, 1e2, 1e3, 1e4, 1e5, 1e6, 1e7, 1e8, 1e9, 1e10, 1e11, 1e12, 1e13, 1e14, 1e15, 1e16, 1e17, 1e18, 1e19, 1e20, 1e21, 1e22];
    powers.forEach((value, exponent) => expect(log10(value)).toBe(exponent));
  });

  it('holds the powers of ten below 1 and above 1e22 to 1e-12', () => {
    const cases: Array<[number, number]> = [
      [1e-1, -1],
      [1e-2, -2],
      [1e-3, -3],
      [1e-6, -6],
      [1e-9, -9],
      [1e-12, -12],
      [1e23, 23],
      [1e30, 30],
      [1e44, 44],
      [1e100, 100],
      [1e300, 300],
      [1e-300, -300],
    ];
    for (const [value, expected] of cases) expect(off(value, expected)).toBeLessThanOrEqual(1e-12);
  });

  it('gives the known values', () => {
    const cases: Array<[number, number]> = [
      [2, 0.3010299956639812],
      [3, 0.47712125471966244],
      [7, 0.8450980400142568],
      [5, 0.6989700043360189],
      [1.5, 0.17609125905568124],
      [9.99, 0.9995654882259823],
      [0.5, -0.3010299956639812],
      [0.03, -1.5228787452803376],
      [11, 1.0413926851582251],
      [37, 1.568201724066995],
      [51, 1.7075701760979363],
      // The ratios the stat formulas actually use: Dexterity 1,575 over its pivot of 10, and the last point of the Luck curve.
      [157.5, 2.197280558125619],
      [350, 2.5440680443502757],
      [999999, 5.999999565705301],
      [1234567.89, 6.09151497716927],
    ];
    for (const [value, expected] of cases) expect(off(value, expected)).toBeLessThanOrEqual(STATED);
  });

  it('gives the known values at the sizes the design reaches', () => {
    // GDD 6.1: enemy levels to 1.2e6 in v1 and the largest value anywhere about 5e21.
    expect(off(1.2e6, 6.079181246047625)).toBeLessThanOrEqual(1e-13);
    expect(off(5e21, 21.69897000433602)).toBeLessThanOrEqual(1e-13);
    expect(off(6.02214076e23, 23.779750902385114)).toBeLessThanOrEqual(1e-13);
  });

  it('gives 0 for anything that is not a positive finite number', () => {
    expect(log10(0)).toBe(0);
    expect(log10(-0)).toBe(0);
    expect(log10(-1)).toBe(0);
    expect(log10(-1e300)).toBe(0);
    expect(log10(Number.NaN)).toBe(0);
    expect(log10(Number.POSITIVE_INFINITY)).toBe(0);
    expect(log10(Number.NEGATIVE_INFINITY)).toBe(0);
  });

  it('turns a product into a sum, to 1e-12', () => {
    const values = [0.004, 0.37, 1, 1.0001, 1.3, 1.78, 2, 3.17, 7, 9.999, 10, 42, 157.5, 999, 31337, 4.2e6, 8.8e11];
    for (const a of values) {
      for (const b of values) {
        expect(Math.abs(log10(a * b) - (log10(a) + log10(b)))).toBeLessThanOrEqual(1e-12);
        expect(Math.abs(log10(a / b) - (log10(a) - log10(b)))).toBeLessThanOrEqual(1e-12);
      }
    }
  });

  it('doubles for a square, adds 1 for ten times as much, and changes sign for a reciprocal', () => {
    for (const value of [0.02, 0.9, 1.1, 2.5, 3.3, 17, 350, 12345, 6.5e7]) {
      expect(Math.abs(log10(value * value) - 2 * log10(value))).toBeLessThanOrEqual(1e-12);
      expect(Math.abs(log10(value * 10) - (log10(value) + 1))).toBeLessThanOrEqual(1e-12);
      expect(Math.abs(log10(1 / value) + log10(value))).toBeLessThanOrEqual(1e-12);
    }
  });

  it('never goes down as its input goes up', () => {
    // A fine sweep across two decades, which crosses every table step and every reduction step inside the function.
    let previous = log10(0.09);
    for (let value = 0.09; value < 110; value *= 1.00037) {
      const now = log10(value);
      expect(now).toBeGreaterThanOrEqual(previous);
      previous = now;
    }
  });

  it('has no jump where one decade, or one reduction step, hands over to the next', () => {
    // Square root, fourth root and eighth root of ten, and the decade edges themselves.
    const seams = [1, 1.333521432163324, 1.7782794100389228, 3.1622776601683795, 10, 100, 1e22];
    for (const seam of seams) {
      const below = log10(seam * (1 - 1e-12));
      const above = log10(seam * (1 + 1e-12));
      expect(above).toBeGreaterThanOrEqual(below);
      // Two parts in 1e12 of the input is 8.7e-13 of the result.
      expect(above - below).toBeLessThanOrEqual(2e-12);
    }
  });

  it('gives the same bits every time', () => {
    for (const value of [2, 157.5, 0.3, 4.4e9]) expect(log10(value)).toBe(log10(value));
  });
});
