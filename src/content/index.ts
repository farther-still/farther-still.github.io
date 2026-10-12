// Turns the files under data/ into the engine's Content, and the strings file into the names the UI shows.
// Each file is parsed with its schema, then joined: lookups by ID, and each enemy's stats from the engine's
// own `enemyStats`, so the formula stays in the engine (ARCHITECTURE section 6).

import { enemyStats, indexContent } from '../engine';
import type { Balance, Content, EnemyDef, EnemyId, ItemDef, ItemId, SecretDef, SecretId, SpawnDef, SpawnId, WaypointDef, WaypointId, ZoneDef, ZoneId } from '../engine';
import { BUNDLED } from './bundle';
import { balanceSchema, enemiesSchema, itemsSchema, mapSchema, stringsSchema, zonesSchema } from './schemas';
import type { StringsFile } from './schemas';

export { ID, LOCK_KINDS, balanceSchema, enemiesSchema, itemsSchema, lockSchema, mapSchema, specSchema, stringsSchema, zonesSchema } from './schemas';
export type { EnemiesFile, IdKind, ItemsFile, LockFile, MapFile, SpecFile, StringsFile, ZonesFile } from './schemas';
export { BUNDLED } from './bundle';

/** The unparsed contents of data/: what the build bundles, or what a test puts together. */
export type RawContent = {
  balance: unknown;
  zones: unknown;
  enemies: unknown;
  items: unknown;
  maps: readonly unknown[];
  strings: unknown;
};

/** Display names and placeholder art. Only the UI uses this; the engine works in IDs. */
export type GameText = {
  zone: (id: string) => string;
  enemy: (id: string) => string;
  family: (id: string) => string;
  item: (id: string) => string;
  tag: (id: string) => string;
  place: (key: string) => string;
  /** A line of content text, or an empty string if there is none. */
  line: (key: string) => string;
  glyph: (enemy: string) => string;
  familyOf: (enemy: string) => string;
  strings: StringsFile;
};

export type Loaded = { content: Content; text: GameText };

const unique = (what: string, ids: readonly string[]): void => {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) throw new Error(`content: ${what} ID ${id} is listed twice`);
    seen.add(id);
  }
};

/** Throws with the schema's own message, or an ID, when a file does not fit. The app stops and logs it. */
export const parseContent = (raw: RawContent): Loaded => {
  const balance: Balance = balanceSchema.parse(raw.balance);
  const zonesFile = zonesSchema.parse(raw.zones);
  const enemiesFile = enemiesSchema.parse(raw.enemies);
  const itemsFile = itemsSchema.parse(raw.items);
  const maps = raw.maps.map((map) => mapSchema.parse(map));
  const strings = stringsSchema.parse(raw.strings);

  unique('zone', zonesFile.zones.map((zone) => zone.id));
  unique('enemy', enemiesFile.enemies.map((enemy) => enemy.id));
  unique('item', itemsFile.items.map((item) => item.id));
  unique('map', maps.map((map) => map.zone));
  unique('spawn', maps.flatMap((map) => map.spawns.map((spawn) => spawn.id)));
  unique('secret', maps.flatMap((map) => map.secrets.map((secret) => secret.id)));
  unique('waypoint', maps.flatMap((map) => map.waypoints.map((waypoint) => waypoint.id)));

  const items: Record<ItemId, ItemDef> = {};
  for (const item of itemsFile.items) items[item.id] = item;

  const zones: Record<ZoneId, ZoneDef> = {};
  const spawns: Record<SpawnId, SpawnDef> = {};
  const secrets: Record<SecretId, SecretDef> = {};
  const waypoints: Record<WaypointId, WaypointDef> = {};
  const spawnOrder: SpawnId[] = [];
  const secretOrder: SecretId[] = [];
  for (const zone of zonesFile.zones) {
    if (balance.zones[zone.balanceKey] === undefined) throw new Error(`content: zone ${zone.id} names a balance row that does not exist`);
    const map = maps.find((candidate) => candidate.zone === zone.id);
    if (map === undefined) throw new Error(`content: zone ${zone.id} has no map`);
    const width = map.tiles[0]?.length ?? 0;
    if (map.tiles.some((row) => row.length !== width)) throw new Error(`content: the map of ${zone.id} has rows of different lengths`);
    zones[zone.id] = {
      id: zone.id,
      balanceKey: zone.balanceKey,
      referenceLoadout: zone.referenceLoadout,
      map: { width, height: map.tiles.length, tiles: map.tiles, doors: map.doors, exits: map.exits, salvageSites: map.salvageSites, places: map.places },
    };
    for (const spawn of map.spawns) {
      spawns[spawn.id] = { ...spawn, zone: zone.id };
      spawnOrder.push(spawn.id);
    }
    for (const secret of map.secrets) {
      secrets[secret.id] = { ...secret, zone: zone.id };
      secretOrder.push(secret.id);
    }
    for (const waypoint of map.waypoints) waypoints[waypoint.id] = { ...waypoint, zone: zone.id };
  }
  for (const map of maps) if (zones[map.zone] === undefined) throw new Error(`content: there is a map for ${map.zone}, which is not a zone`);

  const enemies: Record<EnemyId, EnemyDef> = {};
  const glyphs: Record<EnemyId, string> = {};
  const families: Record<EnemyId, string> = {};
  for (const enemy of enemiesFile.enemies) {
    const row = balance.zones[zones[enemy.zone]?.balanceKey ?? ''];
    if (row === undefined) throw new Error(`content: enemy ${enemy.id} is in a zone that does not exist`);
    for (const drop of enemy.drops) if (items[drop.item] === undefined) throw new Error(`content: enemy ${enemy.id} drops an item that does not exist`);
    const { glyph, family, ...rest } = enemy;
    enemies[enemy.id] = { ...rest, family, stats: enemyStats(enemy, row, balance) };
    glyphs[enemy.id] = glyph;
    families[enemy.id] = family;
  }
  for (const id of spawnOrder) {
    if (enemies[spawns[id]?.enemy ?? ''] === undefined) throw new Error(`content: spawn ${id} holds an enemy that does not exist`);
  }
  if (zones[zonesFile.start.zone] === undefined) throw new Error('content: the run starts in a zone that does not exist');

  const content = indexContent({
    balance,
    start: zonesFile.start,
    zoneOrder: zonesFile.zones.map((zone) => zone.id),
    zones,
    enemyOrder: enemiesFile.enemies.map((enemy) => enemy.id),
    enemies,
    itemOrder: itemsFile.items.map((item) => item.id),
    items,
    spawnOrder,
    spawns,
    secretOrder,
    secrets,
    waypoints,
  });

  const named = (table: Record<string, string>) => (id: string): string => table[id] ?? id;
  const text: GameText = {
    zone: named(strings.zones),
    enemy: named(strings.enemies),
    family: named(strings.families),
    item: named(strings.items),
    tag: named(strings.tags),
    place: named(strings.places),
    line: (key) => strings.lines[key] ?? '',
    glyph: (enemy) => glyphs[enemy] ?? '?',
    familyOf: (enemy) => families[enemy] ?? '',
    strings,
  };
  return { content, text };
};

let bundled: Loaded | null = null;

/** The content that ships with the build, parsed once. */
export const loadBundled = (): Loaded => {
  bundled ??= parseContent(BUNDLED);
  return bundled;
};

export const loadBundledContent = (): Content => loadBundled().content;
