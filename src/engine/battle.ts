// Combat resolution (GDD section 3). A battle is a pure function of the hero's final stats, the enemy and a
// generator: it resolves at once and returns the outcome, summary numbers and, if asked, the event log the UI
// replays. The simulator and the forecast call the same function without the log.
//
// Rolls are drawn in the order GDD 3.2 lists, one number per listed roll, even when the chance is 0% or 100%.
// The one exception is the GDD's own: an enemy's triple attack is rolled only if its double attack succeeded.

import { dodgeChance, hitChance } from './formulas';
import type { Rng } from './rng';
import type { Balance, Combatant, HeroStats } from './types';

export type BattleEvent =
  | { t: 'round'; n: number }
  | { t: 'heroRegen'; amount: number; heroLife: number }
  | { t: 'miss' }
  | { t: 'hit'; damage: number; crit: boolean; enemyLife: number }
  | { t: 'extraTurn' }
  | { t: 'enemyRegen'; amount: number; enemyLife: number }
  | { t: 'dodge' }
  | { t: 'enemyHit'; damage: number; heroLife: number }
  | { t: 'lastStand'; left: number }
  | { t: 'reflect'; damage: number; enemyLife: number }
  | { t: 'end'; win: boolean; rounds: number };

export type BattleResult = {
  win: boolean;
  rounds: number;
  heroMaxLife: number;
  enemyMaxLife: number;
  /** Life left at the end: 0 for whoever lost, unless the round limit ended it. */
  heroLife: number;
  enemyLife: number;
  /** Totals over the battle. `dealt` includes Reflect. */
  dealt: number;
  taken: number;
  heroHealed: number;
  enemyHealed: number;
  /** Enemy hits that landed on the hero. */
  hitsTaken: number;
  /** Present only when the log was asked for. */
  log: BattleEvent[] | null;
};

export type BattleOptions = { log: boolean };

/** What a hero hit is before the crit roll: `Damage × Damage ÷ (Damage + enemy Defense)`, times the tag bonus and the enemy's damage reduction. */
const heroHitBase = (hero: HeroStats, enemy: Combatant): number => {
  let versus = 0;
  for (const tag of enemy.tags) versus += hero.versus[tag];
  const taken = Math.max(0, 1 - enemy.traits.damageReduction / 100);
  return ((hero.damage * hero.damage) / (hero.damage + enemy.defense)) * Math.max(0, 1 + versus / 100) * taken;
};

/** One enemy hit: `E × E ÷ (E + hero Defense)`, times `100 ÷ (100 + Resistance)`. Rounded down once; at least 1. */
export const enemyHitDamage = (hero: HeroStats, enemy: Combatant): number => {
  let resist = 0;
  for (const tag of enemy.tags) resist += hero.resist[tag];
  const raw = ((enemy.damage * enemy.damage) / (enemy.damage + hero.defense)) * (100 / (100 + Math.max(0, resist)));
  return Math.max(1, Math.floor(raw));
};

/** One hero hit without a crit. Rounded down once; at least 1. */
export const heroHitDamage = (hero: HeroStats, enemy: Combatant): number => Math.max(1, Math.floor(heroHitBase(hero, enemy)));

/** The share of the hero's Damage that the enemy's Defense and damage reduction remove, 0 to 1. */
export const shareRemoved = (hero: HeroStats, enemy: Combatant): number => {
  const through = (hero.damage / (hero.damage + enemy.defense)) * Math.max(0, 1 - enemy.traits.damageReduction / 100);
  return 1 - through;
};

