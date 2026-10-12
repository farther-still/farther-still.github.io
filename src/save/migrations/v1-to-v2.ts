// Save version 1 to 2: the walking skeleton's dummy state to the real game (ARCHITECTURE 7.4).
//
// Version 1 held a counter, a step count and a fake inventory. None of it means anything in the real game, so
// all of it is discarded and the record comes out as a new game at run 1. Two things carry over: the old run's
// seed, so that the result is a pure function of the record, and the time the record was last written, as the
// moment export tracking and the run timer start from.
//
// This file is frozen. It spells out the version 2 shape in full instead of calling the engine's `newGame`,
// because `newGame` will keep changing and a version 1 record must always come out as version 2.

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

const wholeOr = (value: unknown, fallback: number): number => (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : fallback);

const SLOTS = ['weapon', 'head', 'neck', 'shoulders', 'body', 'back', 'arms', 'hands', 'finger', 'waist', 'legs', 'feet', 'offhand', 'acc1', 'acc2', 'acc3', 'acc4', 'acc5'];

const emptyLoadout = (): Record<string, unknown> => ({ name: '', slots: Object.fromEntries(SLOTS.map((slot) => [slot, null])) });

const zeroPoints = (): Record<string, number> => ({ life: 0, damage: 0, defense: 0, dexterity: 0, luck: 0 });

export const migrateV1toV2 = (record: Record<string, unknown>): Record<string, unknown> => {
  const payload = isRecord(record['payload']) ? record['payload'] : {};
  const game = isRecord(payload['game']) ? payload['game'] : {};
  const run = isRecord(game['run']) ? game['run'] : {};
  const seed = wholeOr(run['seed'], 0);
  const writtenAt = wholeOr(record['writtenAt'], 0);

  return {
    ...record,
    saveVersion: 2,
    payload: {
      game: {
        profile: {
          items: {},
          loadouts: [emptyLoadout(), emptyLoadout()],
          activeLoadout: 0,
          claimedBosses: [],
          gems: 0,
          waypointsVisited: [],
          waypointsUnlocked: [],
          bestiary: {},
          strongestEverBeaten: 0,
          secretsFound: [],
          autoAssign: { unlocked: false, on: false, split: { life: 30, damage: 30, defense: 30, dexterity: 10, luck: 0 } },
          hintsShown: [],
          counters: { runsStarted: 1, bestLevel: 1 },
        },
        run: {
          seed: seed <= 0xffffffff ? seed : 0,
          battleCount: 0,
          spawnCount: 0,
          xp: 0,
          pointsSpent: zeroPoints(),
          growthPointsEarned: 0,
          gold: 0,
          energySpent: 0,
          energyPaidBack: 0,
          bossesBeaten: [],
          strongestBeaten: 0,
          lastEnemy: null,
          salvageUsed: false,
          // A migration cannot know where the run start is: that is content. No tile has these coordinates, so
          // the run repair that follows every load puts the hero on the run start (ARCHITECTURE 7.3).
          position: { zone: 'z01', x: -1, y: -1 },
          marks: {},
          stashesCollected: [],
          tallies: { wins: 0, losses: 0, itemsGained: [], claims: 0, gemsGained: 0 },
        },
      },
      app: {
        settings: { playbackSpeed: 1, skipPlayback: false, tapToMove: true, dragToSteer: true },
        // An export of the dummy save is not a backup of this game, so tracking starts again.
        exportTracking: { trackingSince: writtenAt, lastExportAt: null, runsAtLastExport: 0 },
        runTiming: { startedAt: writtenAt, activeMs: 0 },
        runLog: [],
      },
    },
  };
};
