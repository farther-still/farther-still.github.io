import { describe, expect, it } from 'vitest';
import { WALL_TILES, canStep, enemyAtSpawn, findPath, indexContent, isAdjacent, walkable } from './map';
import type { WalkMode } from './map';
import { sampleContent, sampleGame } from './sample.fixture';
import type { GameState } from './state';
import type { Content, EnemyDef, Point, Position } from './types';

// GDD 7.7 (gates) and 8.3 (movement), on the sample world:
//
//   x 012345678
// y 0 #########
//   1 #..2#...#   2  s002, a normal enemy            B  s003, the gate boss e003
//   2 #...B..>#   1  s001, a normal enemy            >  exit to z02
//   3 #..1#...#   S  Salvage site                    @  run start
//   4 #.S.#####   %  hidden tile x01, drawn as wall  _  stash x02
//   5 #.@.%_###   D  door, opened by key i004
//   6 #...#####
//   7 #D#######
//   8 #.#######
//   9 #########

const content = sampleContent();

const enemyOrThrow = (id: string): EnemyDef => {
  const enemy = content.enemies[id];
  if (enemy === undefined) throw new Error(`test setup: no enemy ${id}`);
  return enemy;
};

const game = (run: Partial<GameState['run']> = {}, profile: Partial<GameState['profile']> = {}): GameState => {
  const base = sampleGame();
  return { profile: { ...base.profile, ...profile }, run: { ...base.run, ...run } };
};

const fresh = game();
const bossBeaten = game({ bossesBeaten: ['e003'] });
const withKey = game({}, { items: { i004: 1 } });
const hiddenFound = game({}, { secretsFound: ['x01'] });

const at = (x: number, y: number, zone = 'z01'): Position => ({ zone, x, y });

const MODES: WalkMode[] = ['step', 'path'];

/** Checks a route tile by tile: each step is one allowed step from the tile before, and it ends where it should. */
const expectRoute = (state: GameState, world: Content, from: Position, route: Point[] | null, mode: WalkMode = 'path'): Point[] => {
  expect(route).not.toBeNull();
  const steps = route ?? [];
  let here: Position = from;
  for (const tile of steps) {
    expect(canStep(state, world, here, tile.x - here.x, tile.y - here.y, mode)).toBe(true);
    here = { zone: from.zone, x: tile.x, y: tile.y };
  }
  return steps;
};

/** A second small world for what the sample has none of: a fence wall, a sealed door, the other floor characters, and a hidden tile beside a diagonal. */
const yard = (): Content =>
  indexContent({
    ...content,
    start: { zone: 'z09', x: 1, y: 1 },
    zoneOrder: ['z09'],
    zones: {
      z09: {
        id: 'z09',
        balanceKey: 'Z1',
        referenceLoadout: null,
        // (2,1) is the hidden tile, drawn as wall. (4,1) is a fence. (4,2) is the sealed door.
        map: { width: 6, height: 5, tiles: ['######', '#.#.%#', '#....#', '#.,:"#', '######'], doors: [{ x: 4, y: 2, key: null, keyZone: null }], exits: [], salvageSites: [], places: [] },
      },
    },
    spawnOrder: [],
    spawns: {},
    secretOrder: ['x09'],
    secrets: { x09: { id: 'x09', kind: 'hidden', zone: 'z09', tiles: [{ x: 2, y: 1 }] } },
  });

