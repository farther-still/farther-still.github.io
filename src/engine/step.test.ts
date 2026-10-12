import { describe, expect, it } from 'vitest';
import { canonicalJson } from './canonical';
import { streamRng } from './rng';
import { newGame } from './state';
import type { Action, Content, GameState } from './state';
import { repairRun, step } from './step';

const content: Content = { items: ['d01', 'd02', 'd03'] };

const deepFreeze = <T>(value: T): T => {
  if (typeof value === 'object' && value !== null) {
    for (const inner of Object.values(value)) deepFreeze(inner);
    Object.freeze(value);
  }
  return value;
};

const apply = (state: GameState, ...actions: Action[]): GameState => {
  let current = state;
  for (const action of actions) {
    const result = step(deepFreeze(current), action, content);
    if ('rejected' in result) throw new Error(`rejected: ${result.rejected}`);
    current = result.state;
  }
  return current;
};

const rejection = (state: GameState, action: Action): string | null => {
  const result = step(deepFreeze(state), action, content);
  return 'rejected' in result ? result.rejected : null;
};

describe('step (Phase 3a dummy rules)', () => {
  it('starts a new install on run 1 with nothing owned', () => {
    expect(newGame(5)).toEqual({
      profile: { inventory: {}, equipped: null, runsStarted: 1 },
      run: { seed: 5, counter: 0, lastRoll: 0, steps: 0, target: null },
    });
  });

  it('never changes the state it was given', () => {
    const before = newGame(7);
    const text = canonicalJson(before);
    apply(before, { type: 'Count' }, { type: 'AddItem', item: 'd01' }, { type: 'Equip', item: 'd01' }, { type: 'Step' });
    expect(canonicalJson(before)).toBe(text);
  });

  it('draws each Count roll from the battle stream at the current counter', () => {
    const first = step(newGame(7), { type: 'Count' }, content);
    if ('rejected' in first) throw new Error('rejected');
    expect(first.state.run.counter).toBe(1);
    expect(first.state.run.lastRoll).toBe(streamRng(7, 'battle', 0).nextUint32());
    expect(first.events).toEqual([{ type: 'Counted', counter: 1, roll: first.state.run.lastRoll }]);
    const second = apply(first.state, { type: 'Count' });
    expect(second.run.lastRoll).toBe(streamRng(7, 'battle', 1).nextUint32());
  });

  it('gives the same result for the same seed and actions', () => {
    const actions: Action[] = [{ type: 'Count' }, { type: 'Count' }, { type: 'AddItem', item: 'd02' }, { type: 'Step' }];
    expect(apply(newGame(31337), ...actions)).toEqual(apply(newGame(31337), ...actions));
    expect(apply(newGame(31337), ...actions).run.lastRoll).not.toBe(apply(newGame(31338), ...actions).run.lastRoll);
  });

  it('replaces the run and keeps the profile on NewRun', () => {
    const played = apply(
      newGame(1),
      { type: 'AddItem', item: 'd01' },
      { type: 'Equip', item: 'd01' },
      { type: 'Count' },
      { type: 'Step' },
      { type: 'SetTarget', item: 'd02' },
    );
    const next = apply(played, { type: 'NewRun', seed: 99 });
    expect(next.run).toEqual({ seed: 99, counter: 0, lastRoll: 0, steps: 0, target: null });
    expect(next.profile).toEqual({ inventory: { d01: 1 }, equipped: 'd01', runsStarted: 2 });
  });

  it('rejects a seed that is not a whole 32-bit number', () => {
    expect(rejection(newGame(1), { type: 'NewRun', seed: -1 })).toBe('bad-seed');
    expect(rejection(newGame(1), { type: 'NewRun', seed: 0.5 })).toBe('bad-seed');
    expect(rejection(newGame(1), { type: 'NewRun', seed: 4294967296 })).toBe('bad-seed');
  });

  it('rejects items that do not exist or are not owned', () => {
    expect(rejection(newGame(1), { type: 'AddItem', item: 'd99' })).toBe('unknown-item');
    expect(rejection(newGame(1), { type: 'RemoveItem', item: 'd01' })).toBe('not-owned');
    expect(rejection(newGame(1), { type: 'Equip', item: 'd01' })).toBe('not-owned');
    expect(rejection(newGame(1), { type: 'SetTarget', item: 'd99' })).toBe('unknown-item');
  });

  it('will not remove the last copy of the equipped item, so the equipped item is always owned', () => {
    const state = apply(newGame(1), { type: 'AddItem', item: 'd01' }, { type: 'AddItem', item: 'd01' }, { type: 'Equip', item: 'd01' });
    const one = apply(state, { type: 'RemoveItem', item: 'd01' });
    expect(one.profile.inventory['d01']).toBe(1);
    expect(rejection(one, { type: 'RemoveItem', item: 'd01' })).toBe('item-in-use');
    const freed = apply(one, { type: 'Equip', item: null }, { type: 'RemoveItem', item: 'd01' });
    expect(freed.profile.inventory['d01']).toBe(0);
  });

  it('refuses to count past the largest exact whole number', () => {
    const state = newGame(1);
    const full: GameState = { ...state, run: { ...state.run, counter: Number.MAX_SAFE_INTEGER, steps: Number.MAX_SAFE_INTEGER } };
    expect(rejection(full, { type: 'Count' })).toBe('count-limit');
    expect(rejection(full, { type: 'Step' })).toBe('count-limit');
  });
});

describe('repairRun', () => {
  it('clears a target the content no longer has and leaves the profile untouched', () => {
    const state = apply(newGame(1), { type: 'AddItem', item: 'd03' }, { type: 'Equip', item: 'd03' }, { type: 'SetTarget', item: 'd03' }, { type: 'Count' });
    const smaller: Content = { items: ['d01', 'd02'] };
    const repaired = repairRun(deepFreeze(state), smaller);
    expect(repaired.run.target).toBeNull();
    expect(repaired.run.counter).toBe(1);
    expect(repaired.profile).toBe(state.profile);
  });

  it('returns the same object when nothing needs repair', () => {
    const state = apply(newGame(1), { type: 'SetTarget', item: 'd02' });
    expect(repairRun(state, content)).toBe(state);
    expect(repairRun(newGame(1), { items: [] })).toEqual(newGame(1));
  });
});
