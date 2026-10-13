// Two questions the simulator answers from the formulas alone, with no player (`npm run sim -- --probes`):
// where `goldAt` falls between one zone's level band and the next (GDD 5.7), and at what level the
// permanent-energy tool can beat each boss (GDD 2.3, R-06). Neither needs zones that are not built yet.

import { combatantOf, deriveHero, forecastBattle, goldAt, newGame, splitPolicy, xpForLevel, zeroPoints } from '../engine';
import type { Balance, Content, EnemyDef, GameState, ItemId, SlotId, StatSplit } from '../engine';

// ---- goldAt at zone edges ----

export type GoldEdge = {
  from: string;
  to: string;
  /** The last level of one band and `goldAt` there. */
  topLevel: number;
  topGold: number;
  /** The first level of the next band and `goldAt` there. */
  nextLevel: number;
  nextGold: number;
  /** How far it falls, 0 to 1. */
  fall: number;
  /** The first level of the next band at which `goldAt` is back to what it was at the top of the band before. */
  recoversAt: number;
  /** That stretch as a share of the next band's levels, 0 to 1. */
  shareOfBand: number;
};

/** Gold is compared to this many parts of a coin, so that a rounding error in a product is not read as a shortfall. */
const TOLERANCE = 1e-6;

export const goldEdges = (balance: Balance): GoldEdge[] => {
  const bands = Object.entries(balance.zones).sort((a, b) => a[1].levelMin - b[1].levelMin);
  const edges: GoldEdge[] = [];
  for (let index = 0; index + 1 < bands.length; index += 1) {
    const [from, low] = bands[index] as (typeof bands)[number];
    const [to, high] = bands[index + 1] as (typeof bands)[number];
    const topGold = goldAt(low.levelMax, balance);
    const nextGold = goldAt(high.levelMin, balance);
    // A whole level is found by counting up, not by dividing: 450,000 × 1.1 is a hair over 495,000 in a double.
    let recoversAt = Math.max(high.levelMin, Math.floor(topGold / high.goldPerLevel) - 1);
    while (recoversAt * high.goldPerLevel < topGold - TOLERANCE) recoversAt += 1;
    edges.push({
      from,
      to,
      topLevel: low.levelMax,
      topGold,
      nextLevel: high.levelMin,
      nextGold,
      fall: topGold > 0 ? Math.max(0, 1 - nextGold / topGold) : 0,
      recoversAt,
      shareOfBand: (recoversAt - high.levelMin) / Math.max(1, high.levelMax - high.levelMin + 1),
    });
  }
  return edges;
};

/** Shop items whose level sits in a stretch where `goldAt` is still below the band before: they are priced under an item meant for a lower level. */
export const itemsInDips = (content: Content): ItemId[] => {
  const edges = goldEdges(content.balance);
  return content.itemOrder.filter((id) => {
    const item = content.items[id];
    return item !== undefined && item.priceFactor !== null && edges.some((edge) => item.level >= edge.nextLevel && item.level < edge.recoversAt);
  });
};

// ---- the first Claim ----

const TRIALS = 400;

/** A hero at `level` with its points spent by `split`, in `slots`, owning what it wears. Nothing else about the run matters to a forecast. */
const heroAt = (level: number, split: StatSplit, slots: Record<SlotId, ItemId | null>, content: Content): GameState => {
  const base = newGame(1, content);
  const items: Record<ItemId, number> = {};
  for (const id of Object.values(slots)) if (id !== null) items[id] = (items[id] ?? 0) + 1;
  const first = base.profile.loadouts[0];
  if (first === undefined) throw new Error('sim: a new game has no loadout');
  const bare: GameState = {
    profile: { ...base.profile, items, loadouts: [{ ...first, slots }, ...base.profile.loadouts.slice(1)], activeLoadout: 0 },
    run: { ...base.run, xp: xpForLevel(level, content.balance.xp.perLevel) },
  };
  const unspent = content.balance.hero.pointsPerLevel * (level - 1);
  const pointsSpent = unspent > 0 ? splitPolicy(split)({ unspent, spent: zeroPoints(), hero: deriveHero(bare, content) }) : zeroPoints();
  return { ...bare, run: { ...bare.run, pointsSpent } };
};

const chanceAt = (level: number, split: StatSplit, slots: Record<SlotId, ItemId | null>, boss: EnemyDef, content: Content): number => {
  const state = heroAt(level, split, slots, content);
  return forecastBattle(deriveHero(state, content), combatantOf(boss), 1, level, content.balance, TRIALS).winChance;
};

/** The lowest level at which the win chance reaches `want`, to the nearest level, or null if it has not by `ceiling`. */
const levelFor = (want: number, ceiling: number, chance: (level: number) => number): number | null => {
  if (chance(ceiling) < want) return null;
  let low = 1;
  let high = ceiling;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (chance(middle) >= want) high = middle;
    else low = middle + 1;
  }
  return low;
};

