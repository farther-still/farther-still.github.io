// The engine's own base-10 logarithm (GDD 6.3). `Math.log10` is not guaranteed to give the same last digit in
// Node and Safari; this is built only from comparison, division, multiplication and addition, in a fixed order,
// so every device gets the same bits. It is used when stats are derived, never inside the battle loop.

// Exact: every power of ten up to 1e22 is a whole number a double holds exactly.
const POWERS = [
  1, 1e1, 1e2, 1e3, 1e4, 1e5, 1e6, 1e7, 1e8, 1e9, 1e10, 1e11, 1e12, 1e13, 1e14, 1e15, 1e16, 1e17, 1e18, 1e19, 1e20, 1e21, 1e22,
];

// 10^(1/2), 10^(1/4), 10^(1/8): dividing by these brings the remainder under 1.334, where the series below
// converges in nine terms.
const ROOTS: ReadonlyArray<readonly [number, number]> = [
  [3.1622776601683795, 0.5],
  [1.7782794100389228, 0.25],
  [1.333521432163324, 0.125],
];

const LN_10 = 2.302585092994046;
const SERIES_TERMS = 9;

/** log10 of a positive finite number, good to about 1e-14. Anything else gives 0, so callers need no guard. */
export const log10 = (value: number): number => {
  if (!(value > 0) || value === Number.POSITIVE_INFINITY) return 0;
  let decade = 0;
  let rest = value;
  // Below 1: multiply up until it is at least 1. Each step is one exact comparison and one multiplication.
  while (rest < 1) {
    rest *= 10;
    decade -= 1;
  }
  const top = POWERS.length - 1;
  while (rest >= (POWERS[top] ?? 1)) {
    rest /= POWERS[top] ?? 1;
    decade += top;
  }
  let index = 0;
  while (index < top && rest >= (POWERS[index + 1] ?? 1)) index += 1;
  rest /= POWERS[index] ?? 1;
  decade += index;

  let fraction = 0;
  for (const [root, part] of ROOTS) {
    if (rest >= root) {
      rest /= root;
      fraction += part;
    }
  }
  // ln(rest) = 2 × (z + z³/3 + z⁵/5 + …) with z = (rest − 1) ÷ (rest + 1), which is under 0.143 here.
  const z = (rest - 1) / (rest + 1);
  const zSquared = z * z;
  let power = z;
  let sum = 0;
  for (let term = 0; term < SERIES_TERMS; term += 1) {
    sum += power / (2 * term + 1);
    power *= zSquared;
  }
  return decade + fraction + (2 * sum) / LN_10;
};
