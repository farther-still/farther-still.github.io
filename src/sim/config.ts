// What a simulation is run with (ARCHITECTURE section 10): a player strategy, the energy rule, and a balance
// variant. Strategies and variants are named entries in the two JSON files beside this one, so a new one is a
// data change. A variant is a set of candidate numbers laid over data/balance.json for a simulation only: the
// game's own numbers stay in data/, and nothing here ships.

import { z } from 'zod';
import { BUNDLED, parseContent } from '../content';
import type { Content, StatSplit } from '../engine';
import recordedFile from './recorded.json';
import strategiesFile from './strategies.json';
import variantsFile from './variants.json';

const share = z.number().min(0).max(1);
const points = z.number().min(0).max(100);

const strategySchema = z.strictObject({
  about: z.string().min(1),
  split: z.strictObject({ life: points, damage: points, defense: points, dexterity: points, luck: points }),
  minWinChance: share,
  bossWinChance: share,
  patience: z.int().positive(),
  bossPatience: z.int().positive(),
  bossAtRunEnd: share.nullable(),
  bossReserve: z.int().positive(),
  farmAtRatio: z.number().positive().nullable(),
  shop: z.enum(['dearest', 'run-end', 'never']),
  salvage: z.enum(['always', 'never']),
  forecastTrials: z.int().positive(),
});

export type Strategy = {
  name: string;
  /** One sentence for the summary. */
  about: string;
  /** How new stat points are divided. */
  split: StatSplit;
  /** The forecast a normal enemy needs before the player will fight it. */
  minWinChance: number;
  /** The forecast a boss needs. */
  bossWinChance: number;
  /** Losses to one normal enemy, since last beating it, before the player gives up on it for the run. */
  patience: number;
  /** The same for a boss, and the most last-gasp attempts it makes at one. */
  bossPatience: number;
  /** With its last energy the player tries a boss it gives at least this, however poor (DV-3). Null: it does not. */
  bossAtRunEnd: number | null;
  /** Where a loss is charged, the energy held back for those attempts. Where a loss is free they cost nothing, and this is not read. */
  bossReserve: number;
  /** The hero turns from climbing to collecting drops once its level is this many times the best enemy it can beat. Null: it never does. */
  farmAtRatio: number | null;
  /** `dearest`: after every win, buys the dearest thing it can afford until nothing is affordable. `run-end`: does that once, when the run's energy is spent, so what it buys helps from the next run on. */
  shop: 'dearest' | 'run-end' | 'never';
  /** `always`: puts the gold it ends the run with into the one Salvage attempt. */
  salvage: 'always' | 'never';
  /** Trial battles per forecast. Fewer than the game's own, to keep the simulator quick. */
  forecastTrials: number;
};

const variantSchema = z.strictObject({
  about: z.string().min(1),
  /** Dotted paths into data/balance.json, each with the number to try there. */
  set: z.record(z.string(), z.number()),
  /** Drop chances to try, in percent, each keyed by enemy and item: `e009/i003`. Content is tuned by ID, without being named. */
  drops: z.record(z.string().regex(/^e\d{3}\/i\d{3}$/), z.number().positive().max(100)),
});

export type Variant = { name: string; about: string; set: Readonly<Record<string, number>>; drops: Readonly<Record<string, number>> };

const named = <T>(what: string, table: Record<string, T>, name: string): T & { name: string } => {
  if (!Object.hasOwn(table, name)) throw new Error(`sim: there is no ${what} called "${name}". There are: ${Object.keys(table).join(', ')}`);
  return { ...(table[name] as T), name };
};

const STRATEGIES = z.record(z.string(), strategySchema).parse(strategiesFile);
const VARIANTS = z.record(z.string(), variantSchema).parse(variantsFile);

export const strategyNames = (): string[] => Object.keys(STRATEGIES);
export const variantNames = (): string[] => Object.keys(VARIANTS);
export const strategyNamed = (name: string): Strategy => named('strategy', STRATEGIES, name);
export const variantNamed = (name: string): Variant => named('variant', VARIANTS, name);

/** `shipped` is whatever data/balance.json says; the other two set the switch (GDD 2.2, DV-10). */
export const RULES = ['shipped', 'free', 'charged'] as const;
export type Rule = (typeof RULES)[number];

/** Sets one existing number in a parsed JSON tree. A path that names nothing is an error, never a new field. */
const setPath = (root: unknown, path: string, value: number | boolean): void => {
  const keys = path.split('.');
  let at = root;
  for (const [index, key] of keys.entries()) {
    if (typeof at !== 'object' || at === null || !Object.hasOwn(at, key)) throw new Error(`sim: a variant sets "${path}", which is not in data/balance.json`);
    const holder = at as Record<string, unknown>;
    if (index < keys.length - 1) {
      at = holder[key];
      continue;
    }
    if (typeof holder[key] !== typeof value) throw new Error(`sim: a variant sets "${path}" to a ${typeof value}, where data/balance.json has a ${typeof holder[key]}`);
    holder[key] = value;
  }
};

/** The game's content with a rule and a variant laid over it. Parsed like the real thing, so a bad number stops here. */
export const contentFor = (rule: Rule, variant: Variant): Content => {
  const raw = structuredClone(BUNDLED) as unknown as { balance: unknown; zones: unknown; enemies: { enemies: Array<{ id: string; drops: Array<{ item: string; chance: number }> }> }; items: unknown; maps: unknown[]; strings: unknown };
  for (const [path, value] of Object.entries(variant.set)) setPath(raw.balance, path, value);
  if (rule !== 'shipped') setPath(raw.balance, 'energy.chargeLosses', rule === 'charged');
  for (const [key, chance] of Object.entries(variant.drops)) {
    const [enemyId, itemId] = key.split('/');
    const drop = raw.enemies.enemies.find((enemy) => enemy.id === enemyId)?.drops.find((entry) => entry.item === itemId);
    if (drop === undefined) throw new Error(`sim: a variant sets the drop "${key}", which no enemy has`);
    drop.chance = chance;
  }
  return parseContent(raw).content;
};

/** What a configuration is called in a table: the rule in force, then the variant, then the strategy. */
export type Config = { rule: Rule; variant: Variant; strategy: Strategy };

export const ruleInForce = (content: Content): 'free' | 'charged' => (content.balance.energy.chargeLosses ? 'charged' : 'free');

export const labelOf = (config: Config, content: Content): string => `${ruleInForce(content)} · ${config.variant.name} · ${config.strategy.name}`;

// ---- the one real playthrough on record ----

const recordedSchema = z.strictObject({
  source: z.string(),
  rule: z.enum(['free', 'charged']),
  /** The run on which the first gate boss fell. */
  gateRun: z.int().positive(),
  /** Fights at that boss on that run, the winning one included, as the player recalled them. */
  gateTries: z.strictObject({ min: z.int().positive(), max: z.int().positive() }),
  runs: z.array(z.strictObject({ run: z.int().positive(), seconds: z.int().positive(), wins: z.int().nonnegative(), level: z.int().positive() })).min(1),
});

export type Recorded = z.infer<typeof recordedSchema>;

export const RECORDED: Recorded = recordedSchema.parse(recordedFile);
