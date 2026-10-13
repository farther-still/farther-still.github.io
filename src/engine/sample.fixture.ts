// A small made-up world for tests: two zones, four enemies, eight items, one of everything the engine has a
// rule for. It is not game content and never ships: nothing outside a test imports it. Its balance table holds
// the GDD's starting values, so the formula tests check the GDD's calibration points whatever data/balance.json
// is later tuned to.
//
//   z01                 z02
//   #########           #####
//   #..2#...#   1,2  normal spawns s001 (e001), s002 (e002)        #.4.#   4  spawn s004 (e004)
//   #...B..>#   B    boss spawn s003 (e003), a gate; > exit        #..<#   <  exit back to z01
//   #..1#...#                                                      #####
//   #.S.#####   S    Salvage site
//   #.@.%_###   @    run start; % hidden tile x01; _ stash x02
//   #...#####
//   #D#######   D    door, opened by key i004
//   #.#######
//   #########

import { enemyStats } from './formulas';
import { indexContent } from './map';
import { newGame } from './state';
import type { GameState } from './state';
import type { Balance, Content, EnemyDef, ItemDef, ItemLines, TagValues } from './types';

export const SAMPLE_BALANCE: Balance = {
  hero: {
    pointsPerLevel: 5,
    start: { life: 60, damage: 10, defense: 5, dexterity: 0, luck: 0 },
    perPoint: { life: 3, damage: 1, defense: 1, dexterity: 1, luck: 1 },
    multFloor: 0.05,
    accuracyBase: 100,
    evasionBase: 100,
    evasionPerDexterity: 0.5,
    critChanceBase: 10,
    critChancePerDecade: 5,
    critDamageBase: 150,
    critDamagePerDecade: 10,
    dexterityPivot: 10,
    goldBonusPerDecade: 50,
    dropBonusPerDecade: 40,
    luckPivot: 100,
    luckDropCurve: [
      { q: 1, mult: 1 },
      { q: 10, mult: 1.5 },
      { q: 350, mult: 5 },
    ],
    moveSpeedCap: 150,
  },
  xp: { perLevel: 10, enemyFactor: 0.6, enemyLevelOffset: 4, bossMult: 3, underlevelFrom: 1.2, underlevelTo: 3.6, underlevelMax: 3 },
  battle: { ratingBase: 100, missFactor: 0.1, hitFloor: 0.05, dodgeBase: 0.1, dodgePerDecade: 0.26, dodgeCap: 0.8, roundLimit: 200 },
  forecast: { trials: 1000, showFactorBelow: 0.9, missBelow: 0.6, shrugAbove: 0.8 },
  enemy: {
    boss: { life: 2, damage: 1.1, defense: 1.1, gold: 3 },
    roles: {
      standard: { life: 1, damage: 1, defense: 1 },
      bruiser: { life: 1.3, damage: 0.8, defense: 1 },
      glass: { life: 0.75, damage: 1.25, defense: 1 },
      armored: { life: 1, damage: 0.9, defense: 1.5 },
      flurry: { life: 0.9, damage: 0.7, defense: 1 },
      mender: { life: 0.9, damage: 0.9, defense: 1 },
    },
    modifierMin: 0.7,
    modifierMax: 1.4,
  },
  zones: {
    Z1: { levelMin: 1, levelMax: 40, lifePerLevel: 24, damagePerLevel: 5, defensePerLevel: 2, goldPerLevel: 4, fightCost: 1, bossGems: 3, pctBudget: 50, waypointGems: null },
    Z2: { levelMin: 41, levelMax: 250, lifePerLevel: 34, damagePerLevel: 5.5, defensePerLevel: 2.4, goldPerLevel: 3, fightCost: 1, bossGems: 3, pctBudget: 80, waypointGems: null },
    Z3: { levelMin: 251, levelMax: 1500, lifePerLevel: 48, damagePerLevel: 6, defensePerLevel: 2.8, goldPerLevel: 2.5, fightCost: 1, bossGems: 3, pctBudget: 110, waypointGems: 20 },
    Z4: { levelMin: 1501, levelMax: 8000, lifePerLevel: 68, damagePerLevel: 6.6, defensePerLevel: 3.2, goldPerLevel: 2, fightCost: 1, bossGems: 3, pctBudget: 150, waypointGems: 30 },
    Z5: { levelMin: 8001, levelMax: 40000, lifePerLevel: 96, damagePerLevel: 7.4, defensePerLevel: 3.7, goldPerLevel: 1.6, fightCost: 1, bossGems: 5, pctBudget: 220, waypointGems: 40 },
    Z6: { levelMin: 40001, levelMax: 150000, lifePerLevel: 135, damagePerLevel: 8.4, defensePerLevel: 4.2, goldPerLevel: 1.3, fightCost: 1, bossGems: 5, pctBudget: 300, waypointGems: 50 },
    Z7: { levelMin: 150001, levelMax: 450000, lifePerLevel: 190, damagePerLevel: 9.6, defensePerLevel: 4.8, goldPerLevel: 1.1, fightCost: 2, bossGems: 5, pctBudget: 400, waypointGems: 60 },
    Z8: { levelMin: 450001, levelMax: 1200000, lifePerLevel: 270, damagePerLevel: 11, defensePerLevel: 5.5, goldPerLevel: 1, fightCost: 2, bossGems: 5, pctBudget: 550, waypointGems: 70 },
  },
  marks: {
    chance: 0.08,
    stats: [
      { stat: 'xp', weight: 45 },
      { stat: 'drops', weight: 29 },
      { stat: 'gold', weight: 26 },
    ],
    percents: [100, 200],
  },
  energy: { base: 20, bossSurplus: 2, perClaim: 3, chargeLosses: true },
  claim: { damageCutPct: 90 },
  items: {
    budget: { damagePerLevel: 3, defensePerLevel: 1.9, lifePerLevel: 7.9, dexterityPerLevel: 0.4, tolerance: 0.15 },
    limits: { reflect: 30, lifeRegen: 20, lastStand: 3 },
    priceFactorMin: 6,
    priceFactorMax: 60,
    dropChanceMin: 1.25,
  },
  loadouts: { free: 2, max: 5, priceFactor: 60, priceLevels: [1000, 30000, 300000], nameMax: 16 },
  salvage: { goldFactor: 36, boostGems: 25, boostMult: 2, bandHigh: 0.5, bandLow: 0.1 },
  gems: { dropChance: 0.08 },
  autoAssign: { unlockLevel: 250, defaultSplit: { life: 30, damage: 30, defense: 30, dexterity: 10, luck: 0 } },
  map: { tilesPerSecond: 6 },
  pacing: {
    runsInFirstZone: { min: 4, max: 6 },
    wallMaxRuns: 8,
    winsPerRunEarly: { min: 20, max: 30 },
    levelOverStrongest: { min: 1, max: 3 },
    persistentGainShare: 0.9,
    runsWithoutGainMax: 2,
    hardWinTries: 3,
    hardWinShareMax: 0.15,
    minutesPerRunEarly: { min: 2, max: 4 },
    killsPerDropMax: 80,
    breakthroughFirstKills: 3,
    runsPerWall: { min: 4, max: 6 },
    secondsPerFight: { min: 3, max: 6 },
    secondsPerFightSkipMax: 1,
    killsPerDropTypical: { min: 10, max: 20 },
  },
};

