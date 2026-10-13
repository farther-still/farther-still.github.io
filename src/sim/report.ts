// Turns playthroughs into the figures GDD 5.9 sets targets for, and those into the markdown summary. Everything
// is named by ID: the simulator is one of the ways content is reviewed without being seen.
//
// The summary has one row for every row of the table in GDD 5.9, read from the GDD itself, so a target added
// there with no measure here is an error and not a silent gap.

import type { Content } from '../engine';
import type { Recorded } from './config';
import type { Playthrough, RunRecord } from './run';

// ---- small statistics ----

const sorted = (values: readonly number[]): number[] => [...values].sort((a, b) => a - b);

export const median = (values: readonly number[]): number => {
  const list = sorted(values);
  if (list.length === 0) return 0;
  const middle = Math.floor(list.length / 2);
  return list.length % 2 === 1 ? (list[middle] ?? 0) : ((list[middle - 1] ?? 0) + (list[middle] ?? 0)) / 2;
};

/** The value at or below which `share` of the list lies, by nearest rank. */
export const percentile = (values: readonly number[], share: number): number => {
  const list = sorted(values);
  if (list.length === 0) return 0;
  return list[Math.min(list.length - 1, Math.max(0, Math.ceil(share * list.length) - 1))] ?? 0;
};

const mean = (values: readonly number[]): number => (values.length === 0 ? 0 : values.reduce((total, value) => total + value, 0) / values.length);

const round1 = (value: number): number => Math.round(value * 10) / 10;
const percent = (part: number, whole: number): string => (whole === 0 ? 'n/a' : `${Math.round((part / whole) * 100)}%`);
const span = (range: { min: number; max: number }): string => `${range.min}–${range.max}`;
const between = (value: number, range: { min: number; max: number }): boolean => value >= range.min && value <= range.max;
/** Median with the 10th and 90th percentiles: "6 (4–8)". */
const band = (values: readonly number[]): string => (values.length === 0 ? 'none' : `${round1(median(values))} (${round1(percentile(values, 0.1))}–${round1(percentile(values, 0.9))})`);
const clock = (seconds: number): string => `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}`;

// ---- real time ----

/** How long a run takes in real time, from tiles walked and battles fought. */
export type TimeModel = { secondsPerFight: number; secondsPerDecision: number };

/** The playback aims at 4.2 seconds a battle at 1× (src/ui/fight.ts) and opens after a quarter of a second. */
export const DEFAULT_PLAYBACK: TimeModel = { secondsPerFight: 4.5, secondsPerDecision: 2 };
export const SKIP_PLAYBACK: TimeModel = { secondsPerFight: 0.8, secondsPerDecision: 2 };

export const runSeconds = (run: RunRecord, content: Content, model: TimeModel): number =>
  run.tiles / content.balance.map.tilesPerSecond + run.battles * (model.secondsPerFight + model.secondsPerDecision);

// ---- what was measured ----

export type Measures = {
  players: number;
  runsEach: number;
  /** The first gate boss: the one wall the slice has. */
  gate: string | null;
  /** For each player who beat it, the run on which the gate first fell. */
  breakRuns: number[];
  never: number;
  /** Players for whom the wall took more runs than the ceiling, those who never beat it included. */
  overCeiling: number;
  insideFirstZone: number;
  /** Runs up to and including each player's first breakthrough: after it the slice runs out of things to find. */
  early: RunRecord[];
  wins: number[];
  losses: number[];
  ratio: number[];
  gainRuns: number;
  longestDry: number;
  playersOverDry: number;
  hardWins: number;
  totalWins: number;
  /** Fights at the gate on the run it fell, the winning one included. */
  gateTries: number[];
  gateFallsOverTries: number;
  breakthroughs: number;
  breakthroughsWithFirsts: number;
  minutesDefault: number[];
  minutesSkip: number[];
  /** Expected kills for each drop under 100%, at its base chance. */
  killsPerDrop: number[];
  /** Level at the end of each run, one list per run number, over all players. */
  levelByRun: number[][];
  /** Modelled seconds at default playback, one list per run number. */
  secondsByRun: number[][];
};

