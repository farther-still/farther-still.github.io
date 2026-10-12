import { describe, expect, it } from 'vitest';
import { isUint32, makeRng, streamRng, streamSeed } from './rng';

const take = (count: number, draw: () => number): number[] => Array.from({ length: count }, draw);

// Frozen 2026-10-12 (ARCHITECTURE 5.4). A change here changes every battle ever replayed, so these values move
// only with a logged decision. The Settings self-test re-checks the generator on the phone.
describe('generator', () => {
  it('gives the frozen integers for a raw seed', () => {
    expect(take(6, makeRng([1, 2, 3, 4]).nextUint32)).toEqual([
      800524041, 903873393, 3641854082, 3208635939, 1455060588, 4130073006,
    ]);
    expect(take(6, makeRng([0, 0, 0, 0]).nextUint32)).toEqual([
      808754475, 4216505632, 947923937, 2491578854, 3964400089, 2091952393,
    ]);
  });

  it('derives the frozen stream seed from run seed, stream name and counter', () => {
    expect(streamSeed(1, 'battle', 0)).toEqual([83676761, 860367287, 3394759728, 4271480848]);
  });

  it('gives the frozen integers for named streams', () => {
    expect(take(6, streamRng(1, 'battle', 0).nextUint32)).toEqual([
      849597312, 2872956383, 431645022, 4218299567, 3445423630, 716885910,
    ]);
    expect(take(6, streamRng(4294967295, 'salvage', 3).nextUint32)).toEqual([
      4073876136, 1129100535, 271813580, 314871357, 3058418300, 111675927,
    ]);
  });

  it('gives the frozen rolls, each a uint32 divided by 2^32', () => {
    expect(take(3, streamRng(7, 'forecast', 2).next)).toEqual([
      0.5461587042082101, 0.06186179048381746, 0.3784141568467021,
    ]);
  });

  it('repeats exactly for the same seed', () => {
    expect(take(50, streamRng(99, 'reward', 5).nextUint32)).toEqual(take(50, streamRng(99, 'reward', 5).nextUint32));
  });

  it('separates streams by name, by counter and by run seed', () => {
    const base = take(8, streamRng(99, 'battle', 5).nextUint32);
    expect(take(8, streamRng(99, 'reward', 5).nextUint32)).not.toEqual(base);
    expect(take(8, streamRng(99, 'battle', 6).nextUint32)).not.toEqual(base);
    expect(take(8, streamRng(100, 'battle', 5).nextUint32)).not.toEqual(base);
  });

  it('keeps every roll in [0, 1) and every integer in 32 bits', () => {
    const rng = streamRng(2026, 'spawn', 1);
    for (let i = 0; i < 20000; i += 1) {
      const roll = rng.next();
      expect(roll >= 0 && roll < 1).toBe(true);
    }
    for (const value of take(1000, rng.nextUint32)) expect(isUint32(value)).toBe(true);
  });

  it('spreads rolls evenly enough to be a usable generator', () => {
    const rng = streamRng(5, 'battle', 0);
    const buckets = new Array<number>(10).fill(0);
    const draws = 100000;
    for (let i = 0; i < draws; i += 1) {
      const index = Math.floor(rng.next() * 10);
      buckets[index] = (buckets[index] ?? 0) + 1;
    }
    for (const count of buckets) expect(Math.abs(count - draws / 10)).toBeLessThan(draws / 10 / 20);
  });

  it('accepts only whole numbers of 32 unsigned bits as seeds', () => {
    expect(isUint32(0)).toBe(true);
    expect(isUint32(4294967295)).toBe(true);
    expect(isUint32(4294967296)).toBe(false);
    expect(isUint32(-1)).toBe(false);
    expect(isUint32(1.5)).toBe(false);
    expect(isUint32(Number.NaN)).toBe(false);
  });
});
