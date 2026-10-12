import { describe, expect, it } from 'vitest';
import { CONTENT, game, record } from '../../tests/helpers';
import { classify } from '../save';
import type { QuarantineEntry } from '../save';
import { recoveryChoices } from './recovery';

const records = [
  classify('hot', record('hot', 9, game({ profile: { equipped: 'd02' } })), CONTENT),
  classify('checkpoint-0', record('checkpoint-0', 7), CONTENT),
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
    expect(labels[0]).toContain('hot anyway');
    expect(labels[1]).toContain('checkpoint-0');
    expect(labels[1]).not.toContain('anyway');
    expect(labels[2]).toContain('save 4');
  });

  it('never offers a damaged record or one from a newer version as something to use', () => {
    const choices = recoveryChoices({ reason: 'none-usable', records: records.slice(2), quarantine: [] });
    expect(choices.map((choice) => choice.kind)).toEqual(['export', 'retry', 'start-new']);
  });
});
