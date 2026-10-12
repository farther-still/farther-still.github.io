// A simulated player (ARCHITECTURE section 10): a set of policies that plays the game through the same `step`
// function the UI calls. It walks the map, so a gate it has not opened really is in its way.
//
// Phase 3b ships this one simple strategy. It climbs on the best XP it can beat, turns to collecting drops once
// it has outgrown what it can beat, buys what it can afford, and puts the gold it has left into Salvage.

import { combatantOf, deriveHero, dodgeChance, enemyHitDamage, fightCost, findPath, forecast, heroHitDamage, hitChance, level, owned, remainingEnergy, salvageChance, salvagePool, shopPrice, splitPolicy, step, sumPoints, unspentPoints } from '../engine';
import type { Action, AllocationPolicy, Content, EnemyDef, GameEvent, GameState, HeroStats, ItemDef, ItemId, Point, SlotId, SpawnDef, StatSplit } from '../engine';
import { ACCESSORY_SLOTS, ARMOR_SLOTS } from '../engine';

export type Strategy = {
  name: string;
  /** How new stat points are divided. */
  split: StatSplit;
  /** The forecast a normal enemy needs before the player will fight it. */
  minWinChance: number;
  /** The forecast a boss needs. Lower, because a loss costs nothing. */
  bossWinChance: number;
  /** Trial battles per forecast. Fewer than the game's own, to keep the simulator quick. */
  forecastTrials: number;
  /** Losses in a row against one enemy before the player gives up on it for the run. */
  patience: number;
  /** The hero stops climbing and starts collecting drops once its level is this many times the best enemy it can beat. */
  farmAtRatio: number;
};

export const DEFAULT_STRATEGY: Strategy = {
  name: 'climb-then-collect',
  split: { life: 30, damage: 35, defense: 25, dexterity: 10, luck: 0 },
  minWinChance: 0.6,
  bossWinChance: 0.35,
  forecastTrials: 150,
  patience: 4,
  farmAtRatio: 1.6,
};

export type Player = {
  state: GameState;
  /** Steps walked this run. */
  tiles: number;
  /** For each win this run, how many tries it took. */
  tries: number[];
  /** Enemies given up on this run. */
  shunned: Set<string>;
  streak: { spawn: string; losses: number };
  events: GameEvent[];
};

export const newPlayer = (state: GameState): Player => ({ state, tiles: 0, tries: [], shunned: new Set(), streak: { spawn: '', losses: 0 }, events: [] });

/** Applies an action, throwing if the engine turns it down: the simulator only sends actions it believes are allowed. */
export const act = (player: Player, action: Action, content: Content): GameEvent[] => {
  const result = step(player.state, action, content);
  if ('rejected' in result) throw new Error(`sim: ${action.type} was rejected: ${result.rejected}`);
  player.state = result.state;
  return result.events;
};

// ---- walking ----

const walk = (player: Player, path: readonly Point[], content: Content): void => {
  for (const tile of path) {
    const { x, y } = player.state.run.position;
    act(player, { type: 'Step', dx: tile.x - x, dy: tile.y - y }, content);
    player.tiles += 1;
  }
};

/** Walks to a tile beside (or on) a target in `zone`, crossing zones through exits. False if there is no way. */
export const goTo = (player: Player, zone: string, target: Point, beside: boolean, content: Content): boolean => {
  for (let hops = 0; hops <= content.zoneOrder.length; hops += 1) {
    const here = player.state.run.position;
    if (here.zone === zone) {
      const path = findPath(player.state, content, here, target, { beside });
      if (path === null) return false;
      walk(player, path, content);
      return true;
    }
    // Take the exit that leads towards the target zone: directly if there is one, otherwise any exit onward.
    const exits = content.zones[here.zone]?.map.exits ?? [];
    const exit = exits.find((candidate) => candidate.to.zone === zone) ?? exits[0];
    if (exit === undefined) return false;
    const path = findPath(player.state, content, here, { x: exit.x, y: exit.y });
    if (path === null) return false;
    walk(player, path, content);
  }
  return false;
};

// ---- gear ----

/**
 * A measure of fighting strength against one enemy, with no dice in it: how many of the enemy's lives the hero
 * removes per round, over how many of its own it loses. Above 1 the hero should win.
 */
const power = (hero: HeroStats, enemy: EnemyDef, content: Content): number => {
  const foe = combatantOf(enemy);
  const { balance } = content;
  const toHit = hitChance(hero.accuracy, foe.level, balance);
  const swings = (1 + hero.extraAttack) * (1 + hero.extraHit) * (1 + hero.extraTurn);
  const attacks = 1 + (foe.traits.doubleAttack / 100) * (1 + foe.traits.tripleAttack / 100);
  const landed = attacks * (1 - dodgeChance(hero.evasion, foe.level, balance));
  const reflected = foe.damage * (hero.reflect / 100) * (1 - foe.traits.damageReduction / 100) * landed;
  const dealt = heroHitDamage(hero, foe) * toHit * (1 + hero.critChance * (hero.critDamage - 1)) * swings + reflected - foe.life * (foe.traits.regen / 100);
  const taken = enemyHitDamage(hero, foe) * landed - hero.life * (hero.lifeRegen / 100);
  const lives = hero.life * (1 + hero.lastStand * 0.1);
  if (dealt <= 0) return 0;
  return taken <= 0 ? Number.MAX_VALUE : dealt / foe.life / (taken / lives);
};

