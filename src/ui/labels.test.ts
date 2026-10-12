// System labels that are worked out, not just looked up. The export reminder's sentence has to name what is
// overdue and nothing else (GDD D-33): either limit alone brings the reminder up.

import { describe, expect, it } from 'vitest';
import { EXPORT_REMINDER_DAYS, EXPORT_REMINDER_RUNS } from '../save';
import { exportReminderWords } from './labels';

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
