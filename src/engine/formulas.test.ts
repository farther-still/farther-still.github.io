import { describe, expect, it } from 'vitest';
import {
  activeLoadout,
  combatantOf,
  deriveHero,
  dodgeChance,
  dropChance,
  dropsHeld,
  enemyRating,
  enemyStats,
  equippedEnergy,
  equippedItems,
  fightCost,
  goldAt,
  goldReward,
  hitChance,
  level,
  loadoutPrice,
  luckDropMult,
  owned,
  pointsEarned,
  remainingEnergy,
  salvageBands,
  salvageChance,
  salvagePool,
  shopPrice,
  startingEnergy,
  underlevelBonus,
  unspentPoints,
  xpReward,
  zoneRowFor,
} from './formulas';
import { indexContent } from './map';
import { levelForXp, xpForLevel } from './math/level';
import { SAMPLE_BALANCE, sampleContent, sampleGame, sampleItem } from './sample.fixture';
import { emptyLoadout, zeroPoints } from './state';
import type { GameState } from './state';
import type { Balance, Content, EnemyDef, HeroStats, ItemDef, ItemLines, Loadout, Role, SlotId, StatPoints, Tag, TagValues, ZoneBalance } from './types';

// Every expected number here is worked out from the GDD's formulas at its starting values, which are the numbers
// in SAMPLE_BALANCE. None is read back from the code under test.

const B: Balance = SAMPLE_BALANCE;
const content = sampleContent();

const must = <T>(value: T | undefined | null, what: string): T => {
  if (value === undefined || value === null) throw new Error(`test setup: no ${what}`);
  return value;
};

const game = (run: Partial<GameState['run']> = {}, profile: Partial<GameState['profile']> = {}): GameState => {
  const base = sampleGame();
  return { profile: { ...base.profile, ...profile }, run: { ...base.run, ...run } };
};

const points = (spent: Partial<StatPoints>): StatPoints => ({ ...zeroPoints(), ...spent });

/** An accessory carrying these lines. Accessories have no rule of their own in the stat formulas, so any line can ride on one. */
const gear = (lines: ItemLines, tags: { resist?: Partial<TagValues>; versus?: Partial<TagValues> } = {}): ItemDef => sampleItem('i900', 'accessory', { lines, ...tags });

const tool = (): ItemDef => sampleItem('i901', 'weapon', { claim: true });

const heroWith = (items: readonly ItemDef[] = [], run: Partial<GameState['run']> = {}): HeroStats => deriveHero(game(run), content, items);

const heroAtLevel = (heroLevel: number, items: readonly ItemDef[] = []): HeroStats => heroWith(items, { xp: xpForLevel(heroLevel, B.xp.perLevel) });

const zoneRow = (key: string): ZoneBalance => must(B.zones[key], `balance row ${key}`);

type EnemySpec = { level: number; row?: string; boss?: boolean; role?: Role; mods?: EnemyDef['mods']; tags?: readonly Tag[] };

const enemyOf = (spec: EnemySpec): EnemyDef => {
  const shape = {
    id: 'e900',
    zone: 'z01',
    family: 'f01',
    level: spec.level,
    role: spec.role ?? 'standard',
    mods: spec.mods ?? { life: 1, damage: 1, defense: 1 },
    tags: spec.tags ?? [],
    traits: { doubleAttack: 0, tripleAttack: 0, regen: 0, damageReduction: 0 },
    drops: [],
    boss: spec.boss ?? false,
    gate: false,
  };
  return { ...shape, stats: enemyStats(shape, zoneRow(spec.row ?? 'Z1'), B) };
};

const sampleEnemy = (id: string): EnemyDef => must(content.enemies[id], `enemy ${id}`);

/** A loadout holding these items, by slot. */
const loadoutOf = (slots: Partial<Record<SlotId, string>>): Loadout => {
  const loadout = emptyLoadout();
  return { ...loadout, slots: { ...loadout.slots, ...slots } };
};

/** To the nearest whole percent. `Math.round` is not on the engine's list. */
const nearest = (value: number): number => Math.floor(value + 0.5);

