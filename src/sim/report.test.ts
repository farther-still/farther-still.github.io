// The figures behind the summary, and the summary's promise: one row for every row of GDD 5.9.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadBundledContent } from '../content';
import { RECORDED, contentFor, variantNamed } from './config';
import { formatCsv, CSV_COLUMNS } from './csv';
import { hardWrappedLines } from '../../scripts/check-prose';
import { calibrate, formatSummary, gddRows, gddTargets, measure, measuredLabels, median, percentile } from './report';
import type { Playthrough, RunRecord } from './run';

const CONTENT = loadBundledContent();
const GDD = readFileSync(fileURLToPath(new URL('../../docs/GDD.md', import.meta.url)), 'utf8');
const GATE = CONTENT.enemyOrder.find((id) => CONTENT.enemies[id]?.gate === true) ?? '';

const run = (number: number, over: Partial<RunRecord> = {}): RunRecord => ({
  run: number,
  level: 10 * number,
  strongest: 5 * number,
  zoneReached: 1,
  wins: 20,
  losses: 1,
  startingEnergy: 20,
  energyLeft: 0,
  gold: 100 * number,
  drops: [],
  bought: [],
  salvageTried: false,
  salvaged: null,
  itemsGained: ['i001'],
  claims: 0,
  persistentGain: true,
  firstKills: [],
  gatesBeaten: [],
  hardWins: 0,
  wall: GATE,
  power: 0.5,
  wallChance: 0.1,
  wallFights: 0,
  tiles: 120,
  battles: 21,
  ...over,
});

/** A player whose gate falls on `breakRun` (or never, for null) after `fights` fights at it, with `runs` runs played. */
const player = (seed: number, breakRun: number | null, runs = 12, fights = 1, over: (number: number) => Partial<RunRecord> = () => ({})): Playthrough => ({
  seed,
  runs: Array.from({ length: runs }, (_, index) => {
    const number = index + 1;
    return run(number, { ...(number === breakRun ? { gatesBeaten: [GATE], wallFights: fights, firstKills: [GATE] } : {}), ...over(number) });
  }),
});

describe('median and percentile', () => {
  it('takes the middle, and the value a share of the list lies at or below', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBe(0);
    const ten = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(percentile(ten, 0.1)).toBe(1);
    expect(percentile(ten, 0.5)).toBe(5);
    expect(percentile(ten, 0.9)).toBe(9);
    expect(percentile(ten, 1)).toBe(10);
    expect(percentile([7], 0.1)).toBe(7);
    // Nearest rank rounds up: a tenth of eleven values is past the first, so the second is the answer.
    const eleven = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
    expect(percentile(eleven, 0.1)).toBe(2);
    expect(percentile(eleven, 0.9)).toBe(10);
    expect(percentile([5, 1, 3], 0.5)).toBe(3);
  });
});

describe('measure', () => {
  const plays = [player(1, 5), player(2, 6, 12, 4), player(3, 9), player(4, null)];
  const m = measure(plays, CONTENT);

  it('finds the run each player’s gate fell on, and counts the ones over the ceiling with those who never got through', () => {
    expect(m.gate).toBe(GATE);
    expect(m.breakRuns).toEqual([5, 6, 9]);
    expect(m.never).toBe(1);
    expect(m.overCeiling).toBe(2);
    expect(m.insideFirstZone).toBe(2);
    expect(m.breakthroughs).toBe(3);
  });

  it('counts only the runs up to and including the breakthrough', () => {
    expect(m.early).toHaveLength(5 + 6 + 9 + 12);
    expect(m.totalWins).toBe(20 * (5 + 6 + 9 + 12));
  });

  it('counts the fights at the gate on the run it fell, and which falls took more than the target allows', () => {
    expect(m.gateTries).toEqual([1, 4, 1]);
    expect(m.gateFallsOverTries).toBe(1);
  });

  it('finds the longest spell without a persistent gain, and how many players had one too long', () => {
    const dry = (numbers: number[]) => (number: number): Partial<RunRecord> => (numbers.includes(number) ? { persistentGain: false, itemsGained: [] } : {});
    const spells = measure([player(1, 8, 12, 1, dry([2, 3])), player(2, 8, 12, 1, dry([2, 3, 4])), player(3, 4, 12, 1, dry([6, 7, 8, 9]))], CONTENT);
    expect(spells.longestDry).toBe(3);
    expect(spells.playersOverDry).toBe(1);
    expect(spells.gainRuns).toBe(8 - 2 + (8 - 3) + 4);
  });

  it('keeps the level of every player at the end of every run', () => {
    expect(m.levelByRun).toHaveLength(12);
    expect(m.levelByRun[2]).toEqual([30, 30, 30, 30]);
  });
});

