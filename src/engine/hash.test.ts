import { describe, expect, it } from 'vitest';
import { hash, hashWords } from './hash';

// Published SHA-256 vectors (FIPS 180-4 examples and the NIST one-million-letter message). These freeze the hash:
// a save checksum made today must verify in every later build.
describe('hash', () => {
  it('matches the published vector for the empty message', () => {
    expect(hash('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('matches the published one-block vector', () => {
    expect(hash('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('matches the published two-block vector', () => {
    expect(hash('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );
  });

  it('matches the published vector for one million letters', () => {
    expect(hash('a'.repeat(1000000))).toBe('cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0');
  });

  it('gives the words that the hex text spells', () => {
    const words = hashWords('abc');
    expect(words).toHaveLength(8);
    expect(words[0]).toBe(0xba7816bf);
    expect(words[7]).toBe(0xf20015ad);
    for (const word of words) expect(Number.isInteger(word) && word >= 0 && word <= 0xffffffff).toBe(true);
  });

  it('is sensitive to a single changed character', () => {
    expect(hash('{"gold":100}')).not.toBe(hash('{"gold":101}'));
  });
});
