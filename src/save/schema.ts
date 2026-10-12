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

export const gameStateSchema = z.strictObject({
  profile: z.strictObject({
    inventory: z.record(z.string(), whole),
    equipped: z.string().nullable(),
    runsStarted: whole,
  }),
  run: z.strictObject({
    seed: whole,
    counter: whole,
    lastRoll: whole,
    steps: whole,
    target: z.string().nullable(),
  }),
});

/** Settings and export tracking: in the save but outside the game state the engine sees (A-05). */
export const appStateSchema = z.strictObject({
  settings: z.strictObject({
    /** Phase 3a's one setting. It does nothing but prove that settings travel with the save. */
    testToggle: z.boolean(),
  }),
  exportTracking: z.strictObject({
    /** When this save began, so "days without an export" has a start before the first export. */
    trackingSince: whole,
    lastExportAt: whole.nullable(),
    runsAtLastExport: whole,
  }),
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
export type SavePayload = z.infer<typeof payloadSchema>;
export type SlotRecord = z.infer<typeof slotRecordSchema>;
export type SlotName = SlotRecord['slot'];

// Compile-time proof that the schema and the engine agree on GameState. If this line stops compiling, one of
// them changed without the other.
type Same<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
export const GAME_STATE_MATCHES_SCHEMA: Same<z.infer<typeof gameStateSchema>, GameState> = true;

export const newAppState = (now: number): AppState => ({
  settings: { testToggle: false },
  exportTracking: { trackingSince: now, lastExportAt: null, runsAtLastExport: 0 },
});
