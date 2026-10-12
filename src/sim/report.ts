// Turns playthroughs into the figures GDD 5.9 sets targets for. Everything is named by ID: the simulator is one
// of the ways content is reviewed without being seen.

import type { Content } from '../engine';
import type { Playthrough, RunRecord } from './run';

const sorted = (values: readonly number[]): number[] => [...values].sort((a, b) => a - b);

const median = (values: readonly number[]): number => {
  const list = sorted(values);
  if (list.length === 0) return 0;
  const middle = Math.floor(list.length / 2);
  return list.length % 2 === 1 ? (list[middle] ?? 0) : ((list[middle - 1] ?? 0) + (list[middle] ?? 0)) / 2;
};

const range = (values: readonly number[]): string => {
  const list = sorted(values);
  return list.length === 0 ? 'none' : `${list[0]}–${list[list.length - 1]}, median ${median(list)}`;
};

const tally = (values: readonly number[]): string => {
  const counts = new Map<number, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([value, count]) => `run ${value}: ${count}`)
    .join(', ');
};

const percent = (part: number, whole: number): string => (whole === 0 ? 'n/a' : `${Math.round((part / whole) * 100)}%`);

/** How long a run takes in real time, from tiles walked and battles fought. */
export type TimeModel = { secondsPerFight: number; secondsPerDecision: number };

export const DEFAULT_PLAYBACK: TimeModel = { secondsPerFight: 4.5, secondsPerDecision: 2 };
export const SKIP_PLAYBACK: TimeModel = { secondsPerFight: 0.8, secondsPerDecision: 2 };

export const runSeconds = (run: RunRecord, content: Content, model: TimeModel): number =>
  run.tiles / content.balance.map.tilesPerSecond + run.battles * (model.secondsPerFight + model.secondsPerDecision);

export type Summary = {
  playthroughs: number;
  runsEach: number;
  /** For each gate boss: the run on which each playthrough first beat it (absent if it never did). */
  breakthrough: Record<string, number[]>;
  neverBroke: Record<string, number>;
  /** Runs up to and including the first breakthrough, pooled over playthroughs. */
  early: RunRecord[];
  all: RunRecord[];
  longestDrySpell: number;
  /** First breakthrough runs that also beat the target number of enemies never beaten before. */
  breakthroughsWithFirsts: number;
  breakthroughs: number;
};

export const summarize = (plays: readonly Playthrough[], content: Content): Summary => {
  const gates = content.enemyOrder.filter((id) => content.enemies[id]?.gate === true);
  const breakthrough: Record<string, number[]> = {};
  const neverBroke: Record<string, number> = {};
  for (const gate of gates) {
    breakthrough[gate] = [];
    neverBroke[gate] = 0;
  }
  const early: RunRecord[] = [];
  let longestDrySpell = 0;
  let breakthroughs = 0;
  let breakthroughsWithFirsts = 0;
  const firstGate = gates[0];

  for (const play of plays) {
    for (const gate of gates) {
      const first = play.runs.find((run) => run.gatesBeaten.includes(gate));
      if (first === undefined) neverBroke[gate] = (neverBroke[gate] ?? 0) + 1;
      else breakthrough[gate]?.push(first.run);
    }
    const firstBreak = firstGate === undefined ? undefined : play.runs.find((run) => run.gatesBeaten.includes(firstGate));
    if (firstBreak !== undefined) {
      breakthroughs += 1;
      if (firstBreak.firstKills.length >= content.balance.pacing.breakthroughFirstKills) breakthroughsWithFirsts += 1;
    }
    const upToBreak = play.runs.filter((run) => firstBreak === undefined || run.run <= firstBreak.run);
    early.push(...upToBreak);
    // Counted only up to the breakthrough: past it, the slice runs out of things to find.
    let dry = 0;
    for (const run of upToBreak) {
      dry = run.persistentGain ? 0 : dry + 1;
      longestDrySpell = Math.max(longestDrySpell, dry);
    }
  }
  return {
    playthroughs: plays.length,
    runsEach: plays[0]?.runs.length ?? 0,
    breakthrough,
    neverBroke,
    early,
    all: plays.flatMap((play) => play.runs),
    longestDrySpell,
    breakthroughs,
    breakthroughsWithFirsts,
  };
};

const verdict = (ok: boolean): string => (ok ? 'in range' : 'OUT OF RANGE');

const between = (value: number, low: number, high: number): boolean => value >= low && value <= high;

