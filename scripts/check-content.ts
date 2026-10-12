// Content checks (GDD 7.9, ARCHITECTURE section 6). Michael does not review content, so these stand in for him:
// each one is a pure function from the loaded content to a list of findings, and a finding names things by ID
// or by tile (`z01:3:4`), never by display name. Limits come from data/balance.json, never from this file.
//
//   ids         every ID in the data is in data/ids.lock.json with the right kind, and the other way round
//   counts      zones, enemies, bosses and items match data/content-spec.json
//   items       obtainable, priced and capped as GDD 5.7, 7.1 and 7.3 say; the tool is a boss's guaranteed handover
//   enemies     modifiers, level band, gate flag, spawns, drops (GDD 5.4, 7.3, 7.5)
//   loadouts    each complete zone's reference loadout is whole and inside the GDD 5.6 budget
//   gear limits Reflect, Life Regen and Last Stand stay under the GDD 5.6 limits
//   maps        everything can be reached, nothing traps the hero, gates gate, keys come before locks, secrets
//               stay secret, Salvage sites sit where GDD 7.4 puts them (GDD 7.4, 7.7)
//   strings     everything shown has a name, and no two items or two enemies share one
//
// How many secrets there are, of what kind and where is sealed (GDD 7.5), so a finding calls one "secret x01" and
// says no more about it than the fault needs. The reference-name test is separate (tests/refnames.test.ts).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ZodType } from 'zod';
import { BUNDLED, balanceSchema, enemiesSchema, itemsSchema, lockSchema, mapSchema, parseContent, specSchema, stringsSchema, zonesSchema } from '../src/content';
import type { LockFile, RawContent, SpecFile, StringsFile } from '../src/content';
import { ACCESSORY_SLOTS, ARMOR_SLOTS, SLOT_IDS, TAGS, WALL_TILES, canStep, indexContent, newGame, tileKey, walkable } from '../src/engine';
import type { Content, EnemyDef, EnemyId, GameState, ItemDef, ItemId, LineKey, Point, Position, SlotId, WalkMode, ZoneId } from '../src/engine';
import { ROOT, report } from './lib';
import { normalizeName } from './refnames';

type LockKind = LockFile['ids'][string];

// Structure, not balance: these come from the rules of GDD 7.1 and 7.3, and the save format depends on them.
const SINGLE_COPY = 1;
const ACCESSORY_COPIES: readonly number[] = [1, 3];
const DROPS_MIN = 1;
const DROPS_MAX = 3;
const CHANCE_MAX = 100;
// "Beside" in GDD 7.4, for a Salvage site and the run start or a waypoint: this many tiles in any direction.
const SITE_REACH = 2;
// Room for the rounding of a sum of fractions, far below anything a budget is written to.
const EPSILON = 1e-9;

const itemsOf = (content: Content): ItemDef[] => Object.values(content.items);
const enemiesOf = (content: Content): EnemyDef[] => Object.values(content.enemies);
const isArmor = (item: ItemDef): boolean => (ARMOR_SLOTS as readonly string[]).includes(item.kind);
const show = (value: number): string => String(Number(value.toFixed(2)));

/** True when the enemy is a boss that hands the item over every time it is beaten (GDD 7.3). */
const handsOver = (enemy: EnemyDef, item: ItemId): boolean => enemy.boss && enemy.drops.some((drop) => drop.item === item && drop.chance === CHANCE_MAX);

// ---- ids ----

