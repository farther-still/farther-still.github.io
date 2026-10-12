// The one number formatter (GDD 6.4): every digit below a million, four significant figures and a suffix from
// there, scientific notation past the last suffix, and always cut, never rounded.

import { describe, expect, it } from 'vitest';
import { formatChance, formatDuration, formatNumber, formatOdds, formatPair, formatPercent } from './format';

const SUFFIXES = ['M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc'];

/**
 * GDD 6.4 worked out a second way, on the number's own decimal digits. `BigInt` of a whole number is exact, so
 * this has no arithmetic that could round.
 */
const byDigits = (value: number, figures = 4): string => {
  const digits = BigInt(Math.trunc(Math.abs(value))).toString();
  const sign = value < 0 ? '-' : '';
  const group = Math.floor((digits.length - 7) / 3);
  const suffix = SUFFIXES[group];
  const headLength = suffix === undefined ? 1 : digits.length - 6 - 3 * group;
  const decimals = Math.max(0, figures - headLength);
  const shown = `${digits.slice(0, headLength)}${decimals === 0 ? '' : `.${digits.slice(headLength, headLength + decimals).padEnd(decimals, '0')}`}`;
  return suffix === undefined ? `${sign}${shown}e${digits.length - 1}` : `${sign}${shown}${suffix}`;
};

/** The same whole numbers every time, spread evenly over the digit counts: a small generator, so a failure can be reproduced. */
const wholeNumbers = (count: number, lowest: number, highest: number): number[] => {
  let state = 20261012;
  const out: number[] = [];
  for (let i = 0; i < count; i += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const exponent = Math.log10(lowest) + (state / 4294967296) * (Math.log10(highest) - Math.log10(lowest));
    out.push(Math.min(highest, Math.max(lowest, Math.floor(10 ** exponent))));
  }
  return out;
};

/** A number from its decimal spelling, which is read exactly; `10 ** n` is not exact for a large `n`. */
const spelled = (text: string): number => Number(text);

