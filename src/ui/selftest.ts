// The engine self-test (GDD 6.3, ARCHITECTURE section 8). The same function runs in the golden test under Node
// and from Settings on the phone, where it compares each result with the value baked in at build time. It is the
// only way to check Safari's arithmetic without a Mac.
//
// The battle and run replays are the golden replays: a fixed seed and loadout must give the same event-log hash.
// Their expected values change only with an intended balance or content change (tests/golden/golden.test.ts).

import { canonicalJson, deriveHero, findPath, forecast, hash, levelForXp, log10, newGame, owned, resolveBattle, shopPrice, step, streamRng, unspentPoints, xpForLevel } from '../engine';
import { SLOT_IDS } from '../engine';
import type { Action, Combatant, Content, GameState, ItemDef, Point, SpawnId, WalkMode } from '../engine';

export type SelfTestResult = { name: string; expected: string; actual: string; pass: boolean };

export type GoldenFile = { vectors: Record<string, string> };

const REPLAY_SEED = 20261012;

const rngIntegers = (): string => {
  const rng = streamRng(12345, 'battle', 7);
  const out: number[] = [];
  for (let i = 0; i < 1000; i += 1) out.push(rng.nextUint32());
  return hash(out.join(','));
};

const rngRolls = (): string => {
  const rng = streamRng(987654321, 'reward', 0);
  const out: string[] = [];
  for (let i = 0; i < 200; i += 1) out.push(String(rng.next()));
  return hash(out.join(','));
};

// Square roots of whole numbers across the game's range, printed in full. A browser that rounded one
// differently, or printed one differently, would change this hash.
const squareRoots = (): string => {
  const rng = streamRng(42, 'spawn', 0);
  const out: string[] = [];
  let scale = 1;
  for (let i = 0; i < 400; i += 1) {
    out.push(String(Math.sqrt(Math.floor(rng.next() * scale) + i)));
    if (i % 20 === 19) scale *= 10;
  }
  return hash(out.join(','));
};

const canonicalSample = (): string =>
  hash(
    canonicalJson({
      z: [1, 0.1, 1e21, 1e-7, -0, 123456789012345680000],
      a: { 'é': 'naïve', '\u{1F600}': 'face', b: null, a: true },
      text: 'line\nbreak\t"quoted" \\ slash',
    }),
  );

// The engine's own logarithm and the level formula, over the game's whole range of magnitudes.
const logsAndLevels = (): string => {
  const rng = streamRng(77, 'forecast', 0);
  const out: string[] = [];
  let scale = 1e-3;
  for (let i = 0; i < 400; i += 1) {
    const value = (rng.next() + 0.001) * scale;
    out.push(String(log10(value)), String(levelForXp(Math.floor(value * 1e6), 10)));
    if (i % 16 === 15) scale *= 10;
  }
  return hash(out.join(','));
};

const piece = (id: string, kind: ItemDef['kind'], lines: ItemDef['lines'], extra: Partial<ItemDef> = {}): ItemDef => ({
  id,
  kind,
  level: 1,
  lines,
  resist: {},
  versus: {},
  claim: false,
  copyCap: 1,
  priceFactor: null,
  ...extra,
});

