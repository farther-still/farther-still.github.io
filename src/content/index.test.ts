import { describe, expect, it } from 'vitest';
import { canonicalJson, deriveHero, dodgeChance, enemyStats, hitChance, newGame, repairRun, salvageChance, walkable } from '../engine';
import type { Balance, Content, HeroStats, ItemDef, ItemLines } from '../engine';
import { BUNDLED, ID, loadBundled, loadBundledContent, parseContent } from './index';
import type { RawContent } from './index';

// Spoiler rule: nothing here names bundled content. Tests reach it by position or by ID, and no assertion puts a
// display name where a failure message would print it.

type Row = Record<string, unknown>;

/** The files under data/ as plain data a test may break on purpose. */
type Loose = {
  balance: Row;
  zones: { start: Row; zones: Row[] };
  enemies: { enemies: Row[] };
  items: { items: Row[] };
  maps: Array<Row & { tiles: string[]; spawns: Row[]; secrets: Row[]; waypoints: Row[]; doors: Row[]; exits: Row[] }>;
  strings: Record<string, Record<string, string>>;
};

const copy = (): Loose => JSON.parse(JSON.stringify(BUNDLED)) as Loose;

const must = <T>(value: T | undefined | null, what: string): T => {
  if (value === undefined || value === null) throw new Error(`test setup: no ${what}`);
  return value;
};

/** Parses the bundled files after one change to a copy of them. */
const parsedWith = (change: (raw: Loose) => void): (() => unknown) => {
  const raw = copy();
  change(raw);
  return () => parseContent(raw as RawContent);
};

/** An item ID of the right form that the bundled content does not use. */
const unusedItem = (taken: (id: string) => boolean): string => {
  for (let n = 999; n > 0; n -= 1) {
    const id = `i${String(n).padStart(3, '0')}`;
    if (!taken(id)) return id;
  }
  throw new Error('test setup: every item ID is taken');
};

const without = (row: Row, key: string): Row => Object.fromEntries(Object.entries(row).filter(([name]) => name !== key));

