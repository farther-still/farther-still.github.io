// Whether one save may take another's place in the cloud backup without the player being asked (GDD D-40).
// The answer is worked out from the two saves themselves, each time, and from nothing this install remembers:
// a note can go stale, fail to be stored, or miss a way the game on the phone was changed. A save cannot.

import { SAVE_VERSION } from './constants';
import { migrateRecord } from './migrations';
import { checksumMatches, isObject } from './record';
import { payloadSchema } from './schema';
import type { SavePayload } from './schema';

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

/** The moment a game was begun. It is set once, when the save is made, and nothing rewrites it. */
const begunAt = (payload: SavePayload): number => payload.app.exportTracking.trackingSince;

const holdsEvery = (mine: readonly string[], theirs: readonly string[]): boolean => {
  const held = new Set(mine);
  return theirs.every((id) => held.has(id));
};

/**
 * True when `mine` is the same game as `theirs`, is not from an earlier run, and keeps at least everything
 * `theirs` keeps between runs: every copy of every item, every Claim, every count in the bestiary, every secret
 * and waypoint, the permanent unlock, and its two records. Replacing `theirs` with `mine` then loses nothing
 * that lasts.
 *
 * Left out on purpose: gems, which are spent, and loadouts, settings and all of the run itself, which a later
 * state simply changes. So a save from the start of a run may replace one from later in the same run only if the
 * later one won nothing; a win shows in the bestiary.
 */
export const succeeds = (mine: SavePayload, theirs: SavePayload): boolean => {
  if (begunAt(mine) !== begunAt(theirs)) return false;
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
    a.strongestEverBeaten >= b.strongestEverBeaten &&
    a.counters.runsStarted >= b.counters.runsStarted &&
    a.counters.bestLevel >= b.counters.bestLevel &&
    (a.autoAssign.unlocked || !b.autoAssign.unlocked)
  );
};
