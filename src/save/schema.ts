// The save schema for SAVE_VERSION. Strict everywhere: an unknown field is an error, never silently dropped.
// `record.test.ts` pins a hash of this shape to the version, so changing it without bumping fails the build.

import { z } from 'zod';
import type { GameState } from '../engine';
import { ALL_SLOTS, SAVE_VERSION, SEQ_CEILING } from './constants';

// zod normally speeds up parsing by compiling code at run time. The built page's content security policy forbids
// that, so it is turned off everywhere, and Node and the phone run the same parsing path.
z.config({ jitless: true });

// z.int() accepts only safe integers, which is the GDD 6.2 check for every whole-number field.
const whole = z.int();
const id = z.string();
const cell = id.nullable();

const points = z.strictObject({ life: whole, damage: whole, defense: whole, dexterity: whole, luck: whole });

// One cell per slot: a weapon, one of each armor type, five accessories (GDD 7.1).
const slots = z.strictObject({
  weapon: cell,
  head: cell,
  neck: cell,
  shoulders: cell,
  body: cell,
  back: cell,
  arms: cell,
  hands: cell,
  finger: cell,
  waist: cell,
  legs: cell,
  feet: cell,
  offhand: cell,
  acc1: cell,
  acc2: cell,
  acc3: cell,
  acc4: cell,
  acc5: cell,
});

export const gameStateSchema = z.strictObject({
  profile: z.strictObject({
    items: z.record(id, whole),
    loadouts: z.array(z.strictObject({ name: z.string(), slots })),
    activeLoadout: whole,
    claimedBosses: z.array(id),
    gems: whole,
    waypointsVisited: z.array(id),
    waypointsUnlocked: z.array(id),
    bestiary: z.record(id, z.strictObject({ timesBeaten: whole })),
    strongestEverBeaten: whole,
    secretsFound: z.array(id),
    autoAssign: z.strictObject({ unlocked: z.boolean(), on: z.boolean(), split: points }),
    hintsShown: z.array(id),
    counters: z.strictObject({ runsStarted: whole, bestLevel: whole }),
  }),
  run: z.strictObject({
    seed: whole,
    battleCount: whole,
    spawnCount: whole,
    // Whole-valued, but XP may pass the exact range in full scope (GDD 6.2), so it is not held to a safe integer.
    xp: z.number(),
    pointsSpent: points,
    growthPointsEarned: whole,
    gold: whole,
    energySpent: whole,
    energyPaidBack: whole,
    bossesBeaten: z.array(id),
    strongestBeaten: whole,
    lastEnemy: id.nullable(),
    salvageUsed: z.boolean(),
    position: z.strictObject({ zone: id, x: whole, y: whole }),
    marks: z.record(id, z.strictObject({ stat: z.enum(['xp', 'drops', 'gold']), percent: whole })),
    stashesCollected: z.array(id),
    tallies: z.strictObject({ wins: whole, losses: whole, itemsGained: z.array(id), claims: whole, gemsGained: whole }),
  }),
});

/** One finished run, kept only to measure GDD 5.9's time targets in playtests. No mechanic reads it (hard rule 3). */
const runLogEntry = z.strictObject({
  run: whole,
  startedAt: whole,
  endedAt: whole,
  /** Time with the app in front and the player doing something, in milliseconds. */
  activeMs: whole,
  wins: whole,
  losses: whole,
  level: whole,
  strongest: whole,
});

/** Settings, export tracking and the run-duration log: in the save but outside the game state the engine sees (A-05). */
export const appStateSchema = z.strictObject({
  settings: z.strictObject({
    playbackSpeed: z.literal([1, 2, 4]),
    /** Jump straight to the result of every battle. */
    skipPlayback: z.boolean(),
    tapToMove: z.boolean(),
    dragToSteer: z.boolean(),
  }),
  exportTracking: z.strictObject({
    /** When this save began, so "days without an export" has a start before the first export. */
    trackingSince: whole,
    lastExportAt: whole.nullable(),
    runsAtLastExport: whole,
  }),
  /** The run in progress. */
  runTiming: z.strictObject({ startedAt: whole, activeMs: whole }),
  /** Finished runs, oldest first: the newest RUN_LOG_LIMIT of them. */
  runLog: z.array(runLogEntry),
});

export const payloadSchema = z.strictObject({ game: gameStateSchema, app: appStateSchema });

export const slotRecordSchema = z.strictObject({
  slot: z.enum(ALL_SLOTS),
  saveVersion: z.literal(SAVE_VERSION),
  buildId: z.string(),
  contentVersion: z.string(),
  seq: whole.positive().lt(SEQ_CEILING),
  writtenAt: whole,
  payload: payloadSchema,
  checksum: z.string().regex(/^[0-9a-f]{64}$/),
});

export type AppState = z.infer<typeof appStateSchema>;
export type RunLogEntry = z.infer<typeof runLogEntry>;
export type SavePayload = z.infer<typeof payloadSchema>;
export type SlotRecord = z.infer<typeof slotRecordSchema>;
export type SlotName = SlotRecord['slot'];

// Compile-time proof that the schema and the engine agree on GameState. If this line stops compiling, one of
// them changed without the other.
type Same<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
export const GAME_STATE_MATCHES_SCHEMA: Same<z.infer<typeof gameStateSchema>, GameState> = true;

export const newAppState = (now: number): AppState => ({
  settings: { playbackSpeed: 1, skipPlayback: false, tapToMove: true, dragToSteer: true },
  exportTracking: { trackingSince: now, lastExportAt: null, runsAtLastExport: 0 },
  runTiming: { startedAt: now, activeMs: 0 },
  runLog: [],
});