export const measure = (plays: readonly Playthrough[], content: Content): Measures => {
  const target = content.balance.pacing;
  const gate = content.enemyOrder.find((id) => content.enemies[id]?.gate === true) ?? null;
  const breakRuns: number[] = [];
  const early: RunRecord[] = [];
  const gateTries: number[] = [];
  let never = 0;
  let longestDry = 0;
  let playersOverDry = 0;
  let breakthroughsWithFirsts = 0;

  for (const play of plays) {
    const first = gate === null ? undefined : play.runs.find((run) => run.gatesBeaten.includes(gate));
    if (first === undefined) never += 1;
    else {
      breakRuns.push(first.run);
      gateTries.push(first.wallFights);
      if (first.firstKills.length >= target.breakthroughFirstKills) breakthroughsWithFirsts += 1;
    }
    const upToBreak = play.runs.filter((run) => first === undefined || run.run <= first.run);
    early.push(...upToBreak);
    let dry = 0;
    let worst = 0;
    for (const run of upToBreak) {
      dry = run.persistentGain ? 0 : dry + 1;
      worst = Math.max(worst, dry);
    }
    longestDry = Math.max(longestDry, worst);
    if (worst > target.runsWithoutGainMax) playersOverDry += 1;
  }

  const runsEach = plays[0]?.runs.length ?? 0;
  const byRun = <T>(pick: (run: RunRecord) => T): T[][] => Array.from({ length: runsEach }, (_, index) => plays.flatMap((play) => (play.runs[index] === undefined ? [] : [pick(play.runs[index])])));
  return {
    players: plays.length,
    runsEach,
    gate,
    breakRuns,
    never,
    overCeiling: never + breakRuns.filter((run) => run > target.wallMaxRuns).length,
    insideFirstZone: breakRuns.filter((run) => between(run, target.runsInFirstZone)).length,
    early,
    wins: early.map((run) => run.wins),
    losses: early.map((run) => run.losses),
    ratio: early.filter((run) => run.strongest > 0).map((run) => run.level / run.strongest),
    gainRuns: early.filter((run) => run.persistentGain).length,
    longestDry,
    playersOverDry,
    hardWins: early.reduce((total, run) => total + run.hardWins, 0),
    totalWins: early.reduce((total, run) => total + run.wins, 0),
    gateTries,
    gateFallsOverTries: gateTries.filter((tries) => tries > target.hardWinTries).length,
    breakthroughs: breakRuns.length,
    breakthroughsWithFirsts,
    minutesDefault: early.map((run) => runSeconds(run, content, DEFAULT_PLAYBACK) / 60),
    minutesSkip: early.map((run) => runSeconds(run, content, SKIP_PLAYBACK) / 60),
    killsPerDrop: content.enemyOrder.flatMap((id) => (content.enemies[id]?.drops ?? []).filter((drop) => drop.chance < 100).map((drop) => 100 / drop.chance)),
    levelByRun: byRun((run) => run.level),
    secondsByRun: byRun((run) => runSeconds(run, content, DEFAULT_PLAYBACK)),
  };
};

// ---- the rows of GDD 5.9 ----

export type Verdict = 'MET' | 'NOT MET' | 'MODELLED, in range' | 'MODELLED, OUT OF RANGE' | 'PARTLY' | 'CANNOT MEASURE';

export type Row = { label: string; target: string; result: string; verdict: Verdict };

const met = (ok: boolean): Verdict => (ok ? 'MET' : 'NOT MET');
const modelled = (ok: boolean): Verdict => (ok ? 'MODELLED, in range' : 'MODELLED, OUT OF RANGE');

type Finding = { result: string; verdict: Verdict };

const notBuilt = (what: string): Finding => ({ result: `${what} Only Z1 and two enemies of Z2 exist.`, verdict: 'CANNOT MEASURE' });