describe('the rows of GDD 5.9', () => {
  it('has a measure for every row of the table in the GDD, and none the GDD does not have', () => {
    const targets = gddTargets(GDD);
    expect(targets.length).toBeGreaterThanOrEqual(19);
    expect(targets.map((target) => target.label).sort()).toEqual(measuredLabels().sort());
    expect(targets.every((target) => target.target.length > 0)).toBe(true);
  });

  it('gives each row a result and a verdict, in the GDD’s order', () => {
    const rows = gddRows(measure([player(1, 5), player(2, 6)], CONTENT), CONTENT, GDD);
    expect(rows.map((row) => row.label)).toEqual(gddTargets(GDD).map((target) => target.label));
    for (const row of rows) {
      expect(row.result.length).toBeGreaterThan(0);
      expect(['MET', 'NOT MET', 'MODELLED, in range', 'MODELLED, OUT OF RANGE', 'PARTLY', 'CANNOT MEASURE']).toContain(row.verdict);
    }
    expect(rows.find((row) => row.label === 'Runs in Z1')?.verdict).toBe('MET');
    expect(rows.find((row) => row.label === 'Longest wall')?.verdict).toBe('MET');
    expect(rows.find((row) => row.label === 'Walls in v1')?.verdict).toBe('CANNOT MEASURE');
  });

  it('says a target is missed when it is', () => {
    const rows = gddRows(measure([player(1, 9), player(2, 10), player(3, null)], CONTENT), CONTENT, GDD);
    expect(rows.find((row) => row.label === 'Runs in Z1')?.verdict).toBe('NOT MET');
    expect(rows.find((row) => row.label === 'Runs per wall')?.verdict).toBe('NOT MET');
    expect(rows.find((row) => row.label === 'Longest wall')).toMatchObject({ verdict: 'NOT MET', result: expect.stringContaining('3 of 3 players') });
  });

  it('says a target is missed on its second half alone: a long spell without a gain, or too many hard wins', () => {
    const dry = (number: number): Partial<RunRecord> => (number >= 2 && number <= 4 ? { persistentGain: false, itemsGained: [] } : {});
    // 37 of 40 runs have a gain, which is over 90%, but one player went three runs without.
    const spell = gddRows(measure([player(1, 10, 12, 1, dry), player(2, 10), player(3, 10), player(4, 10)], CONTENT), CONTENT, GDD);
    expect(spell.find((row) => row.label === 'Runs with a persistent gain')).toMatchObject({ verdict: 'NOT MET', result: expect.stringContaining('1 of 4 players had a spell over 2') });
    const steady = gddRows(measure([player(1, 10), player(2, 10)], CONTENT), CONTENT, GDD);
    expect(steady.find((row) => row.label === 'Runs with a persistent gain')?.verdict).toBe('MET');
    // A fifth of all wins took more than 3 tries.
    const hard = gddRows(measure([player(1, 5, 12, 1, () => ({ hardWins: 4 }))], CONTENT), CONTENT, GDD);
    expect(hard.find((row) => row.label === 'Wins that needed more than 3 tries')).toMatchObject({ verdict: 'NOT MET', result: expect.stringContaining('20% of all wins') });
    expect(steady.find((row) => row.label === 'Wins that needed more than 3 tries')?.verdict).toBe('MET');
  });

  it('stops when a target in the GDD no longer says the number its verdict is worked out from, or a row is there twice', () => {
    const m = measure([player(1, 5)], CONTENT);
    expect(() => gddRows(m, CONTENT, GDD.replace('| Runs in Z1 | 4–6 |', '| Runs in Z1 | 2–3 |'))).toThrow(/"Runs in Z1" the target "2–3".*should say "4–6"/);
    expect(() => gddRows(m, CONTENT, GDD.replace('| Longest wall | No wall takes more than 8 runs |', '| Longest wall | No wall takes more than 12 runs |'))).toThrow(/should say "more than 8 runs"/);
    expect(() => gddRows(m, CONTENT, GDD.replace('| Wins that needed more than 3 tries | Under 15% |', '| Wins that needed more than 3 tries | Under 25% |'))).toThrow(/should say "Under 15%"/);
    // A number that only begins or ends with the right digits is a different number.
    expect(() => gddRows(m, CONTENT, GDD.replace('| Runs in Z1 | 4–6 |', '| Runs in Z1 | 4–60 |'))).toThrow(/should say "4–6"/);
    expect(() => gddRows(m, CONTENT, GDD.replace('| Runs in Z1 | 4–6 |', '| Runs in Z1 | 14–6 |'))).toThrow(/should say "4–6"/);
    expect(() => gddRows(m, CONTENT, GDD.replace('never over 80,', 'never over 800,'))).toThrow(/should say "never over 80"/);
    expect(() => gddRows(m, CONTENT, GDD.replace('Between 1 and 3 in v1', 'Between 1 and 30 in v1'))).toThrow(/should say "Between 1 and 3"/);
    expect(() => gddRows(m, CONTENT, GDD.replace('never three in a row without one', 'never two in a row without one'))).toThrow(/should say "never three in a row"/);
    // A change of wording that keeps every number is not drift.
    expect(() => gddRows(m, CONTENT, GDD.replace('| Longest wall | No wall takes more than 8 runs |', '| Longest wall | Nobody should need more than 8 runs at one wall |'))).not.toThrow();
    const twice = GDD.replace('| Longest wall |', '| Walls in v1 | 10–14 | Derived |\n| Longest wall |');
    expect(() => gddRows(m, CONTENT, twice)).toThrow(/In the GDD twice: Walls in v1/);
    // And the other way: a number changed in the balance table and not in the GDD.
    const moved: typeof CONTENT = { ...CONTENT, balance: { ...CONTENT.balance, pacing: { ...CONTENT.balance.pacing, wallMaxRuns: 9 } } };
    expect(() => gddRows(m, moved, GDD)).toThrow(/should say "more than 9 runs"/);
  });

  it('stops when the GDD gains a row it has no measure for, or loses one it has', () => {
    const m = measure([player(1, 5)], CONTENT);
    const added = GDD.replace('| Longest wall |', '| A target nobody measures | 1 | Test |\n| Longest wall |');
    expect(() => gddRows(m, CONTENT, added)).toThrow(/drifted apart.*In the GDD only: A target nobody measures/);
    const removed = GDD.split('\n').filter((line) => !line.startsWith('| Longest wall |')).join('\n');
    expect(() => gddRows(m, CONTENT, removed)).toThrow(/In the simulator only: Longest wall/);
    expect(() => gddTargets('# A document with no such section')).toThrow(/no section 5\.9/);
  });
});