/** The enemy gear is judged against: the weakest one never yet beaten, or the strongest of all once everything has been. */
export const nextGoal = (state: GameState, content: Content): EnemyDef | undefined => {
  const all = content.enemyOrder.map((id) => content.enemies[id]).filter((enemy): enemy is EnemyDef => enemy !== undefined);
  const unbeaten = all.filter((enemy) => (state.profile.bestiary[enemy.id]?.timesBeaten ?? 0) === 0).sort((x, y) => x.level - y.level);
  return unbeaten[0] ?? all.sort((x, y) => y.level - x.level)[0];
};

const heroWith = (state: GameState, items: readonly ItemDef[], content: Content): HeroStats => deriveHero(state, content, items);

/** Fills loadout 1 with the best owned gear against `against`, one slot at a time. Returns the actions to send. */
export const bestGear = (state: GameState, against: EnemyDef, content: Content): Record<SlotId, ItemId | null> => {
  const chosen: Record<string, ItemId | null> = {};
  const worn = (): ItemDef[] => Object.values(chosen).flatMap((id) => (id === null ? [] : [content.items[id]])).filter((item): item is ItemDef => item !== undefined);
  const ownedOf = (kind: ItemDef['kind']): ItemDef[] => content.itemOrder.map((id) => content.items[id]).filter((item): item is ItemDef => item !== undefined && item.kind === kind && owned(state, item.id) > 0);

  for (const slot of ['weapon', ...ARMOR_SLOTS] as const) {
    chosen[slot] = null;
    let best = power(heroWith(state, worn(), content), against, content);
    for (const item of ownedOf(slot)) {
      // The tool is never worn for strength: it is put on for one fight, to claim a boss.
      if (item.claim) continue;
      const score = power(heroWith(state, [...worn().filter((entry) => entry.kind !== slot), item], content), against, content);
      if (score > best) {
        best = score;
        chosen[slot] = item.id;
      }
    }
  }
  // Accessories: energy and Growth first, since strength does not measure them; then the best of the rest.
  const copies: ItemDef[] = ownedOf('accessory').flatMap((item) => Array.from({ length: Math.min(owned(state, item.id), item.copyCap) }, () => item));
  const forced = copies.filter((item) => (item.lines.energy ?? 0) > 0 || (item.lines.growth ?? 0) > 0);
  const rest = copies.filter((item) => !forced.includes(item));
  const picked: ItemDef[] = forced.slice(0, ACCESSORY_SLOTS.length);
  while (picked.length < ACCESSORY_SLOTS.length && rest.length > 0) {
    const base = [...worn(), ...picked];
    let bestIndex = -1;
    let best = power(heroWith(state, base, content), against, content);
    rest.forEach((item, index) => {
      const score = power(heroWith(state, [...base, item], content), against, content);
      if (score > best) {
        best = score;
        bestIndex = index;
      }
    });
    if (bestIndex < 0) break;
    picked.push(...rest.splice(bestIndex, 1));
  }
  ACCESSORY_SLOTS.forEach((slot, index) => {
    chosen[slot] = picked[index]?.id ?? null;
  });
  return chosen as Record<SlotId, ItemId | null>;
};

export const wear = (player: Player, slots: Record<SlotId, ItemId | null>, content: Content): void => {
  const index = player.state.profile.activeLoadout;
  // Clear first, so that moving a copy between accessory cells never asks for more copies than are owned.
  for (const slot of Object.keys(slots) as SlotId[]) {
    if (player.state.profile.loadouts[index]?.slots[slot] !== slots[slot]) act(player, { type: 'Equip', loadout: index, slot, item: null }, content);
  }
  for (const slot of Object.keys(slots) as SlotId[]) {
    if (slots[slot] !== null && player.state.profile.loadouts[index]?.slots[slot] !== slots[slot]) act(player, { type: 'Equip', loadout: index, slot, item: slots[slot] }, content);
  }
};

// ---- choosing a fight ----

export type Target = { spawn: SpawnDef; enemy: EnemyDef; withTool: boolean };

/** The permanent-energy tool, if the player owns it. */
export const toolOwned = (state: GameState, content: Content): ItemId | null =>
  content.itemOrder.find((id) => content.items[id]?.claim === true && owned(state, id) > 0) ?? null;

const spawnsByLevel = (content: Content): Array<{ spawn: SpawnDef; enemy: EnemyDef }> =>
  content.spawnOrder
    .flatMap((id) => {
      const spawn = content.spawns[id];
      const enemy = spawn === undefined ? undefined : content.enemies[spawn.enemy];
      return spawn === undefined || enemy === undefined ? [] : [{ spawn, enemy }];
    })
    .sort((a, b) => b.enemy.level - a.enemy.level);