describe('core stats (GDD 4.1)', () => {
  it('starts a hero at the starting values', () => {
    const hero = heroWith();
    expect(hero.level).toBe(1);
    expect(hero.core.life).toEqual({ base: 60, mult: 1, final: 60 });
    expect(hero.core.damage).toEqual({ base: 10, mult: 1, final: 10 });
    expect(hero.core.defense).toEqual({ base: 5, mult: 1, final: 5 });
    expect(hero.core.dexterity).toEqual({ base: 0, mult: 1, final: 0 });
    expect(hero.core.luck).toEqual({ base: 0, mult: 1, final: 0 });
    expect([hero.life, hero.damage, hero.defense, hero.dexterity, hero.luck]).toEqual([60, 10, 5, 0, 0]);
  });

  it('starts the derived stats at their bases (GDD 4.2)', () => {
    const hero = heroWith();
    expect(hero.accuracy).toBe(100);
    expect(hero.evasion).toBe(100);
    expect(hero.critChance).toBe(0.1);
    expect(hero.critDamage).toBe(1.5);
    expect([hero.extraHit, hero.extraAttack, hero.extraTurn]).toEqual([0, 0, 0]);
    expect([hero.xpBonus, hero.goldBonus, hero.dropBonus]).toEqual([0, 0, 0]);
    expect([hero.lifeRegen, hero.reflect, hero.lastStand, hero.growth, hero.moveSpeed, hero.energy]).toEqual([0, 0, 0, 0, 0, 0]);
    expect(hero.resist).toEqual({ e1: 0, e2: 0, e3: 0, t1: 0, t2: 0, t3: 0, t4: 0 });
    expect(hero.versus).toEqual({ e1: 0, e2: 0, e3: 0, t1: 0, t2: 0, t3: 0, t4: 0 });
    expect(hero.claim).toBe(false);
  });

  it('adds each spent point at its value: 3 Life, 1 of anything else', () => {
    const hero = heroWith([], { pointsSpent: points({ life: 10, damage: 7, defense: 4, dexterity: 3, luck: 2 }) });
    expect(hero.core.life.base).toBe(60 + 30);
    expect(hero.core.damage.base).toBe(10 + 7);
    expect(hero.core.defense.base).toBe(5 + 4);
    expect(hero.core.dexterity.base).toBe(3);
    expect(hero.core.luck.base).toBe(2);
    expect([hero.life, hero.damage, hero.defense, hero.dexterity, hero.luck]).toEqual([90, 17, 9, 3, 2]);
  });

  it('builds Base from the start, points and flat gear, Mult from percent gear, and Final from both', () => {
    const hero = heroWith([gear({ lifeFlat: 20, lifePct: 10, damageFlat: 5, damagePct: 50, defenseFlat: 3, defensePct: 25, dexterityFlat: 6, dexterityPct: 100, luckFlat: 9, luckPct: 200 })], {
      pointsSpent: points({ life: 10, damage: 5, defense: 2, dexterity: 4, luck: 1 }),
    });
    // Life: 60 + 10 × 3 + 20 = 110, times 1.1.
    expect(hero.core.life.base).toBe(110);
    expect(hero.core.life.mult).toBeCloseTo(1.1, 12);
    expect(hero.life).toBe(121);
    // Damage: 10 + 5 + 5 = 20, times 1.5.
    expect(hero.core.damage).toEqual({ base: 20, mult: 1.5, final: 30 });
    // Defense: 5 + 2 + 3 = 10, times 1.25, rounded down from 12.5.
    expect(hero.core.defense).toEqual({ base: 10, mult: 1.25, final: 12 });
    expect(hero.core.dexterity).toEqual({ base: 10, mult: 2, final: 20 });
    expect(hero.core.luck).toEqual({ base: 10, mult: 3, final: 30 });
  });

  it('rounds Final down', () => {
    expect(heroWith([gear({ lifeFlat: 1, lifePct: 50 })]).life).toBe(91); // 61 × 1.5 = 91.5
    expect(heroWith([gear({ damageFlat: 1, damagePct: 50 })]).damage).toBe(16); // 11 × 1.5 = 16.5
    expect(heroWith([gear({ defensePct: 50 })]).defense).toBe(7); // 5 × 1.5 = 7.5
  });

  it('adds percent bonuses from several items into one Mult instead of multiplying them', () => {
    const hero = heroWith([gear({ damagePct: 50 }), gear({ damagePct: 50 }), gear({ damagePct: 100 })]);
    expect(hero.core.damage.mult).toBe(3);
    expect(hero.damage).toBe(30);
  });

  it('adds flat bonuses from several items', () => {
    const hero = heroWith([gear({ lifeFlat: 20 }), gear({ lifeFlat: 7 }), gear({ lifeFlat: -2 })]);
    expect(hero.core.life.base).toBe(85);
  });

  it('never lets Mult go below 0.05', () => {
    expect(heroWith([gear({ lifePct: -95 })]).core.life.mult).toBeCloseTo(0.05, 12);
    expect(heroWith([gear({ lifePct: -99 })]).core.life.mult).toBe(0.05);
    expect(heroWith([gear({ lifePct: -100 })]).core.life.mult).toBe(0.05);
    expect(heroWith([gear({ lifePct: -250 }), gear({ lifePct: -250 })]).core.life.mult).toBe(0.05);
    // 60 × 0.05 = 3.
    expect(heroWith([gear({ lifePct: -500 })]).life).toBe(3);
    // 400 Life × 0.05 = 20.
    expect(heroWith([gear({ lifeFlat: 340, lifePct: -500 })]).life).toBe(20);
  });

  it('never lets Life, Damage or Defense go below 1', () => {
    const floored = heroWith([gear({ lifePct: -500, damagePct: -500, defensePct: -500, lifeFlat: -59 })]);
    expect([floored.life, floored.damage, floored.defense]).toEqual([1, 1, 1]);
    const negative = heroWith([gear({ lifeFlat: -1000, damageFlat: -1000, defenseFlat: -1000 })]);
    expect(negative.core.life.base).toBe(-940);
    expect([negative.life, negative.damage, negative.defense]).toEqual([1, 1, 1]);
  });

  it('lets Dexterity and Luck be 0, and no lower', () => {
    const hero = heroWith([gear({ dexterityFlat: -50, luckFlat: -50 })]);
    expect([hero.dexterity, hero.luck]).toEqual([0, 0]);
    const small = heroWith([gear({ dexterityFlat: 10, luckFlat: 10, dexterityPct: -500, luckPct: -500 })]);
    expect([small.dexterity, small.luck]).toEqual([0, 0]); // 10 × 0.05 = 0.5, rounded down
  });

  it('follows exact arithmetic for whole percentages at ordinary sizes', () => {
    expect(heroWith([gear({ lifePct: 15 })]).life).toBe(69);
    expect(heroWith([gear({ lifeFlat: 50, lifePct: 10 })]).life).toBe(121);
    expect(heroWith([gear({ damageFlat: 90, damagePct: 7 })]).damage).toBe(107);
    expect(heroWith([gear({ defenseFlat: 195, defensePct: 110 })]).defense).toBe(420);
  });

  it('is exact where 1 + percent ÷ 100 is not a number a double holds', () => {
    // GDD 4.1: Final = Base × Mult, rounded down. Base 25 with +16% is 29 exactly. Multiplying by the double
    // nearest 1.16 gives 28.999… and so 28; the engine works in whole percent, `Base × (100 + percent) ÷ 100`.
    expect(heroWith([gear({ damageFlat: 15, damagePct: 16 })]).damage).toBe(29);
  });
});

describe('level and stat points (GDD 4.1, 5.1)', () => {
  it('reads the level from XP', () => {
    expect(level(game({ xp: 0 }), B)).toBe(1);
    expect(level(game({ xp: 29 }), B)).toBe(2);
    expect(level(game({ xp: 30 }), B)).toBe(3);
    expect(heroWith([], { xp: 450 }).level).toBe(10);
  });

  it('earns 5 points for each level gained, and none at level 1', () => {
    expect(pointsEarned(game({ xp: 0 }), B)).toBe(0);
    expect(pointsEarned(game({ xp: 10 }), B)).toBe(5);
    expect(pointsEarned(game({ xp: 450 }), B)).toBe(45);
    expect(pointsEarned(game({ xp: xpForLevel(250, 10) }), B)).toBe(1245);
  });

  it('adds Growth points to the points every level gives', () => {
    expect(pointsEarned(game({ xp: 30, growthPointsEarned: 4 }), B)).toBe(14);
  });

  it('derives unspent points from points earned and points spent, never below 0', () => {
    expect(unspentPoints(game({ xp: 30 }), B)).toBe(10);
    expect(unspentPoints(game({ xp: 30, growthPointsEarned: 4, pointsSpent: points({ life: 3, damage: 3, luck: 3 }) }), B)).toBe(5);
    expect(unspentPoints(game({ xp: 30, pointsSpent: points({ life: 10 }) }), B)).toBe(0);
    expect(unspentPoints(game({ xp: 30, pointsSpent: points({ life: 11 }) }), B)).toBe(0);
  });
});

