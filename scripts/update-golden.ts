// Rewrites tests/golden/golden.json with what the engine computes now (`npm run golden:update`).
//
// Run it only for an intended change, and log the decision in the GDD: a changed value means every device now
// computes something different. The first eight values (the hash, the generator, square roots and the
// serialization) must never change at all; this script refuses to rewrite them.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadBundledContent } from '../src/content';
import { SELF_TESTS } from '../src/ui/selftest';
import { ROOT } from './lib';

const FILE = join(ROOT, 'tests/golden/golden.json');

/** Arithmetic and serialization the save format rests on. Changing one would be a save migration, not a balance change. */
const FROZEN = /^(hash|generator|square roots|serialization):/;

const main = (): void => {
  const content = loadBundledContent();
  const before = (JSON.parse(readFileSync(FILE, 'utf8')) as { vectors: Record<string, string> }).vectors;
  const vectors: Record<string, string> = {};
  const changed: string[] = [];
  for (const [name, compute] of Object.entries(SELF_TESTS)) {
    const value = compute(content);
    if (FROZEN.test(name) && before[name] !== undefined && before[name] !== value) {
      console.error(`update-golden: "${name}" changed. That value is frozen: the engine's arithmetic or serialization has changed, which this script will not paper over.`);
      process.exitCode = 1;
      return;
    }
    if (before[name] !== value) changed.push(name);
    vectors[name] = value;
  }
  writeFileSync(FILE, `${JSON.stringify({ vectors }, null, 2)}\n`);
  console.log(changed.length === 0 ? 'update-golden: nothing changed' : `update-golden: rewrote ${changed.length} value(s):\n  ${changed.join('\n  ')}`);
};

main();
