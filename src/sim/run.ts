// Plays whole runs with a simulated player and records what GDD 5.9 asks about each one.

import { level, newGame, remainingEnergy, startingEnergy, streamRng } from '../engine';
import type { Content, EnemyId, GameState, ItemId } from '../engine';
import { act, allocate, bestGear, chooseFight, goTo, newPlayer, nextGoal, policyOf, salvage, shop, toolOwned, wear } from './player';
import type { Player, Strategy } from './player';

export type RunRecord = {
  run: number;
  level: number;
  /** Level of the strongest enemy beaten this run. */
  strongest: number;
  /** The furthest zone in which the hero won a fight this run, as its place in the zone order (1 is the first). */
  zoneReached: number;
  wins: number;
  losses: number;
  startingEnergy: number;
  energyLeft: number;
  gold: number;
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
  tiles: number;
  /** Battles fought, won or lost. */
  battles: number;
};

export type Playthrough = { seed: number; runs: RunRecord[] };

const SAFETY_LIMIT = 2000;

export const playRun = (player: Player, strategy: Strategy, content: Content, runNumber: number): RunRecord => {
  const policy = policyOf(strategy);
  const beatenBefore = new Set(Object.entries(player.state.profile.bestiary).filter(([, entry]) => entry.timesBeaten > 0).map(([id]) => id));
  const loadoutsBefore = player.state.profile.loadouts.length;
  const waypointsBefore = player.state.profile.waypointsUnlocked.length;
  const energyAtStart = startingEnergy(player.state, content.balance);
  let zoneReached = 1;
  let gold = 0;
  let battles = 0;
  let wornFor = '';

  const dress = (): void => {
    const goal = nextGoal(player.state, content);
    if (goal === undefined) return;
    const key = `${goal.id}:${JSON.stringify(player.state.profile.items)}:${JSON.stringify(player.state.run.pointsSpent)}`;
    if (key === wornFor) return;
    wornFor = key;
    wear(player, bestGear(player.state, goal, content), content);
  };

  dress();
  for (let guard = 0; guard < SAFETY_LIMIT; guard += 1) {
    if (remainingEnergy(player.state, content) < 1) break;
    const target = chooseFight(player, strategy, content);
    if (target === null) break;
    if (!goTo(player, target.spawn.zone, { x: target.spawn.x, y: target.spawn.y }, true, content)) {
      player.shunned.add(target.spawn.id);
      continue;
    }
    const tool = toolOwned(player.state, content);
    if (target.withTool && tool !== null) act(player, { type: 'Equip', loadout: player.state.profile.activeLoadout, slot: 'weapon', item: tool }, content);
    const events = act(player, { type: 'Fight', spawn: target.spawn.id }, content);
    battles += 1;
    if (target.withTool) wornFor = '';

    const won = events.some((event) => event.type === 'Battle' && event.win);
    if (player.streak.spawn !== target.spawn.id) player.streak = { spawn: target.spawn.id, losses: 0 };
    if (!won) {
      player.streak.losses += 1;
      if (player.streak.losses >= strategy.patience) player.shunned.add(target.spawn.id);
      dress();
      continue;
    }
    player.tries.push(player.streak.losses + 1);
    player.streak = { spawn: '', losses: 0 };
    for (const event of events) if (event.type === 'Rewards') gold += event.gold;
    zoneReached = Math.max(zoneReached, content.zoneOrder.indexOf(target.enemy.zone) + 1);

    allocate(player, policy, content);
    shop(player, content);
    dress();
  }
  salvage(player, content);

  const { profile, run } = player.state;
  const firstKills = Object.entries(profile.bestiary).filter(([id, entry]) => entry.timesBeaten > 0 && !beatenBefore.has(id)).map(([id]) => id);
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
    itemsGained: [...run.tallies.itemsGained],
    claims: run.tallies.claims,
    persistentGain: run.tallies.itemsGained.length > 0 || run.tallies.claims > 0 || profile.loadouts.length > loadoutsBefore || profile.waypointsUnlocked.length > waypointsBefore,
    firstKills,
    gatesBeaten: run.bossesBeaten.filter((id) => content.enemies[id]?.gate === true),
    hardWins: player.tries.filter((tries) => tries > content.balance.pacing.hardWinTries).length,
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
