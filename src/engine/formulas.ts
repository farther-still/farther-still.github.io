// Every formula in GDD sections 2, 4, 5 and 7, as pure functions of state, content and the balance table.
// No number appears here but 0, 1, 2 and 100: the rest come from data/balance.json.

import { levelForXp } from './math/level';
import { log10 } from './math/log10';
import { sumPoints } from './state';
import type { GameState } from './state';
import { LINE_KEYS, SLOT_IDS, STAT_KEYS, TAGS } from './types';
import type { Balance, Combatant, Content, CoreStat, EnemyDef, EnemyDrop, EnemyId, EnemyStats, HeroStats, ItemDef, ItemId, LineKey, Loadout, StatKey, TagValues, ZoneBalance } from './types';

const clamp = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value));

// ---- level and stat points (GDD 5.1) ----

export const level = (state: GameState, balance: Balance): number => levelForXp(state.run.xp, balance.xp.perLevel);

export const pointsEarned = (state: GameState, balance: Balance): number =>
  balance.hero.pointsPerLevel * (level(state, balance) - 1) + state.run.growthPointsEarned;

/** Never negative: a run that has spent more than it has earned is repaired at load (ARCHITECTURE 7.3). */
export const unspentPoints = (state: GameState, balance: Balance): number =>
  Math.max(0, pointsEarned(state, balance) - sumPoints(state.run.pointsSpent));

// ---- equipment ----

/** Copies owned. Only the save's own entries count: an ordinary object would also answer to names such as `constructor`. */
export const owned = (state: GameState, item: ItemId): number => (Object.hasOwn(state.profile.items, item) ? (state.profile.items[item] ?? 0) : 0);

export const activeLoadout = (state: GameState): Loadout | undefined => state.profile.loadouts[state.profile.activeLoadout];

/** The items in the active loadout, one entry per filled cell, in slot order. */
export const equippedItems = (state: GameState, content: Content): ItemDef[] => {
  const loadout = activeLoadout(state);
  if (loadout === undefined) return [];
  const items: ItemDef[] = [];
  for (const slot of SLOT_IDS) {
    const id = loadout.slots[slot];
    const item = id === null ? undefined : content.items[id];
    if (item !== undefined) items.push(item);
  }
  return items;
};

const zeroTags = (): TagValues => ({ e1: 0, e2: 0, e3: 0, t1: 0, t2: 0, t3: 0, t4: 0 });

// "Highest wins" for these two; every other line adds (GDD 4.3).
const HIGHEST: readonly LineKey[] = ['lastStand', 'growth'];

type Totals = { lines: Record<LineKey, number>; resist: TagValues; versus: TagValues; claim: boolean };

const totalsOf = (items: readonly ItemDef[]): Totals => {
  const lines = {} as Record<LineKey, number>;
  for (const key of LINE_KEYS) lines[key] = 0;
  const resist = zeroTags();
  const versus = zeroTags();
  let claim = false;
  for (const item of items) {
    for (const key of LINE_KEYS) {
      const value = item.lines[key] ?? 0;
      lines[key] = HIGHEST.includes(key) ? Math.max(lines[key], value) : lines[key] + value;
    }
    for (const tag of TAGS) {
      resist[tag] += item.resist[tag] ?? 0;
      versus[tag] += item.versus[tag] ?? 0;
    }
    if (item.claim && item.kind === 'weapon') claim = true;
  }
  return { lines, resist, versus, claim };
};

const FLAT: Record<StatKey, LineKey> = { life: 'lifeFlat', damage: 'damageFlat', defense: 'defenseFlat', dexterity: 'dexterityFlat', luck: 'luckFlat' };
const PCT: Record<StatKey, LineKey> = { life: 'lifePct', damage: 'damagePct', defense: 'defensePct', dexterity: 'dexterityPct', luck: 'luckPct' };
// Life, Damage and Defense are never below 1; Dexterity and Luck can be 0 (GDD 4.1).
const FLOOR_OF: Record<StatKey, number> = { life: 1, damage: 1, defense: 1, dexterity: 0, luck: 0 };

/** A percentage bonus as a multiplier that never goes below 0 (GDD 4.3). */
const bonusMult = (percent: number): number => Math.max(0, 1 + percent / 100);

/** The part a stat adds once it passes its pivot: `perDecade × log10(stat ÷ pivot)`, never negative. */
const decades = (stat: number, pivot: number, perDecade: number): number =>
  stat > pivot ? perDecade * log10(stat / pivot) : 0;