type ItemSpec = Partial<Omit<ItemDef, 'id' | 'kind' | 'lines' | 'resist' | 'versus'>> & { lines?: ItemLines; resist?: Partial<TagValues>; versus?: Partial<TagValues> };

/** An item for a test, with every field a test does not care about filled in. */
export const sampleItem = (id: string, kind: ItemDef['kind'], spec: ItemSpec = {}): ItemDef => ({
  id,
  kind,
  level: spec.level ?? 1,
  lines: spec.lines ?? {},
  resist: spec.resist ?? {},
  versus: spec.versus ?? {},
  claim: spec.claim ?? false,
  copyCap: spec.copyCap ?? 1,
  priceFactor: spec.priceFactor ?? null,
});

const NO_TRAITS = { doubleAttack: 0, tripleAttack: 0, regen: 0, damageReduction: 0 };
const PLAIN = { life: 1, damage: 1, defense: 1 };

type EnemySpec = Omit<EnemyDef, 'stats' | 'family' | 'mods' | 'traits' | 'boss' | 'gate'> & Partial<Pick<EnemyDef, 'mods' | 'traits' | 'boss' | 'gate'>>;

const ITEMS: ItemDef[] = [
  sampleItem('i001', 'weapon', { level: 3, lines: { damageFlat: 10 }, priceFactor: 8 }),
  sampleItem('i002', 'body', { level: 2, lines: { defenseFlat: 5, lifeFlat: 20 } }),
  sampleItem('i003', 'accessory', { level: 4, lines: { dexterityFlat: 5 }, copyCap: 3 }),
  sampleItem('i004', 'key', { level: 2 }),
  sampleItem('i005', 'weapon', { level: 10, claim: true }),
  sampleItem('i006', 'accessory', { level: 5, lines: { energy: 2 }, priceFactor: 6 }),
  sampleItem('i007', 'accessory', { level: 50, lines: { growth: 1, lastStand: 1 } }),
  sampleItem('i008', 'head', { level: 4, lines: { defenseFlat: 3, lifePct: 10 } }),
];

