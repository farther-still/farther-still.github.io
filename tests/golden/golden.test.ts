// The golden values the on-device self-test compares against (GDD 6.3). This test runs the same function under
// Node, so the phone is being compared with what Node computes. Change a value in golden.json only with a
// decision logged in the GDD: it means every device now computes something different.

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { hash } from '../../src/engine';
import { loadBundledContent } from '../../src/content';
import { SELF_TESTS, runSelfTest } from '../../src/ui/selftest';
import golden from './golden.json';

// The same content the built app loads, so the phone and this test replay against the same thing.
const CONTENT = loadBundledContent();

describe('golden values', () => {
  it('has exactly one expected value for every self-test', () => {
    expect(Object.keys(golden.vectors).sort()).toEqual(Object.keys(SELF_TESTS).sort());
  });

  it('matches every expected value under Node', () => {
    const results = runSelfTest(golden, CONTENT);
    expect(results.filter((result) => !result.pass).map((result) => result.name)).toEqual([]);
    expect(results).toHaveLength(Object.keys(SELF_TESTS).length);
  });

  it('reports a mismatch instead of passing when a value differs', () => {
    const wrong = { vectors: { ...golden.vectors, 'hash: abc': '0'.repeat(64) } };
    const failed = runSelfTest(wrong, CONTENT).filter((result) => !result.pass);
    expect(failed.map((result) => result.name)).toEqual(['hash: abc']);
  });

  it('reports a missing expected value as a failure', () => {
    expect(runSelfTest({ vectors: {} }, CONTENT).every((result) => !result.pass)).toBe(true);
  });
});

// The engine's hash against Node's own SHA-256, over text chosen to stress the UTF-8 encoder and the block
// boundaries. This is the independent check that the pure-TypeScript hash is the standard one.
describe('hash against node:crypto', () => {
  const reference = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

  it('agrees at every length around the block boundaries', () => {
    for (const length of [0, 1, 54, 55, 56, 57, 63, 64, 65, 118, 119, 120, 127, 128, 129, 1000]) {
      const text = 'x'.repeat(length);
      expect(hash(text), `length ${length}`).toBe(reference(text));
    }
  });

  it('agrees on text beyond ASCII, including unpaired surrogates', () => {
    const samples = [
      'é',
      'naïve café',
      '—',
      '漢字かな',
      '\u{1F600}',
      'a\u{1F600}b\u{10FFFF}c',
      '\u0000\u007f\u0080߿ࠀ￿',
      '\ud800',
      '\udc00',
      'x\ud800y',
      '\udc00\ud800',
      '\ud83d',
      '{"name":"Señor","gold":1e21}',
    ];
    for (const text of samples) expect(hash(text), JSON.stringify(text)).toBe(reference(text));
  });

  it('agrees on a few thousand generated strings', () => {
    let seed = 12345;
    const next = (): number => {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      return seed;
    };
    for (let i = 0; i < 3000; i += 1) {
      const length = next() % 200;
      let text = '';
      for (let j = 0; j < length; j += 1) text += String.fromCharCode(next() % 0x10000);
      expect(hash(text)).toBe(reference(text));
    }
  });
});
