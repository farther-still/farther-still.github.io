// SHA-256 (FIPS 180-4) over the UTF-8 bytes of a string, written with 32-bit integer operations only so that
// Node and Safari give the same bits. Frozen by the published test vectors in hash.test.ts: saves, golden replays
// and the on-device self-test all depend on it, so changing it is a save migration (ARCHITECTURE 7.1).

const ROUND_CONSTANTS: readonly number[] = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

const INITIAL_STATE: readonly number[] = [
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
];

const BLOCK_BYTES = 64;
const LENGTH_OFFSET = 56;
const TWO_POW_32 = 0x100000000;

const at = (values: ArrayLike<number>, index: number): number => values[index] ?? 0;

const rotr = (value: number, bits: number): number => (value >>> bits) | (value << (32 - bits));

// Lone surrogates become U+FFFD, as TextEncoder and Node do, so the bytes match theirs for any string.
const toUtf8 = (text: string): number[] => {
  const out: number[] = [];
  for (let i = 0; i < text.length; i += 1) {
    let code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      const low = text.charCodeAt(i + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (low - 0xdc00);
        i += 1;
      }
    }
    if (code >= 0xd800 && code <= 0xdfff) code = 0xfffd;
    if (code < 0x80) {
      out.push(code);
    } else if (code < 0x800) {
      out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code < 0x10000) {
      out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      out.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 0x3f), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    }
  }
  return out;
};

/** The digest as eight unsigned 32-bit words. */
export const hashWords = (text: string): number[] => {
  const bytes = toUtf8(text);
  const bitLength = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % BLOCK_BYTES !== LENGTH_OFFSET) bytes.push(0);
  const high = Math.floor(bitLength / TWO_POW_32);
  const low = bitLength >>> 0;
  bytes.push((high >>> 24) & 0xff, (high >>> 16) & 0xff, (high >>> 8) & 0xff, high & 0xff);
  bytes.push((low >>> 24) & 0xff, (low >>> 16) & 0xff, (low >>> 8) & 0xff, low & 0xff);

  const state = INITIAL_STATE.slice();
  const w = new Array<number>(BLOCK_BYTES).fill(0);
  for (let offset = 0; offset < bytes.length; offset += BLOCK_BYTES) {
    for (let i = 0; i < 16; i += 1) {
      const p = offset + i * 4;
      w[i] = (at(bytes, p) << 24) | (at(bytes, p + 1) << 16) | (at(bytes, p + 2) << 8) | at(bytes, p + 3);
    }
    for (let i = 16; i < BLOCK_BYTES; i += 1) {
      const x = at(w, i - 15);
      const y = at(w, i - 2);
      const s0 = rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3);
      const s1 = rotr(y, 17) ^ rotr(y, 19) ^ (y >>> 10);
      w[i] = (at(w, i - 16) + s0 + at(w, i - 7) + s1) | 0;
    }
    let a = at(state, 0);
    let b = at(state, 1);
    let c = at(state, 2);
    let d = at(state, 3);
    let e = at(state, 4);
    let f = at(state, 5);
    let g = at(state, 6);
    let h = at(state, 7);
    for (let i = 0; i < BLOCK_BYTES; i += 1) {
      const big1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const choose = (e & f) ^ (~e & g);
      const t1 = (h + big1 + choose + at(ROUND_CONSTANTS, i) + at(w, i)) | 0;
      const big0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (big0 + majority) | 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) | 0;
    }
    state[0] = (at(state, 0) + a) | 0;
    state[1] = (at(state, 1) + b) | 0;
    state[2] = (at(state, 2) + c) | 0;
    state[3] = (at(state, 3) + d) | 0;
    state[4] = (at(state, 4) + e) | 0;
    state[5] = (at(state, 5) + f) | 0;
    state[6] = (at(state, 6) + g) | 0;
    state[7] = (at(state, 7) + h) | 0;
  }
  return state.map((word) => word >>> 0);
};

/** The digest as 64 lowercase hex characters. */
export const hash = (text: string): string =>
  hashWords(text)
    .map((word) => word.toString(16).padStart(8, '0'))
    .join('');
