import { describe, expect, it } from 'vitest';
import { resolveBattle, shareRemoved } from './battle';
import { canonicalJson } from './canonical';
import { forecast, forecastBattle } from './forecast';
import type { Forecast } from './forecast';
import { combatantOf, deriveHero, dodgeChance, hitChance } from './formulas';
import { streamRng, streamSeed } from './rng';
import { SAMPLE_BALANCE, sampleContent, sampleGame } from './sample.fixture';
import type { GameState } from './state';
import type { Balance, Combatant, EnemyTraits, HeroStats, Tag, TagValues } from './types';

// GDD 3.5 and DV-2: the pre-fight forecast and the one line that says what is limiting the hero.

const B: Balance = SAMPLE_BALANCE;
const content = sampleContent();

const deepFreeze = <T>(value: T): T => {
  if (typeof value === 'object' && value !== null) {
    for (const inner of Object.values(value)) deepFreeze(inner);
    Object.freeze(value);
  }
  return value;
};

const must = <T>(value: T | undefined | null, what: string): T => {
  if (value === undefined || value === null) throw new Error(`test setup: no ${what}`);
  return value;
};

const NO_TAGS: TagValues = { e1: 0, e2: 0, e3: 0, t1: 0, t2: 0, t3: 0, t4: 0 };

/** The enemy in the built fights is level 100, so its rating is 200: a hero with Accuracy and Evasion of 200 hits 90% of the time and dodges 10%. */
const RATING = 200;

const heroOf = (over: Partial<HeroStats> = {}): HeroStats => {
  const stat = (final: number): { base: number; mult: number; final: number } => ({ base: final, mult: 1, final });
  return {
    level: 1,
    core: { life: stat(100), damage: stat(10), defense: stat(0), dexterity: stat(0), luck: stat(0) },
    life: 100,
    damage: 10,
    defense: 0,
    dexterity: 0,
    luck: 0,
    accuracy: RATING,
    evasion: RATING,
    critChance: 0,
    critDamage: 1.5,
    extraHit: 0,
    extraAttack: 0,
    extraTurn: 0,
    xpBonus: 0,
    goldBonus: 0,
    dropBonus: 0,
    lifeRegen: 0,
    reflect: 0,
    lastStand: 0,
    growth: 0,
    moveSpeed: 0,
    energy: 0,
    resist: { ...NO_TAGS },
    versus: { ...NO_TAGS },
    claim: false,
    ...over,
  };
};

type EnemyOver = { life?: number; damage?: number; defense?: number; tags?: readonly Tag[]; traits?: Partial<EnemyTraits> };

const enemyOf = (over: EnemyOver = {}): Combatant => ({
  level: 100,
  life: over.life ?? 1000,
  damage: over.damage ?? 20,
  defense: over.defense ?? 0,
  tags: over.tags ?? [],
  traits: { doubleAttack: 0, tripleAttack: 0, regen: 0, damageReduction: 0, ...over.traits },
});

const SEEDS = [1, 2, 3, 4, 5];

/** The forecast of a built fight on each of a few seeds, so no line rests on one lucky stream. */
const onEachSeed = (hero: HeroStats, enemy: Combatant): Forecast[] => SEEDS.map((seed) => forecastBattle(hero, enemy, seed, 0, B));

const game = (run: Partial<GameState['run']> = {}): GameState => {
  const base = sampleGame();
  return { profile: base.profile, run: { ...base.run, ...run } };
};