describe('the bundled content', () => {
  it('loads', () => {
    const content = loadBundledContent();
    expect(content.zoneOrder.length).toBeGreaterThan(0);
    expect(content.enemyOrder.length).toBeGreaterThan(0);
    expect(content.itemOrder.length).toBeGreaterThan(0);
    expect(content.spawnOrder.length).toBeGreaterThan(0);
  });

  it('is parsed once and handed out again', () => {
    expect(loadBundled()).toBe(loadBundled());
    expect(loadBundledContent()).toBe(loadBundled().content);
  });

  it('parses to the same content every time', () => {
    expect(canonicalJson(parseContent(BUNDLED).content)).toBe(canonicalJson(loadBundledContent()));
  });

  it('gives every zone, enemy, item, spawn, secret and waypoint an ID of its own form, under that ID', () => {
    const content = loadBundledContent();
    const forms: Array<[RegExp, Record<string, { id: string }>, readonly string[] | null]> = [
      [ID.zone, content.zones, content.zoneOrder],
      [ID.enemy, content.enemies, content.enemyOrder],
      [ID.item, content.items, content.itemOrder],
      [ID.spawn, content.spawns, content.spawnOrder],
      [ID.secret, content.secrets, content.secretOrder],
      [ID.waypoint, content.waypoints, null],
    ];
    for (const [form, table, order] of forms) {
      for (const [key, entry] of Object.entries(table)) {
        expect(key).toMatch(form);
        expect(entry.id).toBe(key);
      }
      if (order !== null) {
        expect([...order].sort()).toEqual(Object.keys(table).sort());
        expect(new Set(order).size).toBe(order.length);
      }
    }
  });

  it('works each enemy’s stats out with the engine’s own formula', () => {
    const content = loadBundledContent();
    for (const id of content.enemyOrder) {
      const enemy = must(content.enemies[id], `enemy ${id}`);
      const row = must(content.balance.zones[must(content.zones[enemy.zone], `zone of ${id}`).balanceKey], `balance row of ${id}`);
      expect(enemy.stats, id).toEqual(enemyStats(enemy, row, content.balance));
      expect(enemy.stats.life, id).toBeGreaterThanOrEqual(1);
    }
  });

  it('joins every reference: spawns to enemies and zones, drops to items, secrets and waypoints to zones', () => {
    const content = loadBundledContent();
    for (const id of content.spawnOrder) {
      const spawn = must(content.spawns[id], `spawn ${id}`);
      expect(content.enemies[spawn.enemy], id).toBeDefined();
      expect(content.zones[spawn.zone], id).toBeDefined();
    }
    for (const id of content.enemyOrder) {
      for (const drop of must(content.enemies[id], `enemy ${id}`).drops) {
        expect(content.items[drop.item], id).toBeDefined();
        expect(content.index.droppedBy[drop.item], id).toContain(id);
      }
    }
    for (const id of content.secretOrder) expect(content.zones[must(content.secrets[id], `secret ${id}`).zone], id).toBeDefined();
    for (const waypoint of Object.values(content.waypoints)) expect(content.zones[waypoint.zone], waypoint.id).toBeDefined();
  });

  it('gives every zone a map whose rows are all as wide as it says', () => {
    const content = loadBundledContent();
    for (const id of content.zoneOrder) {
      const map = must(content.zones[id], `zone ${id}`).map;
      expect(map.tiles, id).toHaveLength(map.height);
      for (const row of map.tiles) expect(row.length, id).toBe(map.width);
    }
  });

  it('starts a game the engine accepts as it is', () => {
    const content = loadBundledContent();
    const state = newGame(1, content);
    expect(walkable(state, content, content.start.zone, content.start.x, content.start.y, 'path')).toBe(true);
    expect(repairRun(state, content)).toBe(state);
    expect(state.profile.loadouts).toHaveLength(content.balance.loadouts.free);
  });

  it('answers the UI with a string for any ID, known or not', () => {
    const { text, content } = loadBundled();
    const firstEnemy = must(content.enemyOrder[0], 'enemy');
    const firstItem = must(content.itemOrder[0], 'item');
    expect(typeof text.enemy(firstEnemy)).toBe('string');
    expect(typeof text.item(firstItem)).toBe('string');
    expect(text.glyph(firstEnemy).length).toBeGreaterThan(0);
    // An ID with no name comes back as itself, a line with no text as nothing.
    expect(text.enemy('e000')).toBe('e000');
    expect(text.item('i000')).toBe('i000');
    expect(text.line('no-such-line')).toBe('');
    expect(text.glyph('e000')).toBe('?');
  });
});