describe('formatNumber', () => {
  it('shows every digit, with thousands separators, below one million', () => {
    expect(formatNumber(0)).toBe('0');
    expect(formatNumber(7)).toBe('7');
    expect(formatNumber(999)).toBe('999');
    expect(formatNumber(1000)).toBe('1,000');
    expect(formatNumber(12345)).toBe('12,345');
    expect(formatNumber(100000)).toBe('100,000');
    expect(formatNumber(999999)).toBe('999,999');
  });

  it('cuts a fraction off, never rounding it up', () => {
    expect(formatNumber(0.99)).toBe('0');
    expect(formatNumber(1234.9)).toBe('1,234');
    expect(formatNumber(999999.9)).toBe('999,999');
  });

  it('shows four significant figures and a suffix from one million', () => {
    expect(formatNumber(1_000_000)).toBe('1.000M');
    expect(formatNumber(1_234_567)).toBe('1.234M');
    expect(formatNumber(12_345_678)).toBe('12.34M');
    expect(formatNumber(123_456_789)).toBe('123.4M');
  });

  it('uses each suffix in turn: M, B, T, Qa, Qi, Sx, Sp, Oc, No, Dc', () => {
    SUFFIXES.forEach((suffix, group) => {
      const power = 6 + 3 * group;
      // One, two and three digits before the point, each in the middle of a displayed step.
      expect(formatNumber(spelled(`1.5005e${power}`)), suffix).toBe(`1.500${suffix}`);
      expect(formatNumber(spelled(`25.005e${power}`)), suffix).toBe(`25.00${suffix}`);
      expect(formatNumber(spelled(`350.05e${power}`)), suffix).toBe(`350.0${suffix}`);
    });
  });

  it('starts each suffix at its own round number, and ends the one before just under it', () => {
    // Past the exact range a number is the one it prints as: 1e33 is one Dc, not 999.9 No.
    SUFFIXES.forEach((suffix, group) => {
      const power = 6 + 3 * group;
      expect(formatNumber(spelled(`1e${power}`)), suffix).toBe(`1.000${suffix}`);
      expect(formatNumber(spelled(`1.5e${power}`)), suffix).toBe(`1.500${suffix}`);
      expect(formatNumber(spelled(`25e${power}`)), suffix).toBe(`25.00${suffix}`);
      expect(formatNumber(spelled(`999.99e${power}`)), suffix).toBe(`999.9${suffix}`);
    });
  });

  it('cuts, never rounds, a value just under a boundary', () => {
    expect(formatNumber(1_999_999)).toBe('1.999M');
    expect(formatNumber(9_999_999)).toBe('9.999M');
    expect(formatNumber(99_999_999)).toBe('99.99M');
    expect(formatNumber(999_999_999)).toBe('999.9M');
    expect(formatNumber(1_000_000_000)).toBe('1.000B');
    expect(formatNumber(999_999_999_999)).toBe('999.9B');
    expect(formatNumber(1_000_000_000_000)).toBe('1.000T');
    expect(formatNumber(999_999_999_999_999)).toBe('999.9T');
    expect(formatNumber(1_000_000_000_000_000)).toBe('1.000Qa');
    expect(formatNumber(8_999_999_999_999_999)).toBe('8.999Qa');
    expect(formatNumber(Number.MAX_SAFE_INTEGER)).toBe('9.007Qa');
  });

  it('shows a value that sits exactly on a displayed digit as that digit, not the one below', () => {
    // Each of these is exactly what it reads as. Working the decimals out by dividing first loses that.
    expect(formatNumber(1_290_000)).toBe('1.290M');
    expect(formatNumber(10_290_000)).toBe('10.29M');
    expect(formatNumber(10_570_000)).toBe('10.57M');
    expect(formatNumber(10_580_000)).toBe('10.58M');
    expect(formatNumber(113_500_000)).toBe('113.5M');
    expect(formatNumber(10_290_000_000)).toBe('10.29B');
    expect(formatNumber(10_290_000_000_000)).toBe('10.29T');
    expect(formatNumber(10_290_000_000_000_000)).toBe('10.29Qa');
  });

  it('agrees with the digits themselves for whole numbers all through the exact range', () => {
    const wrong: string[] = [];
    const check = (value: number, figures: number): void => {
      const shown = formatNumber(value, figures);
      if (shown !== byDigits(value, figures)) wrong.push(`${value} at ${figures} figures: ${shown}, not ${byDigits(value, figures)}`);
    };
    // Every thousand from one to ten million, where the fourth figure changes, and the same step in each later group.
    for (const unit of [1e6, 1e9, 1e12, 1e15]) {
      for (let thousandths = 1000; thousandths < 10000; thousandths += 1) {
        const value = (thousandths * unit) / 1000;
        if (!Number.isSafeInteger(value)) continue;
        check(value, 4);
        if (value > 1e6) check(value - 1, 4);
      }
    }
    for (const value of wholeNumbers(20000, 1e6, Number.MAX_SAFE_INTEGER)) {
      for (const figures of [4, 6, 8, 10, 12, 16]) check(value, figures);
    }
    expect(wrong.slice(0, 5)).toEqual([]);
  });

  it('switches to scientific notation past Dc, still cut and never rounded', () => {
    // A power of two is exact however large: 2 to the 120th is 1,329,227,995,784,915,872,903,807,060,280,344,576.
    expect(formatNumber(2 ** 120)).toBe('1.329e36');
    expect(formatNumber(2 ** 130)).toBe('1.361e39');
    expect(formatNumber(1.5e40)).toBe('1.500e40');
    expect(formatNumber(1.2345e40)).toBe('1.234e40');
    expect(formatNumber(1e100)).toBe('1.000e100');
    // Just under a boundary: 1.9999999 and 9.9999999 must not become 2.000 and 10.00.
    expect(formatNumber(1.9999999e36)).toBe('1.999e36');
    expect(formatNumber(2.8029995e44)).toBe('2.802e44');
    expect(formatNumber(9.9999999e40)).toBe('9.999e40');
    expect(formatNumber(9.99999999999999e36)).toBe('9.999e36');
    // The last value with a suffix, and the first without.
    expect(formatNumber(9.9995e35)).toBe('999.9Dc');
    expect(formatNumber(1e36)).toBe('1.000e36');
    expect(formatNumber(1.0001e36)).toBe('1.000e36');
  });

  it('agrees with the digits themselves for numbers too large to be exact, away from a boundary', () => {
    // Above the exact range a number is whatever its nearest representable value is, so these are taken at the
    // middle of a displayed step, where that makes no difference to what is shown.
    const wrong: string[] = [];
    for (let exponent = 16; exponent <= 60; exponent += 1) {
      for (const lead of ['1.0005', '1.2345', '2.5005', '4.9995', '7.7775', '9.9985']) {
        const value = spelled(`${lead}e${exponent}`);
        if (formatNumber(value) !== byDigits(value)) wrong.push(`${value}: ${formatNumber(value)}, not ${byDigits(value)}`);
        if (formatNumber(-value) !== byDigits(-value)) wrong.push(`${-value}: ${formatNumber(-value)}, not ${byDigits(-value)}`);
      }
    }
    expect(wrong.slice(0, 5)).toEqual([]);
  });

  it('formats a negative number as its size with a minus sign', () => {
    expect(formatNumber(-5)).toBe('-5');
    expect(formatNumber(-1234)).toBe('-1,234');
    expect(formatNumber(-999999)).toBe('-999,999');
    expect(formatNumber(-1_234_567)).toBe('-1.234M');
    expect(formatNumber(-999_999_999)).toBe('-999.9M');
    expect(formatNumber(-1_000_000_000)).toBe('-1.000B');
    expect(formatNumber(-1.5e40)).toBe('-1.500e40');
    // Cut toward zero, and no "-0".
    expect(formatNumber(-1234.9)).toBe('-1,234');
    expect(formatNumber(-0.5)).toBe('0');
  });

  it('shows a dash for something that is not a number', () => {
    expect(formatNumber(Number.NaN)).toBe('—');
    expect(formatNumber(Number.POSITIVE_INFINITY)).toBe('—');
    expect(formatNumber(Number.NEGATIVE_INFINITY)).toBe('—');
  });

  it('shows more figures when asked, still cut', () => {
    expect(formatNumber(1_234_567, 6)).toBe('1.23456M');
    expect(formatNumber(1_234_567, 7)).toBe('1.234567M');
    expect(formatNumber(999_999_999, 6)).toBe('999.999M');
    expect(formatNumber(123_456_789, 2)).toBe('123M');
    expect(formatNumber(999_999, 2)).toBe('999,999');
    expect(formatNumber(2 ** 120, 8)).toBe('1.3292279e36');
  });
});