describe('forecast (GDD 3.5)', () => {
  it('runs 1,000 trial battles and reports the share won', () => {
    const result = must(forecast(game(), 's001', content), 'forecast');
    expect(result.trials).toBe(1000);
    expect(Number.isInteger(result.wins)).toBe(true);
    expect(result.wins).toBeGreaterThanOrEqual(0);
    expect(result.wins).toBeLessThanOrEqual(1000);
    expect(result.winChance).toBe(result.wins / 1000);
  });

  it('reports the hit and dodge chances of GDD 3.1 for this hero against this enemy', () => {
    const state = game();
    const hero = deriveHero(state, content);
    const result = must(forecast(state, 's001', content), 'forecast');
    // A new hero against the level 2 enemy at s001: Accuracy and Evasion 100 against a rating of 102.
    expect(result.hitChance).toBe(hitChance(hero.accuracy, 2, B));
    expect(result.dodgeChance).toBe(dodgeChance(hero.evasion, 2, B));
    expect(result.hitChance).toBeCloseTo(1 - 0.1 * 1.02 * 1.02, 12);
    expect(result.dodgeChance).toBeCloseTo(0.1 / 1.02, 12);
  });

  it('is the same every time for the same state', () => {
    const state = game();
    expect(forecast(state, 's001', content)).toEqual(forecast(state, 's001', content));
    expect(forecast(game({ battleCount: 4 }), 's002', content)).toEqual(forecast(game({ battleCount: 4 }), 's002', content));
  });

  it('draws from a different stream when battleCount differs', () => {
    // A fight a new hero wins about four times in five, so the count of wins moves with the stream.
    const wins = [0, 1, 2, 3, 4, 5].map((battleCount) => must(forecast(game({ battleCount }), 's001', content), 'forecast').wins);
    expect(new Set(wins).size).toBeGreaterThan(1);
    for (const count of wins) {
      expect(count).toBeGreaterThan(500);
      expect(count).toBeLessThan(1000);
    }
  });

  it('draws from a different stream when the run seed differs', () => {
    const wins = [7, 8, 9, 10, 11, 12].map((seed) => must(forecast(game({ seed }), 's001', content), 'forecast').wins);
    expect(new Set(wins).size).toBeGreaterThan(1);
  });

  it('reads the run seed and the battle counter and nothing else of the run', () => {
    const plain = forecast(game({ battleCount: 2 }), 's001', content);
    const busy = forecast(game({ battleCount: 2, gold: 999, spawnCount: 40, energySpent: 6, salvageUsed: true, position: { zone: 'z01', x: 1, y: 1 } }), 's001', content);
    expect(busy).toEqual(plain);
  });

  it('is for the hero as they stand now', () => {
    const state = game();
    const hero = deriveHero(state, content);
    const enemy = combatantOf(must(content.enemies['e001'], 'enemy'));
    expect(forecast(state, 's001', content)).toEqual(forecastBattle(hero, enemy, state.run.seed, state.run.battleCount, B));
    // Thirty points of Damage make the same fight a near certainty.
    const stronger = game({ pointsSpent: { life: 0, damage: 30, defense: 0, dexterity: 0, luck: 0 } });
    expect(must(forecast(stronger, 's001', content), 'forecast').winChance).toBeGreaterThan(must(forecast(state, 's001', content), 'forecast').winChance);
  });

  it('never changes the state or the content', () => {
    const state = deepFreeze(game({ battleCount: 3 }));
    const frozen = deepFreeze(sampleContent());
    const before = canonicalJson(state);
    const contentBefore = canonicalJson(frozen.balance);
    for (const spawn of ['s001', 's002', 's003', 's004']) expect(forecast(state, spawn, frozen)).not.toBeNull();
    expect(canonicalJson(state)).toBe(before);
    expect(canonicalJson(frozen.balance)).toBe(contentBefore);
    expect(state.run.battleCount).toBe(3);
  });

  it('gives null for a spawn that does not exist', () => {
    expect(forecast(game(), 's999', content)).toBeNull();
    expect(forecast(game(), '', content)).toBeNull();
  });

  it('runs as many trials as it is asked for', () => {
    expect(must(forecast(game(), 's001', content, 50), 'forecast').trials).toBe(50);
    expect(forecastBattle(heroOf(), enemyOf(), 1, 0, { ...B, forecast: { ...B.forecast, trials: 120 } }).trials).toBe(120);
  });

  it('uses the forecast stream, which is not the stream the real battle draws from (GDD 3.3)', () => {
    expect(streamSeed(7, 'forecast', 0)).not.toEqual(streamSeed(7, 'battle', 0));
    // One trial is one battle on the forecast stream. Across seeds it does not track the real battle.
    const hero = heroOf({ damage: 20 });
    const enemy = enemyOf({ life: 100 });
    let same = 0;
    for (let seed = 0; seed < 60; seed += 1) {
      const trial = forecastBattle(hero, enemy, seed, 0, B, 1);
      expect(trial.wins).toBe(resolveBattle(hero, enemy, streamRng(seed, 'forecast', 0), B, { log: false }).win ? 1 : 0);
      const real = resolveBattle(hero, enemy, streamRng(seed, 'battle', 0), B, { log: false });
      if ((trial.wins === 1) === real.win) same += 1;
    }
    expect(same).toBeLessThan(60);
  });

  it('agrees with a fight whose odds can be worked out by hand', () => {
    // Whoever lands a hit first wins. The hero strikes first and hits 90% of the time; the enemy's blow is
    // dodged 10% of the time. So the chance is 0.9 ÷ (1 − 0.1 × 0.1) = 90.9%, and 1,000 trials are good to
    // about 2 points.
    const hero = heroOf({ life: 10, damage: 100 });
    const enemy = enemyOf({ life: 100, damage: 100 });
    for (const result of onEachSeed(hero, enemy)) expect(Math.abs(result.winChance - 0.9 / 0.99)).toBeLessThan(0.03);
  });
});

