// The reducer: the only way game state changes (ARCHITECTURE 5.1). It never throws on a player action and never
// changes its arguments: an action that is not allowed comes back as `rejected`, with a reason the UI can show.

import { resolveBattle } from './battle';
import type { BattleEvent } from './battle';
import { combatantOf, deriveHero, dropChance, dropsHeld, fightCost, goldReward, level, loadoutPrice, owned, remainingEnergy, salvageChance, salvagePool, shopPrice, unspentPoints, xpReward, zoneBalance } from './formulas';
import { canStep, enemyAtSpawn, isAdjacent, tileKey, walkable } from './map';
import { isUint32, streamRng } from './rng';
import { HINT_IDS, emptyLoadout, freshRun, rollMark, sumPoints, zeroPoints } from './state';
import type { GameState } from './state';
import { ACCESSORY_SLOTS, SLOT_IDS, STAT_KEYS } from './types';
import type { Content, EnemyId, HintId, ItemDef, ItemId, Mark, Position, SecretId, SlotId, SpawnId, StatPoints } from './types';

export type Action =
  | { type: 'NewRun'; seed: number }
  | { type: 'Step'; dx: number; dy: number }
  | { type: 'Fight'; spawn: SpawnId }
  | { type: 'Allocate'; points: StatPoints }
  | { type: 'Equip'; loadout: number; slot: SlotId; item: ItemId | null }
  | { type: 'SwitchLoadout'; index: number }
  | { type: 'RenameLoadout'; index: number; name: string }
  | { type: 'Buy'; item: ItemId }
  | { type: 'BuyLoadoutSlot' }
  | { type: 'Salvage'; boost: boolean }
  | { type: 'CollectStash'; secret: SecretId }
  | { type: 'MarkHintShown'; hint: HintId };

export type RewardSummary = {
  xp: number;
  levelBefore: number;
  levelAfter: number;
  gold: number;
  drops: ItemId[];
  gems: number;
  /** True when this win claimed the boss: starting energy rose for good (GDD 2.3). */
  claimed: boolean;
  energyCost: number;
  energyBack: number;
  energyLeft: number;
  /** The mark the enemy carried, which this win used up. */
  mark: Mark | null;
};

export type GameEvent =
  | { type: 'RunStarted'; run: number }
  | { type: 'Moved'; to: Position }
  | { type: 'ZoneEntered'; zone: string }
  | { type: 'SecretFound'; secret: SecretId }
  | { type: 'StashCollected'; secret: SecretId; gold: number }
  | {
      type: 'Battle';
      spawn: SpawnId;
      enemy: EnemyId;
      win: boolean;
      rounds: number;
      heroMaxLife: number;
      enemyMaxLife: number;
      enemyLifeLeft: number;
      hitsTaken: number;
      log: BattleEvent[];
    }
  | ({ type: 'Rewards' } & RewardSummary)
  | { type: 'Allocated'; points: StatPoints }
  | { type: 'Equipped'; loadout: number; slot: SlotId; item: ItemId | null }
  | { type: 'LoadoutSwitched'; index: number }
  | { type: 'LoadoutRenamed'; index: number }
  | { type: 'Bought'; item: ItemId; price: number }
  | { type: 'LoadoutBought'; price: number }
  | { type: 'Salvaged'; success: boolean; item: ItemId | null; goldSpent: number; chance: number; boosted: boolean }
  | { type: 'HintShown'; hint: HintId };

export type RejectReason =
  | 'bad-seed'
  | 'blocked'
  | 'unknown-spawn'
  | 'not-adjacent'
  | 'boss-beaten'
  | 'no-energy'
  | 'bad-points'
  | 'bad-loadout'
  | 'wrong-slot'
  | 'unknown-item'
  | 'not-owned'
  | 'not-for-sale'
  | 'cap-reached'
  | 'no-gold'
  | 'no-gems'
  | 'loadouts-full'
  | 'bad-name'
  | 'salvage-used'
  | 'empty-pool'
  | 'unknown-secret'
  | 'already-collected'
  | 'unknown-hint'
  | 'unknown-action'
  | 'count-limit';

export type StepResult = { state: GameState; events: GameEvent[] } | { rejected: RejectReason };

const reject = (rejected: RejectReason): StepResult => ({ rejected });

const isCount = (value: number): boolean => Number.isInteger(value) && value >= 0;