describe('derived stats (GDD 4.2)', () => {
  it('works Accuracy out as (100 + Dexterity) × (1 + Accuracy% ÷ 100)', () => {
    expect(heroWith([gear({ dexterityFlat: 50 })]).accuracy).toBe(150);
    expect(heroWith([gear({ dexterityFlat: 50, accuracyPct: 20 })]).accuracy).toBeCloseTo(180, 9);
    expect(heroWith([gear({ accuracyPct: 20 }), gear({ accuracyPct: 30 })]).accuracy).toBeCloseTo(150, 9);
    expect(heroWith([gear({ dexterityFlat: 1575 })]).accuracy).toBe(1675);
  });

  it('works Evasion out as (100 + 0.5 × Dexterity) × (1 + Evasion% ÷ 100)', () => {
    expect(heroWith([gear({ dexterityFlat: 50 })]).evasion).toBe(125);
    expect(heroWith([gear({ dexterityFlat: 50, evasionPct: 10 })]).evasion).toBeCloseTo(137.5, 9);
    expect(heroWith([gear({ evasionPct: 40 }), gear({ evasionPct: 60 })]).evasion).toBeCloseTo(200, 9);
    expect(heroWith([gear({ dexterityFlat: 1575 })]).evasion).toBe(887.5);
  });

  it('never lets Accuracy or Evasion go below 1 (GDD 3.1)', () => {
    const hero = heroWith([gear({ accuracyPct: -100, evasionPct: -100 })]);
    expect([hero.accuracy, hero.evasion]).toEqual([1, 1]);
    const worse = heroWith([gear({ accuracyPct: -900, evasionPct: -900 })]);
    expect([worse.accuracy, worse.evasion]).toEqual([1, 1]);
  });

  it('gives 21% crit chance and 172% crit damage at Dexterity 1,575, the check against the screenshot', () => {
    const hero = heroWith([gear({ dexterityFlat: 1575 })]);
    expect(hero.dexterity).toBe(1575);
    // 10 + 5 × log10(157.5) and 150 + 10 × log10(157.5), with log10(157.5) = 2.19728055812562.
    expect(hero.critChance * 100).toBeCloseTo(20.9864027906281, 9);
    expect(hero.critDamage * 100).toBeCloseTo(171.972805581256, 9);
    expect(nearest(hero.critChance * 100)).toBe(21);
    expect(nearest(hero.critDamage * 100)).toBe(172);
    // QUESTION: the GDD's check holds to the nearest whole percent only. The formula gives 20.99% and 171.97%,
    // and GDD 6.4 says displayed values are cut, not rounded, so a screen that cuts would show 20% and 171%,
    // one under the screenshot's 21% and 172% on both. The formula is the GDD's own, so the code is left alone.
    expect(Math.floor(hero.critChance * 100)).toBe(20);
    expect(Math.floor(hero.critDamage * 100)).toBe(171);
  });

  it('adds nothing to crit for Dexterity at or under 10', () => {
    for (const dexterity of [0, 1, 5, 9, 10]) {
      const hero = heroWith([gear({ dexterityFlat: dexterity })]);
      expect(hero.critChance).toBe(0.1);
      expect(hero.critDamage).toBe(1.5);
    }
    const eleven = heroWith([gear({ dexterityFlat: 11 })]);
    expect(eleven.critChance).toBeGreaterThan(0.1);
    expect(eleven.critDamage).toBeGreaterThan(1.5);
  });

  it('adds 5 points of crit chance and 10 of crit damage for each tenfold of Dexterity past 10', () => {
    const hundred = heroWith([gear({ dexterityFlat: 100 })]);
    expect(hundred.critChance).toBeCloseTo(0.15, 12);
    expect(hundred.critDamage).toBeCloseTo(1.6, 12);
    const tenThousand = heroWith([gear({ dexterityFlat: 10000 })]);
    expect(tenThousand.critChance).toBeCloseTo(0.25, 12);
    expect(tenThousand.critDamage).toBeCloseTo(1.8, 12);
  });

  it('adds crit from gear, stops crit chance at 100% and at 0%, and leaves crit damage uncapped', () => {
    expect(heroWith([gear({ critChance: 5 }), gear({ critChance: 7 })]).critChance).toBeCloseTo(0.22, 12);
    expect(heroWith([gear({ critChance: 90 })]).critChance).toBe(1);
    expect(heroWith([gear({ critChance: 500 })]).critChance).toBe(1);
    expect(heroWith([gear({ critChance: -50 })]).critChance).toBe(0);
    expect(heroWith([gear({ critDamage: 25 }), gear({ critDamage: 25 })]).critDamage).toBeCloseTo(2, 12);
    expect(heroWith([gear({ critDamage: 1000 })]).critDamage).toBeCloseTo(11.5, 12);
    expect(heroWith([gear({ critDamage: -400 })]).critDamage).toBe(0);
  });

  it('gives +50% gold and +40% drops at Luck 1,000, the published rule', () => {
    const hero = heroWith([gear({ luckFlat: 1000 })]);
    expect(hero.luck).toBe(1000);
    expect(hero.goldBonus).toBeCloseTo(50, 12);
    expect(hero.dropBonus).toBeCloseTo(40, 12);
  });

  it('adds nothing for Luck at or under 100', () => {
    for (const luck of [0, 1, 50, 99, 100]) {
      const hero = heroWith([gear({ luckFlat: luck })]);
      expect(hero.goldBonus).toBe(0);
      expect(hero.dropBonus).toBe(0);
    }
    expect(heroWith([gear({ luckFlat: 101 })]).goldBonus).toBeGreaterThan(0);
  });

  it('adds 50 and 40 points for each further tenfold of Luck, on top of gear', () => {
    const hero = heroWith([gear({ luckFlat: 100000 })]);
    expect(hero.goldBonus).toBeCloseTo(150, 12);
    expect(hero.dropBonus).toBeCloseTo(120, 12);
    const geared = heroWith([gear({ luckFlat: 1000, goldBonus: 25, dropBonus: 10 }), gear({ goldBonus: 5, dropBonus: -20 })]);
    expect(geared.goldBonus).toBeCloseTo(80, 12);
    expect(geared.dropBonus).toBeCloseTo(30, 12);
  });

  it('never lets a reward bonus fall below −100%, where its multiplier is 0 (GDD 4.3)', () => {
    const hero = heroWith([gear({ xpBonus: -300, goldBonus: -300, dropBonus: -300 })]);
    expect([hero.xpBonus, hero.goldBonus, hero.dropBonus]).toEqual([-100, -100, -100]);
  });
});

describe('effects on gear: adds against highest wins (GDD 4.3)', () => {
  it('takes only the largest Last Stand', () => {
    expect(heroWith([gear({ lastStand: 1 }), gear({ lastStand: 3 }), gear({ lastStand: 2 })]).lastStand).toBe(3);
    expect(heroWith([gear({ lastStand: 1 }), gear({ lastStand: 1 })]).lastStand).toBe(1);
  });

  it('takes only the largest Growth', () => {
    expect(heroWith([gear({ growth: 2 }), gear({ growth: 1 })]).growth).toBe(2);
    expect(heroWith([gear({ growth: 1 }), gear({ growth: 1 }), gear({ growth: 1 })]).growth).toBe(1);
  });

  it('adds everything else', () => {
    const hero = heroWith([
      gear({ reflect: 10, lifeRegen: 4, extraHit: 10, extraAttack: 5, extraTurn: 2, xpBonus: 15, moveSpeed: 20, energy: 1 }),
      gear({ reflect: 15, lifeRegen: 6, extraHit: 20, extraAttack: 15, extraTurn: 3, xpBonus: 10, moveSpeed: 30, energy: 2 }),
    ]);
    expect(hero.reflect).toBe(25);
    expect(hero.lifeRegen).toBe(10);
    expect(hero.extraHit).toBeCloseTo(0.3, 12);
    expect(hero.extraAttack).toBeCloseTo(0.2, 12);
    expect(hero.extraTurn).toBeCloseTo(0.05, 12);
    expect(hero.xpBonus).toBe(25);
    expect(hero.moveSpeed).toBe(50);
    expect(hero.energy).toBe(3);
  });

  it('adds Resistance and Damage against a tag, tag by tag', () => {
    const hero = heroWith([gear({}, { resist: { t1: 100, e2: 30 }, versus: { t1: 20 } }), gear({}, { resist: { t1: 50 }, versus: { t1: 30, t4: 10 } })]);
    expect(hero.resist).toEqual({ e1: 0, e2: 30, e3: 0, t1: 150, t2: 0, t3: 0, t4: 0 });
    expect(hero.versus).toEqual({ e1: 0, e2: 0, e3: 0, t1: 50, t2: 0, t3: 0, t4: 10 });
  });

  it('stops multi-action chances at 100% and at 0%', () => {
    const over = heroWith([gear({ extraHit: 80, extraAttack: 150, extraTurn: 100 }), gear({ extraHit: 80 })]);
    expect([over.extraHit, over.extraAttack, over.extraTurn]).toEqual([1, 1, 1]);
    const under = heroWith([gear({ extraHit: -10, extraAttack: -10, extraTurn: -10 })]);
    expect([under.extraHit, under.extraAttack, under.extraTurn]).toEqual([0, 0, 0]);
  });

  it('caps Move Speed at +150% and leaves Reflect uncapped', () => {
    expect(heroWith([gear({ moveSpeed: 100 }), gear({ moveSpeed: 100 })]).moveSpeed).toBe(150);
    expect(heroWith([gear({ moveSpeed: -40 })]).moveSpeed).toBe(0);
    expect(heroWith([gear({ reflect: 400 })]).reflect).toBe(400);
  });

  it('holds no summed value below 0 where the stat cannot be negative', () => {
    const hero = heroWith([gear({ reflect: -5, lifeRegen: -5, lastStand: -1, growth: -1, energy: -2 })]);
    expect([hero.reflect, hero.lifeRegen, hero.lastStand, hero.growth, hero.energy]).toEqual([0, 0, 0, 0, 0]);
  });
});

