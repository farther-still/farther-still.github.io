// The pre-fight forecast (GDD 3.5, DV-2): trial battles on the forecast stream, so the forecast can never
// reveal the real battle's rolls. It keeps no state beyond the counters already in `run`.

import { resolveBattle, shareRemoved } from './battle';
import { combatantOf, deriveHero, dodgeChance, hitChance } from './formulas';
import { streamRng } from './rng';
import type { GameState } from './state';
import type { Balance, Combatant, Content, HeroStats, SpawnId } from './types';

/** The one line that says what is limiting the hero, by the first rule that matches (GDD 3.5). */
export type LimitingFactor =
  | { kind: 'miss'; hitPercent: number }
  | { kind: 'burst'; hits: number }
  | { kind: 'regen' }
  | { kind: 'shrug'; percent: number }
  | { kind: 'rounds'; need: number; last: number }
  | { kind: 'rolls' };

export type Forecast = {
  trials: number;
  wins: number;
  /** 0 to 1. */
  winChance: number;
  hitChance: number;
  dodgeChance: number;
  /** Null when the win chance is high enough that no line is shown. */
  factor: LimitingFactor | null;
};

/** Trial battles for one hero against one enemy, all drawn from one generator. */
export const forecastBattle = (hero: HeroStats, enemy: Combatant, seed: number, counter: number, balance: Balance, trials: number = balance.forecast.trials): Forecast => {
  const rng = streamRng(seed, 'forecast', counter);
  let wins = 0;
  let firstTurnDeaths = 0;
  let firstTurnHits = 0;
  let rounds = 0;
  let dealt = 0;
  let taken = 0;
  let heroHealed = 0;
  let enemyHealed = 0;
  for (let trial = 0; trial < trials; trial += 1) {
    const result = resolveBattle(hero, enemy, rng, balance, { log: false });
    if (result.win) wins += 1;
    else if (result.rounds === 1) {
      firstTurnDeaths += 1;
      firstTurnHits += result.hitsTaken;
    }
    rounds += result.rounds;
    dealt += result.dealt;
    taken += result.taken;
    heroHealed += result.heroHealed;
    enemyHealed += result.enemyHealed;
  }
  const count = Math.max(1, trials);
  const winChance = wins / count;
  const toHit = hitChance(hero.accuracy, enemy.level, balance);
  const toDodge = dodgeChance(hero.evasion, enemy.level, balance);

  let factor: LimitingFactor | null = null;
  if (winChance < balance.forecast.showFactorBelow) {
    const removed = shareRemoved(hero, enemy);
    const dealtPerRound = (dealt - enemyHealed) / Math.max(1, rounds);
    const takenPerRound = (taken - heroHealed) / Math.max(1, rounds);
    const need = dealtPerRound > 0 ? Math.ceil(enemy.life / dealtPerRound) : balance.battle.roundLimit;
    const last = takenPerRound > 0 ? Math.ceil(hero.life / takenPerRound) : balance.battle.roundLimit;
    // What the enemy can heal in a turn, against what the hero deals in a round. What it actually healed is no
    // guide: healing stops at full life, so it can never come to more than the damage it took.
    const healPerTurn = Math.floor(enemy.life * (enemy.traits.regen / 100));
    const dealtEachRound = dealt / Math.max(1, rounds);
    if (toHit < balance.forecast.missBelow) factor = { kind: 'miss', hitPercent: Math.floor(toHit * 100) };
    else if (firstTurnDeaths * 2 > count) factor = { kind: 'burst', hits: Math.max(1, Math.ceil(firstTurnHits / firstTurnDeaths)) };
    else if (healPerTurn > 0 && healPerTurn >= dealtEachRound) factor = { kind: 'regen' };
    else if (removed > balance.forecast.shrugAbove) factor = { kind: 'shrug', percent: Math.floor(removed * 100) };
    else if (need > last) factor = { kind: 'rounds', need, last };
    else factor = { kind: 'rolls' };
  }
  return { trials: count, wins, winChance, hitChance: toHit, dodgeChance: toDodge, factor };
};

/** The forecast for fighting `spawn` as the hero stands now, or null for a spawn that does not exist. */
export const forecast = (state: GameState, spawn: SpawnId, content: Content, trials?: number): Forecast | null => {
  const enemy = content.enemies[content.spawns[spawn]?.enemy ?? ''];
  if (enemy === undefined) return null;
  return forecastBattle(deriveHero(state, content), combatantOf(enemy), state.run.seed, state.run.battleCount, content.balance, trials);
};