/** The slot kinds an item may go in. A key is carried, never worn. */
const fits = (item: ItemDef, slot: SlotId): boolean => {
  if (item.kind === 'accessory') return (ACCESSORY_SLOTS as readonly string[]).includes(slot);
  return item.kind === slot;
};

const withItem = (state: GameState, item: ItemId): GameState => ({
  profile: { ...state.profile, items: { ...state.profile.items, [item]: owned(state, item) + 1 } },
  run: { ...state.run, tallies: { ...state.run.tallies, itemsGained: [...state.run.tallies.itemsGained, item] } },
});

/** Why a fight cannot start, or null if it can. The UI asks this to grey out the button with a reason. */
export const fightBlock = (state: GameState, spawnId: SpawnId, content: Content): RejectReason | null => {
  const spawn = content.spawns[spawnId];
  const enemy = enemyAtSpawn(content, spawnId);
  if (spawn === undefined || enemy === undefined) return 'unknown-spawn';
  if (enemy.boss && state.run.bossesBeaten.includes(enemy.id)) return 'boss-beaten';
  if (!isAdjacent(state.run.position, spawn.zone, spawn.x, spawn.y)) return 'not-adjacent';
  if (fightCost(enemy, content) > remainingEnergy(state, content)) return 'no-energy';
  if (state.run.battleCount >= Number.MAX_SAFE_INTEGER) return 'count-limit';
  return null;
};

const fight = (state: GameState, spawnId: SpawnId, content: Content): StepResult => {
  const blocked = fightBlock(state, spawnId, content);
  const enemy = enemyAtSpawn(content, spawnId);
  if (blocked !== null || enemy === undefined) return reject(blocked ?? 'unknown-spawn');
  const { balance } = content;
  const { profile, run } = state;

  const hero = deriveHero(state, content);
  const battleIndex = run.battleCount;
  const result = resolveBattle(hero, combatantOf(enemy), streamRng(run.seed, 'battle', battleIndex), balance, { log: true });
  const battle: GameEvent = {
    type: 'Battle',
    spawn: spawnId,
    enemy: enemy.id,
    win: result.win,
    rounds: result.rounds,
    heroMaxLife: result.heroMaxLife,
    enemyMaxLife: result.enemyMaxLife,
    enemyLifeLeft: result.enemyLife,
    hitsTaken: result.hitsTaken,
    log: result.log ?? [],
  };
  const timesBeaten = profile.bestiary[enemy.id]?.timesBeaten ?? 0;

  if (!result.win) {
    // A loss loses nothing, and charges nothing unless the balance table says a loss is charged like a win
    // (GDD 2.2, DV-10). A boss pays nothing back for a loss either way. The enemy is now seen (GDD 3.4).
    const charged = balance.energy.chargeLosses ? fightCost(enemy, content) : 0;
    return {
      state: {
        profile: { ...profile, bestiary: { ...profile.bestiary, [enemy.id]: { timesBeaten } } },
        run: { ...run, battleCount: battleIndex + 1, energySpent: run.energySpent + charged, lastEnemy: enemy.id, tallies: { ...run.tallies, losses: run.tallies.losses + 1 } },
      },
      events: [battle],
    };
  }

  // ---- a win, in the order of GDD 3.4 ----
  const mark = run.marks[spawnId] ?? null;
  const markFor = (stat: Mark['stat']): number => (mark !== null && mark.stat === stat ? mark.percent : 0);

  const cost = fightCost(enemy, content);
  let energyPaidBack = run.energyPaidBack;
  let claimedBosses = profile.claimedBosses;
  let claimed = false;
  if (enemy.boss) {
    energyPaidBack += cost;
    if (!claimedBosses.includes(enemy.id)) {
      if (hero.claim) {
        claimedBosses = [...claimedBosses, enemy.id];
        claimed = true;
      } else {
        energyPaidBack += balance.energy.bossSurplus;
      }
    }
  }

  const xp = xpReward(enemy, hero, markFor('xp'), balance);
  const levelBefore = hero.level;
  const afterXp: GameState = { profile, run: { ...run, xp: run.xp + xp } };
  const levelAfter = level(afterXp, balance);
  const growthPointsEarned = run.growthPointsEarned + (levelAfter - levelBefore) * hero.growth;

  const gold = goldReward(enemy, hero, markFor('gold'));

  const rewards = streamRng(run.seed, 'reward', battleIndex);
  const items = { ...profile.items };
  const drops: ItemId[] = [];
  for (const drop of dropsHeld(state, enemy, content)) {
    // The roll is drawn for every drop held when the battle began. The cap is tested again as each one falls,
    // so an item an enemy lists twice cannot pass its cap in one win.
    const fell = rewards.next() < dropChance(drop.chance, enemy, hero, markFor('drops'), balance);
    if (fell && (items[drop.item] ?? 0) < (content.items[drop.item]?.copyCap ?? 0)) {
      items[drop.item] = (items[drop.item] ?? 0) + 1;
      drops.push(drop.item);
    }
  }
  // The gem roll is always drawn. A boss gives its gems the first time it is ever beaten and none after (GDD 7.8).
  const gemRoll = rewards.next();
  const gems = enemy.boss ? (timesBeaten === 0 ? (zoneBalance(content, enemy.zone)?.bossGems ?? 0) : 0) : gemRoll < balance.gems.dropChance ? 1 : 0;

  // The win uses the mark up.
  const marks: Record<SpawnId, Mark> = {};
  for (const [id, carried] of Object.entries(run.marks)) if (id !== spawnId) marks[id] = carried;
  let spawnCount = run.spawnCount;
  if (!enemy.boss) {
    // It is back at once, and its mark is rolled again (GDD 5.5).
    const next = rollMark(run.seed, spawnCount, balance);
    spawnCount += 1;
    if (next !== null) marks[spawnId] = next;
  }

  const next: GameState = {
    profile: {
      ...profile,
      items,
      claimedBosses,
      gems: profile.gems + gems,
      bestiary: { ...profile.bestiary, [enemy.id]: { timesBeaten: timesBeaten + 1 } },
      strongestEverBeaten: Math.max(profile.strongestEverBeaten, enemy.level),
      counters: { ...profile.counters, bestLevel: Math.max(profile.counters.bestLevel, levelAfter) },
    },
    run: {
      ...run,
      battleCount: battleIndex + 1,
      spawnCount,
      xp: run.xp + xp,
      growthPointsEarned,
      gold: run.gold + gold,
      energySpent: run.energySpent + cost,
      energyPaidBack,
      bossesBeaten: enemy.boss ? [...run.bossesBeaten, enemy.id] : run.bossesBeaten,
      strongestBeaten: Math.max(run.strongestBeaten, enemy.level),
      lastEnemy: enemy.id,
      marks,
      tallies: {
        wins: run.tallies.wins + 1,
        losses: run.tallies.losses,
        itemsGained: [...run.tallies.itemsGained, ...drops],
        claims: run.tallies.claims + (claimed ? 1 : 0),
        gemsGained: run.tallies.gemsGained + gems,
      },
    },
  };
  const reward: GameEvent = {
    type: 'Rewards',
    xp,
    levelBefore,
    levelAfter,
    gold,
    drops,
    gems,
    claimed,
    energyCost: cost,
    energyBack: energyPaidBack - run.energyPaidBack,
    energyLeft: remainingEnergy(next, content),
    mark,
  };
  return { state: next, events: [battle, reward] };
};

