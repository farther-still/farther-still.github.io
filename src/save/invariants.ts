// Checks the schema cannot express (ARCHITECTURE 7.2). A record that is intact but fails one of these is
// "suspect": it is never written to a checkpoint and never used without the player's say-so.

import type { Content, GameState } from '../engine';

export const checkInvariants = (game: GameState, content: Content): string[] => {
  const problems: string[] = [];
  const { inventory, equipped, runsStarted } = game.profile;
  for (const [item, copies] of Object.entries(inventory)) {
    if (copies < 0) problems.push(`negative count for ${item}`);
    if (!content.items.includes(item)) problems.push(`unknown item ${item} in inventory`);
  }
  if (equipped !== null) {
    if (!content.items.includes(equipped)) problems.push(`unknown item ${equipped} equipped`);
    if ((inventory[equipped] ?? 0) < 1) problems.push(`equipped item ${equipped} is not owned`);
  }
  if (runsStarted < 1) problems.push('runsStarted is below 1');
  if (game.run.counter < 0) problems.push('negative counter');
  if (game.run.steps < 0) problems.push('negative steps');
  if (game.run.lastRoll < 0) problems.push('negative lastRoll');
  if (game.run.seed < 0) problems.push('negative seed');
  return problems;
};