export type ClaimProjection = {
  boss: string;
  bossLevel: number;
  /** The level at which the boss falls half the time, and nine times in ten, in the zone's reference loadout with its own weapon. */
  plain: { half: number | null; most: number | null };
  /** The same with the tool in the weapon slot, which is what a Claim takes. */
  withTool: { half: number | null; most: number | null };
};

/**
 * For each boss whose zone has a reference loadout: the hero level a Claim needs, with that zone's gear only.
 * Gear from later zones would bring the level down, so this is the latest a Claim could land, not when it will.
 */
export const claimProjections = (content: Content, split: StatSplit): ClaimProjection[] => {
  const tool = content.itemOrder.find((id) => content.items[id]?.claim === true);
  const out: ClaimProjection[] = [];
  for (const id of content.enemyOrder) {
    const boss = content.enemies[id];
    const slots = boss === undefined ? null : (content.zones[boss.zone]?.referenceLoadout ?? null);
    if (boss === undefined || !boss.boss || slots === null || tool === undefined) continue;
    const ceiling = boss.level * 40;
    const find = (worn: Record<SlotId, ItemId | null>): { half: number | null; most: number | null } => ({
      half: levelFor(0.5, ceiling, (level) => chanceAt(level, split, worn, boss, content)),
      most: levelFor(0.9, ceiling, (level) => chanceAt(level, split, worn, boss, content)),
    });
    out.push({ boss: boss.id, bossLevel: boss.level, plain: find(slots), withTool: find({ ...slots, weapon: tool }) });
  }
  return out;
};

// ---- markdown ----

const table = (head: readonly string[], rows: readonly (readonly string[])[]): string[] => [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((row) => `| ${row.join(' | ')} |`)];
const whole = (value: number): string => String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const pct = (share: number): string => `${Math.round(share * 100)}%`;

export const formatProbes = (content: Content, splits: ReadonlyArray<{ name: string; split: StatSplit }>): string => {
  const lines: string[] = ['# Simulator probes', '', 'Worked out from the formulas and the balance table alone. No simulated player is involved. Content is named by ID.', ''];
  lines.push('## goldAt at zone edges', '');
  lines.push('`goldAt(L)` is `L × gold per level` for the band that holds `L` (GDD 5.7), and gold per level steps down from one zone to the next, so `goldAt` falls at each edge. Shop prices, loadout prices and the Salvage chance are built on it. Enemy gold is not: it uses the enemy\'s own zone.', '');
  lines.push(
    ...table(
      ['Edge', 'Top of the band', 'Start of the next', 'Fall', 'Back to the old value at level', 'Share of the next band spent below it'],
      goldEdges(content.balance).map((edge) => [`${edge.from} to ${edge.to}`, `level ${whole(edge.topLevel)}: ${whole(edge.topGold)}`, `level ${whole(edge.nextLevel)}: ${whole(edge.nextGold)}`, pct(edge.fall), whole(edge.recoversAt), pct(edge.shareOfBand)]),
    ),
    '',
  );
  const dipped = itemsInDips(content);
  lines.push(`Shop items priced inside one of those stretches today: ${dipped.length === 0 ? 'none' : dipped.join(', ')}. Loadout prices are set at levels ${content.balance.loadouts.priceLevels.map(whole).join(', ')}; ${content.balance.loadouts.priceLevels.some((level) => goldEdges(content.balance).some((edge) => level >= edge.nextLevel && level < edge.recoversAt)) ? 'at least one sits inside a stretch' : 'none sits inside a stretch'}.`, '');

  lines.push('## The first Claim', '');
  lines.push(`A Claim is a boss beaten with the tool in the weapon slot, which cuts Damage by ${content.balance.claim.damageCutPct}% (GDD 2.3). The levels below are for a hero in the boss's own zone's reference loadout, with its points spent by the split named. Gear from later zones would lower them, and no later zone is built, so each is the latest a Claim could land and not a forecast of when it will.`, '');
  for (const { name, split } of splits) {
    lines.push(
      `Split "${name}" (Life ${split.life}, Damage ${split.damage}, Defense ${split.defense}, Dexterity ${split.dexterity}, Luck ${split.luck}):`,
      '',
      ...table(
        ['Boss', 'Its level', 'Beaten half the time from level', 'Nine times in ten from', 'Claimed half the time from level', 'Nine times in ten from'],
        claimProjections(content, split).map((entry) => [entry.boss, whole(entry.bossLevel), String(entry.plain.half ?? 'never'), String(entry.plain.most ?? 'never'), String(entry.withTool.half ?? 'never'), String(entry.withTool.most ?? 'never')]),
      ),
      '',
    );
  }
  return `${lines.join('\n').trimEnd()}\n`;
};