describe('the permanent-energy tool (GDD 2.3)', () => {
  it('cuts Damage by 90%', () => {
    expect(heroWith([tool()]).damage).toBe(1);
    expect(heroWith([tool(), gear({ damageFlat: 10 })]).damage).toBe(2);
    expect(heroWith([tool(), gear({ damageFlat: 20 })]).damage).toBe(3);
    expect(heroWith([tool(), gear({ damageFlat: 90 })]).damage).toBe(10);
    expect(heroWith([tool(), gear({ damageFlat: 95 })]).damage).toBe(10); // 10.5, rounded down
    expect(heroWith([tool(), gear({ damageFlat: 990 })]).damage).toBe(100);
    expect(heroWith([tool()], { pointsSpent: points({ damage: 4990 }) }).damage).toBe(500);
  });

  it('applies the cut after everything else, so no other gear buys it back', () => {
    const hero = heroWith([tool(), gear({ damageFlat: 90, damagePct: 100 })]);
    // (10 + 90) × 2 = 200, then a tenth of that. Base and Mult still show the uncut figures.
    expect(hero.core.damage.base).toBe(100);
    expect(hero.core.damage.mult).toBe(2);
    expect(hero.core.damage.final).toBe(20);
    expect(hero.damage).toBe(20);
    // (10 + 27) × 1.5 = 55.5, a tenth of which is 5.55.
    expect(heroWith([tool(), gear({ damageFlat: 27, damagePct: 50 })]).damage).toBe(5);
    // A hero at the Mult floor: 100 × 0.05 = 5, a tenth is 0.5, and Damage is never below 1.
    expect(heroWith([tool(), gear({ damageFlat: 90, damagePct: -500 })]).damage).toBe(1);
  });

  it('cuts nothing but Damage, and says the hero can claim', () => {
    const plain = heroWith([gear({ lifeFlat: 40, defenseFlat: 10, dexterityFlat: 30 })]);
    const holding = heroWith([tool(), gear({ lifeFlat: 40, defenseFlat: 10, dexterityFlat: 30 })]);
    expect(holding.claim).toBe(true);
    expect(plain.claim).toBe(false);
    expect([holding.life, holding.defense, holding.dexterity, holding.accuracy, holding.critChance]).toEqual([plain.life, plain.defense, plain.dexterity, plain.accuracy, plain.critChance]);
  });
});

describe('equipment lookups', () => {
  it('reads the active loadout only, in slot order, skipping empty cells', () => {
    const state = game({}, { loadouts: [loadoutOf({ acc2: 'i003', weapon: 'i001', body: 'i002' }), loadoutOf({ weapon: 'i005' })], activeLoadout: 0 });
    expect(equippedItems(state, content).map((item) => item.id)).toEqual(['i001', 'i002', 'i003']);
    expect(equippedItems({ ...state, profile: { ...state.profile, activeLoadout: 1 } }, content).map((item) => item.id)).toEqual(['i005']);
    expect(activeLoadout(state)).toBe(state.profile.loadouts[0]);
  });

  it('derives the hero from the active loadout when no items are passed', () => {
    const state = game({}, { loadouts: [loadoutOf({ weapon: 'i001', body: 'i002' }), loadoutOf({})], activeLoadout: 0 });
    const hero = deriveHero(state, content);
    expect([hero.damage, hero.defense, hero.life]).toEqual([20, 10, 80]);
    const bare = deriveHero({ ...state, profile: { ...state.profile, activeLoadout: 1 } }, content);
    expect([bare.damage, bare.defense, bare.life]).toEqual([10, 5, 60]);
  });

  it('counts copies owned, 0 for an item never held', () => {
    const state = game({}, { items: { i003: 2 } });
    expect(owned(state, 'i003')).toBe(2);
    expect(owned(state, 'i001')).toBe(0);
  });
});

describe('energy (GDD 2.2, 5.8)', () => {
  it('starts at 20, plus 3 for each boss claimed', () => {
    expect(startingEnergy(game(), B)).toBe(20);
    expect(startingEnergy(game({}, { claimedBosses: ['e003'] }), B)).toBe(23);
    // All 18 bosses of v1 claimed: 74.
    expect(startingEnergy(game({}, { claimedBosses: Array.from({ length: 18 }, (_, index) => `e9${index}`) }), B)).toBe(74);
  });

  it('is starting energy, plus equipped accessories, plus paybacks, less energy spent', () => {
    expect(remainingEnergy(game(), content)).toBe(20);
    const state = game({ energySpent: 7, energyPaidBack: 3 }, { claimedBosses: ['e003', 'e900'], loadouts: [loadoutOf({ acc1: 'i006' }), loadoutOf({})] });
    expect(remainingEnergy(state, content)).toBe(20 + 6 + 2 + 3 - 7);
  });

  it('counts an energy accessory only while it is in the active loadout', () => {
    const state = game({}, { loadouts: [loadoutOf({}), loadoutOf({ acc3: 'i006' })], activeLoadout: 0 });
    expect(equippedEnergy(state, content)).toBe(0);
    expect(remainingEnergy(state, content)).toBe(20);
    const wearing = { ...state, profile: { ...state.profile, activeLoadout: 1 } };
    expect(equippedEnergy(wearing, content)).toBe(2);
    expect(remainingEnergy(wearing, content)).toBe(22);
    expect(deriveHero(wearing, content).energy).toBe(2);
  });

  it('adds the energy of every accessory worn', () => {
    const more: Content = { ...content, items: { ...content.items, i901: sampleItem('i901', 'accessory', { lines: { energy: 1 } }), i902: sampleItem('i902', 'accessory', { lines: { energy: 3 } }) } };
    const state = game({}, { loadouts: [loadoutOf({ acc1: 'i006', acc2: 'i901', acc5: 'i902' }), loadoutOf({})] });
    expect(equippedEnergy(state, more)).toBe(6);
    expect(remainingEnergy(state, more)).toBe(26);
  });

  it('is shown as 0, never negative', () => {
    expect(remainingEnergy(game({ energySpent: 20 }), content)).toBe(0);
    expect(remainingEnergy(game({ energySpent: 25 }), content)).toBe(0);
    // Spent with the accessory on, then taken off: the sum is −2 and shows as 0.
    const state = game({ energySpent: 22 }, { loadouts: [loadoutOf({}), loadoutOf({ acc1: 'i006' })], activeLoadout: 0 });
    expect(remainingEnergy(state, content)).toBe(0);
  });

  it('charges 1 a fight in Z1 to Z6 and 2 in Z7 and Z8', () => {
    const costs = ['Z1', 'Z2', 'Z3', 'Z4', 'Z5', 'Z6', 'Z7', 'Z8'].map((key) => {
      const zoned: Content = { ...content, zones: { ...content.zones, z01: { ...must(content.zones['z01'], 'zone z01'), balanceKey: key } } };
      return fightCost(sampleEnemy('e001'), zoned);
    });
    expect(costs).toEqual([1, 1, 1, 1, 1, 1, 2, 2]);
  });
});