describe('walkable (GDD 7.7, 8.3)', () => {
  it('lets the hero stand on floor', () => {
    for (const mode of MODES) {
      expect(walkable(fresh, content, 'z01', 1, 1, mode)).toBe(true);
      expect(walkable(fresh, content, 'z01', 2, 5, mode)).toBe(true);
      expect(walkable(fresh, content, 'z01', 6, 3, mode)).toBe(true);
      expect(walkable(fresh, content, 'z02', 1, 2, mode)).toBe(true);
    }
  });

  it('treats every character but the wall characters as floor', () => {
    expect(WALL_TILES).toBe('#%');
    // The stash's `_` in the sample world and the `:` under the exit in z02.
    expect(walkable(fresh, content, 'z01', 5, 5, 'step')).toBe(true);
    expect(walkable(fresh, content, 'z02', 3, 2, 'step')).toBe(true);
    const world = yard();
    const state = game({ position: world.start });
    for (const x of [1, 2, 3, 4]) expect(walkable(state, world, 'z09', x, 3, 'path')).toBe(true);
  });

  it('blocks both kinds of wall', () => {
    for (const mode of MODES) {
      expect(walkable(fresh, content, 'z01', 0, 0, mode)).toBe(false);
      expect(walkable(fresh, content, 'z01', 4, 1, mode)).toBe(false);
      expect(walkable(fresh, content, 'z01', 4, 4, mode)).toBe(false);
      const world = yard();
      expect(walkable(game(), world, 'z09', 4, 1, mode)).toBe(false);
    }
  });

  it('blocks everything outside the grid and every zone that does not exist', () => {
    for (const mode of MODES) {
      expect(walkable(fresh, content, 'z01', -1, 2, mode)).toBe(false);
      expect(walkable(fresh, content, 'z01', 2, -1, mode)).toBe(false);
      expect(walkable(fresh, content, 'z01', 9, 2, mode)).toBe(false);
      expect(walkable(fresh, content, 'z01', 2, 10, mode)).toBe(false);
      expect(walkable(fresh, content, 'z99', 1, 1, mode)).toBe(false);
    }
  });

  it('blocks a normal enemy’s tile always, since it is back at once', () => {
    const beatenBefore = game({ strongestBeaten: 4, lastEnemy: 'e001' }, { bestiary: { e001: { timesBeaten: 9 }, e002: { timesBeaten: 9 } } });
    for (const mode of MODES) {
      for (const state of [fresh, beatenBefore, bossBeaten]) {
        expect(walkable(state, content, 'z01', 3, 3, mode)).toBe(false);
        expect(walkable(state, content, 'z01', 3, 1, mode)).toBe(false);
      }
      expect(walkable(fresh, content, 'z02', 2, 1, mode)).toBe(false);
    }
  });

  it('blocks a boss’s tile until the boss is beaten this run, and opens it then', () => {
    const beatenEarlier = game({}, { bestiary: { e003: { timesBeaten: 5 } }, claimedBosses: ['e003'] });
    for (const mode of MODES) {
      expect(walkable(fresh, content, 'z01', 4, 2, mode)).toBe(false);
      // Beaten on an earlier run, even claimed: a gate boss blocks its path again every run (GDD 2.2).
      expect(walkable(beatenEarlier, content, 'z01', 4, 2, mode)).toBe(false);
      expect(walkable(bossBeaten, content, 'z01', 4, 2, mode)).toBe(true);
    }
  });

  it('opens a door for anyone holding its key, and for nobody else', () => {
    for (const mode of MODES) {
      expect(walkable(fresh, content, 'z01', 1, 7, mode)).toBe(false);
      expect(walkable(game({}, { items: { i004: 0 } }), content, 'z01', 1, 7, mode)).toBe(false);
      expect(walkable(game({}, { items: { i001: 1, i005: 1 } }), content, 'z01', 1, 7, mode)).toBe(false);
      expect(walkable(withKey, content, 'z01', 1, 7, mode)).toBe(true);
    }
  });

  it('never opens a sealed door', () => {
    const world = yard();
    const everything = game({}, { items: { i001: 1, i002: 1, i003: 3, i004: 1, i005: 1, i006: 1, i007: 1, i008: 1 } });
    for (const mode of MODES) expect(walkable(everything, world, 'z09', 4, 2, mode)).toBe(false);
  });

  it('lets the hero step onto a hidden tile at any time, though it is drawn as wall', () => {
    expect(walkable(fresh, content, 'z01', 4, 5, 'step')).toBe(true);
    expect(walkable(hiddenFound, content, 'z01', 4, 5, 'step')).toBe(true);
  });

  it('lets a route use a hidden tile only once it has been found', () => {
    expect(walkable(fresh, content, 'z01', 4, 5, 'path')).toBe(false);
    expect(walkable(game({}, { secretsFound: ['x02'] }), content, 'z01', 4, 5, 'path')).toBe(false);
    expect(walkable(hiddenFound, content, 'z01', 4, 5, 'path')).toBe(true);
  });
});