describe('formatPair', () => {
  it('leaves two values alone when they already display differently', () => {
    expect(formatPair(100, 200)).toEqual(['100', '200']);
    expect(formatPair(1_234_567, 1_300_000)).toEqual(['1.234M', '1.300M']);
    expect(formatPair(999_999, 1_000_000)).toEqual(['999,999', '1.000M']);
  });

  it('gives both more digits when they differ but would display the same', () => {
    expect(formatPair(1_234_567, 1_234_999)).toEqual(['1.23456M', '1.23499M']);
    expect(formatPair(1_234_567, 1_234_568)).toEqual(['1.2345670M', '1.2345680M']);
    expect(formatPair(45_000_000_100, 45_000_000_900)).toEqual(['45.00000010B', '45.00000090B']);
  });

  it('adds nothing when the two are the same whole number', () => {
    expect(formatPair(5, 5)).toEqual(['5', '5']);
    expect(formatPair(1_234_567, 1_234_567)).toEqual(['1.234M', '1.234M']);
    // Only the whole part is ever shown, so two values inside the same whole number are the same value here.
    expect(formatPair(1_234_567.2, 1_234_567.9)).toEqual(['1.234M', '1.234M']);
  });

  it('tells any two different whole numbers apart, to the top of the exact range', () => {
    expect(formatPair(1_000_000_000_000_001, 1_000_000_000_000_002)).toEqual(['1.000000000000001Qa', '1.000000000000002Qa']);
    const top = formatPair(Number.MAX_SAFE_INTEGER - 1, Number.MAX_SAFE_INTEGER);
    expect(top).toEqual(['9.007199254740990Qa', '9.007199254740991Qa']);
    for (const value of wholeNumbers(2000, 1e6, Number.MAX_SAFE_INTEGER - 1)) {
      const [a, b] = formatPair(value, value + 1);
      expect(a, String(value)).not.toBe(b);
    }
  });
});

