// The engine self-test (GDD 6.3, ARCHITECTURE section 8). The same function runs in the golden test under Node
// and from Settings on the phone, where it compares each result with the value baked in at build time. It is the
// only way to check Safari's arithmetic without a Mac. Phase 3b adds the battle replays to the same list.

import { canonicalJson, hash, newGame, step, streamRng } from '../engine';
import type { Action, Content } from '../engine';

export type SelfTestResult = { name: string; expected: string; actual: string; pass: boolean };

export type GoldenFile = { vectors: Record<string, string> };

const REPLAY_SEED = 20261012;

const REPLAY: readonly Action[] = [
  { type: 'Count' },
  { type: 'AddItem', item: 'd01' },
  { type: 'AddItem', item: 'd01' },
  { type: 'AddItem', item: 'd02' },
  { type: 'Equip', item: 'd01' },
  { type: 'RemoveItem', item: 'd02' },
  { type: 'RemoveItem', item: 'd02' },
  { type: 'SetTarget', item: 'd03' },
  { type: 'Step' },
  { type: 'Count' },
  { type: 'Count' },
  { type: 'NewRun', seed: 4294967295 },
  { type: 'Count' },
  { type: 'Equip', item: 'd03' },
  { type: 'Step' },
  { type: 'Count' },
];

const replayDummy = (content: Content): string => {
  let state = newGame(REPLAY_SEED);
  const log: unknown[] = [];
  for (const action of REPLAY) {
    const result = step(state, action, content);
    if ('rejected' in result) {
      log.push({ rejected: result.rejected });
    } else {
      state = result.state;
      log.push(result.events);
    }
  }
  return hash(canonicalJson({ state, log }));
};

const rngIntegers = (): string => {
  const rng = streamRng(12345, 'battle', 7);
  const out: number[] = [];
  for (let i = 0; i < 1000; i += 1) out.push(rng.nextUint32());
  return hash(out.join(','));
};

const rngRolls = (): string => {
  const rng = streamRng(987654321, 'reward', 0);
  const out: string[] = [];
  for (let i = 0; i < 200; i += 1) out.push(String(rng.next()));
  return hash(out.join(','));
};

// Square roots of whole numbers across the game's range, printed in full. A browser that rounded one
// differently, or printed one differently, would change this hash.
const squareRoots = (): string => {
  const rng = streamRng(42, 'spawn', 0);
  const out: string[] = [];
  let scale = 1;
  for (let i = 0; i < 400; i += 1) {
    out.push(String(Math.sqrt(Math.floor(rng.next() * scale) + i)));
    if (i % 20 === 19) scale *= 10;
  }
  return hash(out.join(','));
};

const canonicalSample = (): string =>
  hash(
    canonicalJson({
      z: [1, 0.1, 1e21, 1e-7, -0, 123456789012345680000],
      a: { 'é': 'naïve', '\u{1F600}': 'face', b: null, a: true },
      text: 'line\nbreak\t"quoted" \\ slash',
    }),
  );

export const SELF_TESTS: Record<string, (content: Content) => string> = {
  'hash: empty text': () => hash(''),
  'hash: abc': () => hash('abc'),
  'hash: two blocks': () => hash('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'),
  'hash: text beyond ASCII': () => hash('Fär—ther \u{1F600} still \ud800 end'),
  'generator: 1000 integers': rngIntegers,
  'generator: 200 rolls': rngRolls,
  'square roots: 400 values': squareRoots,
  'serialization: sorted keys and numbers': canonicalSample,
  'replay: dummy actions': replayDummy,
};

export const runSelfTest = (golden: GoldenFile, content: Content): SelfTestResult[] =>
  Object.entries(SELF_TESTS).map(([name, compute]) => {
    const expected = golden.vectors[name] ?? '(no expected value)';
    let actual: string;
    try {
      actual = compute(content);
    } catch (error) {
      actual = `threw: ${error instanceof Error ? error.message : String(error)}`;
    }
    return { name, expected, actual, pass: actual === expected };
  });