const move = (state: GameState, dx: number, dy: number, content: Content): StepResult => {
  const from = state.run.position;
  if (!canStep(state, content, from, dx, dy, 'step')) return reject('blocked');
  let position: Position = { zone: from.zone, x: from.x + dx, y: from.y + dy };
  const events: GameEvent[] = [];
  let profile = state.profile;

  const hidden = content.index.hiddenAt[tileKey(position.zone, position.x, position.y)];
  if (hidden !== undefined && !profile.secretsFound.includes(hidden)) {
    profile = { ...profile, secretsFound: [...profile.secretsFound, hidden] };
    events.push({ type: 'SecretFound', secret: hidden });
  }
  const exit = content.index.exitAt[tileKey(position.zone, position.x, position.y)];
  if (exit !== undefined) {
    position = { ...exit.to };
    events.push({ type: 'ZoneEntered', zone: position.zone });
  }
  events.unshift({ type: 'Moved', to: position });
  return { state: { profile, run: { ...state.run, position } }, events };
};

const equip = (state: GameState, index: number, slot: SlotId, itemId: ItemId | null, content: Content): StepResult => {
  const loadout = state.profile.loadouts[index];
  if (loadout === undefined || !Number.isInteger(index)) return reject('bad-loadout');
  if (!(SLOT_IDS as readonly string[]).includes(slot)) return reject('wrong-slot');
  if (itemId !== null) {
    const item = content.items[itemId];
    if (item === undefined) return reject('unknown-item');
    if (!fits(item, slot)) return reject('wrong-slot');
    // Every owned copy can be worn at once, and no more than that (GDD 7.1).
    let elsewhere = 0;
    for (const other of SLOT_IDS) if (other !== slot && loadout.slots[other] === itemId) elsewhere += 1;
    if (owned(state, itemId) <= elsewhere) return reject('not-owned');
  }
  const loadouts = state.profile.loadouts.map((entry, at) => (at === index ? { ...entry, slots: { ...entry.slots, [slot]: itemId } } : entry));
  return { state: { ...state, profile: { ...state.profile, loadouts } }, events: [{ type: 'Equipped', loadout: index, slot, item: itemId }] };
};