describe('formatChance', () => {
  it('shows a whole percentage, to the nearest 1%', () => {
    expect(formatChance(0.5)).toBe('50%');
    expect(formatChance(0.014)).toBe('1%');
    expect(formatChance(0.015)).toBe('2%');
    expect(formatChance(0.29)).toBe('29%');
    expect(formatChance(0.985)).toBe('99%');
  });

  it('says "under 1%" and "over 99%" at the ends, and never rounds a chance to a certainty', () => {
    expect(formatChance(0.004)).toBe('under 1%');
    expect(formatChance(0.0099)).toBe('under 1%');
    expect(formatChance(0.01)).toBe('1%');
    expect(formatChance(0.99)).toBe('99%');
    expect(formatChance(0.991)).toBe('over 99%');
    expect(formatChance(0.9999)).toBe('over 99%');
  });

  it('says 0% and 100% only when the chance is exactly that, or outside the range', () => {
    expect(formatChance(0)).toBe('0%');
    expect(formatChance(1)).toBe('100%');
    expect(formatChance(-0.2)).toBe('0%');
    expect(formatChance(1.2)).toBe('100%');
  });
});

describe('formatOdds', () => {
  it('shows a forecast to the nearest 1%', () => {
    expect(formatOdds(0.5)).toBe('50%');
    expect(formatOdds(0.014)).toBe('1%');
    expect(formatOdds(0.015)).toBe('2%');
    expect(formatOdds(0.985)).toBe('99%');
    expect(formatOdds(0.01)).toBe('1%');
    expect(formatOdds(0.99)).toBe('99%');
  });

  it('says "under 1%" and "over 99%" at the ends (GDD 3.5)', () => {
    // 9 and 991 wins in 1,000 trials are the first counts past each end.
    expect(formatOdds(9 / 1000)).toBe('under 1%');
    expect(formatOdds(991 / 1000)).toBe('over 99%');
    expect(formatOdds(0.005)).toBe('under 1%');
    expect(formatOdds(0.994)).toBe('over 99%');
    // 99.5% would round to 100%, which a forecast must never say.
    expect(formatOdds(0.995)).toBe('over 99%');
  });

  it('never promises a certainty: no trial won is still "under 1%", and every trial won is still "over 99%"', () => {
    expect(formatOdds(0)).toBe('under 1%');
    expect(formatOdds(1)).toBe('over 99%');
    for (let wins = 0; wins <= 1000; wins += 1) {
      const shown = formatOdds(wins / 1000);
      expect(shown, String(wins)).not.toBe('0%');
      expect(shown, String(wins)).not.toBe('100%');
    }
  });
});

describe('formatPercent', () => {
  it('shows a whole percentage with no decimal', () => {
    expect(formatPercent(0)).toBe('0%');
    expect(formatPercent(5)).toBe('5%');
    expect(formatPercent(100)).toBe('100%');
    expect(formatPercent(150)).toBe('150%');
  });

  it('shows at most one decimal, cut and not rounded', () => {
    expect(formatPercent(21.9)).toBe('21.9%');
    expect(formatPercent(21.98)).toBe('21.9%');
    expect(formatPercent(12.3456)).toBe('12.3%');
    expect(formatPercent(99.99)).toBe('99.9%');
    expect(formatPercent(0.05)).toBe('0%');
    expect(formatPercent(-3.47)).toBe('-3.4%');
  });

  it('shows every tenth as itself', () => {
    const wrong: string[] = [];
    for (let tenths = 0; tenths <= 3000; tenths += 1) {
      const whole = Math.floor(tenths / 10);
      const expected = tenths % 10 === 0 ? `${whole}%` : `${whole}.${tenths % 10}%`;
      if (formatPercent(tenths / 10) !== expected) wrong.push(`${tenths / 10}: ${formatPercent(tenths / 10)}`);
    }
    expect(wrong).toEqual([]);
  });
});

describe('formatDuration', () => {
  it('shows minutes and seconds, cutting part of a second', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(999)).toBe('0:00');
    expect(formatDuration(1000)).toBe('0:01');
    expect(formatDuration(59_999)).toBe('0:59');
    expect(formatDuration(60_000)).toBe('1:00');
    expect(formatDuration(754_321)).toBe('12:34');
  });

  it('keeps counting minutes past an hour, and shows nothing below zero', () => {
    expect(formatDuration(3_600_000)).toBe('60:00');
    expect(formatDuration(7_265_000)).toBe('121:05');
    expect(formatDuration(-5000)).toBe('0:00');
  });
});