describe('enemy stats (GDD 5.2, 5.4)', () => {
  it('gives a level 40 Z1 boss 1,920 life, 220 damage and 88 defense', () => {
    const boss = enemyOf({ level: 40, boss: true });
    expect(boss.stats.life).toBe(1920);
    expect(boss.stats.damage).toBe(220);
    expect(boss.stats.defense).toBe(88);
  });

  it('gives that boss 3,484 XP and 480 gold', () => {
    const boss = enemyOf({ level: 40, boss: true });
    // 0.6 × 44² × 3 = 3,484.8, rounded down. Gold is 40 × 4, times 3 for a boss.
    expect(boss.stats.xp).toBe(3484);
    expect(boss.stats.gold).toBe(480);
  });

  it('gives a normal level 40 Z1 enemy the plain zone figures', () => {
    expect(enemyOf({ level: 40 }).stats).toEqual({ life: 960, damage: 200, defense: 80, xp: 1161, gold: 160 });
  });

  it('uses each zone’s own coefficients', () => {
    expect(enemyOf({ level: 100, row: 'Z2' }).stats).toEqual({ life: 3400, damage: 550, defense: 240, xp: 6489, gold: 300 });
    expect(enemyOf({ level: 1000, row: 'Z3' }).stats).toEqual({ life: 48000, damage: 6000, defense: 2800, xp: 604809, gold: 2500 });
    expect(enemyOf({ level: 1000000, row: 'Z8' }).stats).toMatchObject({ life: 270000000, damage: 11000000, defense: 5500000, gold: 1000000 });
  });

  it('multiplies by the role and by the enemy’s own modifiers', () => {
    expect(enemyOf({ level: 10, role: 'bruiser' }).stats).toMatchObject({ life: 312, damage: 40, defense: 20 });
    expect(enemyOf({ level: 10, role: 'glass' }).stats).toMatchObject({ life: 180, damage: 62, defense: 20 }); // 62.5 rounded down
    expect(enemyOf({ level: 10, role: 'armored' }).stats).toMatchObject({ life: 240, damage: 45, defense: 30 });
    expect(enemyOf({ level: 10, mods: { life: 1.4, damage: 0.7, defense: 1.25 } }).stats).toMatchObject({ life: 336, damage: 35, defense: 25 });
    expect(enemyOf({ level: 10, role: 'bruiser', mods: { life: 0.75, damage: 1.25, defense: 1 }, boss: true }).stats).toMatchObject({ life: 468, damage: 55, defense: 22 });
  });

  it('leaves XP and gold alone when the role or the modifiers change', () => {
    const plain = enemyOf({ level: 20 });
    const shaped = enemyOf({ level: 20, role: 'glass', mods: { life: 1.4, damage: 1.4, defense: 0.7 } });
    expect([shaped.stats.xp, shaped.stats.gold]).toEqual([plain.stats.xp, plain.stats.gold]);
    expect(plain.stats.xp).toBe(345); // 0.6 × 24² = 345.6
  });

  it('gives a boss 3 times the XP and 3 times the gold of a normal enemy of its level', () => {
    expect(enemyOf({ level: 6, boss: true }).stats.xp).toBe(180);
    expect(enemyOf({ level: 6 }).stats.xp).toBe(60);
    expect(enemyOf({ level: 6, boss: true }).stats.gold).toBe(72);
    expect(enemyOf({ level: 6 }).stats.gold).toBe(24);
  });

  it('builds the sample world’s enemies from the same formula', () => {
    expect(sampleEnemy('e001').stats).toEqual({ life: 48, damage: 10, defense: 4, xp: 21, gold: 8 });
    expect(sampleEnemy('e003').stats).toEqual({ life: 480, damage: 55, defense: 22, xp: 352, gold: 120 });
  });

  it('hands a battle the enemy’s level, stats, tags and traits', () => {
    const enemy = sampleEnemy('e004');
    expect(combatantOf(enemy)).toEqual({ level: 50, life: enemy.stats.life, damage: enemy.stats.damage, defense: enemy.stats.defense, tags: ['t4', 'e1'], traits: { doubleAttack: 50, tripleAttack: 50, regen: 5, damageReduction: 20 } });
  });
});

describe('underlevel bonus (GDD 5.3)', () => {
  it('gives no bonus up to a ratio of 1.2', () => {
    for (const enemyLevel of [1, 50, 100, 119, 120]) expect(underlevelBonus(enemyLevel, 100, B)).toBe(1);
  });

  it('gives 3× from a ratio of 3.6', () => {
    for (const enemyLevel of [360, 361, 1000, 1000000]) expect(underlevelBonus(enemyLevel, 100, B)).toBe(3);
  });

  it('rises in a straight line between', () => {
    expect(underlevelBonus(180, 100, B)).toBeCloseTo(1.5, 12);
    expect(underlevelBonus(240, 100, B)).toBeCloseTo(2, 12);
    expect(underlevelBonus(300, 100, B)).toBeCloseTo(2.5, 12);
    expect(underlevelBonus(150, 100, B)).toBeCloseTo(1.25, 12);
    expect(underlevelBonus(200, 100, B)).toBeCloseTo(1 + 2 / 3, 12);
    let previous = 1;
    for (let enemyLevel = 100; enemyLevel <= 400; enemyLevel += 1) {
      const bonus = underlevelBonus(enemyLevel, 100, B);
      expect(bonus).toBeGreaterThanOrEqual(previous);
      previous = bonus;
    }
  });

  it('depends on the ratio alone', () => {
    expect(underlevelBonus(24, 10, B)).toBeCloseTo(underlevelBonus(24000, 10000, B), 12);
    expect(underlevelBonus(4, 1, B)).toBe(3);
  });
});

describe('what a win does to the hero’s level (the table in GDD 5.2)', () => {
  // Far from level 1, so the `+ 4` in the enemy XP formula and the rounding stop mattering.
  const HERO_LEVEL = 10000;

  const levelAfterWin = (ratio: number): number => {
    const hero = heroAtLevel(HERO_LEVEL);
    expect(hero.level).toBe(HERO_LEVEL);
    const enemy = enemyOf({ level: ratio * HERO_LEVEL, row: 'Z4' });
    return levelForXp(xpForLevel(HERO_LEVEL, B.xp.perLevel) + xpReward(enemy, hero, 0, B), B.xp.perLevel);
  };

  it.each([
    [0.5, 1.015],
    [1, 1.058],
    [1.5, 1.157],
    [2, 1.342],
    [3, 1.924],
  ])('multiplies the level by about the listed figure at r = %f', (ratio, listed) => {
    expect(Math.abs(levelAfterWin(ratio) / HERO_LEVEL - listed)).toBeLessThanOrEqual(0.001);
  });

  it('lands near 60% of the enemy’s level from r = 3.6', () => {
    // sqrt(1 + 0.36 r²) ÷ r: 66% at 3.6, 61% at 10, 60% from there on.
    expect(levelAfterWin(3.6) / (3.6 * HERO_LEVEL)).toBeCloseTo(0.661, 2);
    expect(levelAfterWin(10) / (10 * HERO_LEVEL)).toBeCloseTo(0.608, 2);
    expect(levelAfterWin(50) / (50 * HERO_LEVEL)).toBeCloseTo(0.6, 2);
    expect(levelAfterWin(120) / (120 * HERO_LEVEL)).toBeCloseTo(0.6, 2);
  });
});

