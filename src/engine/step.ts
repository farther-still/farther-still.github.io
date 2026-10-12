// The reducer: the only way game state changes (ARCHITECTURE 5.1). Phase 3a holds the dummy rules only.

import { isUint32, streamRng } from './rng';
import { startRun } from './state';
import type { Action, Content, GameState, ItemId, StepResult } from './state';

const owned = (state: GameState, item: ItemId): number => state.profile.inventory[item] ?? 0;

const withCopies = (state: GameState, item: ItemId, copies: number): GameState => ({
  ...state,
  profile: { ...state.profile, inventory: { ...state.profile.inventory, [item]: copies } },
});

/** Never throws on a player action and never changes its arguments: a disallowed action comes back rejected. */
export const step = (state: GameState, action: Action, content: Content): StepResult => {
  switch (action.type) {
    case 'NewRun': {
      if (!isUint32(action.seed)) return { rejected: 'bad-seed' };
      const next = startRun(state, action.seed);
      return { state: next, events: [{ type: 'RunStarted', run: next.profile.runsStarted }] };
    }
    case 'Count': {
      if (state.run.counter >= Number.MAX_SAFE_INTEGER) return { rejected: 'count-limit' };
      const roll = streamRng(state.run.seed, 'battle', state.run.counter).nextUint32();
      const counter = state.run.counter + 1;
      return {
        state: { ...state, run: { ...state.run, counter, lastRoll: roll } },
        events: [{ type: 'Counted', counter, roll }],
      };
    }
    case 'Step': {
      if (state.run.steps >= Number.MAX_SAFE_INTEGER) return { rejected: 'count-limit' };
      const steps = state.run.steps + 1;
      return { state: { ...state, run: { ...state.run, steps } }, events: [{ type: 'Stepped', steps }] };
    }
    case 'AddItem': {
      if (!content.items.includes(action.item)) return { rejected: 'unknown-item' };
      if (owned(state, action.item) >= Number.MAX_SAFE_INTEGER) return { rejected: 'count-limit' };
      const copies = owned(state, action.item) + 1;
      return {
        state: withCopies(state, action.item, copies),
        events: [{ type: 'InventoryChanged', item: action.item, copies }],
      };
    }
    case 'RemoveItem': {
      const copies = owned(state, action.item) - 1;
      if (copies < 0) return { rejected: 'not-owned' };
      if (copies === 0 && state.profile.equipped === action.item) return { rejected: 'item-in-use' };
      return {
        state: withCopies(state, action.item, copies),
        events: [{ type: 'InventoryChanged', item: action.item, copies }],
      };
    }
    case 'Equip': {
      if (action.item !== null && owned(state, action.item) < 1) return { rejected: 'not-owned' };
      return {
        state: { ...state, profile: { ...state.profile, equipped: action.item } },
        events: [{ type: 'Equipped', item: action.item }],
      };
    }
    case 'SetTarget': {
      if (action.item !== null && !content.items.includes(action.item)) return { rejected: 'unknown-item' };
      return {
        state: { ...state, run: { ...state.run, target: action.item } },
        events: [{ type: 'TargetSet', item: action.item }],
      };
    }
  }
};

/**
 * Brings a run in line with changed content (ARCHITECTURE 7.3). `profile` is never altered. Returns the same
 * object when nothing needed repair, so the caller can tell by identity.
 */
export const repairRun = (state: GameState, content: Content): GameState => {
  if (state.run.target === null || content.items.includes(state.run.target)) return state;
  return { ...state, run: { ...state.run, target: null } };
};