describe('parseContent refuses a file that breaks its schema', () => {
  it('accepts an unchanged copy, so each refusal below is down to the one change made', () => {
    expect(parsedWith(() => undefined)).not.toThrow();
  });

  it.each<[string, (raw: Loose) => void]>([
    ['the balance table', (raw) => (raw.balance['extra'] = 1)],
    ['a group of the balance table', (raw) => ((raw.balance['hero'] as Row)['extra'] = 1)],
    ['the zones file', (raw) => ((raw.zones as Row)['extra'] = 1)],
    ['a zone', (raw) => (must(raw.zones.zones[0], 'zone')['extra'] = 1)],
    ['the enemies file', (raw) => ((raw.enemies as Row)['extra'] = 1)],
    ['an enemy', (raw) => (must(raw.enemies.enemies[0], 'enemy')['extra'] = 1)],
    ['an enemy’s traits', (raw) => ((must(raw.enemies.enemies[0], 'enemy')['traits'] as Row)['extra'] = 1)],
    ['an item', (raw) => (must(raw.items.items[0], 'item')['extra'] = 1)],
    ['an item’s lines', (raw) => ((must(raw.items.items[0], 'item')['lines'] as Row)['extra'] = 1)],
    ['a map', (raw) => (must(raw.maps[0], 'map')['extra'] = 1)],
    ['a spawn', (raw) => (must(must(raw.maps[0], 'map').spawns[0], 'spawn')['extra'] = 1)],
    ['the strings file', (raw) => ((raw.strings as Row)['extra'] = {})],
  ])('an unknown field in %s', (_where, change) => {
    expect(parsedWith(change)).toThrow(/unrecognized key/i);
  });

  it.each<[string, (raw: Loose) => void]>([
    ['item', (raw) => raw.items.items.push({ ...must(raw.items.items[0], 'item') })],
    ['enemy', (raw) => raw.enemies.enemies.push({ ...must(raw.enemies.enemies[0], 'enemy') })],
    ['zone', (raw) => raw.zones.zones.push({ ...must(raw.zones.zones[0], 'zone') })],
    ['map', (raw) => raw.maps.push({ ...must(raw.maps[0], 'map') })],
    ['spawn', (raw) => must(raw.maps[0], 'map').spawns.push({ ...must(must(raw.maps[0], 'map').spawns[0], 'spawn') })],
  ])('a duplicate %s ID', (kind, change) => {
    expect(parsedWith(change)).toThrow(`${kind} ID `);
    expect(parsedWith(change)).toThrow(/is listed twice/);
  });

  it('a spawn ID used in two different maps', () => {
    expect(
      parsedWith((raw) => {
        const first = must(raw.maps[0], 'first map');
        const second = must(raw.maps[1], 'second map');
        const spawn = must(first.spawns[0], 'spawn');
        const other = must(second.spawns[0], 'spawn in the second map');
        other['id'] = spawn['id'];
      }),
    ).toThrow(/spawn ID \S+ is listed twice/);
  });

  it('a drop naming an item that does not exist', () => {
    const content = loadBundledContent();
    const missing = unusedItem((id) => content.items[id] !== undefined);
    expect(parsedWith((raw) => (must(raw.enemies.enemies[0], 'enemy')['drops'] = [{ item: missing, chance: 5 }]))).toThrow(/drops an item that does not exist/);
    // The same drop naming an item that does exist is fine.
    const real = must(content.itemOrder[0], 'item');
    expect(parsedWith((raw) => (must(raw.enemies.enemies[0], 'enemy')['drops'] = [{ item: real, chance: 5 }]))).not.toThrow();
  });

  it('map rows of different lengths', () => {
    expect(
      parsedWith((raw) => {
        const map = must(raw.maps[0], 'map');
        map.tiles[0] = `${must(map.tiles[0], 'row')}#`;
      }),
    ).toThrow(/rows of different lengths/);
    expect(
      parsedWith((raw) => {
        const map = must(raw.maps[0], 'map');
        const last = map.tiles.length - 1;
        map.tiles[last] = must(map.tiles[last], 'row').slice(1);
      }),
    ).toThrow(/rows of different lengths/);
  });

  it.each<[string, (raw: Loose) => void]>([
    ['an enemy in a zone that does not exist', (raw) => (must(raw.enemies.enemies[0], 'enemy')['zone'] = 'z99')],
    ['a spawn holding an enemy that does not exist', (raw) => (must(must(raw.maps[0], 'map').spawns[0], 'spawn')['enemy'] = 'e999')],
    ['a zone naming a balance row that does not exist', (raw) => (must(raw.zones.zones[0], 'zone')['balanceKey'] = 'Z9')],
    ['a zone with no map', (raw) => raw.maps.splice(0, 1)],
    ['a map for a zone that does not exist', (raw) => (must(raw.maps[0], 'map')['zone'] = 'z99')],
    ['a run start in a zone that does not exist', (raw) => (raw.zones.start['zone'] = 'z99')],
    ['an ID in the wrong form', (raw) => (must(raw.items.items[0], 'item')['id'] = 'item-1')],
    ['a missing field', (raw) => (raw.items.items[0] = without(must(raw.items.items[0], 'item'), 'copyCap'))],
    ['a number where a list belongs', (raw) => (must(raw.enemies.enemies[0], 'enemy')['drops'] = 5)],
    ['a drop chance over 100', (raw) => (must(raw.enemies.enemies[0], 'enemy')['drops'] = [{ item: must(raw.items.items[0], 'item')['id'], chance: 101 }])],
    ['a fourth drop', (raw) => (must(raw.enemies.enemies[0], 'enemy')['drops'] = [1, 2, 3, 4].map((chance) => ({ item: must(raw.items.items[0], 'item')['id'], chance })))],
    ['a third tag', (raw) => (must(raw.enemies.enemies[0], 'enemy')['tags'] = ['e1', 'e2', 'e3'])],
    ['a tag that is not one of the seven', (raw) => (must(raw.enemies.enemies[0], 'enemy')['tags'] = ['t9'])],
    ['a role that is not one of the six', (raw) => (must(raw.enemies.enemies[0], 'enemy')['role'] = 'giant')],
    ['a tile character the map does not know', (raw) => (must(raw.maps[0], 'map').tiles[0] = must(must(raw.maps[0], 'map').tiles[0], 'row').replace(/./, '?'))],
    ['a balance number of the wrong kind', (raw) => ((raw.balance['hero'] as Row)['pointsPerLevel'] = 2.5)],
    ['a missing balance group', (raw) => (raw.balance = without(raw.balance, 'salvage'))],
    ['a file that is not an object', (raw) => ((raw as Row)['items'] = 'items')],
  ])('%s', (_what, change) => {
    expect(parsedWith(change)).toThrow();
  });
});

