// Whether one save may take another's place in the cloud backup without the player being asked (GDD D-40).
// The answer is worked out from the two saves themselves, each time, and from nothing this install remembers:
// a note can go stale, fail to be stored, or miss a way the game on the phone was changed. A save cannot.
//
// The question is whether `mine` is `theirs` played further. A save does not record where it came from, so that
// cannot be proved outright. What can be done is to hold `mine` to every test that a later state of `theirs`
// must pass, using the history a save does carry: the moment the game was begun, each run's own seed, the log
// of finished runs, and the counts that only ever go up.

import { RUN_LOG_LIMIT, SAVE_VERSION } from './constants';
import { migrateRecord } from './migrations';
import { checksumMatches, isObject } from './record';
import { payloadSchema } from './schema';
import type { RunLogEntry, SavePayload } from './schema';

/**
 * The backup file's text as a payload of this build's save version, or null if it is not a record this build
 * can read and trust: not JSON, a checksum that does not match, a newer save version, or a shape the schema
 * refuses. An older version is migrated first, as a loaded record is.
 */
export const backedUpPayload = (text: string): SavePayload | null => {
  try {
    const raw: unknown = JSON.parse(text);
    if (!isObject(raw) || !checksumMatches(raw)) return null;
    const version = raw['saveVersion'];
    if (typeof version !== 'number' || version > SAVE_VERSION) return null;
    const parsed = payloadSchema.safeParse(migrateRecord(raw)['payload']);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};

/**
 * The moment a game was begun. It is set when a save is made, new or by the migration from version 1, and
 * nothing rewrites it afterwards.
 */
const begunAt = (payload: SavePayload): number => payload.app.exportTracking.trackingSince;

const holdsEvery = (mine: readonly string[], theirs: readonly string[]): boolean => {
  const held = new Set(mine);
  return theirs.every((id) => held.has(id));
};

/**
 * What is kept between runs and never goes down in play: every copy of every item, every Claim, every count in
 * the bestiary, every secret and waypoint, every loadout slot bought, the permanent unlock, the hints shown and
 * the two records. Gems are not here, because they are spent; `sameRunFurtherOn` holds them to what a run allows.
 */
const keepsEverything = (mine: SavePayload, theirs: SavePayload): boolean => {
  const a = mine.game.profile;
  const b = theirs.game.profile;
  for (const [item, copies] of Object.entries(b.items)) {
    if ((a.items[item] ?? 0) < copies) return false;
  }
  for (const [enemy, entry] of Object.entries(b.bestiary)) {
    const own = a.bestiary[enemy];
    if (own === undefined || own.timesBeaten < entry.timesBeaten) return false;
  }
  return (
    holdsEvery(a.claimedBosses, b.claimedBosses) &&
    holdsEvery(a.secretsFound, b.secretsFound) &&
    holdsEvery(a.waypointsVisited, b.waypointsVisited) &&
    holdsEvery(a.waypointsUnlocked, b.waypointsUnlocked) &&
    holdsEvery(a.hintsShown, b.hintsShown) &&
    a.loadouts.length >= b.loadouts.length &&
    a.strongestEverBeaten >= b.strongestEverBeaten &&
    a.counters.bestLevel >= b.counters.bestLevel &&
    (a.autoAssign.unlocked || !b.autoAssign.unlocked)
  );
};

const sameEntry = (a: RunLogEntry, b: RunLogEntry): boolean =>
  a.run === b.run &&
  a.startedAt === b.startedAt &&
  a.endedAt === b.endedAt &&
  a.activeMs === b.activeMs &&
  a.wins === b.wins &&
  a.losses === b.losses &&
  a.level === b.level &&
  a.strongest === b.strongest;

/**
 * A finished run is filed in the log once and never changed, so every run `theirs` had finished must be in
 * `mine` exactly as `theirs` has it. A run played again after going back is filed at another time, with another
 * tally. The log keeps only its newest entries; one that `mine` has since let go cannot be compared.
 */
const keepsTheLog = (mine: SavePayload, theirs: SavePayload): boolean => {
  const log = new Map(mine.app.runLog.map((entry) => [entry.run, entry]));
  const full = mine.app.runLog.length >= RUN_LOG_LIMIT;
  const oldest = mine.app.runLog[0]?.run ?? 0;
  return theirs.app.runLog.every((entry) => {
    const own = log.get(entry.run);
    return own === undefined ? full && entry.run < oldest : sameEntry(own, entry);
  });
};

/**
 * Both saves are in the same run. A run's seed is drawn when the run begins, so it names that run: a run begun
 * again, even with the same number, has another. Inside one run these only ever go up, and gems can only be
 * spent or gained and tallied.
 */
const sameRunFurtherOn = (mine: SavePayload, theirs: SavePayload): boolean => {
  const a = mine.game.run;
  const b = theirs.game.run;
  return (
    a.seed === b.seed &&
    mine.app.runTiming.startedAt === theirs.app.runTiming.startedAt &&
    mine.app.runTiming.activeMs >= theirs.app.runTiming.activeMs &&
    a.battleCount >= b.battleCount &&
    a.energySpent >= b.energySpent &&
    a.xp >= b.xp &&
    a.tallies.wins >= b.tallies.wins &&
    a.tallies.losses >= b.tallies.losses &&
    a.tallies.claims >= b.tallies.claims &&
    a.tallies.gemsGained >= b.tallies.gemsGained &&
    (a.salvageUsed || !b.salvageUsed) &&
    mine.game.profile.gems - a.tallies.gemsGained <= theirs.game.profile.gems - b.tallies.gemsGained
  );
};

/**
 * `mine` is in a later run. The run `theirs` was in must then be one `mine` went on to finish: filed in its log
 * as begun at the same moment, with at least the wins, losses and play time `theirs` already had.
 */
const finishedTheirRun = (mine: SavePayload, theirs: SavePayload): boolean => {
  const run = theirs.game.profile.counters.runsStarted;
  const filed = mine.app.runLog.find((entry) => entry.run === run);
  if (filed === undefined) {
    // Let go from a full log. `keepsTheLog` has held every run that can still be compared.
    return mine.app.runLog.length >= RUN_LOG_LIMIT && run < (mine.app.runLog[0]?.run ?? 0);
  }
  return (
    filed.startedAt === theirs.app.runTiming.startedAt &&
    filed.activeMs >= theirs.app.runTiming.activeMs &&
    filed.wins >= theirs.game.run.tallies.wins &&
    filed.losses >= theirs.game.run.tallies.losses
  );
};

/**
 * True when `mine` passes every test that `theirs` played further would pass: the same game; what is kept
 * between runs and never goes down still held; every run `theirs` had finished filed exactly so, as far as
 * `mine`'s log still reaches; and either the same run further on, or a later run that finished the one `theirs`
 * was in.
 *
 * It is a set of tests and not a proof, and it says yes to three kinds of save that are not `theirs` played
 * further. All three need the phone to have gone back to an earlier save first. None loses an item, a Claim, a
 * win, a secret, a waypoint or a loadout slot.
 *
 * - The same run, after going back to any earlier point of it and playing past every count `theirs` holds.
 *   What `theirs` had of loadout arrangement, settings, gold and points is replaced.
 * - A later run, after going back inside the run `theirs` is in and then finishing that run with at least its
 *   wins, losses and play time. The same is replaced, and gems too: gems are spent as well as gained, so a
 *   later run cannot be held to them, and a gem `theirs` gained that the replay did not is lost.
 * - More than a full log of runs later (`RUN_LOG_LIMIT`), any earlier parting of the ways: the runs that would
 *   show it have been let go from the log.
 *
 * A save that differs from `theirs` only in what is not judged at all, such as a setting, passes either way.
 */
export const succeeds = (mine: SavePayload, theirs: SavePayload): boolean => {
  if (begunAt(mine) !== begunAt(theirs)) return false;
  if (!keepsEverything(mine, theirs) || !keepsTheLog(mine, theirs)) return false;
  const mineRun = mine.game.profile.counters.runsStarted;
  const theirRun = theirs.game.profile.counters.runsStarted;
  if (mineRun < theirRun) return false;
  return mineRun === theirRun ? sameRunFurtherOn(mine, theirs) : finishedTheirRun(mine, theirs);
};