describe('goldAt and prices (GDD 5.7)', () => {
  it('is the level times the gold per level of the band that holds it, at both edges of every band', () => {
    const cases: Array<[number, number]> = [
      [1, 4],
      [40, 160],
      [41, 123],
      [250, 750],
      [251, 627.5],
      [1500, 3750],
      [1501, 3002],
      [8000, 16000],
      [8001, 12801.6],
      [40000, 64000],
      [40001, 52001.3],
      [150000, 195000],
      [150001, 165001.1],
      [450000, 495000],
      [450001, 450001],
      [1200000, 1200000],
    ];
    for (const [enemyLevel, gold] of cases) expect(goldAt(enemyLevel, B)).toBeCloseTo(gold, 6);
  });

  it('uses the last band’s rate past the last band, and the first band’s under the first', () => {
    // QUESTION: GDD 5.7 defines goldAt only inside the bands. Past level 1,200,000 the code keeps the last
    // band's gold per level, and under level 1 the first band's.
    expect(goldAt(1200001, B)).toBe(1200001);
    expect(goldAt(5000000, B)).toBe(5000000);
    expect(goldAt(0, B)).toBe(0);
    expect(zoneRowFor(0, B)).toBe(zoneRow('Z1'));
    expect(zoneRowFor(1e9, B)).toBe(zoneRow('Z8'));
  });

  it('finds the band whatever order the zone table is written in', () => {
    const reversed: Balance = { ...B, zones: Object.fromEntries(Object.entries(B.zones).reverse()) };
    for (const enemyLevel of [0, 1, 40, 41, 250, 251, 1500, 1501, 8000, 8001, 40000, 40001, 42000, 150000, 150001, 450000, 450001, 1200000, 9999999]) {
      expect(goldAt(enemyLevel, reversed)).toBe(goldAt(enemyLevel, B));
    }
  });

  it('prices a shop item at k × goldAt(item level), rounded down', () => {
    expect(shopPrice(must(content.items['i001'], 'item'), B)).toBe(96); // 8 × 3 × 4
    expect(shopPrice(must(content.items['i006'], 'item'), B)).toBe(120); // 6 × 5 × 4
    expect(shopPrice(sampleItem('i900', 'weapon', { level: 40, priceFactor: 60 }), B)).toBe(9600);
    expect(shopPrice(sampleItem('i900', 'weapon', { level: 41, priceFactor: 7.3 }), B)).toBe(897); // 7.3 × 123 = 897.9
    expect(shopPrice(sampleItem('i900', 'weapon', { level: 42000, priceFactor: 6 }), B)).toBe(327600);
  });

  it('has no price for an item that is not sold', () => {
    expect(shopPrice(must(content.items['i002'], 'item'), B)).toBeNull();
    expect(shopPrice(must(content.items['i005'], 'item'), B)).toBeNull();
  });

  const withLoadouts = (count: number): GameState => game({}, { loadouts: Array.from({ length: count }, () => emptyLoadout()) });

  it('prices the third loadout at 60 × goldAt(1,000)', () => {
    expect(loadoutPrice(withLoadouts(2), B)).toBe(60 * 1000 * 2.5);
    expect(loadoutPrice(withLoadouts(2), B)).toBe(150000);
  });

  it('prices the fourth and fifth at 60 × goldAt(30,000) and 60 × goldAt(300,000), and sells no sixth', () => {
    expect(loadoutPrice(withLoadouts(3), B)).toBe(2880000);
    expect(loadoutPrice(withLoadouts(4), B)).toBe(19800000);
    expect(loadoutPrice(withLoadouts(5), B)).toBeNull();
    expect(loadoutPrice(withLoadouts(6), B)).toBeNull();
  });
});

describe('hit chance (GDD 3.1)', () => {
  it('rates an enemy at its level plus 100', () => {
    expect(enemyRating(1, B)).toBe(101);
    expect(enemyRating(42000, B)).toBe(42100);
  });

  it('is 90% when Accuracy equals the enemy rating, at any level', () => {
    for (const enemyLevel of [1, 2, 40, 250, 42000, 1200000]) expect(hitChance(enemyLevel + 100, enemyLevel, B)).toBeCloseTo(0.9, 12);
  });

  it('is about 97% at Accuracy = 1.74 × the rating', () => {
    expect(hitChance(1.74 * 140, 40, B)).toBeCloseTo(0.967, 3);
    expect(nearest(hitChance(1.74 * 42100, 42000, B) * 100)).toBe(97);
  });

  it('follows the square law between', () => {
    expect(hitChance(280, 40, B)).toBeCloseTo(0.975, 12); // twice the rating: 1 − 0.1 ÷ 4
    expect(hitChance(70, 40, B)).toBeCloseTo(0.6, 12); // half the rating: 1 − 0.1 × 4
    expect(hitChance(140 / 3, 40, B)).toBeCloseTo(0.1, 9); // a third: 1 − 0.1 × 9
  });

  it('never falls below 5%', () => {
    expect(hitChance(14, 40, B)).toBe(0.05);
    expect(hitChance(1, 1200000, B)).toBe(0.05);
    expect(hitChance(140 / 3.2, 40, B)).toBe(0.05); // the bare formula would give −2.4%
  });

  it('never passes 100%', () => {
    for (const accuracy of [1e4, 1e9, 1e15, 1e300]) {
      const chance = hitChance(accuracy, 1, B);
      expect(chance).toBeLessThanOrEqual(1);
      expect(chance).toBeGreaterThan(0.9999);
    }
  });

  it('treats an Accuracy under 1 as 1', () => {
    expect(hitChance(0, 1, B)).toBe(hitChance(1, 1, B));
    expect(hitChance(-50, 1, B)).toBe(hitChance(1, 1, B));
  });

  it('never falls as Accuracy rises', () => {
    let previous = 0;
    for (let accuracy = 1; accuracy < 5000; accuracy += 7) {
      const chance = hitChance(accuracy, 400, B);
      expect(chance).toBeGreaterThanOrEqual(previous);
      previous = chance;
    }
  });
});

describe('dodge chance (GDD 3.1)', () => {
  // Evasion as a multiple q of the rating of a level 100 enemy, which is 200.
  const atQ = (q: number): number => dodgeChance(q * 200, 100, B);

  it('is 10% at q = 1', () => {
    expect(atQ(1)).toBeCloseTo(0.1, 12);
    expect(dodgeChance(101, 1, B)).toBeCloseTo(0.1, 12);
    expect(dodgeChance(42100, 42000, B)).toBeCloseTo(0.1, 12);
  });

  it('is linear below q = 1', () => {
    expect(atQ(0.5)).toBeCloseTo(0.05, 12);
    expect(atQ(0.25)).toBeCloseTo(0.025, 12);
    expect(atQ(0.9)).toBeCloseTo(0.09, 12);
    expect(atQ(0.01)).toBeCloseTo(0.001, 12);
  });

  it('is about 51% at q = 37 and about 56% at q = 51, within 2 points', () => {
    expect(Math.abs(atQ(37) * 100 - 51)).toBeLessThanOrEqual(2);
    expect(Math.abs(atQ(51) * 100 - 56)).toBeLessThanOrEqual(2);
    // 0.10 + 0.26 × log10(q) exactly.
    expect(atQ(37)).toBeCloseTo(0.5077324482574187, 12);
    expect(atQ(51)).toBeCloseTo(0.5439682457854635, 12);
    expect(atQ(10)).toBeCloseTo(0.36, 12);
    expect(atQ(100)).toBeCloseTo(0.62, 12);
  });

  it('is capped at 80%', () => {
    expect(atQ(400)).toBeLessThan(0.8);
    expect(atQ(500)).toBe(0.8);
    expect(atQ(1000)).toBe(0.8);
    expect(atQ(1e9)).toBe(0.8);
  });

  it('has no step at q = 1 and never falls as Evasion rises', () => {
    expect(atQ(1.000001) - atQ(0.999999)).toBeLessThan(1e-6);
    let previous = 0;
    for (let q = 0.01; q < 700; q *= 1.02) {
      const chance = atQ(q);
      expect(chance).toBeGreaterThanOrEqual(previous);
      previous = chance;
    }
  });

  it('treats an Evasion under 1 as 1', () => {
    expect(dodgeChance(0, 100, B)).toBe(dodgeChance(1, 100, B));
    expect(dodgeChance(0, 100, B)).toBeCloseTo(0.0005, 12);
  });
});