describe('data/balance.json still reproduces the points taken from the reference game', () => {
  const content: Content = loadBundledContent();
  const balance: Balance = content.balance;

  /** A new hero whose only gear is one made-up item carrying these lines. */
  const heroWith = (lines: ItemLines): HeroStats => {
    const item: ItemDef = { id: 'test', kind: 'accessory', level: 1, lines, resist: {}, versus: {}, claim: false, copyCap: 1, priceFactor: null };
    return deriveHero(newGame(1, content), content, [item]);
  };

  const nearest = (value: number): number => Math.floor(value + 0.5);

  it('gives 21% crit chance and 172% crit damage at Dexterity 1,575 (GDD 4.2)', () => {
    const hero = heroWith({ dexterityFlat: 1575 - balance.hero.start.dexterity });
    expect(hero.dexterity).toBe(1575);
    expect(nearest(hero.critChance * 100)).toBe(21);
    expect(nearest(hero.critDamage * 100)).toBe(172);
  });

  it('gives +50% gold and +40% drops at Luck 1,000 (GDD 4.2)', () => {
    const hero = heroWith({ luckFlat: 1000 - balance.hero.start.luck });
    expect(hero.luck).toBe(1000);
    expect(hero.goldBonus).toBeCloseTo(50, 9);
    expect(hero.dropBonus).toBeCloseTo(40, 9);
  });

  it('hits 90% of the time when Accuracy equals the enemy rating (GDD 3.1)', () => {
    for (const enemyLevel of [1, 40, 42000, 1200000]) {
      const rating = enemyLevel + balance.battle.ratingBase;
      expect(hitChance(rating, enemyLevel, balance)).toBeCloseTo(0.9, 12);
    }
  });

  it('dodges 10% of the time when Evasion equals the enemy rating (GDD 3.1)', () => {
    for (const enemyLevel of [1, 40, 42000, 1200000]) {
      const rating = enemyLevel + balance.battle.ratingBase;
      expect(dodgeChance(rating, enemyLevel, balance)).toBeCloseTo(0.1, 12);
    }
  });

  it('gives a Salvage chance of 66% at 3,750,974 gold with a strongest kill of level 42,000 (GDD 7.4)', () => {
    const base = newGame(1, content);
    const state = { ...base, run: { ...base.run, gold: 3750974, strongestBeaten: 42000 } };
    expect(nearest(salvageChance(state, balance, false) * 100)).toBe(66);
  });
});
