// `npm run sim`: the headless simulator (ARCHITECTURE section 10).
//
//   npm run sim -- --runs 50                                   20 players, the shipped rule and numbers
//   npm run sim -- --players 200 --runs 14 --strategy all --rule both --variant shipped,energy-24 --recorded
//
//   --runs N        runs per player (50)                 --players N     players per configuration (20)
//   --seed N        the first player's seed (1)          --jobs N        processes to spread players over
//   --strategy A,B  names from strategies.json, or all   --rule R        shipped, free, charged or both
//   --variant A,B   names from variants.json             --out DIR       where runs.csv and summary.md go (sim-out/latest)
//                   `charged:energy-25` plays a variant under one rule only
//   --recorded      set each strategy beside the recorded playthrough    --detail  print the first player run by run
//   --probes        write probes.md and stop: goldAt at zone edges, and the level a Claim needs. No player is simulated
//
// Every configuration plays the same seeds, so two of them differ only in what was changed.

import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RECORDED, RULES, contentFor, labelOf, ruleInForce, strategyNamed, strategyNames, variantNamed } from './config';
import type { Config, Rule } from './config';
import { formatCsv } from './csv';
import { formatProbes } from './probes';
import { formatSummary } from './report';
import { playthrough } from './run';
import type { Playthrough } from './run';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const text = (name: string, fallback: string): string => {
  const at = process.argv.indexOf(`--${name}`);
  const value = at < 0 ? undefined : process.argv[at + 1];
  return value === undefined || value.startsWith('--') ? fallback : value;
};

const whole = (name: string, fallback: number): number => {
  const value = Number(text(name, ''));
  return Number.isInteger(value) && value > 0 ? value : fallback;
};

// ---- a worker plays one share of one configuration's players ----

type Job = { rule: Rule; variant: string; strategy: string; seeds: number[]; runs: number };

const play = (job: Job): Playthrough[] => {
  const content = contentFor(job.rule, variantNamed(job.variant));
  const strategy = strategyNamed(job.strategy);
  return job.seeds.map((seed) => playthrough(seed, job.runs, strategy, content));
};

const worker = async (): Promise<void> => {
  let input = '';
  for await (const chunk of process.stdin) input += String(chunk);
  process.stdout.write(JSON.stringify(play(JSON.parse(input) as Job)));
};

const inChild = (job: Job): Promise<Playthrough[]> =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [...process.execArgv, fileURLToPath(import.meta.url), '--worker'], { stdio: ['pipe', 'pipe', 'inherit'] });
    let output = '';
    child.stdout.on('data', (chunk) => (output += String(chunk)));
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve(JSON.parse(output) as Playthrough[]) : reject(new Error(`sim: a worker stopped with code ${code}`))));
    child.stdin.end(JSON.stringify(job));
  });

/** Runs every job, at most `limit` at a time, and returns the results in the jobs' own order. */
const pooled = async <T, R>(jobs: readonly T[], limit: number, run: (job: T) => Promise<R>): Promise<R[]> => {
  const results: R[] = [];
  let next = 0;
  const lane = async (): Promise<void> => {
    for (;;) {
      const index = next;
      next += 1;
      const job = jobs[index];
      if (job === undefined) return;
      results[index] = await run(job);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, limit) }, lane));
  return results;
};

// ---- the command ----