// A made-up hero and enemy that between them use every effect and every trait, so every kind of roll is drawn.
const everyEffect = (content: Content): string => {
  const gear: ItemDef[] = [
    piece('t1', 'weapon', { damageFlat: 320, critChance: 15, critDamage: 40, extraHit: 30 }, { versus: { t4: 40 } }),
    piece('t2', 'body', { defenseFlat: 210, lifeFlat: 2400, lifePct: 25, lifeRegen: 4 }, { resist: { t4: 50, e1: 30 } }),
    piece('t3', 'feet', { dexterityFlat: 480, evasionPct: 300, extraAttack: 25, extraTurn: 20 }),
    piece('t4', 'accessory', { reflect: 20, lastStand: 2, damagePct: 35, growth: 1 }),
    // Two more accessories so that "adds" and "highest wins" both have something to disagree about.
    piece('t5', 'accessory', { lastStand: 1, growth: 2, luckFlat: 1500, luckPct: 20, goldBonus: 10 }),
    piece('t6', 'accessory', { luckFlat: 500, dropBonus: 15, xpBonus: 25, energy: 2, moveSpeed: 30 }),
  ];
  const hero = deriveHero(newGame(REPLAY_SEED, content), content, gear);
  const enemy: Combatant = { level: 300, life: 60000, damage: 900, defense: 400, tags: ['t4', 'e1'], traits: { doubleAttack: 60, tripleAttack: 40, regen: 2, damageReduction: 25 } };
  // The stats themselves are part of the value: a change to how Growth, Luck or any bonus stacks changes it.
  const out: unknown[] = [hero];
  for (let battle = 0; battle < 24; battle += 1) {
    const result = resolveBattle(hero, enemy, streamRng(REPLAY_SEED, 'battle', battle), content.balance, { log: true });
    out.push(result);
  }
  // Neither can finish the other: this one runs to the round limit, which is a loss (GDD 3.2).
  const wall: Combatant = { level: 300, life: 60000, damage: 1, defense: 900000, tags: [], traits: { doubleAttack: 0, tripleAttack: 0, regen: 50, damageReduction: 90 } };
  const stalemate = resolveBattle(hero, wall, streamRng(REPLAY_SEED, 'battle', 99), content.balance, { log: false });
  out.push(stalemate);
  return hash(canonicalJson(out));
};

type Replay = { state: GameState; trail: unknown[] };

const send = (replay: Replay, action: Action, content: Content): boolean => {
  const result = step(replay.state, action, content);
  if ('rejected' in result) {
    replay.trail.push({ action: action.type, rejected: result.rejected });
    return false;
  }
  replay.state = result.state;
  replay.trail.push(result.events);
  return true;
};

const walkTo = (replay: Replay, spawn: SpawnId, content: Content): void => {
  const target = content.spawns[spawn];
  if (target === undefined) return;
  const path = findPath(replay.state, content, replay.state.run.position, target, { beside: true }) ?? [];
  for (const tile of path) {
    const { x, y } = replay.state.run.position;
    send(replay, { type: 'Step', dx: tile.x - x, dy: tile.y - y }, content);
  }
};

const weakestFirst = (content: Content): SpawnId[] =>
  [...content.spawnOrder].sort((a, b) => (content.enemies[content.spawns[a]?.enemy ?? '']?.level ?? 0) - (content.enemies[content.spawns[b]?.enemy ?? '']?.level ?? 0));

/** Puts every owned item on, first come first served, so the replay exercises Equip without knowing the content. */
const wearEverything = (replay: Replay, content: Content): void => {
  for (const id of content.itemOrder) {
    const item = content.items[id];
    if (item === undefined || owned(replay.state, id) < 1 || item.claim || item.kind === 'key') continue;
    const loadout = replay.state.profile.loadouts[replay.state.profile.activeLoadout];
    const free = SLOT_IDS.find((slot) => (item.kind === 'accessory' ? slot.startsWith('acc') : slot === item.kind) && loadout?.slots[slot] === null);
    if (free !== undefined) send(replay, { type: 'Equip', loadout: replay.state.profile.activeLoadout, slot: free, item: id }, content);
  }
};

const fightRound = (replay: Replay, spawn: SpawnId, times: number, content: Content): void => {
  walkTo(replay, spawn, content);
  for (let i = 0; i < times; i += 1) {
    send(replay, { type: 'Fight', spawn }, content);
    const unspent = unspentPoints(replay.state, content.balance);
    if (unspent > 0) {
      const life = Math.floor(unspent / 3);
      const defense = Math.floor(unspent / 3);
      send(replay, { type: 'Allocate', points: { life, damage: unspent - life - defense, defense, dexterity: 0, luck: 0 } }, content);
    }
    wearEverything(replay, content);
  }
};

