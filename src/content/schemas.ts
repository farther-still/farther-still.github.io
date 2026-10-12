// The shape of every file under data/ (ARCHITECTURE section 6). Strict everywhere: an unknown field is an
// error. These schemas say what a file may hold; whether the content makes a playable game is the job of
// scripts/check-content.ts.

import { z } from 'zod';
import { ARMOR_SLOTS, LINE_KEYS, ROLES, SLOT_IDS, TAGS } from '../engine';
import type { Balance, SlotId } from '../engine';

// No run-time code generation: the built page's content security policy forbids it (see src/save/schema.ts).
z.config({ jitless: true });

const count = z.int().nonnegative();
const positive = z.number().positive();
const amount = z.number().nonnegative();

export const ID = {
  zone: /^z\d{2}$/,
  enemy: /^e\d{3}$/,
  item: /^i\d{3}$/,
  spawn: /^s\d{3}$/,
  secret: /^x\d{2}$/,
  waypoint: /^w\d{2}$/,
  place: /^p\d{2}$/,
} as const;

export type IdKind = keyof typeof ID;

const id = (kind: IdKind): z.ZodString => z.string().regex(ID[kind]);

const range = z.strictObject({ min: amount, max: amount });
const statPoints = z.strictObject({ life: amount, damage: amount, defense: amount, dexterity: amount, luck: amount });
const triple = z.strictObject({ life: positive, damage: positive, defense: positive });

const zoneBalance = z.strictObject({
  levelMin: z.int().positive(),
  levelMax: z.int().positive(),
  lifePerLevel: positive,
  damagePerLevel: positive,
  defensePerLevel: positive,
  goldPerLevel: positive,
  fightCost: z.int().positive(),
  bossGems: count,
  pctBudget: amount,
  waypointGems: count.nullable(),
});

const roleTable = z.strictObject({ standard: triple, bruiser: triple, glass: triple, armored: triple, flurry: triple, mender: triple });

export const balanceSchema = z.strictObject({
  hero: z.strictObject({
    pointsPerLevel: z.int().positive(),
    start: statPoints,
    perPoint: statPoints,
    multFloor: positive,
    accuracyBase: positive,
    evasionBase: positive,
    evasionPerDexterity: amount,
    critChanceBase: amount,
    critChancePerDecade: amount,
    critDamageBase: amount,
    critDamagePerDecade: amount,
    dexterityPivot: positive,
    goldBonusPerDecade: amount,
    dropBonusPerDecade: amount,
    luckPivot: positive,
    luckDropCurve: z.array(z.strictObject({ q: positive, mult: positive })).min(1),
    moveSpeedCap: amount,
  }),
  xp: z.strictObject({
    perLevel: positive,
    enemyFactor: positive,
    enemyLevelOffset: amount,
    bossMult: positive,
    underlevelFrom: positive,
    underlevelTo: positive,
    underlevelMax: positive,
  }),
  battle: z.strictObject({
    ratingBase: amount,
    missFactor: amount,
    hitFloor: z.number().min(0).max(1),
    dodgeBase: z.number().min(0).max(1),
    dodgePerDecade: amount,
    dodgeCap: z.number().min(0).max(1),
    roundLimit: z.int().positive(),
  }),
  forecast: z.strictObject({
    trials: z.int().positive(),
    showFactorBelow: z.number().min(0).max(1),
    missBelow: z.number().min(0).max(1),
    shrugAbove: z.number().min(0).max(1),
  }),
  enemy: z.strictObject({
    boss: z.strictObject({ life: positive, damage: positive, defense: positive, gold: positive }),
    roles: roleTable,
    modifierMin: positive,
    modifierMax: positive,
  }),
  zones: z.record(z.string().regex(/^Z\d$/), zoneBalance),
  marks: z.strictObject({
    chance: z.number().min(0).max(1),
    stats: z.array(z.strictObject({ stat: z.enum(['xp', 'drops', 'gold']), weight: positive })).min(1),
    // Whole numbers: a mark's size is stored in the save, where it must be one.
    percents: z.array(z.int().positive()).min(1),
  }),
  energy: z.strictObject({ base: count, bossSurplus: count, perClaim: count }),
  claim: z.strictObject({ damageCutPct: z.number().min(0).max(100) }),
  items: z.strictObject({
    budget: z.strictObject({ damagePerLevel: positive, defensePerLevel: positive, lifePerLevel: positive, dexterityPerLevel: positive, tolerance: z.number().min(0).max(1) }),
    limits: z.strictObject({ reflect: amount, lifeRegen: amount, lastStand: count }),
    priceFactorMin: positive,
    priceFactorMax: positive,
    dropChanceMin: positive,
  }),
  loadouts: z.strictObject({ free: z.int().positive(), max: z.int().positive(), priceFactor: positive, priceLevels: z.array(z.int().positive()), nameMax: z.int().positive() }),
  salvage: z.strictObject({ goldFactor: positive, boostGems: count, boostMult: positive, bandHigh: z.number().min(0).max(1), bandLow: z.number().min(0).max(1) }),
  gems: z.strictObject({ dropChance: z.number().min(0).max(1) }),
  autoAssign: z.strictObject({ unlockLevel: z.int().positive(), defaultSplit: statPoints }),
  map: z.strictObject({ tilesPerSecond: positive }),
  pacing: z.strictObject({
    runsInFirstZone: range,
    wallMaxRuns: z.int().positive(),
    winsPerRunEarly: range,
    levelOverStrongest: range,
    persistentGainShare: z.number().min(0).max(1),
    runsWithoutGainMax: count,
    hardWinTries: z.int().positive(),
    hardWinShareMax: z.number().min(0).max(1),
    minutesPerRunEarly: range,
    killsPerDropMax: positive,
    breakthroughFirstKills: count,
  }),
});

