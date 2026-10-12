// The engine's vocabulary: IDs, the balance table, content definitions and derived figures. No rule lives here.
// Content IDs are opaque strings (`z01`, `e001`, `i001`, `s001`, `x01`, `w01`); the engine never reads meaning
// into one.

export type ItemId = string;
export type EnemyId = string;
export type ZoneId = string;
export type SpawnId = string;
export type SecretId = string;
export type WaypointId = string;
export type HintId = string;

// ---- stats ----

export const STAT_KEYS = ['life', 'damage', 'defense', 'dexterity', 'luck'] as const;
export type StatKey = (typeof STAT_KEYS)[number];
export type StatPoints = { life: number; damage: number; defense: number; dexterity: number; luck: number };
/** Percentages of new points for Auto-assign, summing to 100. */
export type StatSplit = StatPoints;

/** E1–E3 are elements and T1–T4 are types (GDD 4.4). They work identically; the names are sealed. */
export const TAGS = ['e1', 'e2', 'e3', 't1', 't2', 't3', 't4'] as const;
export type Tag = (typeof TAGS)[number];
export type TagValues = { e1: number; e2: number; e3: number; t1: number; t2: number; t3: number; t4: number };

// ---- equipment ----

export const ARMOR_SLOTS = [
  'head',
  'neck',
  'shoulders',
  'body',
  'back',
  'arms',
  'hands',
  'finger',
  'waist',
  'legs',
  'feet',
  'offhand',
] as const;
export type ArmorSlot = (typeof ARMOR_SLOTS)[number];

export const ACCESSORY_SLOTS = ['acc1', 'acc2', 'acc3', 'acc4', 'acc5'] as const;
export type AccessorySlot = (typeof ACCESSORY_SLOTS)[number];

/** Every cell of a loadout: one weapon, one of each armor type, five accessories (GDD 7.1). */
export const SLOT_IDS = ['weapon', ...ARMOR_SLOTS, ...ACCESSORY_SLOTS] as const;
export type SlotId = (typeof SLOT_IDS)[number];

export type ItemKind = 'weapon' | ArmorSlot | 'accessory' | 'key';

/** An item's lines (GDD 4.3). Values are whole or fractional numbers in the unit the stat dictionary gives. */
export const LINE_KEYS = [
  'lifeFlat',
  'damageFlat',
  'defenseFlat',
  'dexterityFlat',
  'luckFlat',
  'lifePct',
  'damagePct',
  'defensePct',
  'dexterityPct',
  'luckPct',
  'accuracyPct',
  'evasionPct',
  'critChance',
  'critDamage',
  'xpBonus',
  'goldBonus',
  'dropBonus',
  'lifeRegen',
  'extraHit',
  'extraAttack',
  'extraTurn',
  'reflect',
  'lastStand',
  'growth',
  'moveSpeed',
  'energy',
] as const;
export type LineKey = (typeof LINE_KEYS)[number];
export type ItemLines = Partial<Record<LineKey, number>>;

export type ItemDef = {
  id: ItemId;
  kind: ItemKind;
  /** Sets prices and budgets. It is not a requirement to equip (GDD 5.6). */
  level: number;
  lines: ItemLines;
  resist: Partial<TagValues>;
  versus: Partial<TagValues>;
  /** The permanent-energy tool's one effect (GDD 2.3). */
  claim: boolean;
  copyCap: number;
  /** The shop's `k` (GDD 5.7), or null for an item that is not sold. */
  priceFactor: number | null;
};

export type Loadout = {
  /** Empty until the player names it; the UI then shows its number. */
  name: string;
  slots: Record<SlotId, ItemId | null>;
};

// ---- enemies ----

export const ROLES = ['standard', 'bruiser', 'glass', 'armored', 'flurry', 'mender'] as const;
export type Role = (typeof ROLES)[number];

export type EnemyTraits = {
  /** Chances in percent. Triple is rolled only if double succeeded (GDD 4.4). */
  doubleAttack: number;
  tripleAttack: number;
  /** Percent of max life healed at the start of its turn. */
  regen: number;
  /** Percent removed from everything it takes. */
  damageReduction: number;
};

export type EnemyDrop = { item: ItemId; chance: number };

export type EnemyStats = { life: number; damage: number; defense: number; xp: number; gold: number };