/** One entry for every row of the table in GDD 5.9, keyed by the row's own first cell. */
const FINDINGS: Record<string, (m: Measures, content: Content) => Finding> = {
  'Runs per wall': (m, { balance: { pacing } }) => ({
    result: `One wall is built, ${m.gate ?? 'none'}. Its fall: run ${band(m.breakRuns)}, median with the 10th and 90th percentiles${m.never > 0 ? `; ${m.never} of ${m.players} players never beat it in ${m.runsEach} runs` : ''}`,
    verdict: met(m.breakRuns.length > 0 && between(median(m.breakRuns), pacing.runsPerWall)),
  }),
  'Real time per run, Z1–Z2': (m, { balance: { pacing } }) => ({
    result: `${band(m.minutesDefault)} minutes at default playback, ${round1(median(m.minutesSkip))} skipping battles: walking time plus seconds per fight, not a stopwatch`,
    verdict: modelled(between(median(m.minutesDefault), pacing.minutesPerRunEarly)),
  }),
  'Real time per run, Z3–Z5': () => notBuilt('Those zones are not built.'),
  'Real time per run, Z6–Z8': () => notBuilt('Those zones are not built.'),
  'Real time per run, late full scope': () => notBuilt('Full scope is not built.'),
  'Wins per run': (m, { balance: { pacing } }) => ({
    result: `Early: ${band(m.wins)} wins, with ${band(m.losses)} losses beside them. The end of v1 is not built`,
    verdict: m.wins.length > 0 && between(median(m.wins), pacing.winsPerRunEarly) ? 'PARTLY' : 'NOT MET',
  }),
  'Seconds per fight': (_m, { balance: { pacing } }) => ({
    result: `${DEFAULT_PLAYBACK.secondsPerFight} at default playback and ${SKIP_PLAYBACK.secondsPerFight} with skip are what the time model is given; the playback itself aims at 4.2 seconds at 1×`,
    verdict: modelled(between(DEFAULT_PLAYBACK.secondsPerFight, pacing.secondsPerFight) && SKIP_PLAYBACK.secondsPerFight < pacing.secondsPerFightSkipMax),
  }),
  'Runs in Z1': (m, { balance: { pacing } }) => ({
    result: `The gate fell on run ${band(m.breakRuns)}; ${m.insideFirstZone} of ${m.players} players inside ${span(pacing.runsInFirstZone)}`,
    verdict: met(m.breakRuns.length > 0 && between(median(m.breakRuns), pacing.runsInFirstZone)),
  }),
  'Runs per zone, Z2–Z8': () => notBuilt('Z2 has two enemies and no gate.'),
  'Walls in v1': () => notBuilt('One wall is built.'),
  'Runs to finish v1': () => notBuilt('v1 cannot be finished.'),
  'Play time to finish v1': () => notBuilt('v1 cannot be finished.'),
  'Play time, full scope': () => notBuilt('Full scope is not built.'),
  'Runs with a persistent gain': (m, { balance: { pacing } }) => ({
    result: `${percent(m.gainRuns, m.early.length)} of runs up to the gate's fall; longest spell without one ${m.longestDry} runs, and ${m.playersOverDry} of ${m.players} players had a spell over ${pacing.runsWithoutGainMax}`,
    verdict: met(m.early.length > 0 && m.gainRuns / m.early.length >= pacing.persistentGainShare && m.playersOverDry === 0),
  }),
  'Breakthrough run': (m, { balance: { pacing } }) => ({
    result: `${m.breakthroughsWithFirsts} of ${m.breakthroughs} breakthrough runs also beat ${pacing.breakthroughFirstKills} enemies never beaten before. Only the boss and two enemies stand past the wall, so ${pacing.breakthroughFirstKills} is the most there can be`,
    verdict: 'PARTLY',
  }),
  'Hero level ÷ strongest enemy beaten, at run end': (m, { balance: { pacing } }) => ({
    result: `${band(m.ratio)}, in Z1 only`,
    verdict: met(m.ratio.length > 0 && between(median(m.ratio), pacing.levelOverStrongest)),
  }),
  'Wins that needed more than 3 tries': (m, { balance: { pacing } }) => ({
    result: `${percent(m.hardWins, m.totalWins)} of all wins. Of the gate's falls, ${m.gateFallsOverTries} of ${m.breakthroughs} took more than ${pacing.hardWinTries} fights at it that run; fights at the gate on that run: ${band(m.gateTries)}`,
    verdict: met(m.totalWins > 0 && m.hardWins / m.totalWins < pacing.hardWinShareMax),
  }),
  'Longest wall': (m, { balance: { pacing } }) => ({
    result: `${m.overCeiling} of ${m.players} players took more than ${pacing.wallMaxRuns} runs at the one wall; the slowest ${m.never > 0 ? `never beat it in ${m.runsEach}` : `took ${Math.max(0, ...m.breakRuns)}`}`,
    verdict: met(m.overCeiling === 0),
  }),
  'Expected kills to get one drop': (m, { balance: { pacing } }) => ({
    result: `${band(m.killsPerDrop)} kills at each drop's base chance, the most ${round1(Math.max(0, ...m.killsPerDrop))}. Drop Bonus only lowers these, and Z1's gear gives little of it`,
    verdict: met(m.killsPerDrop.length > 0 && Math.max(...m.killsPerDrop) <= pacing.killsPerDropMax && between(median(m.killsPerDrop), pacing.killsPerDropTypical)),
  }),
};