/** The plain-text report `npm run sim` prints. */
export const formatReport = (plays: readonly Playthrough[], content: Content, strategyName: string): string => {
  const summary = summarize(plays, content);
  const target = content.balance.pacing;
  const span = (range: { min: number; max: number }): string => `${range.min}–${range.max}`;
  const lines: string[] = [];
  const add = (text = ''): number => lines.push(text);

  add(`Simulator: ${summary.playthroughs} playthroughs of ${summary.runsEach} runs each, strategy "${strategyName}".`);
  add('Content is named by ID. Targets are GDD 5.9.');
  add();
  add('Run by run (median over playthroughs): level at run end, strongest enemy beaten, furthest zone, wins, new items');
  const shown = [1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 15, 20, 25, 30, 40, 50].filter((run) => run <= summary.runsEach);
  for (const number of shown) {
    const runs = plays.map((play) => play.runs[number - 1]).filter((run): run is RunRecord => run !== undefined);
    add(
      `  run ${String(number).padStart(2)}: level ${String(median(runs.map((run) => run.level))).padStart(5)}   strongest ${String(median(runs.map((run) => run.strongest))).padStart(4)}   zone ${median(runs.map((run) => run.zoneReached))}   wins ${String(median(runs.map((run) => run.wins))).padStart(4)}   items ${median(runs.map((run) => run.itemsGained.length))}`,
    );
  }
  add();

  add('Runs to breakthrough (the run that first beats each gate boss)');
  for (const [gate, runs] of Object.entries(summary.breakthrough)) {
    const zone = content.enemies[gate]?.zone ?? '?';
    const never = summary.neverBroke[gate] ?? 0;
    add(`  ${gate} (${zone}): ${range(runs)}${never > 0 ? `; never beaten in ${never} of ${summary.playthroughs} playthroughs` : ''}`);
    add(`    how many playthroughs broke through on each run: ${tally(runs)}`);
    if (zone === content.zoneOrder[0]) add(`    target "runs in Z1" ${span(target.runsInFirstZone)}: ${verdict(runs.length > 0 && between(median(runs), target.runsInFirstZone.min, target.runsInFirstZone.max))}; "no wall over ${target.wallMaxRuns} runs": ${verdict(never === 0 && runs.every((run) => run <= target.wallMaxRuns))}`);
  }
  add();

  const early = summary.early;
  const wins = early.map((run) => run.wins);
  const ratio = early.filter((run) => run.strongest > 0).map((run) => run.level / run.strongest);
  const gains = early.filter((run) => run.persistentGain).length;
  const hard = early.reduce((total, run) => total + run.hardWins, 0);
  const totalWins = early.reduce((total, run) => total + run.wins, 0);
  const defaultTime = early.map((run) => runSeconds(run, content, DEFAULT_PLAYBACK) / 60);
  const skipTime = early.map((run) => runSeconds(run, content, SKIP_PLAYBACK) / 60);
  const round1 = (value: number): number => Math.round(value * 10) / 10;

  add('Up to and including the first breakthrough');
  add(`  wins per run: ${range(wins)}   target ${span(target.winsPerRunEarly)} early: ${verdict(between(median(wins), target.winsPerRunEarly.min, target.winsPerRunEarly.max))}`);
  add(`  hero level ÷ strongest enemy beaten, at run end: median ${round1(median(ratio))}   target ${span(target.levelOverStrongest)}: ${verdict(between(median(ratio), target.levelOverStrongest.min, target.levelOverStrongest.max))}`);
  add(`  runs with a persistent gain: ${percent(gains, early.length)}   target at least ${Math.round(target.persistentGainShare * 100)}%: ${verdict(early.length > 0 && gains / early.length >= target.persistentGainShare)}`);
  add(`  longest spell of runs with no persistent gain: ${summary.longestDrySpell}   target at most ${target.runsWithoutGainMax}: ${verdict(summary.longestDrySpell <= target.runsWithoutGainMax)}`);
  add(`  wins that needed more than ${target.hardWinTries} tries: ${percent(hard, totalWins)}   target under ${Math.round(target.hardWinShareMax * 100)}%: ${verdict(totalWins > 0 && hard / totalWins < target.hardWinShareMax)}`);
  add(`  breakthrough run also beat ${target.breakthroughFirstKills} or more enemies never beaten before: ${summary.breakthroughsWithFirsts} of ${summary.breakthroughs}`);
  add(`  minutes per run, default playback: median ${round1(median(defaultTime))}   target ${span(target.minutesPerRunEarly)}: ${verdict(between(median(defaultTime), target.minutesPerRunEarly.min, target.minutesPerRunEarly.max))}`);
  add(`  minutes per run, skipping battles: median ${round1(median(skipTime))}`);
  add(`  tiles walked per run: median ${median(early.map((run) => run.tiles))}; battles per run: median ${median(early.map((run) => run.battles))}`);
  add();

  add(`Drops: expected kills for each drop at its base chance (target never over ${target.killsPerDropMax})`);
  const kills = content.enemyOrder.flatMap((id) => (content.enemies[id]?.drops ?? []).filter((drop) => drop.chance < 100).map((drop) => 100 / drop.chance));
  add(`  ${range(kills.map((value) => Math.round(value)))}   ${verdict(kills.every((value) => value <= target.killsPerDropMax))}`);
  add();

  add('Whole playthrough');
  const last = plays.map((play) => play.runs[play.runs.length - 1]).filter((run): run is RunRecord => run !== undefined);
  add(`  after run ${summary.runsEach}: level ${range(last.map((run) => run.level))}; starting energy ${range(last.map((run) => run.startingEnergy))}`);
  const owned = plays.map((play) => new Set(play.runs.flatMap((run) => run.itemsGained)).size);
  add(`  distinct items found: ${range(owned)} of ${content.itemOrder.length}`);
  return lines.join('\n');
};