const salvage = (state: GameState, boost: boolean, content: Content): StepResult => {
  const { balance } = content;
  // Where the hero stands is not asked: Salvage can be used from anywhere (GDD 7.4, DV-9).
  if (state.run.salvageUsed) return reject('salvage-used');
  const pool = salvagePool(state, content);
  // An empty pool takes no gold and uses no attempt (GDD 7.4).
  if (pool.length === 0) return reject('empty-pool');
  if (state.run.gold <= 0) return reject('no-gold');
  if (boost && state.profile.gems < balance.salvage.boostGems) return reject('no-gems');

  const chance = salvageChance(state, balance, boost);
  const rng = streamRng(state.run.seed, 'salvage', 0);
  const success = rng.next() < chance;
  const picked = pool[Math.min(pool.length - 1, Math.floor(rng.next() * pool.length))] ?? null;
  const goldSpent = state.run.gold;
  // A failed attempt still uses up the gold and the run's one attempt.
  let next: GameState = {
    profile: { ...state.profile, gems: state.profile.gems - (boost ? balance.salvage.boostGems : 0) },
    run: { ...state.run, gold: 0, salvageUsed: true },
  };
  const item = success ? picked : null;
  if (item !== null) next = withItem(next, item);
  return { state: next, events: [{ type: 'Salvaged', success: item !== null, item, goldSpent, chance, boosted: boost }] };
};

