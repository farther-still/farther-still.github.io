// The engine's only source of randomness: sfc32 (Chris Doty-Humphrey's "small fast counting" generator, 32-bit
// version), which uses only 32-bit adds, shifts and xors, so it is bit-identical in Node and Safari. Frozen by the
// vectors in rng.test.ts and re-checked on the phone by the Settings self-test (ARCHITECTURE 5.4).

import { hashWords } from './hash';

export type StreamName = 'battle' | 'reward' | 'forecast' | 'spawn' | 'salvage';

export type RngSeed = readonly [number, number, number, number];

export type Rng = {
  /** The next unsigned 32-bit integer. */
  nextUint32: () => number;
  /** The next roll in [0, 1): a uint32 divided by 2^32, which is exact. */
  next: () => number;
};

const TWO_POW_32 = 0x100000000;
const WARM_UP_ROUNDS = 15;

/** A run seed must be a whole number that fits in 32 unsigned bits. */
export const isUint32 = (value: number): boolean => Number.isInteger(value) && value >= 0 && value < TWO_POW_32;

/** The seed of one named stream: the first four words of the hash of (run seed, stream name, counter). */
export const streamSeed = (runSeed: number, stream: StreamName, counter: number): RngSeed => {
  const words = hashWords(`${runSeed}:${stream}:${counter}`);
  return [words[0] ?? 0, words[1] ?? 0, words[2] ?? 0, words[3] ?? 0];
};

export const makeRng = (seed: RngSeed): Rng => {
  let a = seed[0] | 0;
  let b = seed[1] | 0;
  let c = seed[2] | 0;
  let d = seed[3] | 0;
  const nextUint32 = (): number => {
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return t >>> 0;
  };
  for (let i = 0; i < WARM_UP_ROUNDS; i += 1) nextUint32();
  return { nextUint32, next: () => nextUint32() / TWO_POW_32 };
};

export const streamRng = (runSeed: number, stream: StreamName, counter: number): Rng =>
  makeRng(streamSeed(runSeed, stream, counter));