// Two runs played through the reducer on the shipped content: walking, fights won and lost, levels, drops,
// spending, gear and a new run. The whole state and every event are hashed.
const playRuns = (content: Content): Replay => {
  const replay: Replay = { state: newGame(REPLAY_SEED, content), trail: [] };
  const spawns = weakestFirst(content);
  for (const spawn of spawns.slice(0, 4)) fightRound(replay, spawn, 5, content);
  // One fight well above the hero, which should be lost: the strongest enemy it can walk up to. What a loss costs follows the balance table (GDD 2.2).
  const reachable = spawns.filter((spawn) => {
    const at = content.spawns[spawn];
    return at !== undefined && at.zone === replay.state.run.position.zone && findPath(replay.state, content, replay.state.run.position, at, { beside: true }) !== null;
  });
  const strongest = reachable[reachable.length - 1];
  if (strongest !== undefined) {
    walkTo(replay, strongest, content);
    send(replay, { type: 'Fight', spawn: strongest }, content);
  }
  for (const id of content.itemOrder) {
    const item = content.items[id];
    const price = item === undefined ? null : shopPrice(item, content.balance);
    if (item !== undefined && price !== null && price <= replay.state.run.gold) send(replay, { type: 'Buy', item: id }, content);
  }
  wearEverything(replay, content);
  const site = content.zones[replay.state.run.position.zone]?.map.salvageSites[0];
  if (site !== undefined) travel(replay, replay.state.run.position.zone, site, false, 'path', content);
  send(replay, { type: 'Salvage', boost: false }, content);
  send(replay, { type: 'NewRun', seed: 4294967295 }, content);
  for (const spawn of spawns.slice(0, 5)) fightRound(replay, spawn, 3, content);
  return replay;
};

/** A hero made strong by fiat: the XP of `heroLevel`, and every point it brings spent three ways. */
const strong = (state: GameState, heroLevel: number, content: Content): GameState => {
  const points = content.balance.hero.pointsPerLevel * (heroLevel - 1);
  const third = Math.floor(points / 3);
  return {
    profile: state.profile,
    run: { ...state.run, xp: xpForLevel(heroLevel, content.balance.xp.perLevel), pointsSpent: { life: third, damage: third, defense: points - 2 * third, dexterity: 0, luck: 0 } },
  };
};

/** Walks to a tile, or to a tile beside it, crossing zones through exits. `mode` "step" walks as steering would, through hidden tiles. */
const travel = (replay: Replay, zone: string, target: Point, beside: boolean, mode: WalkMode, content: Content): void => {
  for (let hops = 0; hops <= content.zoneOrder.length; hops += 1) {
    const here = replay.state.run.position;
    const exits = content.zones[here.zone]?.map.exits ?? [];
    const exit = exits.find((candidate) => candidate.to.zone === zone) ?? exits[0];
    const goal = here.zone === zone ? target : exit;
    if (goal === undefined) return;
    const path = findPath(replay.state, content, here, goal, { beside: here.zone === zone && beside, mode }) ?? [];
    for (const tile of path) {
      const { x, y } = replay.state.run.position;
      if (!send(replay, { type: 'Step', dx: tile.x - x, dy: tile.y - y }, content)) return;
    }
    if (here.zone === zone) return;
  }
};

