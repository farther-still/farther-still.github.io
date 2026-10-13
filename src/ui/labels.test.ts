// System labels that are worked out, not just looked up. The export reminder's sentence has to name what is
// overdue and nothing else (GDD D-33): either limit alone brings the reminder up.

import { describe, expect, it } from 'vitest';
import { CONTENT } from '../../tests/helpers';
import { loadBundledContent } from '../content';
import type { Balance } from '../engine';
import { EXPORT_REMINDER_DAYS, EXPORT_REMINDER_RUNS } from '../save';
import { derivedHelp, energyWords, exportReminderWords, hints } from './labels';

const ONLY_COPY = 'The only copy of this save is on this phone.';

describe('exportReminderWords', () => {
  it('is written for limits of 7 days and 10 runs', () => {
    expect({ days: EXPORT_REMINDER_DAYS, runs: EXPORT_REMINDER_RUNS }).toEqual({ days: 7, runs: 10 });
  });

  it('names only the runs when only the runs are over', () => {
    expect(exportReminderWords(0, 10)).toBe(`No export for 10 runs. ${ONLY_COPY}`);
    expect(exportReminderWords(6, 10)).toBe(`No export for 10 runs. ${ONLY_COPY}`);
    expect(exportReminderWords(3, 41)).toBe(`No export for 41 runs. ${ONLY_COPY}`);
  });

  it('names only the days when only the days are over', () => {
    expect(exportReminderWords(8, 0)).toBe(`No export for 8 days. ${ONLY_COPY}`);
    expect(exportReminderWords(8, 9)).toBe(`No export for 8 days. ${ONLY_COPY}`);
    expect(exportReminderWords(7, 1)).toBe(`No export for 7 days. ${ONLY_COPY}`);
  });

  it('names both, days first, when both are over', () => {
    expect(exportReminderWords(8, 12)).toBe(`No export for 8 days and 12 runs. ${ONLY_COPY}`);
    expect(exportReminderWords(7, 10)).toBe(`No export for 7 days and 10 runs. ${ONLY_COPY}`);
  });

  it('counts neither as overdue one short of its limit, and then names nothing', () => {
    // The reminder is not shown then. The sentence still claims nothing that is not so.
    expect(exportReminderWords(6, 9)).toBe(ONLY_COPY);
    expect(exportReminderWords(0, 0)).toBe(ONLY_COPY);
  });

  it('writes a large count as every other number on screen is written', () => {
    expect(exportReminderWords(400, 1234)).toBe(`No export for 400 days and 1,234 runs. ${ONLY_COPY}`);
  });
});

// The lines that state what a fight costs follow one switch in the balance table (GDD 2.2, DV-10). A screen that
// went on saying a loss is free after the rule changed would be the worst kind of wrong.
describe('energyWords', () => {
  const withLosses = (chargeLosses: boolean): Balance => ({ ...CONTENT.balance, energy: { ...CONTENT.balance.energy, chargeLosses } });
  const free = withLosses(false);
  const charged = withLosses(true);

  it('ships with a loss charged (GDD R-11), and the game that ships says so', () => {
    expect(CONTENT.balance.energy.chargeLosses).toBe(true);
    expect(loadBundledContent().balance.energy.chargeLosses).toBe(true);
    expect(energyWords(loadBundledContent().balance).cost(1)).toBe('Costs 1 energy, win or lose.');
  });

  it('keeps the words the slice was approved with for the switch’s other position', () => {
    const words = energyWords(free);
    expect(words.hint).toBe('A win costs energy. A loss costs nothing, so you can back out or try again freely.');
    expect(words.cost(1)).toBe('Costs 1 energy on a win.');
    expect(words.bossCost(1, 3)).toBe('Costs 1 energy on a win and pays back 3.');
    expect(words.afterLoss(1, 19)).toBe('A loss costs nothing: no energy, no gold.');
    expect(words.help).toBe('Fights you can win this run. Energy gear counts only while it is worn.');
  });

  it('never calls a loss free once losses are charged, and names the cost and what is left', () => {
    const words = energyWords(charged);
    const all = [words.hint, words.help, words.cost(2), words.bossCost(2, 4), words.afterLoss(2, 7)];
    for (const text of all) expect(text).not.toMatch(/costs nothing|energy on a win|you can win|freely/i);
    expect(words.hint).toBe('Every fight costs energy, win or lose, and so does trying again. Backing out before the fight is free.');
    expect(words.help).toBe('Fights you can join this run, won or lost. Energy gear counts only while it is worn.');
    expect(words.cost(2)).toBe('Costs 2 energy, win or lose.');
    expect(words.bossCost(2, 4)).toBe('Costs 2 energy, win or lose, and pays back 4 on a win.');
    expect(words.afterLoss(2, 7)).toBe('That fight cost 2 energy. You have 7 left. No gold was lost.');
    expect(words.hint).toMatch(/win or lose/);
  });

  it('is what the pre-fight hint and the Energy help line are made of, under either rule', () => {
    for (const balance of [free, charged]) {
      expect(hints(balance)['prefight']).toBe(energyWords(balance).hint);
      expect(derivedHelp(balance)['energy']).toBe(energyWords(balance).help);
    }
    expect(hints(free)['prefight']).not.toBe(hints(charged)['prefight']);
  });
});