export type EnemyDef = {
  id: EnemyId;
  zone: ZoneId;
  family: string;
  level: number;
  role: Role;
  mods: { life: number; damage: number; defense: number };
  tags: readonly Tag[];
  traits: EnemyTraits;
  /** Base chances in percent. 100 is a guaranteed handover. */
  drops: readonly EnemyDrop[];
  boss: boolean;
  gate: boolean;
  /** Worked out once by the content loader from `enemyStats` (GDD 5.4). */
  stats: EnemyStats;
};

// ---- maps ----

export type Point = { x: number; y: number };
export type Position = { zone: ZoneId; x: number; y: number };

export type SpawnDef = { id: SpawnId; enemy: EnemyId; zone: ZoneId; x: number; y: number };
/** `key` null is a sealed door: the end of current content (GDD 7.7). */
export type DoorDef = { x: number; y: number; key: ItemId | null; keyZone: ZoneId | null };
export type ExitDef = { x: number; y: number; to: Position };
export type SiteDef = { x: number; y: number };
export type WaypointDef = { id: WaypointId; zone: ZoneId; x: number; y: number };
export type SecretDef =
  | { id: SecretId; kind: 'hidden'; zone: ZoneId; tiles: readonly Point[] }
  | { id: SecretId; kind: 'stash'; zone: ZoneId; x: number; y: number; gold: number };
export type PlaceDef = { key: string; x: number; y: number };

export type ZoneMap = {
  width: number;
  height: number;
  /** One string per row. `#` and `%` are walls; anything else is floor, drawn by the UI as it likes. */
  tiles: readonly string[];
  doors: readonly DoorDef[];
  exits: readonly ExitDef[];
  salvageSites: readonly SiteDef[];
  places: readonly PlaceDef[];
};

export type ZoneDef = {
  id: ZoneId;
  /** Which row of the balance zone table this zone uses (GDD 5.4). */
  balanceKey: string;
  /** The loadout a player who has finished the zone would wear into its gate boss (GDD 5.6), or null for a zone only partly built. */
  referenceLoadout: Record<SlotId, ItemId | null> | null;
  map: ZoneMap;
};

// ---- balance: every number in the GDD (sections 3, 4, 5 and 7). Loaded from data/balance.json ----

export type ZoneBalance = {
  levelMin: number;
  levelMax: number;
  lifePerLevel: number;
  damagePerLevel: number;
  defensePerLevel: number;
  goldPerLevel: number;
  fightCost: number;
  /** Gems a boss gives the first time it is ever beaten. */
  bossGems: number;
  /** The reference loadout's total for each of % Life, % Damage and % Defense. */
  pctBudget: number;
  /** Gem price of this zone's waypoint, or null where it has none. */
  waypointGems: number | null;
};

export type MarkStat = 'xp' | 'drops' | 'gold';
export type Mark = { stat: MarkStat; percent: number };