describe('rewards (GDD 5.5)', () => {
  it('pays enemy XP × underlevel bonus × XP Bonus × mark, rounded down once', () => {
    const enemy = sampleEnemy('e002'); // level 4, so a ratio of 4 to a level 1 hero: the full 3×
    expect(enemy.stats.xp).toBe(38);
    expect(xpReward(enemy, heroWith(), 0, B)).toBe(114);
    expect(xpReward(enemy, heroWith([gear({ xpBonus: 50 })]), 0, B)).toBe(171);
    expect(xpReward(enemy, heroWith([gear({ xpBonus: 50 })]), 100, B)).toBe(342);
    expect(xpReward(enemy, heroWith(), 200, B)).toBe(342);
    // A level 2 hero: ratio 2, bonus 1 + 2 × 0.8 ÷ 2.4. 38 × 1.6667 = 63.33.
    expect(xpReward(enemy, heroAtLevel(2), 0, B)).toBe(63);
    // 63.33 × 1.25 = 79.17: one rounding at the end, not 63 × 1.25 = 78.75.
    expect(xpReward(enemy, heroAtLevel(2, [gear({ xpBonus: 25 })]), 0, B)).toBe(79);
    // A hero far above it gets the plain figure.
    expect(xpReward(enemy, heroAtLevel(40), 0, B)).toBe(38);
  });

  it('pays enemy gold × Gold Bonus × mark, rounded down', () => {
    const enemy = sampleEnemy('e002');
    expect(enemy.stats.gold).toBe(16);
    expect(goldReward(enemy, heroWith(), 0)).toBe(16);
    expect(goldReward(enemy, heroWith([gear({ luckFlat: 1000 })]), 0)).toBe(24);
    expect(goldReward(enemy, heroWith([gear({ luckFlat: 1000 })]), 200)).toBe(72);
    expect(goldReward(enemy, heroWith([gear({ goldBonus: 10 })]), 0)).toBe(17); // 17.6
    expect(goldReward(enemy, heroWith(), 100)).toBe(32);
  });

  it('takes no reward multiplier below 0, whatever negative lines are worn', () => {
    const hero = heroWith([gear({ xpBonus: -250, goldBonus: -250, dropBonus: -250 })]);
    expect(xpReward(sampleEnemy('e002'), hero, 0, B)).toBe(0);
    expect(goldReward(sampleEnemy('e002'), hero, 0)).toBe(0);
    expect(dropChance(50, sampleEnemy('e002'), hero, 200, B)).toBe(0);
  });
});

describe('the Luck drop multiplier (GDD 4.2)', () => {
  it('is 1 up to q = 1', () => {
    expect(luckDropMult(0, 50, B)).toBe(1);
    expect(luckDropMult(25, 50, B)).toBe(1);
    expect(luckDropMult(50, 50, B)).toBe(1);
  });

  it('is 1.5 at q = 10 and 5 at q = 350 and beyond', () => {
    expect(luckDropMult(500, 50, B)).toBeCloseTo(1.5, 12);
    expect(luckDropMult(17500, 50, B)).toBeCloseTo(5, 12);
    expect(luckDropMult(17501, 50, B)).toBe(5);
    expect(luckDropMult(1e12, 50, B)).toBe(5);
  });

  it('runs in straight lines on a log scale between those points', () => {
    // Halfway from 1 to 10 on a log scale is √10; halfway from 10 to 350 is √3500.
    expect(luckDropMult(Math.sqrt(10) * 50, 50, B)).toBeCloseTo(1.25, 9);
    expect(luckDropMult(Math.sqrt(3500) * 50, 50, B)).toBeCloseTo(3.25, 9);
    // q = 100: 1.5 + 3.5 ÷ log10(35).
    expect(luckDropMult(5000, 50, B)).toBeCloseTo(3.766739482632552, 9);
    // A tenth of the way from 1 to 10: q = 10^0.1.
    expect(luckDropMult(1.2589254117941673 * 50, 50, B)).toBeCloseTo(1.05, 9);
  });

  it('depends on Luck ÷ enemy level alone, and never falls as Luck rises', () => {
    expect(luckDropMult(40, 4, B)).toBeCloseTo(luckDropMult(40000, 4000, B), 12);
    let previous = 1;
    for (let luck = 1; luck < 1e6; luck *= 1.07) {
      const mult = luckDropMult(luck, 100, B);
      expect(mult).toBeGreaterThanOrEqual(previous);
      expect(mult).toBeLessThanOrEqual(5);
      previous = mult;
    }
  });
});

describe('drop chance (GDD 5.5)', () => {
  const enemy = sampleEnemy('e002'); // level 4

  it('is the base chance for a hero with no bonus', () => {
    expect(dropChance(5, enemy, heroWith(), 0, B)).toBeCloseTo(0.05, 12);
    expect(dropChance(1.25, enemy, heroWith(), 0, B)).toBeCloseTo(0.0125, 12);
  });

  it('multiplies base chance, Drop Bonus, the Luck multiplier and the mark', () => {
    // Luck 40 against level 4 is q = 10, so ×1.5, and too little Luck to add any Drop Bonus.
    const lucky = heroWith([gear({ luckFlat: 40 })]);
    expect(lucky.dropBonus).toBe(0);
    expect(dropChance(10, enemy, lucky, 0, B)).toBeCloseTo(0.15, 12);
    expect(dropChance(10, enemy, heroWith([gear({ dropBonus: 100 })]), 0, B)).toBeCloseTo(0.2, 12);
    expect(dropChance(10, enemy, heroWith(), 200, B)).toBeCloseTo(0.3, 12);
    expect(dropChance(10, enemy, heroWith([gear({ luckFlat: 40, dropBonus: 100 })]), 100, B)).toBeCloseTo(0.6, 12);
    // Luck 1,000 against a level 1,000 enemy: +40% Drop Bonus and no Luck multiplier.
    expect(dropChance(5, enemyOf({ level: 1000, row: 'Z3' }), heroWith([gear({ luckFlat: 1000 })]), 0, B)).toBeCloseTo(0.07, 12);
  });

  it('is capped at 100%', () => {
    expect(dropChance(50, enemy, heroWith(), 200, B)).toBe(1);
    expect(dropChance(100, enemy, heroWith(), 0, B)).toBe(1);
    expect(dropChance(100, enemy, heroWith([gear({ luckFlat: 100000, dropBonus: 500 })]), 200, B)).toBe(1);
  });

  it('stops a drop once the copy cap is reached (GDD 7.3)', () => {
    // e002 holds i003 (cap 3) and i008 (cap 1).
    const held = (items: Record<string, number>): string[] => dropsHeld(game({}, { items }), enemy, content).map((drop) => drop.item);
    expect(held({})).toEqual(['i003', 'i008']);
    expect(held({ i003: 2 })).toEqual(['i003', 'i008']);
    expect(held({ i003: 3 })).toEqual(['i008']);
    expect(held({ i003: 3, i008: 1 })).toEqual([]);
    expect(held({ i008: 1 })).toEqual(['i003']);
  });
});