const main = async (): Promise<void> => {
  const runs = whole('runs', 50);
  const players = whole('players', 20);
  const seed = whole('seed', 1);
  const jobs = whole('jobs', Math.max(1, Math.min(10, availableParallelism() - 2)));
  const out = text('out', join('sim-out', 'latest'));
  const strategies = text('strategy', 'climb-then-collect') === 'all' ? strategyNames() : text('strategy', 'climb-then-collect').split(',');
  const variants = text('variant', 'shipped').split(',');
  const ruleFlag = text('rule', 'shipped');
  const rules: Rule[] = ruleFlag === 'both' ? ['free', 'charged'] : [ruleFlag as Rule];
  if (!rules.every((rule) => (RULES as readonly string[]).includes(rule))) throw new Error(`sim: --rule takes ${RULES.join(', ')} or both`);

  if (process.argv.includes('--probes')) {
    const probes = formatProbes(contentFor(rules[0] ?? 'shipped', variantNamed((variants[0] ?? 'shipped').split(':').pop() ?? 'shipped')), strategies.map((name) => ({ name, split: strategyNamed(name).split })));
    mkdirSync(join(ROOT, out), { recursive: true });
    writeFileSync(join(ROOT, out, 'probes.md'), probes);
    console.log(probes);
    console.log(`Wrote ${join(out, 'probes.md')}.`);
    return;
  }

  // Each configuration is checked before anything is played, so a mistyped name fails at once.
  const configs: Config[] = rules.flatMap((rule) =>
    variants.flatMap((entry) => {
      const [only, name] = entry.includes(':') ? entry.split(':') : [null, entry];
      if (only !== null && !(RULES as readonly string[]).includes(only)) throw new Error(`sim: "${entry}" names a rule that does not exist`);
      return only !== null && only !== rule ? [] : strategies.map((strategy) => ({ rule, variant: variantNamed(name ?? ''), strategy: strategyNamed(strategy) }));
    }),
  );
  if (configs.length === 0) throw new Error('sim: no variant is played under the rule asked for');
  const seeds = Array.from({ length: players }, (_, index) => seed + index);
  const shares = Math.min(jobs, players);
  const work = configs.flatMap((config, at) =>
    Array.from({ length: shares }, (_, share) => ({ at, job: { rule: config.rule, variant: config.variant.name, strategy: config.strategy.name, seeds: seeds.filter((_seed, index) => index % shares === share), runs } })),
  );
  const done = await pooled(work, jobs, async (entry) => ({ at: entry.at, plays: jobs === 1 ? play(entry.job) : await inChild(entry.job) }));

  const results = configs.map((config, at) => {
    const content = contentFor(config.rule, config.variant);
    const plays = done.filter((entry) => entry.at === at).flatMap((entry) => entry.plays).sort((a, b) => a.seed - b.seed);
    return { config, content, plays, label: labelOf(config, content), about: `${config.variant.about} ${config.strategy.about}` };
  });

  const summary = formatSummary(results, { seed, recorded: process.argv.includes('--recorded') ? RECORDED : null, gdd: readFileSync(join(ROOT, 'docs', 'GDD.md'), 'utf8') });
  const csv = formatCsv(results.map((result) => ({ rule: ruleInForce(result.content), variant: result.config.variant.name, strategy: result.config.strategy.name, content: result.content, plays: result.plays })));
  mkdirSync(join(ROOT, out), { recursive: true });
  writeFileSync(join(ROOT, out, 'summary.md'), summary);
  writeFileSync(join(ROOT, out, 'runs.csv'), csv);
  console.log(summary);
  console.log(`Wrote ${join(out, 'summary.md')} and ${join(out, 'runs.csv')} (${csv.split('\n').length - 2} runs).`);

  if (process.argv.includes('--detail')) {
    const first = results[0]?.plays[0];
    console.log(`\nPlayer with seed ${seed}, ${results[0]?.label ?? ''}, run by run`);
    for (const run of first?.runs ?? []) {
      console.log(
        `  run ${run.run}: level ${run.level}, strongest ${run.strongest}, wins ${run.wins}, losses ${run.losses}, energy ${run.startingEnergy} (left ${run.energyLeft}), gold ${run.gold}, drops [${run.drops.join(' ')}], bought [${run.bought.join(' ')}], salvage ${run.salvageTried ? (run.salvaged ?? 'miss') : 'none'}, firsts [${run.firstKills.join(' ')}], gates [${run.gatesBeaten.join(' ')}], wall ${run.wall ?? 'none'} at ${Math.round(run.wallChance * 100)}% after ${run.wallFights} fights, claims ${run.claims}`,
      );
    }
  }
};

await (process.argv.includes('--worker') ? worker() : main());