describe('canStep (GDD 8.3)', () => {
  it('allows one tile in any of eight directions onto open floor', () => {
    const centre = at(2, 2);
    const moves: Array<[number, number, boolean]> = [
      [0, -1, true],
      [1, 0, true],
      [0, 1, true],
      [-1, 0, true],
      [-1, -1, true],
      [-1, 1, true],
      // The two diagonals to the right land on the enemies at (3,1) and (3,3).
      [1, -1, false],
      [1, 1, false],
    ];
    for (const [dx, dy, allowed] of moves) expect(canStep(fresh, content, centre, dx, dy, 'step')).toBe(allowed);
  });

  it('refuses a step into a wall, off the grid, or onto an enemy', () => {
    expect(canStep(fresh, content, at(1, 1), -1, 0, 'step')).toBe(false);
    expect(canStep(fresh, content, at(1, 1), 0, -1, 'step')).toBe(false);
    expect(canStep(fresh, content, at(3, 2), 0, -1, 'step')).toBe(false);
    expect(canStep(fresh, content, at(3, 2), 0, 1, 'step')).toBe(false);
    expect(canStep(fresh, content, at(3, 2), 1, 0, 'step')).toBe(false);
    expect(canStep(fresh, content, at(0, 0), -1, 0, 'step')).toBe(false);
  });

  it('refuses anything that is not exactly one tile', () => {
    const from = at(2, 3);
    expect(canStep(fresh, content, from, 0, 0, 'step')).toBe(false);
    expect(canStep(fresh, content, from, 0, 2, 'step')).toBe(false);
    expect(canStep(fresh, content, from, -2, 0, 'step')).toBe(false);
    expect(canStep(fresh, content, from, 2, 2, 'step')).toBe(false);
    expect(canStep(fresh, content, from, 0.5, 0, 'step')).toBe(false);
    expect(canStep(fresh, content, from, 0, -0.5, 'step')).toBe(false);
    expect(canStep(fresh, content, from, Number.NaN, 0, 'step')).toBe(false);
    expect(canStep(fresh, content, from, 0, Number.NaN, 'step')).toBe(false);
    expect(canStep(fresh, content, from, Number.POSITIVE_INFINITY, 0, 'step')).toBe(false);
  });

  it('allows a diagonal only when both tiles beside it are open', () => {
    // Open on both sides.
    expect(canStep(fresh, content, at(1, 1), 1, 1, 'step')).toBe(true);
    expect(canStep(fresh, content, at(2, 5), -1, -1, 'step')).toBe(true);
    // A wall on one side: (5,1) to the boss's opened tile (4,2) would cut the corner of the wall at (4,1).
    expect(walkable(bossBeaten, content, 'z01', 4, 2, 'step')).toBe(true);
    expect(canStep(bossBeaten, content, at(5, 1), -1, 1, 'step')).toBe(false);
    expect(canStep(bossBeaten, content, at(5, 3), -1, -1, 'step')).toBe(false);
    expect(canStep(bossBeaten, content, at(4, 2), 1, -1, 'step')).toBe(false);
    // The straight step onto the same tile is fine.
    expect(canStep(bossBeaten, content, at(5, 2), -1, 0, 'step')).toBe(true);
    // A wall on one side of the way onto the hidden tile: only the straight step from (3,5) reaches it.
    expect(canStep(fresh, content, at(3, 4), 1, 1, 'step')).toBe(false);
    expect(canStep(fresh, content, at(3, 6), 1, -1, 'step')).toBe(false);
    expect(canStep(fresh, content, at(3, 5), 1, 0, 'step')).toBe(true);
  });

  it('counts an enemy as a closed tile beside a diagonal', () => {
    // (2,3) to (3,2) passes the enemy at (3,3); (2,1) to (3,2) passes the one at (3,1).
    expect(walkable(fresh, content, 'z01', 3, 2, 'step')).toBe(true);
    expect(canStep(fresh, content, at(2, 3), 1, -1, 'step')).toBe(false);
    expect(canStep(fresh, content, at(2, 1), 1, 1, 'step')).toBe(false);
    expect(canStep(fresh, content, at(3, 2), -1, 1, 'step')).toBe(false);
  });

  it('counts a locked door as a closed tile beside a diagonal, and an open one as open', () => {
    const world = indexContent({
      ...content,
      zones: {
        ...content.zones,
        z02: { id: 'z02', balanceKey: 'Z2', referenceLoadout: null, map: { width: 5, height: 4, tiles: ['#####', '#...#', '#...#', '#####'], doors: [{ x: 2, y: 1, key: 'i004', keyZone: 'z01' }], exits: [], salvageSites: [], places: [] } },
      },
      spawnOrder: ['s001', 's002', 's003'],
    });
    // (1,1) to (2,2) passes the door at (2,1).
    expect(canStep(fresh, world, at(1, 1, 'z02'), 1, 1, 'step')).toBe(false);
    expect(canStep(withKey, world, at(1, 1, 'z02'), 1, 1, 'step')).toBe(true);
  });

  it('counts an unfound hidden tile as open beside a diagonal when stepping, and closed when routing', () => {
    const world = yard();
    const state = game({ position: world.start });
    const found = game({ position: world.start }, { secretsFound: ['x09'] });
    // The hidden tile (2,1) lies beside the diagonal from (3,1) to (2,2).
    expect(canStep(state, world, at(3, 1, 'z09'), -1, 1, 'step')).toBe(true);
    expect(canStep(state, world, at(3, 1, 'z09'), -1, 1, 'path')).toBe(false);
    expect(canStep(found, world, at(3, 1, 'z09'), -1, 1, 'path')).toBe(true);
  });

  it('needs a key to step through the door', () => {
    expect(canStep(fresh, content, at(1, 6), 0, 1, 'step')).toBe(false);
    expect(canStep(withKey, content, at(1, 6), 0, 1, 'step')).toBe(true);
    expect(canStep(withKey, content, at(1, 7), 0, 1, 'step')).toBe(true);
    // The door stands in a corridor one tile wide: no diagonal reaches it.
    expect(canStep(withKey, content, at(2, 6), -1, 1, 'step')).toBe(false);
  });
});

