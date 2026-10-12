// The one state object (ARCHITECTURE section 4). Its two halves are the game rows of the reset ledger in
// GDD 2.5: `profile` persists and `run` is replaced by NewRun. Save version 2.
//
// Derived, never stored: level (from xp), unspent stat points, remaining energy, drops found (a drop counts as
// found once a copy is owned), doors (open if the key is owned), and how many loadouts were bought (the list's
// length less the free ones).

import { makeRng, streamSeed } from './rng';
import { isUint32 } from './rng';
import { SLOT_IDS, STAT_KEYS } from './types';
import type { Balance, Content, EnemyId, HintId, ItemId, Loadout, Mark, Position, SecretId, SlotId, SpawnId, StatPoints, StatSplit, WaypointId } from './types';

/** What the new-run sheet reports about the run being left (GDD 2.4). */
export type RunTallies = {
  wins: number;
  losses: number;
  /** Every item or copy gained this run, in the order gained: drops, handovers, purchases and Salvage. */
  itemsGained: ItemId[];
  claims: number;
  gemsGained: number;
};

export type GameState = {
  profile: {
    /** Copies owned. Keys are items too. */
    items: Record<ItemId, number>;
    loadouts: Loadout[];
    activeLoadout: number;
    /** Permanent starting energy is this list's length times the energy per Claim. */
    claimedBosses: EnemyId[];
    gems: number;
    waypointsVisited: WaypointId[];
    waypointsUnlocked: WaypointId[];
    /** An enemy has an entry once it has been fought, won or lost: that is what "seen" means. */
    bestiary: Record<EnemyId, { timesBeaten: number }>;
    /** A level, not an ID. */
    strongestEverBeaten: number;
    secretsFound: SecretId[];
    autoAssign: { unlocked: boolean; on: boolean; split: StatSplit };
    hintsShown: HintId[];
    counters: { runsStarted: number; bestLevel: number };
  };
  run: {
    seed: number;
    /** Advances on every battle, won or lost, so a retry is a new battle (GDD 3.3). */
    battleCount: number;
    /** Advances on every marked-enemy roll. */
    spawnCount: number;
    xp: number;
    pointsSpent: StatPoints;
    /** Stat points from Growth gear, on top of the points every level gives. */
    growthPointsEarned: number;
    gold: number;
    energySpent: number;
    energyPaidBack: number;
    bossesBeaten: EnemyId[];
    /** A level, not an ID. */
    strongestBeaten: number;
    lastEnemy: EnemyId | null;
    salvageUsed: boolean;
    position: Position;
    /** Only spawns that currently carry a mark have an entry. */
    marks: Record<SpawnId, Mark>;
    stashesCollected: SecretId[];
    tallies: RunTallies;
  };
};

/** The one-line explanations a screen shows the first time it opens (GDD 8.4). The text lives in the UI. */
export const HINT_IDS = ['map', 'prefight', 'hero', 'gear', 'items', 'bestiary', 'salvage', 'run', 'tool'] as const;

export const zeroPoints = (): StatPoints => ({ life: 0, damage: 0, defense: 0, dexterity: 0, luck: 0 });

export const sumPoints = (points: StatPoints): number => STAT_KEYS.reduce((total, key) => total + points[key], 0);

export const emptyLoadout = (): Loadout => {
  const slots = {} as Record<SlotId, ItemId | null>;
  for (const slot of SLOT_IDS) slots[slot] = null;
  return { name: '', slots };
};

/**
 * One marked-enemy roll (GDD 5.5): three numbers from the spawn stream at `counter`, always all three, so the
 * stream does not depend on the outcome.
 */
export const rollMark = (seed: number, counter: number, balance: Balance): Mark | null => {
  const rng = makeRng(streamSeed(seed, 'spawn', counter));
  const marked = rng.next() < balance.marks.chance;
  const statRoll = rng.next();
  const percentRoll = rng.next();
  if (!marked) return null;

  const totalWeight = balance.marks.stats.reduce((total, entry) => total + entry.weight, 0);
  let stat = balance.marks.stats[0]?.stat ?? 'xp';
  let passed = 0;
  for (const entry of balance.marks.stats) {
    passed += entry.weight;
    stat = entry.stat;
    if (statRoll * totalWeight < passed) break;
  }
  const percents = balance.marks.percents;
  const percent = percents[Math.min(percents.length - 1, Math.floor(percentRoll * percents.length))] ?? 0;
  return { stat, percent };
};

/** A run at its first moment: level 1, no gold, full energy, the hero at the run start, marks rolled. */
export const freshRun = (seed: number, content: Content): GameState['run'] => {
  const marks: Record<SpawnId, Mark> = {};
  let spawnCount = 0;
  for (const id of content.spawnOrder) {
    const spawn = content.spawns[id];
    const enemy = spawn === undefined ? undefined : content.enemies[spawn.enemy];
    if (enemy === undefined || enemy.boss) continue;
    const mark = rollMark(seed, spawnCount, content.balance);
    spawnCount += 1;
    if (mark !== null) marks[id] = mark;
  }
  return {
    seed,
    battleCount: 0,
    spawnCount,
    xp: 0,
    pointsSpent: zeroPoints(),
    growthPointsEarned: 0,
    gold: 0,
    energySpent: 0,
    energyPaidBack: 0,
    bossesBeaten: [],
    strongestBeaten: 0,
    lastEnemy: null,
    salvageUsed: false,
    position: { ...content.start },
    marks,
    stashesCollected: [],
    tallies: { wins: 0, losses: 0, itemsGained: [], claims: 0, gemsGained: 0 },
  };
};

/** A new install's state: nothing owned, first run started. The caller supplies the seed (GDD 2.5). */
export const newGame = (seed: number, content: Content): GameState => {
  const loadouts: Loadout[] = [];
  for (let index = 0; index < content.balance.loadouts.free; index += 1) loadouts.push(emptyLoadout());
  return {
    profile: {
      items: {},
      loadouts,
      activeLoadout: 0,
      claimedBosses: [],
      gems: 0,
      waypointsVisited: [],
      waypointsUnlocked: [],
      bestiary: {},
      strongestEverBeaten: 0,
      secretsFound: [],
      autoAssign: { unlocked: false, on: false, split: { ...content.balance.autoAssign.defaultSplit } },
      hintsShown: [],
      counters: { runsStarted: 1, bestLevel: 1 },
    },
    run: freshRun(isUint32(seed) ? seed : 0, content),
  };
};
