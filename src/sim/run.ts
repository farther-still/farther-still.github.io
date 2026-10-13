// Plays whole runs with a simulated player and records what GDD 5.9 asks about each one.

import { combatantOf, fightCost, forecastBattle, level, newGame, remainingEnergy, streamRng } from '../engine';
import type { Content, EnemyDef, EnemyId, GameState, ItemId } from '../engine';
import type { Strategy } from './config';
import { act, allocate, bestGear, chooseFight, goTo, heroIn, newPlayer, nextGoal, policyOf, power, reachable, salvage, shop, toolOwned, wear } from './player';
import type { Player, Target } from './player';

export type RunRecord = {
  run: number;
  level: number;
  /** Level of the strongest enemy beaten this run. */
  strongest: number;
  /** The furthest zone in which the hero won a fight this run, as its place in the zone order (1 is the first). */
  zoneReached: number;
  wins: number;
  losses: number;
  /** Energy to spend as the run began: permanent energy plus any energy accessory worn. */
  startingEnergy: number;
  energyLeft: number;
  /** Gold won in fights this run. */
  gold: number;
  /** Items that fell from enemies this run. */
  drops: ItemId[];
  bought: ItemId[];
  /** Whether the run's Salvage attempt was made, and what it found. */
  salvageTried: boolean;
  salvaged: ItemId | null;
  /** Everything gained this run, however it came. */
  itemsGained: ItemId[];
  claims: number;
  /** A new item or copy, a Claim, a waypoint or a loadout slot (GDD 5.9). */
  persistentGain: boolean;
  /** Enemies beaten this run for the first time ever. */
  firstKills: EnemyId[];
  /** Gate bosses beaten this run. */
  gatesBeaten: EnemyId[];
  /** Wins that took more tries than the pacing target allows (GDD 5.9). */
  hardWins: number;
  /** The enemy `power` is measured against: the first gate boss never beaten before this run, or the strongest enemy there is. */
  wall: EnemyId | null;
  /** The hero's strength against the wall as the run ended, in its best gear for that fight: under 1 it should lose, over 1 it should win. */
  power: number;
  /** The same fight as a win chance, 0 to 1. */
  wallChance: number;
  /** Fights joined at the wall this run, won or lost. */
  wallFights: number;
  tiles: number;
  /** Battles fought, won or lost. */
  battles: number;
};

export type Playthrough = { seed: number; runs: RunRecord[] };

const SAFETY_LIMIT = 2000;
/** Trial battles behind `wallChance`. It is a reading for the report, not a choice the player makes. */
const WALL_TRIALS = 400;

const bump = (counts: Map<string, number>, key: string): number => {
  const next = (counts.get(key) ?? 0) + 1;
  counts.set(key, next);
  return next;
};

/** The first gate boss never beaten, in content order; once every gate has fallen, the strongest enemy of all. */
const wallOf = (state: GameState, content: Content): EnemyDef | undefined => {
  const all = content.enemyOrder.map((id) => content.enemies[id]).filter((enemy): enemy is EnemyDef => enemy !== undefined);
  return all.find((enemy) => enemy.gate && (state.profile.bestiary[enemy.id]?.timesBeaten ?? 0) === 0) ?? [...all].sort((x, y) => y.level - x.level)[0];
};

/**
 * With its last energy the player may throw itself at a boss it would not otherwise fight (DV-3). Where a loss
 * is free that is the last fight's worth of energy; where a loss is charged it is the energy the strategy holds back.
 */
const lastGasp = (player: Player, strategy: Strategy, content: Content): Target | null => {
  if (strategy.bossAtRunEnd === null) return null;
  const { state } = player;
  const energy = remainingEnergy(state, content);
  for (const id of content.spawnOrder) {
    const spawn = content.spawns[id];
    const enemy = spawn === undefined ? undefined : content.enemies[spawn.enemy];
    if (spawn === undefined || enemy === undefined || !enemy.boss || state.run.bossesBeaten.includes(enemy.id)) continue;
    const cost = fightCost(enemy, content);
    const held = content.balance.energy.chargeLosses ? strategy.bossReserve * cost : cost;
    if (energy < cost || energy > held) continue;
    if ((player.lastGaspLosses.get(id) ?? 0) >= strategy.bossPatience) continue;
    if (!reachable(player, spawn, content)) continue;
    const slots = bestGear(state, enemy, content);
    const chance = forecastBattle(heroIn(state, slots, content), combatantOf(enemy), state.run.seed, state.run.battleCount, content.balance, strategy.forecastTrials).winChance;
    if (chance >= strategy.bossAtRunEnd) return { spawn, enemy, withTool: false };
  }
  return null;
};