export const measuredLabels = (): string[] => Object.keys(FINDINGS);

type Pacing = Content['balance']['pacing'];
const wholePercent = (share: number): number => Math.round(share * 100);
/** The GDD writes its smallest counts as words: "never three in a row". */
const COUNT_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

/** Whether `text` holds `words` as written, and not as part of a longer number: "4–6" is not in "4–60" or "14–6". */
const holds = (text: string, words: string): boolean => {
  for (let at = text.indexOf(words); at >= 0; at = text.indexOf(words, at + 1)) {
    const before = text.charAt(at - 1);
    const after = text.charAt(at + words.length);
    const digitBefore = /\d/.test(before) && /^\d/.test(words);
    const digitAfter = /[\d.]/.test(after) && /\d$/.test(words) && !(after === '.' && !/\d/.test(text.charAt(at + words.length + 1)));
    if (!digitBefore && !digitAfter) return true;
  }
  return false;
};

/**
 * A verdict is worked out from the numbers in data/balance.json, and the target shown beside it is the GDD's own
 * text. These are the words that text must still hold for the two to be saying the same thing.
 */
const TARGET_WORDS: Record<string, (pacing: Pacing) => string[]> = {
  'Runs per wall': (p) => [span(p.runsPerWall)],
  'Real time per run, Z1–Z2': (p) => [`${span(p.minutesPerRunEarly)} minutes`],
  'Wins per run': (p) => [`${span(p.winsPerRunEarly)} early`],
  'Seconds per fight': (p) => [`${span(p.secondsPerFight)} at default playback`, `under ${p.secondsPerFightSkipMax} with skip`],
  'Runs in Z1': (p) => [span(p.runsInFirstZone)],
  'Runs with a persistent gain': (p) => [`At least ${wholePercent(p.persistentGainShare)}%`, `never ${COUNT_WORDS[p.runsWithoutGainMax + 1] ?? String(p.runsWithoutGainMax + 1)} in a row`],
  'Breakthrough run': (p) => [`at least ${p.breakthroughFirstKills} enemies`],
  'Hero level ÷ strongest enemy beaten, at run end': (p) => [`Between ${p.levelOverStrongest.min} and ${p.levelOverStrongest.max}`],
  'Wins that needed more than 3 tries': (p) => [`more than ${p.hardWinTries} tries`, `Under ${wholePercent(p.hardWinShareMax)}%`],
  'Longest wall': (p) => [`more than ${p.wallMaxRuns} runs`],
  'Expected kills to get one drop': (p) => [`${span(p.killsPerDropTypical)} for a typical item`, `never over ${p.killsPerDropMax}`],
};