export const resolveBattle = (hero: HeroStats, enemy: Combatant, rng: Rng, balance: Balance, options: BattleOptions): BattleResult => {
  const log: BattleEvent[] | null = options.log ? [] : null;
  const toHit = hitChance(hero.accuracy, enemy.level, balance);
  const toDodge = dodgeChance(hero.evasion, enemy.level, balance);
  const hitBase = heroHitBase(hero, enemy);
  const plainHit = Math.max(1, Math.floor(hitBase));
  const critHit = Math.max(1, Math.floor(hitBase * hero.critDamage));
  const enemyHit = enemyHitDamage(hero, enemy);
  const reduction = Math.max(0, 1 - enemy.traits.damageReduction / 100);
  // Reflect is worked out before the hero's Defense and ignores the enemy's Defense (GDD 3.1).
  const reflectHit = hero.reflect > 0 ? Math.max(1, Math.floor(enemy.damage * (hero.reflect / 100) * reduction)) : 0;
  const heroRegen = Math.floor(hero.life * (hero.lifeRegen / 100));
  const enemyRegen = Math.floor(enemy.life * (enemy.traits.regen / 100));
  const doubleChance = enemy.traits.doubleAttack / 100;
  const tripleChance = enemy.traits.tripleAttack / 100;

  let heroLife = hero.life;
  let enemyLife = enemy.life;
  let lastStand = hero.lastStand;
  let dealt = 0;
  let taken = 0;
  let heroHealed = 0;
  let enemyHealed = 0;
  let hitsTaken = 0;
  let rounds = 0;
  let win = false;
  let over = false;

  while (!over && rounds < balance.battle.roundLimit) {
    rounds += 1;
    log?.push({ t: 'round', n: rounds });

    // ---- hero turn ----
    if (rounds > 1 && heroRegen > 0 && heroLife < hero.life) {
      const amount = Math.min(heroRegen, hero.life - heroLife);
      heroLife += amount;
      heroHealed += amount;
      log?.push({ t: 'heroRegen', amount, heroLife });
    }
    for (let turn = 0; turn < 2 && !over; turn += 1) {
      const attacks = rng.next() < hero.extraAttack ? 2 : 1;
      for (let attack = 0; attack < attacks && !over; attack += 1) {
        if (rng.next() >= toHit) {
          log?.push({ t: 'miss' });
          continue;
        }
        const hits = rng.next() < hero.extraHit ? 2 : 1;
        for (let hit = 0; hit < hits && !over; hit += 1) {
          const crit = rng.next() < hero.critChance;
          const damage = crit ? critHit : plainHit;
          enemyLife = Math.max(0, enemyLife - damage);
          dealt += damage;
          log?.push({ t: 'hit', damage, crit, enemyLife });
          if (enemyLife <= 0) {
            win = true;
            over = true;
          }
        }
      }
      // Extra Turn is rolled once, after the first pass. The second pass has no further roll.
      if (over || turn > 0) break;
      if (rng.next() >= hero.extraTurn) break;
      log?.push({ t: 'extraTurn' });
    }
    if (over) break;

    // ---- enemy turn ----
    if (enemyRegen > 0 && enemyLife < enemy.life) {
      const amount = Math.min(enemyRegen, enemy.life - enemyLife);
      enemyLife += amount;
      enemyHealed += amount;
      log?.push({ t: 'enemyRegen', amount, enemyLife });
    }
    let enemyAttacks = 1;
    if (rng.next() < doubleChance) {
      enemyAttacks = 2;
      if (rng.next() < tripleChance) enemyAttacks += 1;
    }
    for (let attack = 0; attack < enemyAttacks && !over; attack += 1) {
      if (rng.next() < toDodge) {
        log?.push({ t: 'dodge' });
        continue;
      }
      heroLife = Math.max(0, heroLife - enemyHit);
      taken += enemyHit;
      hitsTaken += 1;
      log?.push({ t: 'enemyHit', damage: enemyHit, heroLife });
      if (heroLife <= 0) {
        if (lastStand > 0) {
          lastStand -= 1;
          heroLife = 1;
          log?.push({ t: 'lastStand', left: lastStand });
        } else {
          over = true;
          break;
        }
      }
      if (reflectHit > 0) {
        enemyLife = Math.max(0, enemyLife - reflectHit);
        dealt += reflectHit;
        log?.push({ t: 'reflect', damage: reflectHit, enemyLife });
        if (enemyLife <= 0) {
          win = true;
          over = true;
        }
      }
    }
  }
  // A battle that reaches the round limit with both standing is a loss (GDD 3.2).
  log?.push({ t: 'end', win, rounds });
  return { win, rounds, heroMaxLife: hero.life, enemyMaxLife: enemy.life, heroLife, enemyLife, dealt, taken, heroHealed, enemyHealed, hitsTaken, log };
};
