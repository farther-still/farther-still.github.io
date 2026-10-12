// The golden values the on-device self-test compares against (GDD 6.3). This test runs the same function under
// Node, so the phone is being compared with what Node computes. Change a value in golden.json only with a
// decision logged in the GDD: it means every device now computes something different.

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { hash } from '../../src/engine';
import { loadBundledContent } from '../../src/content';
import type { GameEvent } from '../../src/engine';
import { REPLAYS, SELF_TESTS, runSelfTest } from '../../src/ui/selftest';
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

// A replay matches its own golden value whatever it does, so this checks that the replays still reach the rules
// they are there for. If content or the replay script changes so that, say, the boss is no longer fought, the
// golden value would be rewritten and go on passing; this would not.
describe('what the replays reach', () => {
  type Step = GameEvent[] | { action: string; rejected: string };
  const trailOf = (name: string): Step[] => (REPLAYS[name]?.(CONTENT).trail ?? []) as Step[];
  const events = (trail: Step[]): GameEvent[] => trail.flatMap((step) => (Array.isArray(step) ? step : []));
  const rejections = (trail: Step[]): string[] => trail.flatMap((step) => (Array.isArray(step) ? [] : [`${step.action}:${step.rejected}`]));
  const battles = (trail: Step[]): Array<Extract<GameEvent, { type: 'Battle' }>> => events(trail).filter((event) => event.type === 'Battle');
  const rewards = (trail: Step[]): Array<Extract<GameEvent, { type: 'Rewards' }>> => events(trail).filter((event) => event.type === 'Rewards');
  const isBoss = (enemy: string): boolean => CONTENT.enemies[enemy]?.boss === true;

  it('the run replay wins, loses, levels, finds a drop, buys, tries Salvage at a site and starts a second run', () => {
    const trail = trailOf('run replay: two runs of the real game');
    expect(battles(trail).filter((battle) => battle.win).length).toBeGreaterThan(10);
    expect(battles(trail).some((battle) => !battle.win)).toBe(true);
    expect(rewards(trail).some((reward) => reward.levelAfter > reward.levelBefore)).toBe(true);
    expect(rewards(trail).some((reward) => reward.drops.length > 0)).toBe(true);
    expect(events(trail).some((event) => event.type === 'Bought')).toBe(true);
    expect(events(trail).some((event) => event.type === 'Equipped' && event.item !== null)).toBe(true);
    expect(events(trail).some((event) => event.type === 'Allocated')).toBe(true);
    expect(events(trail).some((event) => event.type === 'RunStarted')).toBe(true);
    // Salvage is reached at a site: it is either tried or turned away for a reason other than where the hero stands.
    expect(rejections(trail)).not.toContain('Salvage:not-at-site');
    expect(rejections(trail).filter((entry) => entry.startsWith('Fight:not-adjacent'))).toEqual([]);
  });

  it('the milestone replay finds a secret, beats a boss, is handed the tool, claims with it, uses Salvage and runs dry', () => {
    const trail = trailOf('milestone replay: a secret, a boss, the tool, a Claim, Salvage and an empty tank');
    const bossWins = battles(trail).filter((battle) => battle.win && isBoss(battle.enemy));
    const bossRewards = rewards(trail).filter((reward) => reward.energyBack > 0);
    expect(events(trail).some((event) => event.type === 'SecretFound')).toBe(true);
    expect(events(trail).some((event) => event.type === 'StashCollected')).toBe(true);
    expect(rejections(trail)).toContain('CollectStash:already-collected');
    expect(bossWins).toHaveLength(2);
    // The first win over the boss: its cost back plus the surplus, its gems, and the tool.
    expect(bossRewards[0]?.energyBack).toBe(bossRewards[0] === undefined ? 0 : bossRewards[0].energyCost + CONTENT.balance.energy.bossSurplus);
    expect(bossRewards[0]?.gems).toBeGreaterThan(0);
    expect(bossRewards[0]?.drops.some((item) => CONTENT.items[item]?.claim === true)).toBe(true);
    expect(rejections(trail)).toContain('Fight:boss-beaten');
    // Past the gate, in another zone.
    expect(events(trail).some((event) => event.type === 'ZoneEntered')).toBe(true);
    expect(new Set(battles(trail).map((battle) => CONTENT.enemies[battle.enemy]?.zone)).size).toBeGreaterThan(1);
    expect(events(trail).some((event) => event.type === 'Salvaged')).toBe(true);
    expect(rejections(trail)).toContain('Salvage:salvage-used');
    // The second win over it, with the tool: a Claim, its cost back and no surplus, and no gems a second time.
    expect(bossRewards[1]).toMatchObject({ claimed: true, gems: 0 });
    expect(bossRewards[1]?.energyBack).toBe(bossRewards[1]?.energyCost);
    expect(rejections(trail)).toContain('Fight:no-energy');
    expect(rewards(trail).some((reward) => reward.energyLeft === 0)).toBe(true);
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