/** The first two cells of every row of the table under "### 5.9" in the GDD's text: the target's name and its value. */
export const gddTargets = (gdd: string): Array<{ label: string; target: string }> => {
  const lines = gdd.split(/\r?\n/);
  const start = lines.findIndex((line) => /^### 5\.9 /.test(line));
  if (start < 0) throw new Error('sim: the GDD has no section 5.9');
  const rows: Array<{ label: string; target: string }> = [];
  let seenTable = false;
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,6} /.test(line)) break;
    if (!line.startsWith('|')) {
      if (seenTable) break;
      continue;
    }
    seenTable = true;
    const cells = line.split('|').map((cell) => cell.trim());
    const label = cells[1] ?? '';
    if (label === 'Target' || /^-+$/.test(label)) continue;
    rows.push({ label, target: cells[2] ?? '' });
  }
  return rows;
};

/**
 * One row per row of GDD 5.9, in the GDD's order. Throws if the GDD has a row this file has no measure for, or
 * the reverse, or the same row twice, or a target whose text no longer holds the number its verdict is worked out from.
 */
export const gddRows = (measures: Measures, content: Content, gdd: string): Row[] => {
  const targets = gddTargets(gdd);
  const unknown = targets.filter(({ label }) => !Object.hasOwn(FINDINGS, label)).map(({ label }) => label);
  const stale = Object.keys(FINDINGS).filter((label) => !targets.some((target) => target.label === label));
  const twice = targets.filter(({ label }, index) => targets.findIndex((target) => target.label === label) !== index).map(({ label }) => label);
  if (unknown.length > 0 || stale.length > 0 || twice.length > 0) {
    throw new Error(`sim: the summary and GDD 5.9 have drifted apart. In the GDD only: ${unknown.join('; ') || 'none'}. In the simulator only: ${stale.join('; ') || 'none'}. In the GDD twice: ${twice.join('; ') || 'none'}`);
  }
  for (const { label, target } of targets) {
    const missing = (TARGET_WORDS[label]?.(content.balance.pacing) ?? []).filter((words) => !holds(`${label} | ${target}`, words));
    if (missing.length > 0) throw new Error(`sim: GDD 5.9 gives "${label}" the target "${target}", and data/balance.json holds a different one: the GDD's row should say "${missing.join('" and "')}"`);
  }
  return targets.map(({ label, target }) => {
    const finding = (FINDINGS[label] as (m: Measures, content: Content) => Finding)(measures, content);
    return { label, target, ...finding };
  });
};

// ---- against the one real playthrough ----

export type Calibration = {
  levels: Array<{ run: number; recorded: number; low: number; mid: number; high: number; inside: boolean }>;
  levelsInside: number;
  levelsNeeded: number;
  gate: { recorded: number; low: number; mid: number; high: number; inside: boolean };
  tries: { recorded: { min: number; max: number }; low: number; mid: number; high: number; inside: boolean };
  seconds: { recordedMin: number; recordedMax: number; recordedMean: number; modelMedian: number; modelMean: number; inside: boolean };
  reproduces: boolean;
};

/** The share of the recorded levels that must fall inside the simulated band: 6 of 8, as stated before the work began. */
const LEVELS_NEEDED = 0.75;

/**
 * The stated test (docs/STATUS.md, Phase 4 success check 5): the recorded gate run, the recorded level at the end
 * of each run and the recorded tries at the boss each lie between a strategy's 10th and 90th percentiles, and its
 * modelled run time lies inside the recorded range.
 */