describe('limiting factor (GDD 3.5)', () => {
  it('1: says the hero misses too often when the hit chance is under 60%', () => {
    // Accuracy at the rating ÷ 2.2: 1 − 0.1 × 2.2² = 51.6%.
    const hero = heroOf({ accuracy: RATING / 2.2 });
    for (const result of onEachSeed(hero, enemyOf())) {
      expect(result.winChance).toBeLessThan(0.9);
      expect(result.factor).toEqual({ kind: 'miss', hitPercent: 51 });
    }
  });

  it('1: does not say so at exactly 60%', () => {
    // Accuracy at half the rating: 1 − 0.1 × 4.
    const hero = heroOf({ accuracy: RATING / 2 });
    for (const result of onEachSeed(hero, enemyOf())) {
      expect(result.hitChance).toBeCloseTo(0.6, 12);
      expect(result.factor?.kind).not.toBe('miss');
    }
  });

  it('2: says how many hits kill the hero when the hero usually dies in the enemy’s first turn', () => {
    for (const result of onEachSeed(heroOf({ life: 10 }), enemyOf({ damage: 100 }))) expect(result.factor).toEqual({ kind: 'burst', hits: 1 });
    // Three attacks of 10 into 25 Life: dead on the third, unless one is dodged.
    const flurry = enemyOf({ damage: 10, traits: { doubleAttack: 100, tripleAttack: 100 } });
    for (const result of onEachSeed(heroOf({ life: 25 }), flurry)) expect(result.factor).toEqual({ kind: 'burst', hits: 3 });
  });

  it('2: does not say so for a hero who lasts into a second round', () => {
    // Two hits of 20 into 30 Life: the hero falls in round 2, never in round 1.
    for (const result of onEachSeed(heroOf({ life: 30 }), enemyOf({ damage: 20 }))) expect(result.factor?.kind).not.toBe('burst');
  });

  it('2: does not say so for a hero who dies in the first turn now and then, but not usually', () => {
    // The same fight with a double attack three times in ten: both blows land in about a quarter of the trials.
    const sometimes = enemyOf({ damage: 20, traits: { doubleAttack: 30 } });
    for (const result of onEachSeed(heroOf({ life: 30 }), sometimes)) {
      expect(result.winChance).toBe(0);
      expect(result.factor?.kind).toBe('rounds');
    }
    // Eight times in ten it is more often than not: 0.8 × 0.9 × 0.9 = 65%.
    const mostly = enemyOf({ damage: 20, traits: { doubleAttack: 80 } });
    for (const result of onEachSeed(heroOf({ life: 30 }), mostly)) expect(result.factor).toEqual({ kind: 'burst', hits: 2 });
  });

  it('3: says the enemy heals faster than the hero hurts it', () => {
    // The hero deals 10 a round at most and the enemy heals up to 50 a turn.
    const mender = enemyOf({ damage: 30, traits: { regen: 5 } });
    for (const result of onEachSeed(heroOf(), mender)) {
      expect(result.winChance).toBe(0);
      expect(result.factor).toEqual({ kind: 'regen' });
    }
  });

  it('3: holds with Reflect in the hero’s damage', () => {
    const mender = enemyOf({ damage: 30, traits: { regen: 5 } });
    for (const result of onEachSeed(heroOf({ reflect: 10 }), mender)) expect(result.factor).toEqual({ kind: 'regen' });
  });

  it('3: holds when a rare big hit outruns one turn of healing, as long as the average does not', () => {
    // GDD 3.5: "the enemy heals at least as much per round as the hero deals". The enemy can heal 50 a turn and
    // the hero averages about 15 a round, though a crit does 80. The rule compares what the enemy CAN heal in
    // a turn with the hero's average damage per round. What it actually healed is no guide: healing stops at
    // full life, so a trial that ends just after a crit would otherwise lose the line and read as "you need
    // about 1,600 rounds".
    const mender = enemyOf({ damage: 30, traits: { regen: 5 } });
    const spiky = heroOf({ critChance: 0.1, critDamage: 8 });
    for (const result of onEachSeed(spiky, mender)) {
      expect(result.winChance).toBe(0);
      expect(result.factor).toEqual({ kind: 'regen' });
    }
  });

  it('4: says how much of the hero’s damage the enemy shrugs off when Defense and damage reduction remove over 80%', () => {
    // Damage 10 into Defense 90: a tenth gets through.
    const plated = enemyOf({ damage: 30, defense: 90 });
    for (const result of onEachSeed(heroOf(), plated)) expect(result.factor).toEqual({ kind: 'shrug', percent: 90 });
    const warded = enemyOf({ damage: 30, traits: { damageReduction: 85 } });
    for (const result of onEachSeed(heroOf(), warded)) expect(result.factor).toEqual({ kind: 'shrug', percent: 85 });
    // Defense 30 removes three quarters and a 40% reduction takes the rest to 85%.
    const both = enemyOf({ damage: 30, defense: 30, traits: { damageReduction: 40 } });
    expect(shareRemoved(heroOf(), both)).toBeCloseTo(0.85, 12);
    for (const result of onEachSeed(heroOf(), both)) expect(result.factor?.kind).toBe('shrug');
  });

  it('4: does not say so at exactly 80%', () => {
    // Defense at four times the hero's Damage removes exactly four fifths.
    const plated = enemyOf({ damage: 30, defense: 40 });
    expect(shareRemoved(heroOf(), plated)).toBe(0.8);
    for (const result of onEachSeed(heroOf(), plated)) expect(result.factor?.kind).toBe('rounds');
  });

  it('5: says how many rounds the hero needs and how many the hero lasts', () => {
    // 1,000 life at 10 a hit and nine hits in ten is about 111 rounds; 100 Life at 20 a hit, one in ten dodged, is about 6.
    for (const result of onEachSeed(heroOf(), enemyOf())) {
      const factor = result.factor;
      expect(factor?.kind).toBe('rounds');
      if (factor?.kind !== 'rounds') continue;
      expect(factor.need).toBeGreaterThanOrEqual(105);
      expect(factor.need).toBeLessThanOrEqual(118);
      expect(factor.last).toBeGreaterThanOrEqual(5);
      expect(factor.last).toBeLessThanOrEqual(7);
      expect(factor.need).toBeGreaterThan(factor.last);
    }
  });

  it('6: says it comes down to the rolls when nothing else matches', () => {
    // An even fight: both sides need five hits, and the hero strikes first.
    for (const result of onEachSeed(heroOf({ damage: 20 }), enemyOf({ life: 100 }))) {
      expect(result.winChance).toBeGreaterThan(0.6);
      expect(result.winChance).toBeLessThan(0.85);
      expect(result.factor).toEqual({ kind: 'rolls' });
    }
  });

  it('shows no line when the win chance is 90% or more, even where a rule would match', () => {
    for (const result of onEachSeed(heroOf({ life: 1000, damage: 500 }), enemyOf({ life: 100 }))) {
      expect(result.winChance).toBe(1);
      expect(result.factor).toBeNull();
    }
    // A hero who misses half the time and wins anyway.
    for (const result of onEachSeed(heroOf({ life: 100000, damage: 500, accuracy: RATING / 2.2 }), enemyOf({ life: 100 }))) {
      expect(result.hitChance).toBeLessThan(0.6);
      expect(result.winChance).toBeGreaterThanOrEqual(0.9);
      expect(result.factor).toBeNull();
    }
    // A plated enemy the hero grinds down in the end.
    for (const result of onEachSeed(heroOf({ life: 100000 }), enemyOf({ life: 50, defense: 90 }))) {
      expect(result.winChance).toBeGreaterThanOrEqual(0.9);
      expect(result.factor).toBeNull();
    }
  });

  it('shows a line just under 90% and none just over, on the same trials', () => {
    const hero = heroOf({ life: 10, damage: 100 });
    const enemy = enemyOf({ life: 100, damage: 100 });
    // This fight is won about 91% of the time. Moving the threshold either side of the measured figure turns the line on and off.
    const measured = forecastBattle(hero, enemy, 1, 0, B).winChance;
    const shown = forecastBattle(hero, enemy, 1, 0, { ...B, forecast: { ...B.forecast, showFactorBelow: measured + 0.001 } });
    const hidden = forecastBattle(hero, enemy, 1, 0, { ...B, forecast: { ...B.forecast, showFactorBelow: measured } });
    expect(shown.factor).not.toBeNull();
    expect(hidden.factor).toBeNull();
  });

  describe('order of precedence', () => {
    it('puts missing ahead of dying in the first turn', () => {
      for (const result of onEachSeed(heroOf({ life: 10, accuracy: RATING / 2.2 }), enemyOf({ damage: 100 }))) expect(result.factor?.kind).toBe('miss');
    });

    it('puts dying in the first turn ahead of healing and plating', () => {
      for (const result of onEachSeed(heroOf({ life: 10 }), enemyOf({ damage: 100, defense: 90, traits: { regen: 5 } }))) expect(result.factor?.kind).toBe('burst');
    });

    it('puts healing ahead of plating', () => {
      for (const result of onEachSeed(heroOf(), enemyOf({ damage: 30, defense: 90, traits: { regen: 5 } }))) expect(result.factor?.kind).toBe('regen');
    });

    it('puts plating ahead of the count of rounds', () => {
      for (const result of onEachSeed(heroOf(), enemyOf({ damage: 30, defense: 90 }))) expect(result.factor?.kind).toBe('shrug');
    });

    it('puts the count of rounds ahead of the rolls', () => {
      // Six hits needed against five survived.
      for (const result of onEachSeed(heroOf({ damage: 18 }), enemyOf({ life: 100 }))) expect(result.factor?.kind).toBe('rounds');
    });
  });
});
