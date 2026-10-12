// The tile map as the engine sees it (GDD 7.7, 8.3): which tiles can be stood on, which single steps are
// allowed, and the shortest route over known-walkable tiles. Walking is an animation in the UI; here every move
// is a step from one tile to a neighbouring tile.

import { owned } from './formulas';
import type { GameState } from './state';
import type { Content, ContentIndex, DoorDef, EnemyDef, EnemyId, ExitDef, ItemId, Point, Position, SecretId, SiteDef, SpawnId, ZoneId } from './types';

export const tileKey = (zone: ZoneId, x: number, y: number): string => `${zone}:${x}:${y}`;

type Unindexed = Omit<Content, 'index'>;

/**
 * A lookup table with nothing behind it. An ordinary object answers to names such as `constructor`, so an ID
 * of that spelling in a crafted save or action would look like known content. These tables answer only to
 * what was put in them.
 */
const bare = <T>(table: Readonly<Record<string, T>>): Record<string, T> => Object.assign(Object.create(null) as Record<string, T>, table);

/** Builds the lookups by tile and by item. The content loader and the tests both go through this. */
export const indexContent = (content: Unindexed): Content => {
  const spawnAt: Record<string, SpawnId> = {};
  const hiddenAt: Record<string, SecretId> = {};
  const stashAt: Record<string, SecretId> = {};
  const doorAt: Record<string, DoorDef> = {};
  const exitAt: Record<string, ExitDef> = {};
  const siteAt: Record<string, SiteDef> = {};
  const droppedBy: Record<ItemId, EnemyId[]> = {};

  for (const id of content.spawnOrder) {
    const spawn = content.spawns[id];
    if (spawn !== undefined) spawnAt[tileKey(spawn.zone, spawn.x, spawn.y)] = id;
  }
  for (const id of content.secretOrder) {
    const secret = content.secrets[id];
    if (secret === undefined) continue;
    if (secret.kind === 'stash') stashAt[tileKey(secret.zone, secret.x, secret.y)] = id;
    else for (const tile of secret.tiles) hiddenAt[tileKey(secret.zone, tile.x, tile.y)] = id;
  }
  for (const zoneId of content.zoneOrder) {
    const map = content.zones[zoneId]?.map;
    if (map === undefined) continue;
    for (const door of map.doors) doorAt[tileKey(zoneId, door.x, door.y)] = door;
    for (const exit of map.exits) exitAt[tileKey(zoneId, exit.x, exit.y)] = exit;
    for (const site of map.salvageSites) siteAt[tileKey(zoneId, site.x, site.y)] = site;
  }
  for (const id of content.enemyOrder) {
    for (const drop of content.enemies[id]?.drops ?? []) (droppedBy[drop.item] ??= []).push(id);
  }
  const index: ContentIndex = {
    spawnAt: bare(spawnAt),
    hiddenAt: bare(hiddenAt),
    stashAt: bare(stashAt),
    doorAt: bare(doorAt),
    exitAt: bare(exitAt),
    siteAt: bare(siteAt),
    droppedBy: bare(droppedBy),
  };
  return {
    ...content,
    zones: bare(content.zones),
    enemies: bare(content.enemies),
    items: bare(content.items),
    spawns: bare(content.spawns),
    secrets: bare(content.secrets),
    waypoints: bare(content.waypoints),
    index,
  };
};

export const enemyAtSpawn = (content: Content, spawn: SpawnId): EnemyDef | undefined => content.enemies[content.spawns[spawn]?.enemy ?? ''];

/** The tile characters nobody can stand on. `#` is plain wall; `%` is a wall the UI draws as something built, such as a fence. Every other character is floor. */
export const WALL_TILES = '#%';

/** True when the tile is a wall or lies outside the grid. */
const isWall = (content: Content, zone: ZoneId, x: number, y: number): boolean => {
  const map = content.zones[zone]?.map;
  if (map === undefined || x < 0 || y < 0 || x >= map.width || y >= map.height) return true;
  return WALL_TILES.includes((map.tiles[y] ?? '').charAt(x));
};

/**
 * `step` asks whether the hero may stand there, which includes a hidden tile nobody has found yet: stepping on
 * one is how it is found. `path` asks what tap-to-move may route through: a hidden tile only once it has been
 * found, so a tapped route never gives one away (GDD 8.3).
 */
export type WalkMode = 'step' | 'path';