/** Whether the player can get beside this spawn as the map stands, without walking there. */
const reachable = (state: GameState, spawn: SpawnDef, content: Content): boolean => {
  const probe = newPlayer(state);
  return goTo(probe, spawn.zone, { x: spawn.x, y: spawn.y }, true, content);
};

const newDropRate = (state: GameState, enemy: EnemyDef, content: Content): number =>
  enemy.drops.reduce((total, drop) => total + (owned(state, drop.item) < (content.items[drop.item]?.copyCap ?? 0) ? drop.chance : 0), 0);

export const chooseFight = (player: Player, strategy: Strategy, content: Content): Target | null => {
  const { state } = player;
  const energy = remainingEnergy(state, content);
  const candidates = spawnsByLevel(content).filter(
    ({ spawn, enemy }) => !player.shunned.has(spawn.id) && fightCost(enemy, content) <= energy && !(enemy.boss && state.run.bossesBeaten.includes(enemy.id)),
  );
  const open = candidates.filter(({ spawn }) => reachable(state, spawn, content));
  const chance = (spawnId: string): number => forecast(state, spawnId, content, strategy.forecastTrials)?.winChance ?? 0;

  // A boss first: it pays energy back, and a gate boss opens the way on. With the tool in hand and the boss not
  // yet claimed, the player tries the tool first: a Claim is permanent energy (GDD 2.3).
  const tool = toolOwned(state, content);
  for (const { spawn, enemy } of open) {
    if (!enemy.boss) continue;
    if (tool !== null && !state.profile.claimedBosses.includes(enemy.id)) {
      const armed = step(state, { type: 'Equip', loadout: state.profile.activeLoadout, slot: 'weapon', item: tool }, content);
      const withTool = 'rejected' in armed ? 0 : (forecast(armed.state, spawn.id, content, strategy.forecastTrials)?.winChance ?? 0);
      if (withTool >= strategy.bossWinChance) return { spawn, enemy, withTool: true };
    }
    if (chance(spawn.id) >= strategy.bossWinChance) return { spawn, enemy, withTool: false };
  }
  // The strongest normal enemy the forecast likes. The list is strongest first, so the first hit is the best XP.
  const best = open.find(({ spawn, enemy }) => !enemy.boss && chance(spawn.id) >= strategy.minWinChance);
  if (best === undefined) return null;

  // Outgrown it: wins there barely move the level now, so collect drops instead, wherever the most are left.
  if (level(state, content.balance) >= best.enemy.level * strategy.farmAtRatio) {
    let pick = best;
    let rate = newDropRate(state, best.enemy, content);
    for (const candidate of open) {
      if (candidate.enemy.boss || candidate.enemy.level > best.enemy.level) continue;
      const candidateRate = newDropRate(state, candidate.enemy, content);
      if (candidateRate > rate) {
        rate = candidateRate;
        pick = candidate;
      }
    }
    return { ...pick, withTool: false };
  }
  return { ...best, withTool: false };
};

// ---- spending ----

export const allocate = (player: Player, policy: AllocationPolicy, content: Content): void => {
  const unspent = unspentPoints(player.state, content.balance);
  if (unspent < 1) return;
  const points = policy({ unspent, spent: player.state.run.pointsSpent, hero: deriveHero(player.state, content) });
  if (sumPoints(points) >= 1) act(player, { type: 'Allocate', points }, content);
};

/** Buys the dearest thing it can afford, again and again, until nothing is affordable. True if anything was bought. */
export const shop = (player: Player, content: Content): boolean => {
  let bought = false;
  for (;;) {
    const affordable = content.itemOrder
      .map((id) => content.items[id])
      .filter((item): item is ItemDef => item !== undefined && owned(player.state, item.id) < item.copyCap)
      .map((item) => ({ item, price: shopPrice(item, content.balance) }))
      .filter((entry): entry is { item: ItemDef; price: number } => entry.price !== null && entry.price <= player.state.run.gold)
      .sort((a, b) => b.price - a.price)[0];
    if (affordable === undefined) return bought;
    act(player, { type: 'Buy', item: affordable.item.id }, content);
    bought = true;
  }
};

/** Walks to a Salvage site and puts the gold on hand into one attempt, if there is anything to find. */
export const salvage = (player: Player, content: Content): void => {
  const { state } = player;
  if (state.run.salvageUsed || state.run.gold <= 0 || salvagePool(state, content).length === 0) return;
  for (const zone of content.zoneOrder) {
    const site = content.zones[zone]?.map.salvageSites[0];
    if (site === undefined) continue;
    if (!goTo(player, zone, { x: site.x, y: site.y }, false, content)) continue;
    const boost = player.state.profile.gems >= content.balance.salvage.boostGems && salvageChance(player.state, content.balance, false) < 0.5;
    act(player, { type: 'Salvage', boost }, content);
    return;
  }
};

export const policyOf = (strategy: Strategy): AllocationPolicy => splitPolicy(strategy.split);