export type Balance = {
  hero: {
    pointsPerLevel: number;
    start: StatPoints;
    perPoint: StatPoints;
    multFloor: number;
    accuracyBase: number;
    evasionBase: number;
    evasionPerDexterity: number;
    critChanceBase: number;
    critChancePerDecade: number;
    critDamageBase: number;
    critDamagePerDecade: number;
    dexterityPivot: number;
    goldBonusPerDecade: number;
    dropBonusPerDecade: number;
    luckPivot: number;
    /** Points of the Luck drop multiplier, by Luck ÷ enemy level; straight lines between them on a log scale. */
    luckDropCurve: ReadonlyArray<{ q: number; mult: number }>;
    moveSpeedCap: number;
  };
  xp: {
    perLevel: number;
    enemyFactor: number;
    enemyLevelOffset: number;
    bossMult: number;
    underlevelFrom: number;
    underlevelTo: number;
    underlevelMax: number;
  };
  battle: {
    ratingBase: number;
    missFactor: number;
    hitFloor: number;
    dodgeBase: number;
    dodgePerDecade: number;
    dodgeCap: number;
    roundLimit: number;
  };
  forecast: {
    trials: number;
    showFactorBelow: number;
    missBelow: number;
    shrugAbove: number;
  };
  enemy: {
    boss: { life: number; damage: number; defense: number; gold: number };
    roles: Record<Role, { life: number; damage: number; defense: number }>;
    modifierMin: number;
    modifierMax: number;
  };
  zones: Record<string, ZoneBalance>;
  marks: {
    chance: number;
    stats: ReadonlyArray<{ stat: MarkStat; weight: number }>;
    percents: readonly number[];
  };
  energy: { base: number; bossSurplus: number; perClaim: number };
  claim: { damageCutPct: number };
  items: {
    budget: { damagePerLevel: number; defensePerLevel: number; lifePerLevel: number; dexterityPerLevel: number; tolerance: number };
    limits: { reflect: number; lifeRegen: number; lastStand: number };
    priceFactorMin: number;
    priceFactorMax: number;
    dropChanceMin: number;
  };
  loadouts: { free: number; max: number; priceFactor: number; priceLevels: readonly number[]; nameMax: number };
  salvage: { goldFactor: number; boostGems: number; boostMult: number; bandHigh: number; bandLow: number };
  gems: { dropChance: number };
  autoAssign: { unlockLevel: number; defaultSplit: StatSplit };
  map: { tilesPerSecond: number };
  /** The pacing targets of GDD 5.9 that the simulator reports against. No rule reads them. */
  pacing: {
    runsInFirstZone: Range;
    wallMaxRuns: number;
    winsPerRunEarly: Range;
    levelOverStrongest: Range;
    persistentGainShare: number;
    /** "Never three in a row without one": the longest spell allowed. */
    runsWithoutGainMax: number;
    /** A win that took more tries than this counts as a hard win. */
    hardWinTries: number;
    hardWinShareMax: number;
    minutesPerRunEarly: Range;
    killsPerDropMax: number;
    /** Enemies never beaten before that a breakthrough run should also beat. */
    breakthroughFirstKills: number;
  };
};

export type Range = { min: number; max: number };

// ---- content, as the engine sees it. Built by src/content/ from data/ ----

export type Content = {
  balance: Balance;
  start: Position;
  zoneOrder: readonly ZoneId[];
  zones: Readonly<Record<ZoneId, ZoneDef>>;
  enemyOrder: readonly EnemyId[];
  enemies: Readonly<Record<EnemyId, EnemyDef>>;
  itemOrder: readonly ItemId[];
  items: Readonly<Record<ItemId, ItemDef>>;
  spawnOrder: readonly SpawnId[];
  spawns: Readonly<Record<SpawnId, SpawnDef>>;
  secretOrder: readonly SecretId[];
  secrets: Readonly<Record<SecretId, SecretDef>>;
  waypoints: Readonly<Record<WaypointId, WaypointDef>>;
  /** Lookups by tile (`tileKey`) and by item, built once by `indexContent`. */
  index: ContentIndex;
};

export type ContentIndex = {
  spawnAt: Readonly<Record<string, SpawnId>>;
  hiddenAt: Readonly<Record<string, SecretId>>;
  stashAt: Readonly<Record<string, SecretId>>;
  doorAt: Readonly<Record<string, DoorDef>>;
  exitAt: Readonly<Record<string, ExitDef>>;
  siteAt: Readonly<Record<string, SiteDef>>;
  /** The enemies that drop each item, in enemy order. */
  droppedBy: Readonly<Record<ItemId, readonly EnemyId[]>>;
};

// ---- derived figures ----

export type CoreStat = { base: number; mult: number; final: number };

export type HeroStats = {
  level: number;
  core: Record<StatKey, CoreStat>;
  life: number;
  damage: number;
  defense: number;
  dexterity: number;
  luck: number;
  accuracy: number;
  evasion: number;
  /** Chances are 0 to 1. Crit Damage is a multiplier: 1.5 means 150%. */
  critChance: number;
  critDamage: number;
  extraHit: number;
  extraAttack: number;
  extraTurn: number;
  /** Percentages, as the stat dictionary lists them. */
  xpBonus: number;
  goldBonus: number;
  dropBonus: number;
  lifeRegen: number;
  reflect: number;
  lastStand: number;
  growth: number;
  moveSpeed: number;
  energy: number;
  resist: TagValues;
  versus: TagValues;
  claim: boolean;
};

/** What a battle needs to know about the enemy. */
export type Combatant = {
  level: number;
  life: number;
  damage: number;
  defense: number;
  tags: readonly Tag[];
  traits: EnemyTraits;
};