const ENEMIES: EnemySpec[] = [
  { id: 'e001', zone: 'z01', level: 2, role: 'standard', tags: ['t1'], drops: [{ item: 'i002', chance: 50 }, { item: 'i004', chance: 100 }] },
  { id: 'e002', zone: 'z01', level: 4, role: 'glass', tags: ['t1'], drops: [{ item: 'i003', chance: 25 }, { item: 'i008', chance: 10 }] },
  { id: 'e003', zone: 'z01', level: 10, role: 'standard', tags: ['t2'], drops: [{ item: 'i005', chance: 100 }], boss: true, gate: true },
  { id: 'e004', zone: 'z02', level: 50, role: 'flurry', tags: ['t4', 'e1'], drops: [{ item: 'i007', chance: 100 }], traits: { doubleAttack: 50, tripleAttack: 50, regen: 5, damageReduction: 20 } },
];

/** `balance` can be swapped for a test that needs a changed rule. */
export const sampleContent = (balance: Balance = SAMPLE_BALANCE): Content => {
  const items: Record<string, ItemDef> = {};
  for (const item of ITEMS) items[item.id] = item;
  const enemies: Record<string, EnemyDef> = {};
  for (const spec of ENEMIES) {
    const shape = { ...spec, family: 'f01', mods: spec.mods ?? PLAIN, traits: spec.traits ?? NO_TRAITS, boss: spec.boss ?? false, gate: spec.gate ?? false };
    const row = balance.zones[spec.zone === 'z01' ? 'Z1' : 'Z2'];
    if (row === undefined) throw new Error('sample content: the balance table has no row for this zone');
    enemies[spec.id] = { ...shape, stats: enemyStats(shape, row, balance) };
  }
  return indexContent({
    balance,
    start: { zone: 'z01', x: 2, y: 5 },
    zoneOrder: ['z01', 'z02'],
    zones: {
      z01: {
        id: 'z01',
        balanceKey: 'Z1',
        referenceLoadout: null,
        map: {
          width: 9,
          height: 10,
          tiles: ['#########', '#...#...#', '#.......#', '#...#...#', '#...#####', '#...%_###', '#...#####', '#.#######', '#.#######', '#########'],
          doors: [{ x: 1, y: 7, key: 'i004', keyZone: 'z01' }],
          exits: [{ x: 7, y: 2, to: { zone: 'z02', x: 1, y: 1 } }],
          salvageSites: [{ x: 2, y: 4 }],
          places: [],
        },
      },
      z02: {
        id: 'z02',
        balanceKey: 'Z2',
        referenceLoadout: null,
        map: { width: 5, height: 4, tiles: ['#####', '#...#', '#..:#', '#####'], doors: [], exits: [{ x: 3, y: 2, to: { zone: 'z01', x: 6, y: 2 } }], salvageSites: [], places: [] },
      },
    },
    enemyOrder: ENEMIES.map((enemy) => enemy.id),
    enemies,
    itemOrder: ITEMS.map((item) => item.id),
    items,
    spawnOrder: ['s001', 's002', 's003', 's004'],
    spawns: {
      s001: { id: 's001', enemy: 'e001', zone: 'z01', x: 3, y: 3 },
      s002: { id: 's002', enemy: 'e002', zone: 'z01', x: 3, y: 1 },
      s003: { id: 's003', enemy: 'e003', zone: 'z01', x: 4, y: 2 },
      s004: { id: 's004', enemy: 'e004', zone: 'z02', x: 2, y: 1 },
    },
    secretOrder: ['x01', 'x02'],
    secrets: {
      x01: { id: 'x01', kind: 'hidden', zone: 'z01', tiles: [{ x: 4, y: 5 }] },
      x02: { id: 'x02', kind: 'stash', zone: 'z01', x: 5, y: 5, gold: 40 },
    },
    waypoints: {},
  });
};

/** A new game in the sample world. Seed 7 leaves no enemy marked at the start, which keeps reward sums plain. */
export const sampleGame = (seed = 7): GameState => newGame(seed, sampleContent());
