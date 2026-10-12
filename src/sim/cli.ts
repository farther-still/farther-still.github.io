// `npm run sim -- --runs 50`: the headless simulator (ARCHITECTURE section 10). Phase 4 adds configurable
// strategies, CSV output and a markdown summary.

import { loadBundledContent } from '../content';
import { DEFAULT_STRATEGY } from './player';
import { formatReport } from './report';
import { playthrough } from './run';
import type { Playthrough } from './run';

const flag = (name: string, fallback: number): number => {
  const at = process.argv.indexOf(`--${name}`);
  const value = at < 0 ? Number.NaN : Number(process.argv[at + 1]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
};

const main = (): void => {
  const runs = flag('runs', 50);
  const players = flag('players', 20);
  const seed = flag('seed', 1);
  const content = loadBundledContent();
  const plays: Playthrough[] = [];
  for (let index = 0; index < players; index += 1) plays.push(playthrough(seed + index, runs, DEFAULT_STRATEGY, content));
  console.log(formatReport(plays, content, DEFAULT_STRATEGY.name));
  if (process.argv.includes('--detail')) {
    const first = plays[0];
    console.log(`\nPlaythrough with seed ${seed}, run by run`);
    for (const run of first?.runs ?? []) {
      console.log(
        `  run ${run.run}: level ${run.level}, strongest ${run.strongest}, wins ${run.wins}, losses ${run.losses}, energy ${run.startingEnergy} (left ${run.energyLeft}), gold ${run.gold}, items [${run.itemsGained.join(' ')}], firsts [${run.firstKills.join(' ')}], gates [${run.gatesBeaten.join(' ')}], claims ${run.claims}`,
      );
    }
  }
};

main();