export const playRun = (player: Player, strategy: Strategy, content: Content, runNumber: number): RunRecord => {
  const policy = policyOf(strategy);
  const beatenBefore = new Set(Object.entries(player.state.profile.bestiary).filter(([, entry]) => entry.timesBeaten > 0).map(([id]) => id));
  const loadoutsBefore = player.state.profile.loadouts.length;
  const waypointsBefore = player.state.profile.waypointsUnlocked.length;
  const wall = wallOf(player.state, content);
  let zoneReached = 1;
  let gold = 0;
  let battles = 0;
  let wornFor = '';
  const drops: ItemId[] = [];
  const bought: ItemId[] = [];

  const dress = (against?: EnemyDef): void => {
    const goal = against ?? nextGoal(player.state, content);
    if (goal === undefined) return;
    const key = `${goal.id}:${JSON.stringify(player.state.profile.items)}:${JSON.stringify(player.state.run.pointsSpent)}`;
    if (key === wornFor) return;
    wornFor = key;
    wear(player, bestGear(player.state, goal, content), content);
  };

  dress();
  const energyAtStart = remainingEnergy(player.state, content);
  for (let guard = 0; guard < SAFETY_LIMIT; guard += 1) {
    if (remainingEnergy(player.state, content) < 1) break;
    const desperate = lastGasp(player, strategy, content);
    const target = desperate ?? chooseFight(player, strategy, content);
    if (target === null) break;
    if (!goTo(player, target.spawn.zone, { x: target.spawn.x, y: target.spawn.y }, true, content)) {
      player.shunned.add(target.spawn.id);
      continue;
    }
    // A last-gasp fight is dressed for: the player is about to fight this boss and nothing else.
    if (desperate !== null) dress(target.enemy);
    const tool = toolOwned(player.state, content);
    if (target.withTool && tool !== null) act(player, { type: 'Equip', loadout: player.state.profile.activeLoadout, slot: 'weapon', item: tool }, content);
    const events = act(player, { type: 'Fight', spawn: target.spawn.id }, content);
    battles += 1;
    bump(player.fightsAt, target.spawn.id);
    if (target.withTool) wornFor = '';

    const won = events.some((event) => event.type === 'Battle' && event.win);
    if (!won) {
      bump(player.sinceWin, target.spawn.id);
      if (desperate !== null) bump(player.lastGaspLosses, target.spawn.id);
      else if (bump(player.lossesAt, target.spawn.id) >= (target.enemy.boss ? strategy.bossPatience : strategy.patience)) player.shunned.add(target.spawn.id);
      dress();
      continue;
    }
    player.tries.push((player.sinceWin.get(target.spawn.id) ?? 0) + 1);
    player.sinceWin.delete(target.spawn.id);
    player.lossesAt.delete(target.spawn.id);
    for (const event of events) {
      if (event.type !== 'Rewards') continue;
      gold += event.gold;
      drops.push(...event.drops);
    }
    zoneReached = Math.max(zoneReached, content.zoneOrder.indexOf(target.enemy.zone) + 1);

    allocate(player, policy, content);
    if (strategy.shop === 'dearest') bought.push(...shop(player, content));
    dress();
  }
  if (strategy.shop === 'run-end') bought.push(...shop(player, content));
  const salvageEvents = strategy.salvage === 'always' ? salvage(player, content) : [];
  const salvaged = salvageEvents.flatMap((event) => (event.type === 'Salvaged' ? [event.item] : []));

  const { profile, run } = player.state;
  const firstKills = Object.entries(profile.bestiary).filter(([id, entry]) => entry.timesBeaten > 0 && !beatenBefore.has(id)).map(([id]) => id);
  // The wall as the hero stood at the end of the run, in the best gear it owns for that fight.
  const best = wall === undefined ? undefined : heroIn(player.state, bestGear(player.state, wall, content), content);
  const wallSpawns = wall === undefined ? [] : content.spawnOrder.filter((id) => content.spawns[id]?.enemy === wall.id);
  return {
    run: runNumber,
    level: level(player.state, content.balance),
    strongest: run.strongestBeaten,
    zoneReached,
    wins: run.tallies.wins,
    losses: run.tallies.losses,
    startingEnergy: energyAtStart,
    energyLeft: remainingEnergy(player.state, content),
    gold,
    drops,
    bought,
    salvageTried: salvaged.length > 0,
    salvaged: salvaged[0] ?? null,
    itemsGained: [...run.tallies.itemsGained],
    claims: run.tallies.claims,
    persistentGain: run.tallies.itemsGained.length > 0 || run.tallies.claims > 0 || profile.loadouts.length > loadoutsBefore || profile.waypointsUnlocked.length > waypointsBefore,
    firstKills,
    gatesBeaten: run.bossesBeaten.filter((id) => content.enemies[id]?.gate === true),
    hardWins: player.tries.filter((tries) => tries > content.balance.pacing.hardWinTries).length,
    wall: wall?.id ?? null,
    power: wall === undefined || best === undefined ? 0 : power(best, wall, content),
    wallChance: wall === undefined || best === undefined ? 0 : forecastBattle(best, combatantOf(wall), run.seed, run.battleCount, content.balance, WALL_TRIALS).winChance,
    wallFights: wallSpawns.reduce((total, id) => total + (player.fightsAt.get(id) ?? 0), 0),
    tiles: player.tiles,
    battles,
  };
};

/** One player's first `runs` runs, from a new game. Everything follows from `seed`. */
export const playthrough = (seed: number, runs: number, strategy: Strategy, content: Content): Playthrough => {
  // Run seeds come from the simulator's own stream, as the UI draws them from the browser.
  const seeds = streamRng(seed, 'spawn', 0);
  let state: GameState = newGame(seeds.nextUint32(), content);
  const records: RunRecord[] = [];
  for (let index = 1; index <= runs; index += 1) {
    const player = newPlayer(state);
    records.push(playRun(player, strategy, content, index));
    const next = newPlayer(player.state);
    act(next, { type: 'NewRun', seed: seeds.nextUint32() }, content);
    state = next.state;
  }
  return { seed, runs: records };
};
