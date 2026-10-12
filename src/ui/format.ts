// The one number formatter (GDD 6.4). Displayed values are cut, never rounded, so the screen never shows more
// than the player has. Whether something is affordable is always decided by the engine, never by this text.

const SUFFIXES = ['M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc'];
const MILLION = 1_000_000;

const withSeparators = (whole: number): string => {
  const digits = String(Math.abs(whole));
  let out = '';
  for (let i = 0; i < digits.length; i += 1) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += ',';
    out += digits.charAt(i);
  }
  return whole < 0 ? `-${out}` : out;
};

/**
 * Below one million: every digit, with thousands separators. From one million: four significant figures and a
 * suffix (M, B, T, Qa, Qi, Sx, Sp, Oc, No, Dc); past Dc, scientific notation. `figures` can be raised when two
 * values being compared would otherwise look the same.
 */
export const formatNumber = (value: number, figures = 4): string => {
  if (!Number.isFinite(value)) return '—';
  const whole = Math.trunc(value);
  const size = Math.abs(whole);
  if (size < MILLION) return withSeparators(whole);
  // Cut from the number's own digits, as it prints, and never worked out by arithmetic: dividing and multiplying
  // back loses a digit (0.29 × 100 is 28.99…, which showed 10,290,000 as 10.28M), and rounding to a fixed
  // number of decimals turns 1.9999999 into 2.000. Every whole number in the exact range prints all its digits.
  const [lead = '', power = ''] = size.toExponential().split('e+');
  const exponent = Number(power);
  // Past the last suffix there is none, and the number is shown in scientific notation.
  const suffix = SUFFIXES[Math.floor(exponent / 3) - 2];
  // With a suffix, one to three digits stand before the point; in scientific notation, one.
  const headLength = suffix === undefined ? 1 : (exponent % 3) + 1;
  const digits = lead.replace('.', '').padEnd(Math.max(figures, headLength), '0');
  const fraction = figures > headLength ? `.${digits.slice(headLength, figures)}` : '';
  return `${whole < 0 ? '-' : ''}${digits.slice(0, headLength)}${fraction}${suffix ?? `e${exponent}`}`;
};

/** Two values side by side: if they would display the same but differ, both get more digits. */
export const formatPair = (a: number, b: number): [string, string] => {
  for (let figures = 4; figures <= 12; figures += 2) {
    const pair: [string, string] = [formatNumber(a, figures), formatNumber(b, figures)];
    if (pair[0] !== pair[1] || Math.trunc(a) === Math.trunc(b)) return pair;
  }
  // Sixteen figures is every digit of the largest whole number that is still exact.
  return [formatNumber(a, 16), formatNumber(b, 16)];
};

/** A known chance from 0 to 1 as a whole percentage. An exact 0 or 1 says so; anything else never rounds to them. */
export const formatChance = (chance: number): string => {
  if (chance <= 0) return '0%';
  if (chance >= 1) return '100%';
  if (chance < 0.01) return 'under 1%';
  if (chance > 0.99) return 'over 99%';
  return `${Math.round(chance * 100)}%`;
};

/**
 * A forecast's win chance (GDD 3.5): the nearest 1%, with "under 1%" and "over 99%" at the ends. A forecast is
 * a count of trial battles, so even none won out of a thousand is not a promise of 0%.
 */
export const formatOdds = (chance: number): string => {
  if (chance < 0.01) return 'under 1%';
  if (chance > 0.99) return 'over 99%';
  return `${Math.round(chance * 100)}%`;
};

/** A percentage with at most one decimal, cut not rounded: 21.98 shows as 21.9%. */
export const formatPercent = (percent: number): string => {
  const cutTo = Math.trunc(percent * 10) / 10;
  return `${Number.isInteger(cutTo) ? String(cutTo) : cutTo.toFixed(1)}%`;
};

export const formatDuration = (ms: number): string => {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
};