/** The lock the data implies: every ID with its kind, sorted by ID. */
export const lockOf = (content: Content): Record<string, LockKind> => {
  const ids: Array<[string, LockKind]> = [];
  for (const id of Object.keys(content.zones)) ids.push([id, 'zone']);
  for (const enemy of enemiesOf(content)) ids.push([enemy.id, enemy.boss ? 'boss' : 'enemy']);
  for (const item of itemsOf(content)) ids.push([item.id, item.kind]);
  for (const id of Object.keys(content.spawns)) ids.push([id, 'spawn']);
  // What kind of secret an ID is stays out of the lock, which is not a sealed file (GDD 7.5).
  for (const secret of Object.values(content.secrets)) ids.push([secret.id, 'secret']);
  for (const id of Object.keys(content.waypoints)) ids.push([id, 'waypoint']);
  return Object.fromEntries(ids.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
};

export const idLockFindings = (content: Content, lock: LockFile): string[] => {
  const found: string[] = [];
  const expected = lockOf(content);
  for (const [id, kind] of Object.entries(expected)) {
    const locked = lock.ids[id];
    if (locked === undefined) found.push(`${id} is not in data/ids.lock.json`);
    else if (locked !== kind) found.push(`${id} is locked as ${locked} but the data makes it ${kind}`);
  }
  for (const id of Object.keys(lock.ids)) {
    if (expected[id] === undefined) found.push(`${id} is in data/ids.lock.json but no longer in the data`);
  }
  return found;
};

// ---- counts ----

export const countFindings = (content: Content, spec: SpecFile): string[] => {
  const found: string[] = [];
  const zones = Object.keys(content.zones);
  if (zones.length !== spec.zones) found.push(`the data has ${zones.length} zone(s); the spec says ${spec.zones}`);
  for (const zone of zones) {
    const want = spec.enemies[zone];
    if (want === undefined) {
      found.push(`${zone} has no enemy counts in the spec`);
      continue;
    }
    const here = enemiesOf(content).filter((enemy) => enemy.zone === zone);
    const bosses = here.filter((enemy) => enemy.boss).length;
    if (here.length !== want.total) found.push(`${zone} has ${here.length} enemies; the spec says ${want.total}`);
    if (bosses !== want.bosses) found.push(`${zone} has ${bosses} boss(es); the spec says ${want.bosses}`);
  }
  for (const zone of Object.keys(spec.enemies)) {
    if (content.zones[zone] === undefined) found.push(`the spec counts enemies for ${zone}, which is not a zone`);
  }
  const groups: Array<[keyof SpecFile['items'], (item: ItemDef) => boolean]> = [
    ['weapons', (item) => item.kind === 'weapon'],
    ['armor', isArmor],
    ['accessories', (item) => item.kind === 'accessory'],
    ['keys', (item) => item.kind === 'key'],
  ];
  for (const [group, belongs] of groups) {
    const members = itemsOf(content).filter(belongs);
    const sold = members.filter((item) => item.priceFactor !== null).length;
    const want = spec.items[group];
    if (members.length !== want.total) found.push(`the data has ${members.length} ${group}; the spec says ${want.total}`);
    if (sold !== want.sold) found.push(`the shop sells ${sold} ${group}; the spec says ${want.sold}`);
  }
  return found;
};

// ---- items ----

export const itemFindings = (content: Content): string[] => {
  const found: string[] = [];
  const { priceFactorMin, priceFactorMax, dropChanceMin } = content.balance.items;
  const spawned = new Set(Object.values(content.spawns).map((spawn) => spawn.enemy));

  for (const enemy of enemiesOf(content)) {
    for (const drop of enemy.drops) {
      if (content.items[drop.item] === undefined) found.push(`${enemy.id} drops ${drop.item}, which is not an item`);
      if (drop.chance < dropChanceMin || drop.chance > CHANCE_MAX) {
        found.push(`${enemy.id} drops ${drop.item} at a chance outside ${show(dropChanceMin)} to ${CHANCE_MAX}`);
      }
    }
  }

  for (const item of itemsOf(content)) {
    const droppers = enemiesOf(content).filter((enemy) => enemy.drops.some((drop) => drop.item === item.id));
    const sold = item.priceFactor !== null;
    if (!sold && !droppers.some((enemy) => spawned.has(enemy.id))) {
      found.push(`${item.id} cannot be obtained: it is not sold, and no enemy with a spawn drops it`);
    }
    if (item.priceFactor !== null && (item.priceFactor < priceFactorMin || item.priceFactor > priceFactorMax)) {
      found.push(`${item.id} has a price factor outside ${show(priceFactorMin)} to ${show(priceFactorMax)}`);
    }
    if (droppers.length > 0 && !droppers.some((enemy) => enemy.level === item.level)) {
      found.push(`${item.id} is dropped, but its level is not the level of an enemy that drops it`);
    }
    if (item.kind === 'accessory') {
      if (!ACCESSORY_COPIES.includes(item.copyCap)) found.push(`${item.id} is an accessory with a copy cap that is not ${ACCESSORY_COPIES.join(' or ')}`);
    } else if (item.copyCap !== SINGLE_COPY) {
      found.push(`${item.id} is a ${item.kind === 'weapon' || item.kind === 'key' ? item.kind : 'piece of armor'} with a copy cap that is not ${SINGLE_COPY}`);
    }
    if (item.kind === 'key' && sold) found.push(`${item.id} is a key and is sold; a key is never sold`);
    if (item.claim && item.kind !== 'weapon') found.push(`${item.id} carries the claim effect but is not a weapon`);
    // The tool is handed over in plain sight by a boss, never left to chance (GDD 2.3, 7.3).
    if (item.claim && !droppers.some((enemy) => handsOver(enemy, item.id))) {
      found.push(`${item.id} carries the claim effect, so a boss must drop it at a chance of ${CHANCE_MAX}`);
    }
  }
  return found;
};

// ---- enemies ----

export const enemyFindings = (content: Content): string[] => {
  const found: string[] = [];
  const { modifierMin, modifierMax } = content.balance.enemy;
  const spawnsOf = new Map<EnemyId, number>();
  for (const spawn of Object.values(content.spawns)) spawnsOf.set(spawn.enemy, (spawnsOf.get(spawn.enemy) ?? 0) + 1);
  for (const enemy of enemiesOf(content)) {
    for (const stat of ['life', 'damage', 'defense'] as const) {
      const mod = enemy.mods[stat];
      if (mod < modifierMin || mod > modifierMax) found.push(`${enemy.id} has a ${stat} modifier outside ${show(modifierMin)} to ${show(modifierMax)}`);
    }
    const band = content.balance.zones[content.zones[enemy.zone]?.balanceKey ?? ''];
    if (band === undefined) found.push(`${enemy.id} is in ${enemy.zone}, which is not a zone with a balance row`);
    else if (enemy.level < band.levelMin || enemy.level > band.levelMax) found.push(`${enemy.id} has a level outside the band of ${enemy.zone}`);
    if (enemy.gate && !enemy.boss) found.push(`${enemy.id} is a gate but not a boss`);
    const spawns = spawnsOf.get(enemy.id) ?? 0;
    if (spawns === 0) found.push(`${enemy.id} has no spawn`);
    // A boss is beaten once a run, by its ID: a second spawn of it could never be fought.
    else if (enemy.boss && spawns > 1) found.push(`${enemy.id} is a boss with ${spawns} spawns; a boss has exactly one`);
    if (enemy.drops.length < DROPS_MIN || enemy.drops.length > DROPS_MAX) found.push(`${enemy.id} has ${enemy.drops.length} drops; an enemy holds ${DROPS_MIN} to ${DROPS_MAX}`);
    const listed = new Set<ItemId>();
    const twice = new Set<ItemId>();
    for (const drop of enemy.drops) {
      if (listed.has(drop.item)) twice.add(drop.item);
      listed.add(drop.item);
    }
    for (const item of twice) found.push(`${enemy.id} lists ${item} more than once in its drops`);
  }
  return found;
};

// ---- reference loadouts ----

const fits = (item: ItemDef, slot: SlotId): boolean =>
  item.kind === 'accessory' ? (ACCESSORY_SLOTS as readonly string[]).includes(slot) : item.kind === slot;

export const loadoutFindings = (content: Content, spec: SpecFile): string[] => {
  const found: string[] = [];
  const { budget } = content.balance.items;
  for (const zone of spec.completeZones) {
    if (content.zones[zone] === undefined) found.push(`the spec lists ${zone} as complete, which is not a zone`);
  }
  for (const zone of Object.values(content.zones)) {
    const loadout = zone.referenceLoadout;
    if (!spec.completeZones.includes(zone.id)) {
      if (loadout !== null) found.push(`${zone.id} is not listed as complete, so its reference loadout must be null`);
      continue;
    }
    if (loadout === null) {
      found.push(`${zone.id} is listed as complete but has no reference loadout`);
      continue;
    }
    const row = content.balance.zones[zone.balanceKey];
    if (row === undefined) {
      found.push(`${zone.id} names a balance row that does not exist`);
      continue;
    }
    const where = `${zone.id} reference loadout`;
    const worn: ItemDef[] = [];
    const cells = new Map<ItemId, number>();
    for (const slot of SLOT_IDS) {
      const id = loadout[slot] ?? null;
      if (id === null) {
        found.push(`${where}: ${slot} is empty`);
        continue;
      }
      const item = content.items[id];
      if (item === undefined) {
        found.push(`${where}: ${slot} holds ${id}, which is not an item`);
        continue;
      }
      if (!fits(item, slot)) found.push(`${where}: ${slot} holds ${id}, which does not go in that slot`);
      if (item.level > row.levelMax) found.push(`${where}: ${id} has a level above the zone's top level`);
      worn.push(item);
      cells.set(id, (cells.get(id) ?? 0) + 1);
    }
    for (const [id, count] of cells) {
      if (count > (content.items[id]?.copyCap ?? 0)) found.push(`${where}: ${id} is worn in ${count} cells, more than its copy cap`);
    }
    const targets: Array<[LineKey, number]> = [
      ['damageFlat', budget.damagePerLevel * row.levelMax],
      ['defenseFlat', budget.defensePerLevel * row.levelMax],
      ['lifeFlat', budget.lifePerLevel * row.levelMax],
      ['dexterityFlat', budget.dexterityPerLevel * row.levelMax],
      ['lifePct', row.pctBudget],
      ['damagePct', row.pctBudget],
      ['defensePct', row.pctBudget],
    ];
    for (const [line, target] of targets) {
      const total = worn.reduce((sum, item) => sum + (item.lines[line] ?? 0), 0);
      const slack = budget.tolerance * target;
      if (Math.abs(total - target) > slack + EPSILON) {
        found.push(`${where}: ${line} totals ${show(total)}, outside ${show(target - slack)} to ${show(target + slack)}`);
      }
    }
  }
  return found;
};

// ---- gear limits ----

/** The most of one line a player could wear at once: the best item in each weapon and armor cell, and the best accessory cells within copy caps. */
const mostWorn = (content: Content, line: LineKey): number => {
  const value = (item: ItemDef): number => Math.max(0, item.lines[line] ?? 0);
  let total = 0;
  for (const kind of ['weapon', ...ARMOR_SLOTS]) {
    total += itemsOf(content)
      .filter((item) => item.kind === kind)
      .reduce((best, item) => Math.max(best, value(item)), 0);
  }
  const copies: number[] = [];
  for (const item of itemsOf(content)) {
    if (item.kind !== 'accessory' || value(item) === 0) continue;
    for (let copy = 0; copy < Math.min(item.copyCap, ACCESSORY_SLOTS.length); copy += 1) copies.push(value(item));
  }
  copies.sort((a, b) => b - a);
  return copies.slice(0, ACCESSORY_SLOTS.length).reduce((sum, each) => sum + each, total);
};

export const gearLimitFindings = (content: Content): string[] => {
  const found: string[] = [];
  const { limits } = content.balance.items;
  for (const line of ['reflect', 'lifeRegen'] as const) {
    const most = mostWorn(content, line);
    if (most > limits[line] + EPSILON) found.push(`gear worn together can reach ${show(most)} ${line}; the limit is ${show(limits[line])}`);
  }
  // Last Stand does not stack: the highest equipped value wins (GDD 4.3), so the limit is on a single item.
  for (const item of itemsOf(content)) {
    if ((item.lines.lastStand ?? 0) > limits.lastStand) found.push(`${item.id} has lastStand above the limit of ${show(limits.lastStand)}`);
  }
  return found;
};

// ---- maps ----

// The engine's own order: straight steps, then diagonals.
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

/** What the hero is taken to have done: bosses beaten this run, keys held, and whether hidden tiles may be stepped on. */
type Access = { beaten: readonly EnemyId[]; keys: readonly ItemId[]; hidden: boolean };

type Reach = {
  /** Tiles the hero can come to stand on. */
  tiles: Set<string>;
  /** Exit tiles the hero can step onto; an exit moves the hero, so nobody stands on one. */
  exits: Set<string>;
  /** For each tile, the tiles one move before it. */
  from: Map<string, string[]>;
  state: GameState;
};

const stateFor = (world: Content, access: Access): GameState => {
  const fresh = newGame(0, world);
  const items: Record<ItemId, number> = {};
  for (const key of access.keys) items[key] = 1;
  return { profile: { ...fresh.profile, items }, run: { ...fresh.run, bossesBeaten: [...access.beaten] } };
};

/**
 * Everywhere the hero can get to from the run start, across zones. Each single step is judged by the engine's
 * own `canStep`, so the rules are the engine's by construction: eight directions, no corner cutting, a wall or a
 * closed door or a standing enemy blocks, a beaten boss does not. A hidden tile that nobody has found is open to
 * a step and closed to a tapped route, which is how `hidden` is told apart here.
 */
const flood = (world: Content, access: Access): Reach => {
  const state = stateFor(world, access);
  const mode: WalkMode = access.hidden ? 'step' : 'path';
  const tiles = new Set<string>();
  const exits = new Set<string>();
  const from = new Map<string, string[]>();
  const queue: Position[] = [];
  const arrive = (to: Position, origin: string | null): void => {
    const key = tileKey(to.zone, to.x, to.y);
    if (origin !== null) {
      const origins = from.get(key);
      if (origins === undefined) from.set(key, [origin]);
      else origins.push(origin);
    }
    if (tiles.has(key)) return;
    tiles.add(key);
    queue.push(to);
  };
  arrive({ ...world.start }, null);
  for (let head = 0; head < queue.length; head += 1) {
    const here = queue[head];
    if (here === undefined) break;
    const hereKey = tileKey(here.zone, here.x, here.y);
    for (const [dx, dy] of DIRECTIONS) {
      if (!canStep(state, world, here, dx, dy, mode)) continue;
      const key = tileKey(here.zone, here.x + dx, here.y + dy);
      const exit = world.index.exitAt[key];
      if (exit === undefined) {
        arrive({ zone: here.zone, x: here.x + dx, y: here.y + dy }, hereKey);
      } else {
        exits.add(key);
        arrive({ ...exit.to }, hereKey);
      }
    }
  }
  return { tiles, exits, from, state };
};

/** True when the hero can stand beside the tile, or on it where `self` allows: close enough to fight, use or collect. */
const near = (reach: Reach, zone: ZoneId, at: Point, self: boolean): boolean =>
  (self && reach.tiles.has(tileKey(zone, at.x, at.y))) || DIRECTIONS.some(([dx, dy]) => reach.tiles.has(tileKey(zone, at.x + dx, at.y + dy)));

const zoneOfTile = (key: string): string => key.slice(0, key.indexOf(':'));

/** One finding per zone for a list of tiles, so a walled-off room is one line and not a hundred. */
const perZone = (keys: readonly string[], say: (zone: string, count: number, first: string) => string): string[] => {
  const groups = new Map<string, string[]>();
  for (const key of keys) {
    const zone = zoneOfTile(key);
    const group = groups.get(zone);
    if (group === undefined) groups.set(zone, [key]);
    else group.push(key);
  }
  return [...groups].map(([zone, group]) => say(zone, group.length, group[0] ?? zone));
};

/** Something on a map that the hero must be able to get to. */
type Thing = {
  label: string;
  reached: (reach: Reach) => boolean;
  /** On the list that must be reachable without a hidden tile: gate bosses, exits, doors, waypoints, Salvage sites. */
  required: boolean;
  exit: boolean;
  boss: EnemyId | null;
  /** A gate boss's spawn. With the exits, these are what the required path leads to. */
  gate: boolean;
};

export const mapFindings = (content: Content): string[] => {
  const found: string[] = [];
  // The lookups by tile are rebuilt from the records, so the check sees the content it was given and nothing staler.
  const world = indexContent({
    ...content,
    zoneOrder: Object.keys(content.zones),
    enemyOrder: Object.keys(content.enemies),
    itemOrder: Object.keys(content.items),
    spawnOrder: Object.keys(content.spawns),
    secretOrder: Object.keys(content.secrets),
  });
  const zones = Object.values(world.zones);
  const spawns = Object.values(world.spawns);
  const enemies = enemiesOf(world);
  const doors = zones.flatMap((zone) => zone.map.doors.map((door) => ({ zone: zone.id, door, key: tileKey(zone.id, door.x, door.y) })));
  const startKey = tileKey(world.start.zone, world.start.x, world.start.y);

  const inGrid = (zone: ZoneId, x: number, y: number): boolean => {
    const map = world.zones[zone]?.map;
    return map !== undefined && x >= 0 && y >= 0 && x < map.width && y < map.height;
  };
  /** What the map draws there: floor, as opposed to a wall character or nothing at all. */
  const isFloor = (zone: ZoneId, x: number, y: number): boolean =>
    inGrid(zone, x, y) && !WALL_TILES.includes((world.zones[zone]?.map.tiles[y] ?? '').charAt(x));

  // ---- where things sit ----

  // Open to anyone at any time: floor that is no door, spawn, hidden tile or exit.
  const nobody = stateFor(world, { beaten: [], keys: [], hidden: false });
  const openFloor = (at: Position): boolean =>
    walkable(nobody, world, at.zone, at.x, at.y, 'path') && world.index.exitAt[tileKey(at.zone, at.x, at.y)] === undefined;

  if (!openFloor(world.start)) found.push('the run start is not on open floor');

  const taken = new Map<string, string>();
  for (const spawn of spawns) {
    const key = tileKey(spawn.zone, spawn.x, spawn.y);
    const enemy = world.enemies[spawn.enemy];
    if (enemy === undefined) found.push(`spawn ${spawn.id} holds ${spawn.enemy}, which is not an enemy`);
    else if (enemy.zone !== spawn.zone) found.push(`spawn ${spawn.id} is in ${spawn.zone} but holds ${enemy.id}, which belongs to ${enemy.zone}`);
    if (!isFloor(spawn.zone, spawn.x, spawn.y)) found.push(`spawn ${spawn.id} is not on floor`);
    const other = taken.get(key);
    if (other !== undefined) found.push(`spawns ${other} and ${spawn.id} are on one tile`);
    else taken.set(key, spawn.id);
    const on: Array<[boolean, string]> = [
      [key === startKey, 'the run start'],
      [world.index.exitAt[key] !== undefined, 'an exit'],
      [world.index.doorAt[key] !== undefined, 'a door'],
      [world.index.siteAt[key] !== undefined, 'a Salvage site'],
      [world.index.stashAt[key] !== undefined || world.index.hiddenAt[key] !== undefined, 'a secret'],
    ];
    for (const [clash, what] of on) if (clash) found.push(`spawn ${spawn.id} is on ${what}`);
  }

  for (const zone of zones) {
    for (const exit of zone.map.exits) {
      if (!openFloor(exit.to)) found.push(`exit ${tileKey(zone.id, exit.x, exit.y)} lands on ${tileKey(exit.to.zone, exit.to.x, exit.to.y)}, which is not open floor`);
    }
    for (const place of zone.map.places) {
      if (!inGrid(zone.id, place.x, place.y)) found.push(`place ${place.key} lies outside the map of ${zone.id}`);
    }
  }

  // A Salvage site beside the run start and beside every waypoint (GDD 7.4).
  const siteBeside = (at: Position): boolean =>
    (world.zones[at.zone]?.map.salvageSites ?? []).some((site) => Math.abs(site.x - at.x) <= SITE_REACH && Math.abs(site.y - at.y) <= SITE_REACH);
  if (!siteBeside(world.start)) found.push(`no Salvage site within ${SITE_REACH} tiles of the run start`);
  for (const waypoint of Object.values(world.waypoints)) {
    if (!siteBeside(waypoint)) found.push(`no Salvage site within ${SITE_REACH} tiles of waypoint ${waypoint.id}`);
  }

  // ---- doors and their keys ----

  const droppersOf = (item: ItemId): EnemyDef[] => enemies.filter((enemy) => enemy.drops.some((drop) => drop.item === item));
  const doorKeys = new Set<ItemId>();
  for (const { door, key } of doors) {
    if (door.key === null) {
      if (door.keyZone !== null) found.push(`door ${key} is sealed, so its keyZone must be null`);
      continue;
    }
    doorKeys.add(door.key);
    if (world.items[door.key]?.kind !== 'key') found.push(`door ${key} is opened by ${door.key}, which is not a key`);
    if (door.keyZone === null || !droppersOf(door.key).some((enemy) => enemy.zone === door.keyZone)) {
      found.push(`door ${key}: its keyZone is not the zone of an enemy that drops ${door.key}`);
    }
  }

  // ---- reachability ----

  const bosses = enemies.filter((enemy) => enemy.boss).map((enemy) => enemy.id);
  const keys = [...new Set([...itemsOf(world).filter((item) => item.kind === 'key').map((item) => item.id), ...doorKeys])];
  // Everything open: every boss beaten, every key held, hidden tiles allowed.
  const full = flood(world, { beaten: bosses, keys, hidden: true });
  // The same with hidden tiles treated as walls: the required path may not use one (GDD 7.7).
  const plain = flood(world, { beaten: bosses, keys, hidden: false });

  const things: Thing[] = [];
  for (const spawn of spawns) {
    const enemy = world.enemies[spawn.enemy];
    things.push({
      label: `spawn ${spawn.id}`,
      reached: (reach) => near(reach, spawn.zone, spawn, false),
      required: enemy?.gate === true,
      exit: false,
      boss: enemy?.boss === true ? enemy.id : null,
      gate: enemy?.gate === true,
    });
  }
  const fixture = { required: true, exit: false, boss: null, gate: false };
  for (const zone of zones) {
    for (const exit of zone.map.exits) {
      const key = tileKey(zone.id, exit.x, exit.y);
      things.push({ ...fixture, label: `exit ${key}`, reached: (reach) => reach.exits.has(key), exit: true });
    }
    for (const site of zone.map.salvageSites) {
      things.push({ ...fixture, label: `Salvage site ${tileKey(zone.id, site.x, site.y)}`, reached: (reach) => near(reach, zone.id, site, true) });
    }
  }
  for (const { zone, door, key } of doors) {
    // An open door is walked through; a sealed one is walked up to.
    const reached = door.key === null ? (reach: Reach): boolean => near(reach, zone, door, false) : (reach: Reach): boolean => reach.tiles.has(key);
    things.push({ ...fixture, label: `door ${key}`, reached });
  }
  for (const waypoint of Object.values(world.waypoints)) {
    things.push({ ...fixture, label: `waypoint ${waypoint.id}`, reached: (reach) => near(reach, waypoint.zone, waypoint, true) });
  }
  for (const secret of Object.values(world.secrets)) {
    // A stash is collected from its tile or the one beside it; every tile of a hidden path has to be steppable.
    const tiles = secret.kind === 'hidden' ? secret.tiles.map((tile) => tileKey(secret.zone, tile.x, tile.y)) : [];
    const reached = secret.kind === 'stash' ? (reach: Reach): boolean => near(reach, secret.zone, secret, true) : (reach: Reach): boolean => tiles.every((tile) => reach.tiles.has(tile));
    things.push({ ...fixture, label: `secret ${secret.id}`, reached, required: false });
  }

  for (const thing of things) {
    if (!thing.reached(full)) found.push(`${thing.label} cannot be reached from the run start`);
    else if (thing.required && !thing.reached(plain)) found.push(`${thing.label} can be reached only over a hidden tile`);
  }

  // ---- secrets stay secret ----

  // A tile the hero can stand on with no secret found: not hidden, and not an exit, which nobody stands on.
  const ordinary = (zone: ZoneId, x: number, y: number): boolean => {
    const key = tileKey(zone, x, y);
    return walkable(full.state, world, zone, x, y, 'step') && world.index.hiddenAt[key] === undefined && world.index.exitAt[key] === undefined;
  };
  for (const secret of Object.values(world.secrets)) {
    if (secret.kind === 'hidden') {
      // The map draws each tile by its character, so a hidden tile written as floor is no secret at all.
      if (secret.tiles.some((tile) => !inGrid(secret.zone, tile.x, tile.y) || isFloor(secret.zone, tile.x, tile.y))) {
        found.push(`secret ${secret.id} has a tile that is not a wall character on its map`);
      }
      continue;
    }
    const hidden = world.index.hiddenAt[tileKey(secret.zone, secret.x, secret.y)] !== undefined;
    if (!hidden && !isFloor(secret.zone, secret.x, secret.y)) found.push(`secret ${secret.id} sits in a plain wall`);
    // A stash is collected from a tile beside it as well as from its own, so one on a hidden tile must have
    // nothing ordinary beside it, or it could be taken through the wall without the way in ever being found.
    if (hidden && DIRECTIONS.some(([dx, dy]) => ordinary(secret.zone, secret.x + dx, secret.y + dy))) {
      found.push(`secret ${secret.id} can be collected from an ordinary tile beside it, without finding the way in`);
    }
  }

  // No orphan area: every tile that could be stood on can be got to. Doors, hidden tiles and exits are in the
  // list above; a normal enemy's tile is never stood on.
  const orphans: string[] = [];
  for (const zone of zones) {
    for (let y = 0; y < zone.map.height; y += 1) {
      for (let x = 0; x < zone.map.width; x += 1) {
        const key = tileKey(zone.id, x, y);
        if (world.index.exitAt[key] !== undefined || world.index.doorAt[key] !== undefined || world.index.hiddenAt[key] !== undefined) continue;
        if (walkable(full.state, world, zone.id, x, y, 'step') && !full.tiles.has(key)) orphans.push(key);
      }
    }
  }
  found.push(...perZone(orphans, (zone, count, first) => `${zone}: ${count} floor tile(s) cannot be reached from the run start, the first at ${first}`));

  // No one-way trap: from everywhere the hero can get to, the run start can be got back to.
  const back = new Set<string>([startKey]);
  const pending = [startKey];
  for (let head = 0; head < pending.length; head += 1) {
    for (const origin of full.from.get(pending[head] ?? '') ?? []) {
      if (back.has(origin)) continue;
      back.add(origin);
      pending.push(origin);
    }
  }
  const traps = [...full.tiles].filter((key) => !back.has(key));
  found.push(...perZone(traps, (zone, count, first) => `${zone}: the run start cannot be reached from ${count} tile(s), the first at ${first}`));

  // A gate boss stands on the only path: left standing, it must cut off an exit or another boss.
  for (const gate of enemies.filter((enemy) => enemy.gate)) {
    const shut = flood(world, { beaten: bosses.filter((boss) => boss !== gate.id), keys, hidden: true });
    const beyond = things.filter((thing) => (thing.exit || (thing.boss !== null && thing.boss !== gate.id)) && thing.reached(full));
    if (!beyond.some((thing) => !thing.reached(shut))) {
      found.push(`${gate.id} is a gate but blocks nothing: every exit and every other boss can be reached without beating it`);
    }
  }

  // A key on the required path is a boss's guaranteed handover, never a drop the player might not get (GDD 7.7).
  // A door is on that path if, with it alone shut, a gate boss or an exit can no longer be reached. Hidden tiles
  // count as walls here too: a way round the door that needs a secret is not a way the game may rely on.
  for (const { zone, door, key } of doors) {
    const zoneDef = world.zones[zone];
    if (door.key === null || zoneDef === undefined) continue;
    const doorKey = door.key;
    const sealed = zoneDef.map.doors.map((other) => (other === door ? { ...other, key: null, keyZone: null } : other));
    const shutWorld = indexContent({ ...world, zones: { ...world.zones, [zone]: { ...zoneDef, map: { ...zoneDef.map, doors: sealed } } } });
    const shut = flood(shutWorld, { beaten: bosses, keys, hidden: false });
    const onPath = things.some((thing) => (thing.exit || thing.gate) && thing.reached(plain) && !thing.reached(shut));
    if (onPath && !droppersOf(doorKey).some((enemy) => handsOver(enemy, doorKey))) {
      found.push(`door ${key} is on the required path, so a boss must drop its key ${doorKey} at a chance of ${CHANCE_MAX}`);
    }
  }

  // Keys before locks. The hero sets out with no key and no boss beaten, beats whatever it can walk up to and
  // takes the keys those enemies drop (or the shop sells), and goes again until nothing new opens. A door whose
  // key never turns up can only have its key behind itself, or behind another door in the same fix.
  if (doorKeys.size > 0) {
    const held = new Set<ItemId>([...doorKeys].filter((key) => (world.items[key]?.priceFactor ?? null) !== null));
    const beaten = new Set<EnemyId>();
    for (let grew = true; grew; ) {
      grew = false;
      const reach = flood(world, { beaten: [...beaten], keys: [...held], hidden: true });
      for (const spawn of spawns) {
        const enemy = world.enemies[spawn.enemy];
        if (enemy === undefined || !near(reach, spawn.zone, spawn, false)) continue;
        if (enemy.boss && !beaten.has(enemy.id)) {
          beaten.add(enemy.id);
          grew = true;
        }
        for (const drop of enemy.drops) {
          if (doorKeys.has(drop.item) && !held.has(drop.item)) {
            held.add(drop.item);
            grew = true;
          }
        }
      }
    }
    for (const { door, key } of doors) {
      if (door.key !== null && !held.has(door.key)) found.push(`door ${key}: nothing that gives its key ${door.key} can be reached while the door is closed`);
    }
  }

  return found;
};

// ---- strings ----

export const stringFindings = (content: Content, strings: StringsFile): string[] => {
  const found: string[] = [];
  const need = (section: 'zones' | 'enemies' | 'families' | 'items' | 'tags' | 'places', ids: Iterable<string>): void => {
    for (const id of ids) {
      if ((strings[section][id] ?? '').trim() === '') found.push(`${section}.${id} has no name in data/strings.en.json`);
    }
  };
  need('zones', Object.keys(content.zones));
  need('enemies', Object.keys(content.enemies));
  need('families', new Set(enemiesOf(content).map((enemy) => enemy.family)));
  need('items', Object.keys(content.items));
  need('tags', TAGS);
  need('places', new Set(Object.values(content.zones).flatMap((zone) => zone.map.places.map((place) => place.key))));

  // Two names that differ only in case, spacing or punctuation read as one name on the phone.
  const shared = (section: 'items' | 'enemies', ids: readonly string[]): void => {
    const byName = new Map<string, string[]>();
    for (const id of ids) {
      const name = normalizeName(strings[section][id] ?? '');
      if (name === '') continue;
      const holders = byName.get(name);
      if (holders === undefined) byName.set(name, [id]);
      else holders.push(id);
    }
    for (const holders of byName.values()) if (holders.length > 1) found.push(`${section} ${holders.join(', ')} share a name`);
  };
  shared('items', Object.keys(content.items));
  shared('enemies', Object.keys(content.enemies));
  return found;
};

// ---- all of them ----

export type ContentCheck = { name: string; findings: string[] };

export const contentChecks = (content: Content, strings: StringsFile, lock: LockFile, spec: SpecFile): ContentCheck[] => [
  { name: 'ids', findings: idLockFindings(content, lock) },
  { name: 'counts', findings: countFindings(content, spec) },
  { name: 'items', findings: itemFindings(content) },
  { name: 'enemies', findings: enemyFindings(content) },
  { name: 'loadouts', findings: loadoutFindings(content, spec) },
  { name: 'gear limits', findings: gearLimitFindings(content) },
  { name: 'maps', findings: mapFindings(content) },
  { name: 'strings', findings: stringFindings(content, strings) },
];

export const contentFindings = (content: Content, strings: StringsFile, lock: LockFile, spec: SpecFile): string[] =>
  contentChecks(content, strings, lock, spec).flatMap((check) => check.findings.map((finding) => `${check.name}: ${finding}`));

/** Where a file fails its schema: the path and the kind of fault only, since a message could quote a value. */
const shapeFindings = (file: string, schema: ZodType, value: unknown): string[] => {
  const result = schema.safeParse(value);
  if (result.success) return [];
  return result.error.issues.map((issue) => `${file} does not fit its schema at ${issue.path.map(String).join('.') || 'the top'} (${issue.code})`);
};

/** Each file under data/ against its own schema, before anything is joined. */
export const schemaFindings = (raw: RawContent): string[] => [
  ...shapeFindings('data/balance.json', balanceSchema, raw.balance),
  ...shapeFindings('data/zones.json', zonesSchema, raw.zones),
  ...shapeFindings('data/enemies.json', enemiesSchema, raw.enemies),
  ...shapeFindings('data/items.json', itemsSchema, raw.items),
  ...raw.maps.flatMap((map, index) => shapeFindings(`data/maps, file ${index + 1} in src/content/bundle.ts`, mapSchema, map)),
  ...shapeFindings('data/strings.en.json', stringsSchema, raw.strings),
];

const readData = (file: string): unknown => {
  try {
    return JSON.parse(readFileSync(join(ROOT, file), 'utf8')) as unknown;
  } catch {
    return undefined;
  }
};

const main = (): void => {
  const files = schemaFindings(BUNDLED);
  const lockFile = readData('data/ids.lock.json');
  const specFile = readData('data/content-spec.json');
  files.push(...shapeFindings('data/ids.lock.json', lockSchema, lockFile), ...shapeFindings('data/content-spec.json', specSchema, specFile));

  let loaded: ReturnType<typeof parseContent> | null = null;
  if (files.length === 0) {
    try {
      // The loader's own messages name IDs only.
      loaded = parseContent(BUNDLED);
    } catch (error) {
      files.push(error instanceof Error ? error.message : 'the content could not be put together');
    }
  }
  report('check-content files', files);
  if (loaded === null) return;

  const checks = contentChecks(loaded.content, loaded.text.strings, lockSchema.parse(lockFile), specSchema.parse(specFile));
  for (const check of checks) report(`check-content ${check.name}`, check.findings);
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
