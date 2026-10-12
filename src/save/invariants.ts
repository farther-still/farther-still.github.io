// Checks the schema cannot express (ARCHITECTURE 7.2). A record that is intact but fails one of these is
// "suspect": it is never written to a checkpoint and never used without the player's say-so.
//
// They cover `profile`, whose IDs are permanent, and the plain arithmetic of `run`. What a run says about
// content (its position, its spawns, the bosses it has beaten) is not judged here: content can change under a
// run in progress, and bringing the run back in line is the job of `repairRun`, not a reason to refuse the save.

import { SLOT_IDS, STAT_KEYS } from '../engine';
import type { Content, GameState, ItemDef, SlotId } from '../engine';

const ACCESSORY = /^acc\d$/;

const fits = (item: ItemDef, slot: SlotId): boolean => (item.kind === 'accessory' ? ACCESSORY.test(slot) : item.kind === slot);

const repeats = (list: readonly string[]): boolean => new Set(list).size !== list.length;

export const checkInvariants = (game: GameState, content: Content): string[] => {
  const problems: string[] = [];
  const { profile, run } = game;
  const { loadouts: rules } = content.balance;

  for (const [item, copies] of Object.entries(profile.items)) {
    if (copies < 0) problems.push(`negative count for ${item}`);
    if (content.items[item] === undefined) problems.push(`unknown item ${item} owned`);
  }

  if (profile.loadouts.length < rules.free || profile.loadouts.length > rules.max) problems.push(`${profile.loadouts.length} loadouts`);
  if (profile.loadouts[profile.activeLoadout] === undefined) problems.push('the active loadout does not exist');
  profile.loadouts.forEach((loadout, index) => {
    const worn: Record<string, number> = {};
    for (const slot of SLOT_IDS) {
      const id = loadout.slots[slot];
      if (id === null) continue;
      const item = content.items[id];
      if (item === undefined) {
        problems.push(`unknown item ${id} in loadout ${index + 1}`);
        continue;
      }
      if (!fits(item, slot)) problems.push(`item ${id} is in the wrong slot of loadout ${index + 1}`);
      worn[id] = (worn[id] ?? 0) + 1;
    }
    // Every equipped item must be owned in as many copies as the loadout wears.
    for (const [id, count] of Object.entries(worn)) {
      if ((profile.items[id] ?? 0) < count) problems.push(`loadout ${index + 1} wears ${count} of ${id} but ${profile.items[id] ?? 0} are owned`);
    }
  });

  for (const boss of profile.claimedBosses) {
    if (content.enemies[boss]?.boss !== true) problems.push(`claimed ${boss}, which is not a boss`);
  }
  if (repeats(profile.claimedBosses)) problems.push('a boss is claimed twice');
  for (const [enemy, entry] of Object.entries(profile.bestiary)) {
    if (content.enemies[enemy] === undefined) problems.push(`unknown enemy ${enemy} in the bestiary`);
    if (entry.timesBeaten < 0) problems.push(`negative wins against ${enemy}`);
  }
  for (const secret of profile.secretsFound) if (content.secrets[secret] === undefined) problems.push(`unknown secret ${secret}`);
  for (const waypoint of [...profile.waypointsVisited, ...profile.waypointsUnlocked]) {
    if (content.waypoints[waypoint] === undefined) problems.push(`unknown waypoint ${waypoint}`);
  }
  for (const waypoint of profile.waypointsUnlocked) {
    if (!profile.waypointsVisited.includes(waypoint)) problems.push(`waypoint ${waypoint} is unlocked but was never visited`);
  }
  if (repeats(profile.secretsFound) || repeats(profile.waypointsVisited) || repeats(profile.waypointsUnlocked) || repeats(profile.hintsShown)) {
    problems.push('a list in the profile holds an entry twice');
  }

  const split = profile.autoAssign.split;
  if (STAT_KEYS.some((key) => split[key] < 0) || STAT_KEYS.reduce((total, key) => total + split[key], 0) !== 100) {
    problems.push('the Auto-assign split does not add up to 100');
  }
  if (profile.gems < 0) problems.push('negative gems');
  if (profile.strongestEverBeaten < 0) problems.push('negative strongest enemy');
  if (profile.counters.runsStarted < 1) problems.push('runsStarted is below 1');
  if (profile.counters.bestLevel < 1) problems.push('bestLevel is below 1');

  if (run.seed < 0 || run.seed > 0xffffffff) problems.push('the run seed is out of range');
  const counts: Record<string, number> = {
    battleCount: run.battleCount,
    spawnCount: run.spawnCount,
    xp: run.xp,
    growthPointsEarned: run.growthPointsEarned,
    gold: run.gold,
    energySpent: run.energySpent,
    energyPaidBack: run.energyPaidBack,
    strongestBeaten: run.strongestBeaten,
    wins: run.tallies.wins,
    losses: run.tallies.losses,
    claims: run.tallies.claims,
    gemsGained: run.tallies.gemsGained,
  };
  for (const [name, value] of Object.entries(counts)) if (value < 0) problems.push(`negative ${name}`);
  if (!Number.isInteger(run.xp)) problems.push('xp is not a whole number');
  if (STAT_KEYS.some((key) => run.pointsSpent[key] < 0)) problems.push('negative points spent');
  return problems;
};