describe('calibrate', () => {
  // Ten players whose gate falls on runs 6 to 12 and whose levels are the recorded ones, give or take.
  const like = (shift: number, breakRun: number, fights: number): Playthrough => ({
    seed: shift,
    runs: Array.from({ length: 14 }, (_, index) => {
      const number = index + 1;
      const recorded = RECORDED.runs.find((entry) => entry.run === number);
      return run(number, { level: (recorded?.level ?? 10) + shift, tiles: 120, battles: 21, ...(number === breakRun ? { gatesBeaten: [GATE], wallFights: fights } : {}) });
    }),
  });
  const close = [like(-2, 6, 1), like(-1, 7, 2), like(0, 8, 2), like(0, 8, 3), like(1, 9, 4), like(1, 9, 2), like(2, 10, 5), like(2, 11, 1), like(3, 12, 3), like(-3, 8, 2)];

  it('says a strategy reproduces the playthrough when every recorded figure is inside its 10th to 90th percentiles', () => {
    const result = calibrate(measure(close, CONTENT), RECORDED);
    expect(result.gate).toMatchObject({ recorded: 10, inside: true });
    expect(result.tries.inside).toBe(true);
    expect(result.levelsInside).toBe(8);
    expect(result.levelsNeeded).toBe(6);
    expect(result.seconds.inside).toBe(true);
    expect(result.reproduces).toBe(true);
  });

  it('says it does not when the gate falls too early, whatever else matches', () => {
    const early = close.map((play, index) => like(index - 5, 4 + (index % 3), 4));
    const result = calibrate(measure(early, CONTENT), RECORDED);
    expect(result.gate.inside).toBe(false);
    expect(result.reproduces).toBe(false);
  });

  it('counts a player who never got through as later than any run, so a slow strategy is not flattered', () => {
    const stuck = [...close.slice(0, 5), ...Array.from({ length: 5 }, (_, index) => like(index, 99, 1))];
    const result = calibrate(measure(stuck, CONTENT), RECORDED);
    expect(result.gate.high).toBe(Number.POSITIVE_INFINITY);
    expect(result.gate.inside).toBe(true);
  });

  it('needs six of the eight recorded levels inside, and not five', () => {
    const shifted = (misses: number): Playthrough[] =>
      close.map((play) => ({ ...play, runs: play.runs.map((entry) => (entry.run >= 2 && entry.run < 2 + misses ? { ...entry, level: entry.level + 40 } : entry)) }));
    expect(calibrate(measure(shifted(2), CONTENT), RECORDED)).toMatchObject({ levelsInside: 6, levelsNeeded: 6, reproduces: true });
    expect(calibrate(measure(shifted(3), CONTENT), RECORDED)).toMatchObject({ levelsInside: 5, levelsNeeded: 6, reproduces: false });
  });

  it('counts the recorded tries as inside when either four or five is: the player said "four or five"', () => {
    const withTries = (tries: number[]): Playthrough[] => close.map((play, index) => ({ ...play, runs: play.runs.map((entry) => (entry.gatesBeaten.length > 0 ? { ...entry, wallFights: tries[index] ?? 1 } : entry)) }));
    // The 90th percentile of ten values is the ninth.
    expect(calibrate(measure(withTries([1, 1, 1, 1, 2, 2, 2, 3, 3, 9]), CONTENT), RECORDED).tries).toMatchObject({ high: 3, inside: false });
    expect(calibrate(measure(withTries([1, 1, 1, 1, 2, 2, 2, 3, 4, 9]), CONTENT), RECORDED).tries).toMatchObject({ high: 4, inside: true });
    expect(calibrate(measure(withTries([6, 6, 6, 6, 7, 7, 7, 8, 8, 9]), CONTENT), RECORDED).tries).toMatchObject({ low: 6, inside: false });
    expect(calibrate(measure(withTries([5, 5, 6, 6, 7, 7, 7, 8, 8, 9]), CONTENT), RECORDED).tries).toMatchObject({ low: 5, inside: true });
  });

  it('needs the levels, and the tries, and the run time, each on its own', () => {
    const tooStrong = close.map((play) => ({ ...play, runs: play.runs.map((entry) => ({ ...entry, level: entry.level + 40 })) }));
    expect(calibrate(measure(tooStrong, CONTENT), RECORDED)).toMatchObject({ levelsInside: 0, reproduces: false });
    const oneTry = close.map((play) => ({ ...play, runs: play.runs.map((entry) => ({ ...entry, wallFights: Math.min(entry.wallFights, 1) })) }));
    expect(calibrate(measure(oneTry, CONTENT), RECORDED)).toMatchObject({ tries: { inside: false }, reproduces: false });
    const slow = close.map((play) => ({ ...play, runs: play.runs.map((entry) => ({ ...entry, tiles: 3000 })) }));
    expect(calibrate(measure(slow, CONTENT), RECORDED)).toMatchObject({ seconds: { inside: false }, reproduces: false });
  });
});