// Compile-time proof that the schema and the engine agree on the balance table.
type Same<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Mutable<T> = T extends readonly (infer U)[] ? Mutable<U>[] : T extends object ? { -readonly [K in keyof T]: Mutable<T[K]> } : T;
export const BALANCE_MATCHES_SCHEMA: Same<z.infer<typeof balanceSchema>, Mutable<Balance>> = true;

const tagValues = z.partialRecord(z.enum(TAGS), z.number());
const itemKind = z.enum(['weapon', ...ARMOR_SLOTS, 'accessory', 'key']);

export const itemsSchema = z.strictObject({
  items: z.array(
    z.strictObject({
      id: id('item'),
      kind: itemKind,
      level: z.int().positive(),
      lines: z.partialRecord(z.enum(LINE_KEYS), z.number()),
      resist: tagValues,
      versus: tagValues,
      claim: z.boolean(),
      copyCap: z.int().positive(),
      priceFactor: positive.nullable(),
    }),
  ),
});

const percent = z.number().min(0).max(100);

export const enemiesSchema = z.strictObject({
  enemies: z.array(
    z.strictObject({
      id: id('enemy'),
      zone: id('zone'),
      /** Groups an enemy with its family in the bestiary. The family's name is in the strings file. */
      family: z.string().regex(/^f\d{2}$/),
      level: z.int().positive(),
      role: z.enum(ROLES),
      mods: triple,
      tags: z.array(z.enum(TAGS)).max(2),
      traits: z.strictObject({ doubleAttack: percent, tripleAttack: percent, regen: percent, damageReduction: percent }),
      drops: z.array(z.strictObject({ item: id('item'), chance: z.number().positive().max(100) })).max(3),
      boss: z.boolean(),
      gate: z.boolean(),
      /** Placeholder art: the one character drawn for it on the map and in battle. */
      glyph: z.string().min(1).max(8),
    }),
  ),
});

const slotCells = Object.fromEntries(SLOT_IDS.map((slot) => [slot, id('item').nullable()])) as Record<SlotId, z.ZodNullable<z.ZodString>>;

export const zonesSchema = z.strictObject({
  start: z.strictObject({ zone: id('zone'), x: count, y: count }),
  zones: z.array(
    z.strictObject({
      id: id('zone'),
      balanceKey: z.string().regex(/^Z\d$/),
      referenceLoadout: z.strictObject(slotCells).nullable(),
    }),
  ),
});

const point = z.strictObject({ x: count, y: count });

export const mapSchema = z.strictObject({
  zone: id('zone'),
  /** One string per row, all the same length. `#` and `%` are walls; the other characters are kinds of floor. */
  tiles: z.array(z.string().regex(/^[#%.,:;"'=_]+$/)).min(1),
  spawns: z.array(z.strictObject({ id: id('spawn'), enemy: id('enemy'), x: count, y: count })),
  doors: z.array(z.strictObject({ x: count, y: count, key: id('item').nullable(), keyZone: id('zone').nullable() })),
  exits: z.array(z.strictObject({ x: count, y: count, to: z.strictObject({ zone: id('zone'), x: count, y: count }) })),
  waypoints: z.array(z.strictObject({ id: id('waypoint'), x: count, y: count })),
  salvageSites: z.array(point),
  secrets: z.array(
    z.discriminatedUnion('kind', [
      z.strictObject({ id: id('secret'), kind: z.literal('hidden'), tiles: z.array(point).min(1) }),
      z.strictObject({ id: id('secret'), kind: z.literal('stash'), x: count, y: count, gold: z.int().positive() }),
    ]),
  ),
  places: z.array(z.strictObject({ key: id('place'), x: count, y: count })),
});

const names = z.record(z.string(), z.string().min(1));

export const stringsSchema = z.strictObject({
  zones: names,
  enemies: names,
  families: names,
  items: names,
  tags: names,
  places: names,
  /** Lines of content text, such as what a boss says when it hands something over. */
  lines: names,
});

/**
 * Every ID ever shipped, with its kind. The kind is finer than "item" or "enemy" on purpose: an item's kind is
 * its slot and a boss is its own kind, because a save holds items in slots and bosses in its claimed list. The
 * repo check refuses a change of kind, so neither can change under a save. A secret is only ever `secret`:
 * the lock is not sealed, and what kind of secret an ID is, is (GDD 7.5).
 */
export const LOCK_KINDS = ['zone', 'enemy', 'boss', 'weapon', ...ARMOR_SLOTS, 'accessory', 'key', 'spawn', 'secret', 'waypoint'] as const;

export const lockSchema = z.strictObject({
  ids: z.record(z.string(), z.enum(LOCK_KINDS)),
});

export const specSchema = z.strictObject({
  /** Zones built in full, which must have a reference loadout; the rest are a glimpse. */
  completeZones: z.array(id('zone')),
  zones: count,
  enemies: z.record(id('zone'), z.strictObject({ total: count, bosses: count })),
  items: z.strictObject({
    weapons: z.strictObject({ total: count, sold: count }),
    armor: z.strictObject({ total: count, sold: count }),
    accessories: z.strictObject({ total: count, sold: count }),
    keys: z.strictObject({ total: count, sold: count }),
  }),
});

export type ItemsFile = z.infer<typeof itemsSchema>;
export type EnemiesFile = z.infer<typeof enemiesSchema>;
export type ZonesFile = z.infer<typeof zonesSchema>;
export type MapFile = z.infer<typeof mapSchema>;
export type StringsFile = z.infer<typeof stringsSchema>;
export type LockFile = z.infer<typeof lockSchema>;
export type SpecFile = z.infer<typeof specSchema>;
