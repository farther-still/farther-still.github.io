import { describe, expect, it } from 'vitest';
import { canonicalJson } from './canonical';

describe('canonicalJson', () => {
  it('sorts keys at every depth and writes no whitespace', () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { z: null, y: true }], c: 'x' } })).toBe(
      '{"a":{"c":"x","d":[3,{"y":true,"z":null}]},"b":1}',
    );
  });

  it('gives the same text whatever order the keys were added in', () => {
    const one: Record<string, number> = {};
    one['x'] = 1;
    one['a'] = 2;
    const two: Record<string, number> = {};
    two['a'] = 2;
    two['x'] = 1;
    expect(canonicalJson(one)).toBe(canonicalJson(two));
  });

  it('round-trips through JSON.parse without loss', () => {
    const value = { n: [0, 1, 0.1, 1e21, 5e-324, 9007199254740991], s: 'é\n"\\\u{1F600}', e: {}, l: [] };
    expect(JSON.parse(canonicalJson(value))).toEqual(value);
  });

  it('keeps array order', () => {
    expect(canonicalJson([3, 1, 2])).toBe('[3,1,2]');
  });

  it('refuses values JSON cannot hold exactly', () => {
    expect(() => canonicalJson({ a: undefined })).toThrow();
    expect(() => canonicalJson(Number.NaN)).toThrow();
    expect(() => canonicalJson(Number.POSITIVE_INFINITY)).toThrow();
    expect(() => canonicalJson(new Map())).toThrow();
    expect(() => canonicalJson(() => 1)).toThrow();
  });
});