export const calibrate = (measures: Measures, recorded: Recorded): Calibration => {
  const levels = recorded.runs.map((entry) => {
    const list = measures.levelByRun[entry.run - 1] ?? [];
    const low = percentile(list, 0.1);
    const high = percentile(list, 0.9);
    return { run: entry.run, recorded: entry.level, low, mid: median(list), high, inside: list.length > 0 && entry.level >= low && entry.level <= high };
  });
  const levelsInside = levels.filter((entry) => entry.inside).length;
  const levelsNeeded = Math.ceil(levels.length * LEVELS_NEEDED);
  // A player who never beat the gate counts as later than any run played, so that a slow strategy is not flattered.
  const gateRuns = [...measures.breakRuns, ...Array.from({ length: measures.never }, () => Number.POSITIVE_INFINITY)];
  const gate = { recorded: recorded.gateRun, low: percentile(gateRuns, 0.1), mid: median(gateRuns), high: percentile(gateRuns, 0.9), inside: false };
  gate.inside = gateRuns.length > 0 && recorded.gateRun >= gate.low && recorded.gateRun <= gate.high;
  const tries = { recorded: recorded.gateTries, low: percentile(measures.gateTries, 0.1), mid: median(measures.gateTries), high: percentile(measures.gateTries, 0.9), inside: false };
  tries.inside = measures.gateTries.length > 0 && recorded.gateTries.max >= tries.low && recorded.gateTries.min <= tries.high;
  const modelled = recorded.runs.flatMap((entry) => measures.secondsByRun[entry.run - 1] ?? []);
  const recordedSeconds = recorded.runs.map((entry) => entry.seconds);
  const seconds = {
    recordedMin: Math.min(...recordedSeconds),
    recordedMax: Math.max(...recordedSeconds),
    recordedMean: mean(recordedSeconds),
    modelMedian: median(modelled),
    modelMean: mean(modelled),
    inside: false,
  };
  seconds.inside = modelled.length > 0 && seconds.modelMedian >= seconds.recordedMin && seconds.modelMedian <= seconds.recordedMax;
  return { levels, levelsInside, levelsNeeded, gate, tries, seconds, reproduces: levelsInside >= levelsNeeded && gate.inside && tries.inside && seconds.inside };
};

// ---- markdown ----

export type Result = { label: string; about: string; content: Content; plays: readonly Playthrough[] };

const table = (head: readonly string[], rows: readonly (readonly string[])[]): string[] => [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((row) => `| ${row.join(' | ')} |`)];

const whenInfinite = (value: number, runsEach: number): string => (Number.isFinite(value) ? String(round1(value)) : `over ${runsEach}`);

const sideBySide = (results: readonly Result[], all: readonly Measures[]): string[] => {
  const first = results[0];
  if (first === undefined) return [];
  const { pacing } = first.content.balance;
  const row = (name: string, pick: (m: Measures, result: Result) => string): string[] => [name, ...results.map((result, index) => pick(all[index] as Measures, result))];
  return table(
    ['', ...results.map((result) => result.label)],
    [
      row(`Run the Z1 gate fell on (target ${span(pacing.runsInFirstZone)})`, (m) => band(m.breakRuns)),
      row(`Players inside ${span(pacing.runsInFirstZone)}`, (m) => percent(m.insideFirstZone, m.players)),
      row(`Players over ${pacing.wallMaxRuns} runs (target none)`, (m) => `${percent(m.overCeiling, m.players)}${m.never > 0 ? `, ${m.never} never` : ''}`),
      row(`Wins per run (target ${span(pacing.winsPerRunEarly)})`, (m) => band(m.wins)),
      row('Losses per run', (m) => band(m.losses)),
      row('Energy to spend at the start of a run', (m) => band(m.early.map((run) => run.startingEnergy))),
      row('Level at the end of run 3', (m) => band(m.levelByRun[2] ?? [])),
      row('Level at the end of run 5', (m) => band(m.levelByRun[4] ?? [])),
      row(`Level ÷ strongest enemy beaten (target ${span(pacing.levelOverStrongest)})`, (m) => String(round1(median(m.ratio)))),
      row('Fights at the gate on the run it fell', (m) => band(m.gateTries)),
      row(`Gate falls that took more than ${pacing.hardWinTries} fights`, (m) => percent(m.gateFallsOverTries, m.breakthroughs)),
      row(`Wins needing more than ${pacing.hardWinTries} tries (target under ${Math.round(pacing.hardWinShareMax * 100)}%)`, (m) => percent(m.hardWins, m.totalWins)),
      row(`Runs with a persistent gain (target ${Math.round(pacing.persistentGainShare * 100)}% or more)`, (m) => percent(m.gainRuns, m.early.length)),
      row(`Players with over ${pacing.runsWithoutGainMax} runs in a row without one (target none)`, (m) => percent(m.playersOverDry, m.players)),
      row(`Minutes per run, modelled (target ${span(pacing.minutesPerRunEarly)})`, (m) => String(round1(median(m.minutesDefault)))),
    ],
  );
};