describe('Salvage (GDD 7.4)', () => {
  const beaten = (...ids: string[]): GameState['profile']['bestiary'] => Object.fromEntries(ids.map((id) => [id, { timesBeaten: 1 }]));

  it('gives 66% at 3,750,974 gold with a strongest kill of level 42,000', () => {
    const state = game({ gold: 3750974, strongestBeaten: 42000 });
    // 36 × 42,000 × 1.3 = 1,965,600, so 3,750,974 ÷ 5,716,574.
    expect(salvageChance(state, B, false)).toBeCloseTo(0.6561576916523778, 12);
    expect(nearest(salvageChance(state, B, false) * 100)).toBe(66);
    // QUESTION: as with crit at Dexterity 1,575, "66%" is the nearest whole percent. The figure is 65.6%, which a
    // screen that cuts (GDD 6.4) shows as 65%.
    expect(Math.floor(salvageChance(state, B, false) * 100)).toBe(65);
  });

  it('is gold ÷ (gold + 36 × goldAt(strongest kill))', () => {
    // Strongest kill level 10: goldAt is 40, so 1,440 gold is an even chance.
    expect(salvageChance(game({ gold: 1440, strongestBeaten: 10 }), B, false)).toBeCloseTo(0.5, 12);
    expect(salvageChance(game({ gold: 160, strongestBeaten: 10 }), B, false)).toBeCloseTo(0.1, 12);
    expect(salvageChance(game({ gold: 12960, strongestBeaten: 10 }), B, false)).toBeCloseTo(0.9, 12);
    expect(salvageChance(game({ gold: 0, strongestBeaten: 10 }), B, false)).toBe(0);
  });

  it('needs more gold for the same chance as the run goes higher inside a zone', () => {
    const chanceAt = (strongestBeaten: number): number => salvageChance(game({ gold: 5000, strongestBeaten }), B, false);
    expect(chanceAt(20)).toBeLessThan(chanceAt(10));
    expect(chanceAt(40)).toBeLessThan(chanceAt(20));
    expect(chanceAt(250)).toBeLessThan(chanceAt(41));
  });

  it('doubles with the gem boost, to at most 100%', () => {
    expect(salvageChance(game({ gold: 160, strongestBeaten: 10 }), B, true)).toBeCloseTo(0.2, 12);
    expect(salvageChance(game({ gold: 1440, strongestBeaten: 10 }), B, true)).toBe(1);
    expect(salvageChance(game({ gold: 3750974, strongestBeaten: 42000 }), B, true)).toBe(1);
    expect(salvageChance(game({ gold: 0, strongestBeaten: 10 }), B, true)).toBe(0);
  });

  it('offers items owned in no copy, dropped by an enemy beaten at least once ever, at or below this run’s strongest kill', () => {
    // e001 (level 2) drops i002 and i004; e002 (level 4) drops i003 and i008; e003 (level 10) drops i005.
    const all = beaten('e001', 'e002', 'e003');
    expect(salvagePool(game({ strongestBeaten: 10 }, { bestiary: all }), content)).toEqual(['i002', 'i003', 'i004', 'i005', 'i008']);
    // At or below this run's strongest kill: level 4 is in at 4 and out at 3.
    expect(salvagePool(game({ strongestBeaten: 4 }, { bestiary: all }), content)).toEqual(['i002', 'i003', 'i004', 'i008']);
    expect(salvagePool(game({ strongestBeaten: 3 }, { bestiary: all }), content)).toEqual(['i002', 'i004']);
    expect(salvagePool(game({ strongestBeaten: 1 }, { bestiary: all }), content)).toEqual([]);
    expect(salvagePool(game({ strongestBeaten: 0 }, { bestiary: all }), content)).toEqual([]);
  });

  it('leaves out an item with any copy owned, even one of three', () => {
    const state = game({ strongestBeaten: 10 }, { bestiary: beaten('e001', 'e002', 'e003'), items: { i003: 1, i004: 1 } });
    expect(salvagePool(state, content)).toEqual(['i002', 'i005', 'i008']);
  });

  it('leaves out the drops of an enemy that was fought but never beaten', () => {
    const state = game({ strongestBeaten: 10 }, { bestiary: { e001: { timesBeaten: 3 }, e002: { timesBeaten: 0 } } });
    expect(salvagePool(state, content)).toEqual(['i002', 'i004']);
  });

  it('counts a win from any earlier run, since the bestiary is kept', () => {
    // Nothing beaten this run but a level 4 enemy; e001 was beaten on an earlier run only.
    const state = game({ strongestBeaten: 4, bossesBeaten: [] }, { bestiary: beaten('e001') });
    expect(salvagePool(state, content)).toEqual(['i002', 'i004']);
  });

  it('never offers an item nothing drops', () => {
    const state = game({ strongestBeaten: 1000 }, { bestiary: beaten('e001', 'e002', 'e003', 'e004') });
    expect(salvagePool(state, content)).toEqual(['i002', 'i003', 'i004', 'i005', 'i007', 'i008']);
    expect(salvagePool(state, content)).not.toContain('i001');
    expect(salvagePool(state, content)).not.toContain('i006');
  });

  it('splits the pool into three bands by level against this run’s strongest kill', () => {
    // Strongest kill 50: over 25 is the top band, 5 to 25 the middle, under 5 the bottom.
    const state = game({ strongestBeaten: 50 }, { bestiary: beaten('e001', 'e002', 'e003', 'e004') });
    expect(salvageBands(state, content)).toEqual({ high: 1, mid: 1, low: 4 });
    const bands = salvageBands(state, content);
    expect(bands.high + bands.mid + bands.low).toBe(salvagePool(state, content).length);
    // Strongest kill 12: level 10 is the top band, level 4 and level 2 the middle.
    expect(salvageBands(game({ strongestBeaten: 12 }, { bestiary: beaten('e001', 'e002', 'e003') }), content)).toEqual({ high: 1, mid: 4, low: 0 });
    // Owned items leave their band.
    expect(salvageBands(game({ strongestBeaten: 50 }, { bestiary: beaten('e001', 'e002', 'e003', 'e004'), items: { i007: 1, i002: 1 } }), content)).toEqual({ high: 0, mid: 1, low: 3 });
  });

  it('puts an item at exactly half, or exactly a tenth, of the strongest kill in the middle band', () => {
    // QUESTION: GDD 7.4 says "within half", "between a tenth and a half" and "below a tenth", which does not
    // say where the two edges fall. The code puts both in the middle band.
    const state = game({ strongestBeaten: 20 }, { bestiary: beaten('e001', 'e003') });
    // e003 is level 10, exactly half of 20; e001 is level 2, exactly a tenth.
    expect(salvageBands(state, content)).toEqual({ high: 0, mid: 3, low: 0 });
  });

  it('bands an item by the strongest qualifying enemy that drops it', () => {
    const extra = enemyOf({ level: 30 });
    const wider = indexContent({
      ...content,
      enemyOrder: [...content.enemyOrder, 'e900'],
      enemies: { ...content.enemies, e900: { ...extra, drops: [{ item: 'i002', chance: 5 }] } },
    });
    // i002 falls from e001 (level 2) and from e900 (level 30).
    const both = game({ strongestBeaten: 40 }, { bestiary: beaten('e001', 'e900') });
    expect(salvageBands(both, wider)).toEqual({ high: 1, mid: 0, low: 1 });
    // With e900 never beaten, i002 still qualifies through e001, in the bottom band.
    const one = game({ strongestBeaten: 40 }, { bestiary: beaten('e001') });
    expect(salvagePool(one, wider)).toEqual(['i002', 'i004']);
    expect(salvageBands(one, wider)).toEqual({ high: 0, mid: 0, low: 2 });
    // With e900 beaten once but above this run's strongest kill, the same.
    expect(salvageBands(game({ strongestBeaten: 29 }, { bestiary: beaten('e001', 'e900') }), wider)).toEqual({ high: 0, mid: 0, low: 2 });
  });
});