describe('the summary and the CSV', () => {
  const free = contentFor('free', variantNamed('shipped'));
  const charged = contentFor('charged', variantNamed('shipped'));
  const plays = [player(1, 5), player(2, 6)];
  const results = [
    { label: 'free · shipped · one', about: 'The first.', content: free, plays },
    { label: 'charged · shipped · two', about: 'The second.', content: charged, plays },
  ];
  const summary = formatSummary(results, { seed: 1, recorded: RECORDED, gdd: GDD });

  it('puts every configuration in one side-by-side table and gives each its own table of all the GDD’s rows', () => {
    expect(summary).toContain('|  | free · shipped · one | charged · shipped · two |');
    for (const result of results) expect(summary).toContain(`## ${result.label}, against every row of GDD 5.9`);
    for (const target of gddTargets(GDD)) expect(summary.split(`| ${target.label} | ${target.target} |`).length - 1).toBe(2);
  });

  it('sets only configurations under the recorded rule beside the recorded playthrough', () => {
    const section = summary.slice(summary.indexOf('## Against the recorded playthrough'));
    expect(section).toContain('### free · shipped · one');
    expect(section).not.toContain('### charged · shipped · two');
    expect(formatSummary(results, { seed: 1, recorded: null, gdd: GDD })).not.toContain('recorded playthrough');
  });

  it('never wraps a paragraph, and is the same text for the same input', () => {
    expect(summary).toBe(formatSummary(results, { seed: 1, recorded: RECORDED, gdd: GDD }));
    expect(summary.endsWith('\n')).toBe(true);
    // The project's own prose check, which the repo's documents pass.
    expect(hardWrappedLines(summary)).toEqual([]);
    expect(hardWrappedLines('A paragraph\nwrapped by hand.\n')).toEqual([2]);
  });

  it('puts each figure of a run under its own column name', () => {
    const one = run(3, { level: 31, wins: 17, losses: 4, startingEnergy: 21, energyLeft: 2, gold: 345, drops: ['i005'], bought: ['i001', 'i010'], salvageTried: true, salvaged: 'i007', firstKills: ['e004', 'e005'], gatesBeaten: [GATE], claims: 1, persistentGain: false, strongest: 23, zoneReached: 2, wallChance: 0.4567, wallFights: 6, hardWins: 2, tiles: 120, battles: 21, power: 1.23456 });
    const lines = formatCsv([{ rule: 'charged', variant: 'energy-25', strategy: 'like-michael', content: charged, plays: [{ seed: 42, runs: [one] }] }]).trimEnd().split('\n');
    const cells = (lines[1] ?? '').split(',');
    const row = Object.fromEntries(CSV_COLUMNS.map((name, index) => [name, cells[index]]));
    expect(cells).toHaveLength(CSV_COLUMNS.length);
    expect(row).toEqual({
      rule: 'charged',
      variant: 'energy-25',
      strategy: 'like-michael',
      player_seed: '42',
      run: '3',
      level: '31',
      power: '1.235',
      zone_reached: '2',
      gold: '345',
      drops: '1',
      drop_ids: 'i005',
      strongest_beaten: '23',
      wins: '17',
      losses: '4',
      energy_start: '21',
      energy_left: '2',
      bought_ids: 'i001 i010',
      salvage: 'i007',
      first_kills: 'e004 e005',
      gates_beaten: GATE,
      claims: '1',
      persistent_gain: '0',
      wall: GATE,
      wall_win_chance: '0.457',
      wall_fights: '6',
      hard_wins: '2',
      tiles: '120',
      battles: '21',
      // 120 tiles at 6 a second, and 21 battles at 4.5 seconds each with 2 to decide: 156.5 seconds.
      minutes_modelled: '2.61',
    });
  });

  it('writes one CSV row per run, with the kickoff’s columns first after the configuration', () => {
    expect(CSV_COLUMNS.slice(0, 10)).toEqual(['rule', 'variant', 'strategy', 'player_seed', 'run', 'level', 'power', 'zone_reached', 'gold', 'drops']);
    const withItems = [{ seed: 9, runs: [run(1, { drops: ['i005', 'i006'], bought: ['i001'], salvageTried: true, salvaged: null, power: Number.MAX_VALUE }), run(2, { salvageTried: true, salvaged: 'i007' })] }];
    const csv = formatCsv([
      { rule: 'free', variant: 'shipped', strategy: 'one', content: free, plays },
      { rule: 'charged', variant: 'a, "b"', strategy: 'two', content: charged, plays: withItems },
    ]);
    const lines = csv.trimEnd().split('\n');
    expect(lines).toHaveLength(1 + 2 * 12 + 2);
    expect(lines[0]).toBe(CSV_COLUMNS.join(','));
    expect(lines.every((line) => !line.includes('undefined') && !line.includes('NaN') && !line.includes('Infinity'))).toBe(true);
    const first = (lines[1] ?? '').split(',');
    expect(first.slice(0, 10)).toEqual(['free', 'shipped', 'one', '1', '1', '10', '0.5', '1', '100', '0']);
    const itemRow = lines[lines.length - 2] ?? '';
    expect(itemRow.startsWith('charged,"a, ""b""",two,9,1,10,999,1,100,2,i005 i006,')).toBe(true);
    expect(itemRow).toContain(',i001,miss,');
    expect(lines[lines.length - 1]).toContain(',i007,');
  });
});