/** Final stats from points, gear and Growth (GDD section 4). `items` defaults to the active loadout. */
export const deriveHero = (state: GameState, content: Content, items: readonly ItemDef[] = equippedItems(state, content)): HeroStats => {
  const { hero } = content.balance;
  const totals = totalsOf(items);
  const { lines } = totals;

  // Mult is carried in whole percent until the last division. As a multiplier, `1 + 16 ÷ 100` is a hair under
  // 1.16 in a double, which would turn Base 25 into 28 where `Final = Base × Mult` is 29 (GDD 4.1).
  const core = {} as Record<StatKey, CoreStat>;
  const percent = {} as Record<StatKey, number>;
  for (const key of STAT_KEYS) {
    const base = hero.start[key] + state.run.pointsSpent[key] * hero.perPoint[key] + lines[FLAT[key]];
    percent[key] = Math.max(hero.multFloor * 100, 100 + lines[PCT[key]]);
    core[key] = { base, mult: percent[key] / 100, final: Math.max(FLOOR_OF[key], Math.floor((base * percent[key]) / 100)) };
  }
  if (totals.claim) {
    // The tool cuts Damage after everything else, so no other gear can buy the cut back (GDD 2.3). The share kept
    // stays in whole percent too: `1 − 90 ÷ 100` is a hair under a tenth, which would turn Damage 20 into 1.
    const kept = Math.max(0, 100 - content.balance.claim.damageCutPct);
    core.damage = { ...core.damage, final: Math.max(FLOOR_OF.damage, Math.floor((core.damage.base * percent.damage * kept) / (100 * 100))) };
  }

  const dexterity = core.dexterity.final;
  const luck = core.luck.final;
  return {
    level: level(state, content.balance),
    core,
    life: core.life.final,
    damage: core.damage.final,
    defense: core.defense.final,
    dexterity,
    luck,
    accuracy: Math.max(1, (hero.accuracyBase + dexterity) * bonusMult(lines.accuracyPct)),
    evasion: Math.max(1, (hero.evasionBase + hero.evasionPerDexterity * dexterity) * bonusMult(lines.evasionPct)),
    critChance: clamp((hero.critChanceBase + decades(dexterity, hero.dexterityPivot, hero.critChancePerDecade) + lines.critChance) / 100, 0, 1),
    critDamage: Math.max(0, (hero.critDamageBase + decades(dexterity, hero.dexterityPivot, hero.critDamagePerDecade) + lines.critDamage) / 100),
    extraHit: clamp(lines.extraHit / 100, 0, 1),
    extraAttack: clamp(lines.extraAttack / 100, 0, 1),
    extraTurn: clamp(lines.extraTurn / 100, 0, 1),
    xpBonus: Math.max(-100, lines.xpBonus),
    goldBonus: Math.max(-100, decades(luck, hero.luckPivot, hero.goldBonusPerDecade) + lines.goldBonus),
    dropBonus: Math.max(-100, decades(luck, hero.luckPivot, hero.dropBonusPerDecade) + lines.dropBonus),
    lifeRegen: Math.max(0, lines.lifeRegen),
    reflect: Math.max(0, lines.reflect),
    lastStand: Math.max(0, Math.floor(lines.lastStand)),
    growth: Math.max(0, Math.floor(lines.growth)),
    moveSpeed: clamp(lines.moveSpeed, 0, hero.moveSpeedCap),
    energy: Math.max(0, Math.floor(lines.energy)),
    resist: totals.resist,
    versus: totals.versus,
    claim: totals.claim,
  };
};

// ---- energy (GDD 2.2, 5.8) ----

export const startingEnergy = (state: GameState, balance: Balance): number =>
  balance.energy.base + balance.energy.perClaim * state.profile.claimedBosses.length;

/** Energy accessories count only while equipped (GDD 2.2), so this reads the active loadout. */
export const equippedEnergy = (state: GameState, content: Content): number =>
  Math.max(0, Math.floor(equippedItems(state, content).reduce((total, item) => total + (item.lines.energy ?? 0), 0)));

export const remainingEnergy = (state: GameState, content: Content): number =>
  Math.max(0, startingEnergy(state, content.balance) + equippedEnergy(state, content) + state.run.energyPaidBack - state.run.energySpent);

// ---- zones, enemies and prices (GDD 5.4, 5.7) ----

export const zoneBalance = (content: Content, zone: string): ZoneBalance | undefined =>
  content.balance.zones[content.zones[zone]?.balanceKey ?? ''];