export const walkable = (state: GameState, content: Content, zone: ZoneId, x: number, y: number, mode: WalkMode): boolean => {
  const map = content.zones[zone]?.map;
  if (map === undefined || x < 0 || y < 0 || x >= map.width || y >= map.height) return false;
  const key = tileKey(zone, x, y);

  const door = content.index.doorAt[key];
  if (door !== undefined) return door.key !== null && owned(state, door.key) > 0;

  // A normal enemy is back at once, so its tile is always taken. A boss is gone for the run once beaten, which
  // is what opens a gate (GDD 7.7).
  const spawn = content.index.spawnAt[key];
  if (spawn !== undefined) {
    const enemy = enemyAtSpawn(content, spawn);
    if (enemy === undefined || !enemy.boss || !state.run.bossesBeaten.includes(enemy.id)) return false;
  }

  const hidden = content.index.hiddenAt[key];
  if (hidden !== undefined) return mode === 'step' || state.profile.secretsFound.includes(hidden);
  return !isWall(content, zone, x, y);
};

/** One step in one of eight directions. A diagonal may not cut a corner: both tiles beside it must be open too. */
export const canStep = (state: GameState, content: Content, from: Position, dx: number, dy: number, mode: WalkMode): boolean => {
  if (Math.abs(dx) > 1 || Math.abs(dy) > 1 || (dx === 0 && dy === 0)) return false;
  if (!Number.isInteger(dx) || !Number.isInteger(dy)) return false;
  if (!walkable(state, content, from.zone, from.x + dx, from.y + dy, mode)) return false;
  if (dx !== 0 && dy !== 0) {
    return walkable(state, content, from.zone, from.x + dx, from.y, mode) && walkable(state, content, from.zone, from.x, from.y + dy, mode);
  }
  return true;
};

export const isAdjacent = (position: Position, zone: ZoneId, x: number, y: number): boolean =>
  position.zone === zone && Math.abs(position.x - x) <= 1 && Math.abs(position.y - y) <= 1;

// Straight steps first, so a route prefers them and comes out the same on every device.
const DIRECTIONS: ReadonlyArray<readonly [number, number]> = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
  [1, -1],
  [1, 1],
  [-1, 1],
  [-1, -1],
];

export type PathOptions = {
  /** Stop on any tile beside the target instead of on it: for an enemy, whose own tile cannot be entered. */
  beside?: boolean;
  mode?: WalkMode;
};

/**
 * The shortest route from `from` to a tile in the same zone, as the tiles to step onto in order. Empty when
 * already there; null when there is no route.
 */
export const findPath = (state: GameState, content: Content, from: Position, to: Point, options: PathOptions = {}): Point[] | null => {
  const map = content.zones[from.zone]?.map;
  if (map === undefined) return null;
  const mode = options.mode ?? 'path';
  const beside = options.beside ?? false;
  const arrived = (x: number, y: number): boolean =>
    beside ? Math.abs(x - to.x) <= 1 && Math.abs(y - to.y) <= 1 && !(x === to.x && y === to.y) : x === to.x && y === to.y;
  if (arrived(from.x, from.y)) return [];

  const cell = (x: number, y: number): number => y * map.width + x;
  const cameFrom: number[] = [];
  for (let i = 0; i < map.width * map.height; i += 1) cameFrom.push(-1);
  const startCell = cell(from.x, from.y);
  cameFrom[startCell] = startCell;
  const queue: Point[] = [{ x: from.x, y: from.y }];

  for (let head = 0; head < queue.length; head += 1) {
    const here = queue[head];
    if (here === undefined) break;
    for (const [dx, dy] of DIRECTIONS) {
      const x = here.x + dx;
      const y = here.y + dy;
      if (x < 0 || y < 0 || x >= map.width || y >= map.height) continue;
      if ((cameFrom[cell(x, y)] ?? 0) >= 0) continue;
      if (!canStep(state, content, { zone: from.zone, x: here.x, y: here.y }, dx, dy, mode)) continue;
      cameFrom[cell(x, y)] = cell(here.x, here.y);
      if (arrived(x, y)) {
        const path: Point[] = [];
        let at = cell(x, y);
        while (at !== startCell) {
          path.push({ x: at % map.width, y: Math.floor(at / map.width) });
          at = cameFrom[at] ?? startCell;
        }
        return path.reverse();
      }
      queue.push({ x, y });
    }
  }
  return null;
};