export const step = (state: GameState, action: Action, content: Content): StepResult => {
  if (typeof action !== 'object' || action === null) return reject('unknown-action');
  const { balance } = content;
  switch (action.type) {
    case 'NewRun': {
      if (!isUint32(action.seed)) return reject('bad-seed');
      if (state.profile.counters.runsStarted >= Number.MAX_SAFE_INTEGER) return reject('count-limit');
      const runsStarted = state.profile.counters.runsStarted + 1;
      return {
        state: { profile: { ...state.profile, counters: { ...state.profile.counters, runsStarted } }, run: freshRun(action.seed, content) },
        events: [{ type: 'RunStarted', run: runsStarted }],
      };
    }
    case 'Step':
      return move(state, action.dx, action.dy, content);
    case 'Fight':
      return fight(state, action.spawn, content);
    case 'Allocate': {
      const { points } = action;
      if (typeof points !== 'object' || points === null) return reject('bad-points');
      if (!STAT_KEYS.every((key) => isCount(points[key]))) return reject('bad-points');
      const total = sumPoints(points);
      if (total < 1 || total > unspentPoints(state, balance)) return reject('bad-points');
      const pointsSpent = zeroPoints();
      for (const key of STAT_KEYS) pointsSpent[key] = state.run.pointsSpent[key] + points[key];
      return { state: { ...state, run: { ...state.run, pointsSpent } }, events: [{ type: 'Allocated', points: { ...points } }] };
    }
    case 'Equip':
      return equip(state, action.loadout, action.slot, action.item, content);
    case 'SwitchLoadout': {
      if (!Number.isInteger(action.index) || state.profile.loadouts[action.index] === undefined) return reject('bad-loadout');
      return { state: { ...state, profile: { ...state.profile, activeLoadout: action.index } }, events: [{ type: 'LoadoutSwitched', index: action.index }] };
    }
    case 'RenameLoadout': {
      if (!Number.isInteger(action.index) || state.profile.loadouts[action.index] === undefined) return reject('bad-loadout');
      if (typeof action.name !== 'string' || action.name.length > balance.loadouts.nameMax) return reject('bad-name');
      const loadouts = state.profile.loadouts.map((entry, at) => (at === action.index ? { ...entry, name: action.name } : entry));
      return { state: { ...state, profile: { ...state.profile, loadouts } }, events: [{ type: 'LoadoutRenamed', index: action.index }] };
    }
    case 'Buy': {
      const item = content.items[action.item];
      // The second test turns away a name every object answers to, such as `constructor`, which is not an item.
      if (item === undefined || item.id !== action.item) return reject('unknown-item');
      const price = shopPrice(item, balance);
      if (price === null) return reject('not-for-sale');
      if (owned(state, item.id) >= item.copyCap) return reject('cap-reached');
      if (state.run.gold < price) return reject('no-gold');
      const paid: GameState = { ...state, run: { ...state.run, gold: state.run.gold - price } };
      return { state: withItem(paid, item.id), events: [{ type: 'Bought', item: item.id, price }] };
    }
    case 'BuyLoadoutSlot': {
      const price = loadoutPrice(state, balance);
      if (price === null) return reject('loadouts-full');
      if (state.run.gold < price) return reject('no-gold');
      return {
        state: { profile: { ...state.profile, loadouts: [...state.profile.loadouts, emptyLoadout()] }, run: { ...state.run, gold: state.run.gold - price } },
        events: [{ type: 'LoadoutBought', price }],
      };
    }
    case 'Salvage':
      return salvage(state, action.boost === true, content);
    case 'CollectStash': {
      const secret = content.secrets[action.secret];
      if (secret === undefined || secret.kind !== 'stash') return reject('unknown-secret');
      if (!isAdjacent(state.run.position, secret.zone, secret.x, secret.y)) return reject('not-adjacent');
      // A stash pays once per run; finding it is remembered (GDD 7.8).
      if (state.run.stashesCollected.includes(secret.id)) return reject('already-collected');
      const secretsFound = state.profile.secretsFound.includes(secret.id) ? state.profile.secretsFound : [...state.profile.secretsFound, secret.id];
      return {
        state: {
          profile: { ...state.profile, secretsFound },
          run: { ...state.run, gold: state.run.gold + secret.gold, stashesCollected: [...state.run.stashesCollected, secret.id] },
        },
        events: [{ type: 'StashCollected', secret: secret.id, gold: secret.gold }],
      };
    }
    case 'MarkHintShown': {
      if (!(HINT_IDS as readonly string[]).includes(action.hint)) return reject('unknown-hint');
      if (state.profile.hintsShown.includes(action.hint)) return reject('unknown-hint');
      return { state: { ...state, profile: { ...state.profile, hintsShown: [...state.profile.hintsShown, action.hint] } }, events: [{ type: 'HintShown', hint: action.hint }] };
    }
    default:
      // Not an action this version knows: one from a newer build, or not an action at all.
      return reject('unknown-action');
  }
};

/**
 * Brings a run in line with changed content (ARCHITECTURE 7.3). `profile` is never altered. Returns the same
 * object when nothing needed repair, so the caller can tell by identity.
 */
export const repairRun = (state: GameState, content: Content): GameState => {
  const { run } = state;
  let changed = false;
  const kept = <T>(list: readonly T[], keep: (entry: T) => boolean): T[] => {
    const out = list.filter(keep);
    if (out.length !== list.length) changed = true;
    return out;
  };

  const bossesBeaten = kept(run.bossesBeaten, (id) => content.enemies[id]?.boss === true);
  const stashesCollected = kept(run.stashesCollected, (id) => content.secrets[id]?.kind === 'stash');
  const itemsGained = kept(run.tallies.itemsGained, (id) => content.items[id] !== undefined);

  const marks: GameState['run']['marks'] = {};
  for (const [spawn, mark] of Object.entries(run.marks)) {
    const enemy = enemyAtSpawn(content, spawn);
    if (enemy !== undefined && !enemy.boss) marks[spawn] = mark;
    else changed = true;
  }

  let lastEnemy = run.lastEnemy;
  if (lastEnemy !== null && content.enemies[lastEnemy] === undefined) {
    lastEnemy = null;
    changed = true;
  }

  let position = run.position;
  if (!walkable(state, content, position.zone, position.x, position.y, 'step')) {
    position = { ...content.start };
    changed = true;
  }

  let pointsSpent = run.pointsSpent;
  const earned = content.balance.hero.pointsPerLevel * (level(state, content.balance) - 1) + run.growthPointsEarned;
  if (sumPoints(pointsSpent) > earned) {
    pointsSpent = zeroPoints();
    changed = true;
  }

  if (!changed) return state;
  return {
    profile: state.profile,
    run: { ...run, bossesBeaten, stashesCollected, marks, lastEnemy, position, pointsSpent, tallies: { ...run.tallies, itemsGained } },
  };
};