/** The row of the zone table whose level band holds `enemyLevel`: the highest band that starts at or below it, or the lowest band of all for a level under every band. */
export const zoneRowFor = (enemyLevel: number, balance: Balance): ZoneBalance | undefined => {
  let chosen: ZoneBalance | undefined;
  for (const row of Object.values(balance.zones)) {
    if (chosen === undefined) {
      chosen = row;
      continue;
    }
    const rowFits = enemyLevel >= row.levelMin;
    const chosenFits = enemyLevel >= chosen.levelMin;
    if (rowFits ? !chosenFits || row.levelMin > chosen.levelMin : !chosenFits && row.levelMin < chosen.levelMin) chosen = row;
  }
  return chosen;
};

/** `L × gold per level` for the zone whose band contains `L`, with no boss or enemy modifiers (GDD 5.7). */
export const goldAt = (enemyLevel: number, balance: Balance): number => enemyLevel * (zoneRowFor(enemyLevel, balance)?.goldPerLevel ?? 0);

type EnemyShape = Pick<EnemyDef, 'level' | 'role' | 'mods' | 'boss'>;

/** An enemy's stats: `level × zone coefficient × role modifier × enemy modifier`, with the boss factors (GDD 5.2, 5.4). */
export const enemyStats = (enemy: EnemyShape, zone: ZoneBalance, balance: Balance): EnemyStats => {
  const role = balance.enemy.roles[enemy.role];
  const boss = enemy.boss ? balance.enemy.boss : { life: 1, damage: 1, defense: 1, gold: 1 };
  const xpLevel = enemy.level + balance.xp.enemyLevelOffset;
  return {
    life: Math.max(1, Math.floor(enemy.level * zone.lifePerLevel * role.life * enemy.mods.life * boss.life)),
    damage: Math.max(1, Math.floor(enemy.level * zone.damagePerLevel * role.damage * enemy.mods.damage * boss.damage)),
    defense: Math.max(0, Math.floor(enemy.level * zone.defensePerLevel * role.defense * enemy.mods.defense * boss.defense)),
    xp: Math.floor(balance.xp.enemyFactor * xpLevel * xpLevel * (enemy.boss ? balance.xp.bossMult : 1)),
    gold: Math.floor(enemy.level * zone.goldPerLevel * boss.gold),
  };
};

export const combatantOf = (enemy: EnemyDef): Combatant => ({
  level: enemy.level,
  life: enemy.stats.life,
  damage: enemy.stats.damage,
  defense: enemy.stats.defense,
  tags: enemy.tags,
  traits: enemy.traits,
});

export const fightCost = (enemy: EnemyDef, content: Content): number => zoneBalance(content, enemy.zone)?.fightCost ?? 1;

/** A shop item's price, or null for an item that is not sold. */
export const shopPrice = (item: ItemDef, balance: Balance): number | null =>
  item.priceFactor === null ? null : Math.floor(item.priceFactor * goldAt(item.level, balance));

/** The price of the next loadout, or null when every loadout has been bought. */
export const loadoutPrice = (state: GameState, balance: Balance): number | null => {
  const { free, max, priceFactor, priceLevels } = balance.loadouts;
  const count = state.profile.loadouts.length;
  const atLevel = priceLevels[count - free];
  if (count >= max || atLevel === undefined) return null;
  return Math.floor(priceFactor * goldAt(atLevel, balance));
};

// ---- battle chances (GDD 3.1) ----

export const enemyRating = (enemyLevel: number, balance: Balance): number => enemyLevel + balance.battle.ratingBase;

export const hitChance = (accuracy: number, enemyLevel: number, balance: Balance): number => {
  const ratio = enemyRating(enemyLevel, balance) / Math.max(1, accuracy);
  return clamp(1 - balance.battle.missFactor * ratio * ratio, balance.battle.hitFloor, 1);
};

export const dodgeChance = (evasion: number, enemyLevel: number, balance: Balance): number => {
  const q = Math.max(1, evasion) / enemyRating(enemyLevel, balance);
  const chance = q < 1 ? balance.battle.dodgeBase * q : balance.battle.dodgeBase + balance.battle.dodgePerDecade * log10(q);
  return clamp(chance, 0, balance.battle.dodgeCap);
};

// ---- rewards (GDD 5.3, 5.5) ----

