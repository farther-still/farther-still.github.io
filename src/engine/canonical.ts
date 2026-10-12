// One serialization for everything that gets hashed: object keys sorted by UTF-16 code unit, no whitespace.
// Saves, golden replays and the self-test hash this text, so its output is frozen by the save fixtures.

const isPlainObject = (value: object): value is Record<string, unknown> => {
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

/**
 * Throws on anything JSON cannot hold exactly (undefined, NaN, an infinity, a function, a class instance),
 * because writing such a value would silently change it.
 */
export const canonicalJson = (value: unknown): string => {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('canonicalJson: number is not finite');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  if (typeof value === 'object' && isPlainObject(value)) {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  throw new Error(`canonicalJson: unsupported value of type ${typeof value}`);
};
