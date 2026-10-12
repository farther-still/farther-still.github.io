import { describe, expect, it } from 'vitest';
import { CONTENT, gameAtRun, record, recordV1, suspectGame } from '../../tests/helpers';
import { classify } from '../save';
import type { QuarantineEntry } from '../save';
import { recoveryChoices } from './recovery';

// One record of each kind: suspect (a loadout wears an item that is not owned), good, damaged, and newer.
const records = [
  classify('hot', record('hot', 9, suspectGame()), CONTENT),
  classify('checkpoint-0', record('checkpoint-0', 7, gameAtRun(2)), CONTENT),
  classify('checkpoint-1', 'garbage', CONTENT),
  classify('checkpoint-2', { ...record('checkpoint-2', 8), saveVersion: 5 }, CONTENT),
];

const entry: QuarantineEntry = {
  key: 'hot|4|abc',
  kind: 'kept',
  reason: 'replaced-by-import',
  slot: 'hot',
  seq: 4,
  order: 1,
  raw: record('hot', 4),
};

describe('recovery choices', () => {
  it('is handed one record of each kind', () => {
    expect(records.map((classified) => classified.kind)).toEqual(['suspect', 'good', 'damaged', 'newer']);
  });

  it('offers only the two choices that write nothing when storage could not be read', () => {
    // Whatever the screen was handed, nothing is known about the slots after an unreadable start, so nothing
    // that would write over them may be offered: no use, no restore, no new game.
    for (const reason of ['unreadable', 'failed-start'] as const) {
      for (const given of [[], records]) {
        const choices = recoveryChoices({ reason, records: given, quarantine: [entry] });
        expect(choices.map((choice) => choice.kind), reason).toEqual(['export', 'retry']);
      }
    }
  });

  it('offers each intact record, each set-aside save and a new game once the slots have been read', () => {
    const choices = recoveryChoices({ reason: 'suspect', records, quarantine: [entry] });
    expect(choices.map((choice) => choice.kind)).toEqual(['export', 'retry', 'use', 'use', 'restore', 'start-new']);
    const labels = choices.flatMap((choice) => (choice.kind === 'use' || choice.kind === 'restore' ? [choice.label] : []));
    expect(labels[0]).toBe('Use hot anyway (run 3)');
    expect(labels[1]).toMatch(/^Use checkpoint-0 \(run 2, /);
    expect(labels[1]).not.toContain('anyway');
    expect(labels[2]).toBe('Restore set-aside hot, save 4 (replaced-by-import)');
  });

  it('hands each choice the record or the set-aside save it names, not another', () => {
    const choices = recoveryChoices({ reason: 'suspect', records, quarantine: [entry] });
    const used = choices.flatMap((choice) => (choice.kind === 'use' ? [choice.record] : []));
    expect(used.map((chosen) => `${chosen.slot}:${chosen.seq}`)).toEqual(['hot:9', 'checkpoint-0:7']);
    expect(choices.flatMap((choice) => (choice.kind === 'restore' ? [choice.entry] : []))).toEqual([entry]);
  });

  it('lists the records newest first, whatever order they were read in', () => {
    const good = [
      classify('checkpoint-0', record('checkpoint-0', 7, gameAtRun(2)), CONTENT),
      classify('checkpoint-1', record('checkpoint-1', 30, gameAtRun(6)), CONTENT),
      classify('hot', record('hot', 9, suspectGame()), CONTENT),
      classify('checkpoint-2', record('checkpoint-2', 12, gameAtRun(4)), CONTENT),
    ];
    const labels = recoveryChoices({ reason: 'suspect', records: good, quarantine: [] }).flatMap((choice) => (choice.kind === 'use' ? [choice.label] : []));
    expect(labels.map((label) => label.replace(/, .*$/, ')'))).toEqual(['Use checkpoint-1 (run 6)', 'Use checkpoint-2 (run 4)', 'Use hot anyway (run 3)', 'Use checkpoint-0 (run 2)']);
  });

  it('never offers a damaged record or one from a newer version as something to use', () => {
    const choices = recoveryChoices({ reason: 'none-usable', records: records.slice(2), quarantine: [] });
    expect(choices.map((choice) => choice.kind)).toEqual(['export', 'retry', 'start-new']);
  });

  it('offers a record from the test build as the upgraded game it would load as: run 1', () => {
    // A version 1 record is good once migrated, so it is offered like any other; what it holds is the real game's start.
    const old = classify('checkpoint-0', recordV1('checkpoint-0', 7), CONTENT);
    expect(old).toMatchObject({ kind: 'good', migrated: true });
    const choices = recoveryChoices({ reason: 'suspect', records: [records[0], old].filter((classified) => classified !== undefined), quarantine: [] });
    const labels = choices.flatMap((choice) => (choice.kind === 'use' ? [choice.label] : []));
    expect(labels[0]).toBe('Use hot anyway (run 3)');
    expect(labels[1]).toMatch(/^Use checkpoint-0 \(run 1, /);
  });
});