// The rules a short run of weak fights never reaches: a secret and its stash, a boss with its payback, gems and
// handover, a boss that cannot be fought twice, the way on past a beaten gate, Salvage at a site, a Claim with
// the tool, and a run fought until the energy is gone. The hero is made strong by fiat so that it can.
const playMilestones = (content: Content): Replay => {
  const replay: Replay = { state: strong(newGame(REPLAY_SEED + 1, content), 2000, content), trail: [] };
  const spawns = weakestFirst(content);
  const isBoss = (spawn: SpawnId): boolean => content.enemies[content.spawns[spawn]?.enemy ?? '']?.boss === true;
  const weakest = spawns.find((spawn) => !isBoss(spawn));
  const boss = spawns.find(isBoss);
  const bossZone = boss === undefined ? undefined : content.spawns[boss]?.zone;

  for (const id of content.secretOrder) {
    const secret = content.secrets[id];
    if (secret === undefined || secret.kind !== 'stash') continue;
    travel(replay, secret.zone, secret, true, 'step', content);
    send(replay, { type: 'CollectStash', secret: id }, content);
    send(replay, { type: 'CollectStash', secret: id }, content);
  }
  if (weakest !== undefined) {
    walkTo(replay, weakest, content);
    for (let i = 0; i < 6; i += 1) send(replay, { type: 'Fight', spawn: weakest }, content);
  }
  if (boss !== undefined && bossZone !== undefined) {
    const at = content.spawns[boss];
    if (at !== undefined) travel(replay, bossZone, at, true, 'path', content);
    send(replay, { type: 'Fight', spawn: boss }, content);
    send(replay, { type: 'Fight', spawn: boss }, content);
    // On through the gate it was standing in, to the weakest enemy of the zone beyond.
    const beyond = spawns.find((spawn) => !isBoss(spawn) && content.spawns[spawn]?.zone !== bossZone);
    const there = beyond === undefined ? undefined : content.spawns[beyond];
    if (beyond !== undefined && there !== undefined) {
      travel(replay, there.zone, there, true, 'path', content);
      send(replay, { type: 'Fight', spawn: beyond }, content);
    }
  }
  for (const zone of content.zoneOrder) {
    const site = content.zones[zone]?.map.salvageSites[0];
    if (site === undefined) continue;
    travel(replay, zone, site, false, 'path', content);
    send(replay, { type: 'Salvage', boost: false }, content);
    send(replay, { type: 'Salvage', boost: false }, content);
    break;
  }

  // The next run: the tool goes on, and the boss that handed it over is claimed with it.
  send(replay, { type: 'NewRun', seed: 123456789 }, content);
  replay.state = strong(replay.state, 2000, content);
  const tool = content.itemOrder.find((id) => content.items[id]?.claim === true && owned(replay.state, id) > 0);
  if (tool !== undefined) send(replay, { type: 'Equip', loadout: replay.state.profile.activeLoadout, slot: 'weapon', item: tool }, content);
  if (boss !== undefined && bossZone !== undefined) {
    const at = content.spawns[boss];
    if (at !== undefined) travel(replay, bossZone, at, true, 'path', content);
    send(replay, { type: 'Fight', spawn: boss }, content);
  }
  // Fight until the energy is gone; the fight after that is turned away.
  if (weakest !== undefined) {
    const at = content.spawns[weakest];
    if (at !== undefined) travel(replay, at.zone, at, true, 'path', content);
    for (let i = 0; i < 200; i += 1) if (!send(replay, { type: 'Fight', spawn: weakest }, content)) break;
  }
  return replay;
};

/**
 * The two replays, unhashed, so a test can check that they still reach what they are there to reach. A replay
 * that quietly stops fighting bosses would otherwise go on matching its own golden value for ever.
 */
export const REPLAYS: Record<string, (content: Content) => { state: GameState; trail: unknown[] }> = {
  'run replay: two runs of the real game': playRuns,
  'milestone replay: a secret, a boss, the tool, a Claim, Salvage and an empty tank': playMilestones,
};

const hashed = (name: string) => (content: Content): string => hash(canonicalJson(REPLAYS[name]?.(content) ?? null));

// The forecast is a thousand battles on its own stream. It must agree to the last trial.
const forecasts = (content: Content): string => {
  const state = newGame(REPLAY_SEED, content);
  return hash(canonicalJson(weakestFirst(content).map((spawn) => forecast(state, spawn, content))));
};

export const SELF_TESTS: Record<string, (content: Content) => string> = {
  'hash: empty text': () => hash(''),
  'hash: abc': () => hash('abc'),
  'hash: two blocks': () => hash('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'),
  'hash: text beyond ASCII': () => hash('Fär—ther \u{1F600} still \ud800 end'),
  'generator: 1000 integers': rngIntegers,
  'generator: 200 rolls': rngRolls,
  'square roots: 400 values': squareRoots,
  'serialization: sorted keys and numbers': canonicalSample,
  'logarithms and levels: 400 values': logsAndLevels,
  'battle replay: every effect and trait, 24 battles': everyEffect,
  'run replay: two runs of the real game': hashed('run replay: two runs of the real game'),
  'milestone replay: a secret, a boss, the tool, a Claim, Salvage and an empty tank': hashed('milestone replay: a secret, a boss, the tool, a Claim, Salvage and an empty tank'),
  'forecast: every enemy, bare hero': forecasts,
};

export const runSelfTest = (golden: GoldenFile, content: Content): SelfTestResult[] =>
  Object.entries(SELF_TESTS).map(([name, compute]) => {
    const expected = golden.vectors[name] ?? '(no expected value)';
    let actual: string;
    try {
      actual = compute(content);
    } catch (error) {
      actual = `threw: ${error instanceof Error ? error.message : String(error)}`;
    }
    return { name, expected, actual, pass: actual === expected };
  });