describe('isAdjacent', () => {
  it('is true for the eight tiles around, and for the tile itself', () => {
    for (const dx of [-1, 0, 1]) for (const dy of [-1, 0, 1]) expect(isAdjacent(at(3, 3), 'z01', 3 + dx, 3 + dy)).toBe(true);
  });

  it('is false two tiles away or in another zone', () => {
    expect(isAdjacent(at(3, 3), 'z01', 5, 3)).toBe(false);
    expect(isAdjacent(at(3, 3), 'z01', 3, 1)).toBe(false);
    expect(isAdjacent(at(3, 3), 'z01', 5, 5)).toBe(false);
    expect(isAdjacent(at(3, 3), 'z02', 3, 3)).toBe(false);
  });
});

describe('findPath (GDD 8.3)', () => {
  it('is empty when the hero is already there', () => {
    expect(findPath(fresh, content, at(2, 5), { x: 2, y: 5 })).toEqual([]);
  });

  it('finds the shortest route over open floor', () => {
    const cases: Array<[Position, Point, number]> = [
      [at(2, 5), { x: 2, y: 2 }, 3],
      [at(2, 5), { x: 1, y: 1 }, 4],
      [at(1, 1), { x: 3, y: 2 }, 2],
      [at(1, 1), { x: 1, y: 6 }, 5],
      [at(1, 6), { x: 3, y: 4 }, 2],
      [at(5, 1), { x: 6, y: 3 }, 2],
      [at(2, 5), { x: 3, y: 5 }, 1],
    ];
    for (const [from, to, length] of cases) {
      const route = expectRoute(fresh, content, from, findPath(fresh, content, from, to));
      expect(route).toHaveLength(length);
      expect(route[route.length - 1]).toEqual(to);
    }
  });

  it('goes round an enemy instead of past its corner', () => {
    // (3,2) is one across and three up from the start, which would be three steps if the last could be the
    // diagonal from (2,3). That diagonal brushes the enemy at (3,3), so the route takes four.
    const route = expectRoute(fresh, content, at(2, 5), findPath(fresh, content, at(2, 5), { x: 3, y: 2 }));
    expect(route).toHaveLength(4);
    expect(route[route.length - 1]).toEqual({ x: 3, y: 2 });
  });

  it('gives the same route every time', () => {
    expect(findPath(fresh, content, at(1, 6), { x: 2, y: 1 })).toEqual(findPath(fresh, content, at(1, 6), { x: 2, y: 1 }));
  });

  it('has no route onto an enemy’s tile, a wall, or a tile outside the grid or the zone', () => {
    expect(findPath(fresh, content, at(2, 5), { x: 3, y: 3 })).toBeNull();
    expect(findPath(fresh, content, at(2, 5), { x: 4, y: 2 })).toBeNull();
    expect(findPath(fresh, content, at(2, 5), { x: 0, y: 0 })).toBeNull();
    expect(findPath(fresh, content, at(2, 5), { x: 4, y: 4 })).toBeNull();
    expect(findPath(fresh, content, at(2, 5), { x: -3, y: 2 })).toBeNull();
    expect(findPath(fresh, content, at(2, 5), { x: 40, y: 40 })).toBeNull();
    expect(findPath(fresh, content, at(2, 5, 'z99'), { x: 1, y: 1 })).toBeNull();
  });

  it('stops beside an enemy when asked to', () => {
    const toFirst = expectRoute(fresh, content, at(2, 5), findPath(fresh, content, at(2, 5), { x: 3, y: 3 }, { beside: true }));
    expect(toFirst).toHaveLength(1);
    const end = toFirst[0] ?? { x: -9, y: -9 };
    expect(isAdjacent({ zone: 'z01', ...end }, 'z01', 3, 3)).toBe(true);
    expect(end).not.toEqual({ x: 3, y: 3 });

    // The boss at (4,2) can be reached from (3,2) only: (3,1) and (3,3) are enemies and the rest is wall or beyond it.
    const toBoss = expectRoute(fresh, content, at(2, 5), findPath(fresh, content, at(2, 5), { x: 4, y: 2 }, { beside: true }));
    expect(toBoss).toHaveLength(4);
    expect(toBoss[toBoss.length - 1]).toEqual({ x: 3, y: 2 });
  });

  it('is empty when the hero already stands beside the enemy', () => {
    expect(findPath(fresh, content, at(2, 4), { x: 3, y: 3 }, { beside: true })).toEqual([]);
    expect(findPath(fresh, content, at(3, 2), { x: 4, y: 2 }, { beside: true })).toEqual([]);
    expect(findPath(fresh, content, at(1, 1, 'z02'), { x: 2, y: 1 }, { beside: true })).toEqual([]);
  });

  it('does not count standing on the target as standing beside it', () => {
    // The hero on a beaten boss's tile, asked to stand beside that tile, takes one step off it.
    const route = expectRoute(bossBeaten, content, at(4, 2), findPath(bossBeaten, content, at(4, 2), { x: 4, y: 2 }, { beside: true }));
    expect(route).toHaveLength(1);
  });

  it('has no route past a gate boss, and one through its tile once it is beaten this run', () => {
    expect(findPath(fresh, content, at(3, 2), { x: 5, y: 2 })).toBeNull();
    expect(findPath(fresh, content, at(2, 5), { x: 7, y: 2 })).toBeNull();
    expect(findPath(fresh, content, at(2, 5), { x: 6, y: 1 })).toBeNull();
    // And back the other way.
    expect(findPath(fresh, content, at(6, 2), { x: 2, y: 5 })).toBeNull();

    expect(findPath(bossBeaten, content, at(3, 2), { x: 5, y: 2 })).toEqual([
      { x: 4, y: 2 },
      { x: 5, y: 2 },
    ]);
    const toExit = expectRoute(bossBeaten, content, at(2, 5), findPath(bossBeaten, content, at(2, 5), { x: 7, y: 2 }));
    expect(toExit).toHaveLength(8);
    expect(toExit).toContainEqual({ x: 4, y: 2 });
  });

  it('has no route past a gate boss beaten on an earlier run only', () => {
    const earlier = game({}, { bestiary: { e003: { timesBeaten: 3 } }, claimedBosses: ['e003'] });
    expect(findPath(earlier, content, at(3, 2), { x: 5, y: 2 })).toBeNull();
  });

  it('has no route through a door without its key, and one with it', () => {
    expect(findPath(fresh, content, at(2, 5), { x: 1, y: 8 })).toBeNull();
    expect(findPath(fresh, content, at(2, 5), { x: 1, y: 7 })).toBeNull();
    const route = expectRoute(withKey, content, at(2, 5), findPath(withKey, content, at(2, 5), { x: 1, y: 8 }));
    expect(route).toEqual([
      { x: 1, y: 6 },
      { x: 1, y: 7 },
      { x: 1, y: 8 },
    ]);
  });

  it('never routes a tap across a hidden tile that has not been found', () => {
    // The stash at (5,5) lies behind the hidden tile at (4,5), and nothing else leads to it.
    expect(findPath(fresh, content, at(2, 5), { x: 5, y: 5 })).toBeNull();
    expect(findPath(fresh, content, at(2, 5), { x: 4, y: 5 })).toBeNull();
    expect(findPath(fresh, content, at(3, 5), { x: 5, y: 5 })).toBeNull();
  });

  it('routes across a hidden tile once it has been found', () => {
    const route = expectRoute(hiddenFound, content, at(2, 5), findPath(hiddenFound, content, at(2, 5), { x: 5, y: 5 }));
    expect(route).toEqual([
      { x: 3, y: 5 },
      { x: 4, y: 5 },
      { x: 5, y: 5 },
    ]);
  });

  it('can be asked for a steering route, which may cross an unfound hidden tile', () => {
    const route = expectRoute(fresh, content, at(2, 5), findPath(fresh, content, at(2, 5), { x: 5, y: 5 }, { mode: 'step' }), 'step');
    expect(route).toHaveLength(3);
    expect(route).toContainEqual({ x: 4, y: 5 });
  });

  it('takes the longer way round an unfound hidden tile, and the short way once it is found', () => {
    const world = yard();
    const state = game({ position: world.start });
    const found = game({ position: world.start }, { secretsFound: ['x09'] });
    const from = at(1, 1, 'z09');
    // (1,1) and (3,1) are two tiles apart with the hidden tile between them.
    const round = expectRoute(state, world, from, findPath(state, world, from, { x: 3, y: 1 }));
    expect(round).toHaveLength(4);
    expect(round).not.toContainEqual({ x: 2, y: 1 });
    expect(expectRoute(found, world, from, findPath(found, world, from, { x: 3, y: 1 }))).toHaveLength(2);
  });

  it('never crosses an unfound hidden tile on any route in the sample world', () => {
    const map = content.zones['z01']?.map;
    expect(map).toBeDefined();
    let routes = 0;
    for (let y = 0; y < (map?.height ?? 0); y += 1) {
      for (let x = 0; x < (map?.width ?? 0); x += 1) {
        const route = findPath(bossBeaten, content, at(2, 5), { x, y });
        if (route === null) continue;
        routes += 1;
        expect(route).not.toContainEqual({ x: 4, y: 5 });
        expectRoute(bossBeaten, content, at(2, 5), route);
      }
    }
    // The 16 open tiles of the left room, the boss's tile and the 9 of the right room. Not the enemies' tiles,
    // the locked door, the tile behind it, the hidden tile or the stash.
    expect(routes).toBe(16 + 1 + 9);
  });

  it('stays inside the zone it starts in', () => {
    const inSecond = game({ position: { zone: 'z02', x: 1, y: 1 } });
    const route = expectRoute(inSecond, content, at(1, 1, 'z02'), findPath(inSecond, content, at(1, 1, 'z02'), { x: 3, y: 2 }));
    // Down, across, across: the diagonal from (1,1) would brush the enemy at (2,1).
    expect(route).toHaveLength(3);
    // The exit at (3,2) is a tile like any other to the route; crossing it is the reducer's business.
    expect(route[route.length - 1]).toEqual({ x: 3, y: 2 });
  });
});