const calibrationLines = (label: string, c: Calibration, recorded: Recorded, runsEach: number): string[] => [
  `### ${label}`,
  '',
  `**${c.reproduces ? 'Reproduces the recorded playthrough' : 'Does not reproduce the recorded playthrough'}** by the test stated before the work began: the gate run, the tries at the boss and at least ${c.levelsNeeded} of ${c.levels.length} levels inside the strategy's 10th to 90th percentiles, and its modelled run time inside the recorded range.`,
  '',
  ...table(
    ['What', 'Recorded', 'Simulated: median (10th–90th)', 'Inside'],
    [
      ['Run the gate fell on', String(c.gate.recorded), `${whenInfinite(c.gate.mid, runsEach)} (${whenInfinite(c.gate.low, runsEach)}–${whenInfinite(c.gate.high, runsEach)})`, c.gate.inside ? 'yes' : 'NO'],
      ['Fights at the boss on that run', `${recorded.gateTries.min} or ${recorded.gateTries.max}`, `${round1(c.tries.mid)} (${c.tries.low}–${c.tries.high})`, c.tries.inside ? 'yes' : 'NO'],
      ['Seconds per run', `${clock(c.seconds.recordedMin)} to ${clock(c.seconds.recordedMax)}, mean ${clock(c.seconds.recordedMean)}`, `median ${clock(c.seconds.modelMedian)}, mean ${clock(c.seconds.modelMean)}`, c.seconds.inside ? 'yes' : 'NO'],
      ...c.levels.map((entry) => [`Level at the end of run ${entry.run}`, String(entry.recorded), `${round1(entry.mid)} (${entry.low}–${entry.high})`, entry.inside ? 'yes' : 'NO']),
    ],
  ),
  '',
];

export type SummaryOptions = { seed: number; recorded: Recorded | null; gdd: string };

/** The markdown summary `npm run sim` writes: what ran, the configurations side by side, each against every row of GDD 5.9, and each against the recorded playthrough. */
export const formatSummary = (results: readonly Result[], options: SummaryOptions): string => {
  const all = results.map((result) => measure(result.plays, result.content));
  const first = all[0];
  const lines: string[] = [];
  const add = (...text: string[]): number => lines.push(...text);

  add('# Simulator summary', '');
  add(`${first?.players ?? 0} simulated players of ${first?.runsEach ?? 0} runs each for every configuration, on seeds ${options.seed} to ${options.seed + (first?.players ?? 1) - 1}. A configuration is the energy rule in force, a balance variant and a player strategy. Content is named by ID. A figure written "6 (4–8)" is a median with its 10th and 90th percentiles.`, '');
  add('## What was run', '');
  for (const result of results) add(`- **${result.label}.** ${result.about}`);
  add('');
  add('## Side by side', '');
  add('Counted over each player\'s runs up to and including the one on which the Z1 gate fell. After that the slice runs out of things to find.', '');
  add(...sideBySide(results, all), '');

  results.forEach((result, index) => {
    add(`## ${result.label}, against every row of GDD 5.9`, '');
    add(...table(['GDD 5.9 row', 'Target', 'Result', 'Verdict'], gddRows(all[index] as Measures, result.content, options.gdd).map((row) => [row.label, row.target, row.result, row.verdict])), '');
  });

  if (options.recorded !== null) {
    const recorded = options.recorded;
    add('## Against the recorded playthrough', '');
    add(`One real player, one playthrough, under the ${recorded.rule === 'free' ? 'rule that only wins are charged' : 'rule that a loss is charged'} (${recorded.source}). A configuration under the other rule is not comparable and is left out.`, '');
    results.forEach((result, index) => {
      if ((result.content.balance.energy.chargeLosses ? 'charged' : 'free') !== recorded.rule) return;
      add(...calibrationLines(result.label, calibrate(all[index] as Measures, recorded), recorded, (all[index] as Measures).runsEach));
    });
  }
  return `${lines.join('\n').trimEnd()}\n`;
};
