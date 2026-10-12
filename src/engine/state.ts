// Phase 3a dummy state: a counter and a fake inventory, shaped like the real thing (a `profile` half that
// persists and a `run` half that NewRun replaces) so the save system is proven before any game rule exists.
// Save version 1. Phase 3b replaces every field here with ARCHITECTURE section 4, as save version 2.

import { isUint32 } from './rng';

export type ItemId = string;

export type GameState = {
  profile: {
    /** Copies owned of each fake item. */
    inventory: Record<ItemId, number>;
    /** One fake equipment slot. An equipped item must be owned: the checkpoint invariant. */
    equipped: ItemId | null;
    runsStarted: number;
  };
  run: {
    seed: number;
    /** Stands in for the battle count: each Count draws one roll from the seeded stream. */
    counter: number;
    lastRoll: number;
    /** Stands in for a move-only Step: it changes state without an immediate save. */
    steps: number;
    /** Stands in for the run fields that hold content IDs, so run repair has something real to repair. */
    target: ItemId | null;
  };
};

/** Phase 3a dummy content: the list of fake item IDs, loaded from `data/dummy.json`. */
export type Content = {
  items: readonly ItemId[];
};

export type Action =
  | { type: 'NewRun'; seed: number }
  | { type: 'Count' }
  | { type: 'Step' }
  | { type: 'AddItem'; item: ItemId }
  | { type: 'RemoveItem'; item: ItemId }
  | { type: 'Equip'; item: ItemId | null }
  | { type: 'SetTarget'; item: ItemId | null };

export type GameEvent =
  | { type: 'RunStarted'; run: number }
  | { type: 'Counted'; counter: number; roll: number }
  | { type: 'Stepped'; steps: number }
  | { type: 'InventoryChanged'; item: ItemId; copies: number }
  | { type: 'Equipped'; item: ItemId | null }
  | { type: 'TargetSet'; item: ItemId | null };

export type RejectReason = 'bad-seed' | 'unknown-item' | 'not-owned' | 'item-in-use' | 'count-limit';

export type StepResult = { state: GameState; events: GameEvent[] } | { rejected: RejectReason };

const freshRun = (seed: number): GameState['run'] => ({ seed, counter: 0, lastRoll: 0, steps: 0, target: null });

/** A new install's state: nothing owned, first run started. The caller supplies the seed (GDD 2.5). */
export const newGame = (seed: number): GameState => ({
  profile: { inventory: {}, equipped: null, runsStarted: 1 },
  run: freshRun(isUint32(seed) ? seed : 0),
});

export const startRun = (state: GameState, seed: number): GameState => ({
  profile: { ...state.profile, runsStarted: state.profile.runsStarted + 1 },
  run: freshRun(seed),
});
