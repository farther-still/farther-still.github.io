// The simulator's CSV: one row per run. The first columns after the configuration are the kickoff's: run number,
// level, power, zone reached, gold and drops. Items and enemies appear as IDs only.

import type { Content } from '../engine';
import { DEFAULT_PLAYBACK, runSeconds } from './report';
import type { Playthrough, RunRecord } from './run';

type Column = { name: string; value: (run: RunRecord, content: Content) => string | number };

const round = (value: number, places: number): number => {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
};

const RUN_COLUMNS: readonly Column[] = [
  { name: 'run', value: (run) => run.run },
  { name: 'level', value: (run) => run.level },
  // Strength against the wall with no dice in it: under 1 the hero should lose, over 1 it should win. Capped, because a hero the wall cannot hurt has no finite figure.
  { name: 'power', value: (run) => round(Math.min(run.power, 999), 3) },
  { name: 'zone_reached', value: (run) => run.zoneReached },
  { name: 'gold', value: (run) => run.gold },
  { name: 'drops', value: (run) => run.drops.length },
  { name: 'drop_ids', value: (run) => run.drops.join(' ') },
  { name: 'strongest_beaten', value: (run) => run.strongest },
  { name: 'wins', value: (run) => run.wins },
  { name: 'losses', value: (run) => run.losses },
  { name: 'energy_start', value: (run) => run.startingEnergy },
  { name: 'energy_left', value: (run) => run.energyLeft },
  { name: 'bought_ids', value: (run) => run.bought.join(' ') },
  { name: 'salvage', value: (run) => (run.salvageTried ? (run.salvaged ?? 'miss') : '') },
  { name: 'first_kills', value: (run) => run.firstKills.join(' ') },
  { name: 'gates_beaten', value: (run) => run.gatesBeaten.join(' ') },
  { name: 'claims', value: (run) => run.claims },
  { name: 'persistent_gain', value: (run) => (run.persistentGain ? 1 : 0) },
  { name: 'wall', value: (run) => run.wall ?? '' },
  { name: 'wall_win_chance', value: (run) => round(run.wallChance, 3) },
  { name: 'wall_fights', value: (run) => run.wallFights },
  { name: 'hard_wins', value: (run) => run.hardWins },
  { name: 'tiles', value: (run) => run.tiles },
  { name: 'battles', value: (run) => run.battles },
  { name: 'minutes_modelled', value: (run, content) => round(runSeconds(run, content, DEFAULT_PLAYBACK) / 60, 2) },
];

export const CSV_COLUMNS: readonly string[] = ['rule', 'variant', 'strategy', 'player_seed', ...RUN_COLUMNS.map((column) => column.name)];

const cell = (value: string | number): string => {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

export type CsvBlock = { rule: string; variant: string; strategy: string; content: Content; plays: readonly Playthrough[] };

/** Header and one row per run, for every configuration in turn. */
export const formatCsv = (blocks: readonly CsvBlock[]): string => {
  const rows: string[] = [CSV_COLUMNS.join(',')];
  for (const block of blocks) {
    for (const play of block.plays) {
      for (const run of play.runs) {
        rows.push([block.rule, block.variant, block.strategy, play.seed, ...RUN_COLUMNS.map((column) => column.value(run, block.content))].map(cell).join(','));
      }
    }
  }
  return `${rows.join('\n')}\n`;
};