/** No bonus up to the first ratio, rising in a straight line to the maximum at the second. */
export const underlevelBonus = (enemyLevel: number, heroLevel: number, balance: Balance): number => {
  const { underlevelFrom, underlevelTo, underlevelMax } = balance.xp;
  const ratio = enemyLevel / Math.max(1, heroLevel);
  if (ratio <= underlevelFrom) return 1;
  if (ratio >= underlevelTo) return underlevelMax;
  return 1 + ((underlevelMax - 1) * (ratio - underlevelFrom)) / (underlevelTo - underlevelFrom);
};

/** The Luck drop multiplier, from Luck ÷ enemy level, along the balance curve's points on a log scale (GDD 4.2). */
export const luckDropMult = (luck: number, enemyLevel: number, balance: Balance): number => {
  const curve = balance.hero.luckDropCurve;
  const first = curve[0];
  if (first === undefined) return 1;
  const q = luck / Math.max(1, enemyLevel);
  if (q <= first.q) return first.mult;
  let low = first;
  for (const high of curve) {
    if (q < high.q) {
      const span = log10(high.q) - log10(low.q);
      return span > 0 ? low.mult + ((high.mult - low.mult) * (log10(q) - log10(low.q))) / span : high.mult;
    }
    low = high;
  }
  return low.mult;
};

export const xpReward = (enemy: EnemyDef, hero: HeroStats, markPercent: number, balance: Balance): number =>
  Math.floor(enemy.stats.xp * underlevelBonus(enemy.level, hero.level, balance) * bonusMult(hero.xpBonus) * bonusMult(markPercent));

export const goldReward = (enemy: EnemyDef, hero: HeroStats, markPercent: number): number =>
  Math.floor(enemy.stats.gold * bonusMult(hero.goldBonus) * bonusMult(markPercent));

/** The chance, 0 to 1, that one drop falls on a win. `baseChance` is in percent. */
export const dropChance = (baseChance: number, enemy: EnemyDef, hero: HeroStats, markPercent: number, balance: Balance): number =>
  clamp((baseChance / 100) * bonusMult(hero.dropBonus) * luckDropMult(hero.luck, enemy.level, balance) * bonusMult(markPercent), 0, 1);

/** The drops an enemy still holds: a drop stops once the item's copy cap is reached (GDD 7.3). */
export const dropsHeld = (state: GameState, enemy: EnemyDef, content: Content): EnemyDrop[] =>
  enemy.drops.filter((drop) => owned(state, drop.item) < (content.items[drop.item]?.copyCap ?? 0));

// ---- Salvage (GDD 7.4) ----

const beaten = (state: GameState, enemy: EnemyId): boolean => (state.profile.bestiary[enemy]?.timesBeaten ?? 0) > 0;

/** For each pool item, the level of the strongest qualifying enemy that drops it. */
const salvageSources = (state: GameState, content: Content): Array<{ item: ItemId; level: number }> => {
  const sources: Array<{ item: ItemId; level: number }> = [];
  for (const item of content.itemOrder) {
    if (owned(state, item) > 0) continue;
    let best = 0;
    for (const enemyId of content.index.droppedBy[item] ?? []) {
      const enemy = content.enemies[enemyId];
      if (enemy !== undefined && beaten(state, enemyId) && enemy.level <= state.run.strongestBeaten) best = Math.max(best, enemy.level);
    }
    if (best > 0) sources.push({ item, level: best });
  }
  return sources;
};

/** Items owned in no copy, dropped by an enemy beaten at least once ever, at or below this run's strongest kill. */
export const salvagePool = (state: GameState, content: Content): ItemId[] => salvageSources(state, content).map((source) => source.item);

/** The pool split into the three level bands the Salvage screen shows (DV-2). */
export const salvageBands = (state: GameState, content: Content): { high: number; mid: number; low: number } => {
  const { bandHigh, bandLow } = content.balance.salvage;
  const strongest = state.run.strongestBeaten;
  const bands = { high: 0, mid: 0, low: 0 };
  for (const source of salvageSources(state, content)) {
    if (source.level > strongest * bandHigh) bands.high += 1;
    else if (source.level >= strongest * bandLow) bands.mid += 1;
    else bands.low += 1;
  }
  return bands;
};

/** `gold ÷ (gold + factor × goldAt(strongest enemy beaten this run))`, doubled by the gem boost, to at most 1. */
export const salvageChance = (state: GameState, balance: Balance, boost: boolean): number => {
  const gold = state.run.gold;
  if (gold <= 0) return 0;
  const chance = gold / (gold + balance.salvage.goldFactor * goldAt(state.run.strongestBeaten, balance));
  return clamp(boost ? chance * balance.salvage.boostMult : chance, 0, 1);
};