describe('content lookups', () => {
  it('finds the enemy at a spawn', () => {
    expect(enemyAtSpawn(content, 's001')?.id).toBe('e001');
    expect(enemyAtSpawn(content, 's003')?.id).toBe('e003');
    expect(enemyAtSpawn(content, 's999')).toBeUndefined();
  });

  it('indexes spawns, secrets, doors, exits and sites by tile', () => {
    const { index } = content;
    expect(Object.values(index.spawnAt).sort()).toEqual(['s001', 's002', 's003', 's004']);
    expect(Object.values(index.hiddenAt)).toEqual(['x01']);
    expect(Object.values(index.stashAt)).toEqual(['x02']);
    expect(Object.values(index.doorAt)).toEqual([{ x: 1, y: 7, key: 'i004', keyZone: 'z01' }]);
    expect(Object.values(index.exitAt)).toHaveLength(2);
    expect(Object.values(index.siteAt)).toEqual([{ x: 2, y: 4 }]);
  });

  it('lists the enemies that drop each item, in enemy order', () => {
    expect(content.index.droppedBy['i002']).toEqual(['e001']);
    expect(content.index.droppedBy['i003']).toEqual(['e002']);
    expect(content.index.droppedBy['i005']).toEqual(['e003']);
    expect(content.index.droppedBy['i001']).toBeUndefined();
    const wider = indexContent({
      ...content,
      enemyOrder: ['e004', 'e001'],
      enemies: { ...content.enemies, e004: { ...enemyOrThrow('e004'), drops: [{ item: 'i002', chance: 5 }] } },
    });
    expect(wider.index.droppedBy['i002']).toEqual(['e004', 'e001']);
  });
});
