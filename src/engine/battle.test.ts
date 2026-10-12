import { describe, expect, it } from 'vitest';
import { enemyHitDamage, heroHitDamage, resolveBattle, shareRemoved } from './battle';
import type { BattleEvent, BattleResult } from './battle';
import { dodgeChance, hitChance } from './formulas';
import { streamRng } from './rng';
import type { Rng } from './rng';
import { SAMPLE_BALANCE } from './sample.fixture';
import type { Balance, Combatant, EnemyTraits, HeroStats, Tag, TagValues } from './types';

// GDD section 3. The order of a round is proved with a scripted generator: it hands out the queued numbers in
// order, counts the draws, and fails the test if the battle asks for one more than the script holds. Every
// script below is exactly as long as the GDD says the round is, so a roll too many or too few shows.

const B: Balance = SAMPLE_BALANCE;

/** The enemy's level in these tests. Its rating is 200 (GDD 3.1). */
const ENEMY_LEVEL = 100;
const RATING = 200;

const NO_TAGS: TagValues = { e1: 0, e2: 0, e3: 0, t1: 0, t2: 0, t3: 0, t4: 0 };

/**
 * A hero given as final stats, which is all a battle reads. Accuracy and Evasion default to the enemy's rating,
 * so the hero hits 90% of the time and dodges 10%. With no Defense on either side a hit does the attacker's Damage.
 */
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
  level: ENEMY_LEVEL,
  life: over.life ?? 1000,
  damage: over.damage ?? 20,
  defense: over.defense ?? 0,
  tags: over.tags ?? [],
  traits: { doubleAttack: 0, tripleAttack: 0, regen: 0, damageReduction: 0, ...over.traits },
});

/** A hero whose every multi-action chance and crit chance is a half, so each roll can go either way. */
const evenHero = (over: Partial<HeroStats> = {}): HeroStats => heroOf({ extraAttack: 0.5, extraHit: 0.5, critChance: 0.5, extraTurn: 0.5, ...over });
/** An enemy whose double and triple attack are both a half. */
const evenEnemy = (over: EnemyOver = {}): Combatant => enemyOf({ ...over, traits: { doubleAttack: 50, tripleAttack: 50, ...over.traits } });

// Rolls. A roll succeeds when it is below the chance, so 0 passes any chance above 0% and 0.999 fails any below 99.9%.
const YES = 0;
const NO = 0.999;
const HIT = YES;
const MISS = NO;
const DODGE = YES;
const TAKE = NO;

const scripted = (rolls: readonly number[]): { rng: Rng; drawn: () => number } => {
  let drawn = 0;
  const next = (): number => {
    const roll = rolls[drawn];
    drawn += 1;
    if (roll === undefined) throw new Error(`the battle drew roll number ${drawn}, and the script holds ${rolls.length}`);
    return roll;
  };
  const nextUint32 = (): number => {
    throw new Error('a battle draws rolls, not raw integers');
  };
  return { rng: { next, nextUint32 }, drawn: () => drawn };
};

const rounds = (roundLimit: number): Balance => ({ ...B, battle: { ...B.battle, roundLimit } });

type Played = { result: BattleResult; log: BattleEvent[]; drawn: number; told: string[] };

/** The log as a list of words: `hit` and `crit` for the hero's hits, the event's own name for the rest. */
const tell = (log: readonly BattleEvent[]): string[] => log.map((event) => (event.t === 'hit' ? (event.crit ? 'crit' : 'hit') : event.t));

/** Plays a battle from a script and checks that it drew every roll in it. */
const play = (hero: HeroStats, enemy: Combatant, rolls: readonly number[], balance: Balance = rounds(1)): Played => {
  const script = scripted(rolls);
  const result = resolveBattle(hero, enemy, script.rng, balance, { log: true });
  const log = result.log ?? [];
  expect(script.drawn()).toBe(rolls.length);
  return { result, log, drawn: script.drawn(), told: tell(log) };
};

const eventsOf = <K extends BattleEvent['t']>(log: readonly BattleEvent[], kind: K): Array<Extract<BattleEvent, { t: K }>> =>
  log.filter((event): event is Extract<BattleEvent, { t: K }> => event.t === kind);

describe('the setup these scripts rely on (GDD 3.1)', () => {
  it('hits 90% of the time and dodges 10% when Accuracy and Evasion equal the enemy rating', () => {
    expect(hitChance(RATING, ENEMY_LEVEL, B)).toBeCloseTo(0.9, 12);
    expect(dodgeChance(RATING, ENEMY_LEVEL, B)).toBeCloseTo(0.1, 12);
  });
});

describe('order of a round: the hero’s turn (GDD 3.2)', () => {
  it('draws Extra Attack, hit, Extra Hit, crit and Extra Turn, then the enemy’s double attack and the dodge', () => {
    const { told, result } = play(evenHero(), evenEnemy(), [NO, HIT, NO, NO, NO, NO, TAKE]);
    expect(told).toEqual(['round', 'hit', 'enemyHit', 'end']);
    expect(result.rounds).toBe(1);
  });

  it('reads the first roll as Extra Attack: two attacks, each with its own hit roll', () => {
    const { told } = play(evenHero(), evenEnemy(), [YES, HIT, NO, NO, HIT, NO, NO, NO, NO, TAKE]);
    expect(told).toEqual(['round', 'hit', 'hit', 'enemyHit', 'end']);
  });

  it('reads the second roll as the roll to hit: a miss ends that attack with no Extra Hit or crit roll', () => {
    const { told } = play(evenHero(), evenEnemy(), [NO, MISS, NO, NO, TAKE]);
    expect(told).toEqual(['round', 'miss', 'enemyHit', 'end']);
  });

  it('reads the third roll as Extra Hit: one hit roll, two hits, each with its own crit roll', () => {
    const { told } = play(evenHero(), evenEnemy(), [NO, HIT, YES, NO, YES, NO, NO, TAKE]);
    expect(told).toEqual(['round', 'hit', 'crit', 'enemyHit', 'end']);
  });

  it('reads the fourth roll as crit', () => {
    const { told } = play(evenHero(), evenEnemy(), [NO, HIT, NO, YES, NO, NO, TAKE]);
    expect(told).toEqual(['round', 'crit', 'enemyHit', 'end']);
  });

  it('reads the fifth roll as Extra Turn: the hero repeats attack, hit, Extra Hit and crit, with no further Extra Turn roll', () => {
    const { told } = play(evenHero(), evenEnemy(), [NO, HIT, NO, NO, YES, NO, HIT, NO, NO, NO, TAKE]);
    expect(told).toEqual(['round', 'hit', 'extraTurn', 'hit', 'enemyHit', 'end']);
  });

  it('rolls Extra Attack again on the second pass', () => {
    const { told } = play(evenHero(), evenEnemy(), [NO, HIT, NO, NO, YES, YES, HIT, NO, YES, MISS, NO, TAKE]);
    expect(told).toEqual(['round', 'hit', 'extraTurn', 'crit', 'miss', 'enemyHit', 'end']);
  });

  it('with Extra Attack, misses one attack and still makes the other in full', () => {
    const { told } = play(evenHero(), evenEnemy(), [YES, MISS, HIT, YES, YES, NO, NO, NO, TAKE]);
    expect(told).toEqual(['round', 'miss', 'crit', 'hit', 'enemyHit', 'end']);
  });

  it('rolls Extra Turn after a pass in which every attack missed', () => {
    const { told } = play(evenHero(), evenEnemy(), [YES, MISS, MISS, YES, NO, HIT, NO, NO, NO, TAKE]);
    expect(told).toEqual(['round', 'miss', 'miss', 'extraTurn', 'hit', 'enemyHit', 'end']);
  });

  it('draws one number for every listed roll even at 0%', () => {
    // Every chance is 0. A roll of 0 is the lowest there is and still fails each of them.
    const { told } = play(heroOf(), enemyOf(), [0, HIT, 0, 0, 0, 0, TAKE]);
    expect(told).toEqual(['round', 'hit', 'enemyHit', 'end']);
  });

  it('draws one number for every listed roll even at 100%', () => {
    // Every chance is 100%, so the highest roll there is still passes each of them: two attacks of two crits,
    // an Extra Turn with the same again, then three enemy attacks. 9 + 1 + 9 + 2 + 3 = 24 rolls.
    const top = 0.9999999999;
    const hero = heroOf({ accuracy: 1e15, extraAttack: 1, extraHit: 1, critChance: 1, extraTurn: 1 });
    expect(hitChance(hero.accuracy, ENEMY_LEVEL, B)).toBe(1);
    const enemy = enemyOf({ life: 1e6, traits: { doubleAttack: 100, tripleAttack: 100 } });
    const rolls: number[] = [];
    for (let i = 0; i < 24; i += 1) rolls.push(top);
    const { told } = play(hero, enemy, rolls);
    expect(told).toEqual(['round', 'crit', 'crit', 'crit', 'crit', 'extraTurn', 'crit', 'crit', 'crit', 'crit', 'enemyHit', 'enemyHit', 'enemyHit', 'end']);
  });

  it('passes a roll only when it is below the chance', () => {
    // A half is not below a half.
    expect(play(evenHero(), evenEnemy(), [0.5, HIT, 0.5, 0.5, 0.5, 0.5, TAKE]).told).toEqual(['round', 'hit', 'enemyHit', 'end']);
    expect(play(evenHero(), evenEnemy(), [0.4999, HIT, NO, NO, HIT, NO, NO, NO, NO, TAKE]).told).toEqual(['round', 'hit', 'hit', 'enemyHit', 'end']);
  });

  it('heals the hero from round 2 on, once a round, and not again on an Extra Turn', () => {
    const hero = evenHero({ lifeRegen: 10 });
    const enemy = evenEnemy({ damage: 30 });
    const round = [NO, HIT, NO, NO, YES, NO, HIT, NO, NO, NO, TAKE];
    const { told, log, result } = play(hero, enemy, [...round, ...round], rounds(2));
    expect(told).toEqual(['round', 'hit', 'extraTurn', 'hit', 'enemyHit', 'round', 'heroRegen', 'hit', 'extraTurn', 'hit', 'enemyHit', 'end']);
    // 100 − 30 = 70, healed by 10% of 100 at the start of round 2, then hit again.
    expect(eventsOf(log, 'heroRegen')).toEqual([{ t: 'heroRegen', amount: 10, heroLife: 80 }]);
    expect(result.heroHealed).toBe(10);
    expect(result.heroLife).toBe(50);
  });
});

describe('order of a round: the hero wins at once (GDD 3.2)', () => {
  it('ends on the hit that takes the enemy to 0, with no further roll', () => {
    // Extra Attack and Extra Hit both succeeded, so three more hits were due, and an Extra Turn roll after them.
    const hero = heroOf({ extraAttack: 1, extraHit: 1, extraTurn: 1 });
    const { told, result } = play(hero, enemyOf({ life: 10 }), [YES, HIT, YES, NO]);
    expect(told).toEqual(['round', 'hit', 'end']);
    expect(result).toMatchObject({ win: true, rounds: 1, enemyLife: 0, heroLife: 100, hitsTaken: 0, taken: 0, dealt: 10 });
  });

  it('ends on the second hit of an attack without making the second attack', () => {
    const hero = heroOf({ extraAttack: 1, extraHit: 1, extraTurn: 1 });
    const { told, result } = play(hero, enemyOf({ life: 20 }), [YES, HIT, YES, NO, NO]);
    expect(told).toEqual(['round', 'hit', 'hit', 'end']);
    expect(result.win).toBe(true);
  });

  it('ends inside an Extra Turn without an enemy turn', () => {
    const hero = heroOf({ extraTurn: 1 });
    const { told, result } = play(hero, enemyOf({ life: 20 }), [NO, HIT, NO, NO, YES, NO, HIT, NO, NO]);
    expect(told).toEqual(['round', 'hit', 'extraTurn', 'hit', 'end']);
    expect(result).toMatchObject({ win: true, hitsTaken: 0 });
  });

  it('lets the hero act first: an enemy that would kill in one hit never gets its turn', () => {
    const { result } = play(heroOf({ life: 1 }), enemyOf({ life: 10, damage: 5000 }), [NO, HIT, NO, NO]);
    expect(result).toMatchObject({ win: true, heroLife: 1 });
  });
});

describe('order of a round: the enemy’s turn (GDD 3.2)', () => {
  // The hero's five rolls of a plain round, ending in a failed Extra Turn.
  const HERO = [NO, HIT, NO, NO, NO];

  it('rolls the triple attack only if the double attack succeeded', () => {
    const sureTriple = enemyOf({ traits: { doubleAttack: 50, tripleAttack: 100 } });
    // Double fails: one attack, and no triple roll although it could not fail.
    expect(play(heroOf(), sureTriple, [...HERO, NO, TAKE]).told).toEqual(['round', 'hit', 'enemyHit', 'end']);
    // Double succeeds: the triple roll is drawn, then three dodge rolls.
    expect(play(heroOf(), sureTriple, [...HERO, YES, NO, TAKE, TAKE, TAKE]).told).toEqual(['round', 'hit', 'enemyHit', 'enemyHit', 'enemyHit', 'end']);
  });

  it('draws the triple roll after a successful double even when the triple chance is 0%', () => {
    const neverTriple = enemyOf({ traits: { doubleAttack: 100, tripleAttack: 0 } });
    expect(play(heroOf(), neverTriple, [...HERO, NO, YES, TAKE, TAKE]).told).toEqual(['round', 'hit', 'enemyHit', 'enemyHit', 'end']);
  });

  it('draws the double roll even at 0%, and then no triple roll', () => {
    const onlyTriple = enemyOf({ traits: { doubleAttack: 0, tripleAttack: 100 } });
    expect(play(heroOf(), onlyTriple, [...HERO, YES, TAKE]).told).toEqual(['round', 'hit', 'enemyHit', 'end']);
  });

  it('makes two attacks when the double succeeds and the triple fails', () => {
    expect(play(heroOf(), evenEnemy(), [...HERO, YES, NO, TAKE, DODGE]).told).toEqual(['round', 'hit', 'enemyHit', 'dodge', 'end']);
  });

  it('rolls the hero’s dodge once for each attack', () => {
    const triple = enemyOf({ traits: { doubleAttack: 100, tripleAttack: 100 } });
    const { told, result } = play(heroOf(), triple, [...HERO, YES, YES, DODGE, TAKE, DODGE]);
    expect(told).toEqual(['round', 'hit', 'dodge', 'enemyHit', 'dodge', 'end']);
    expect(result).toMatchObject({ hitsTaken: 1, taken: 20, heroLife: 80 });
  });

  it('gives a dodged attack no damage and no Reflect', () => {
    const hero = heroOf({ reflect: 50 });
    const triple = enemyOf({ traits: { doubleAttack: 100, tripleAttack: 100 } });
    const { told, log, result } = play(hero, triple, [...HERO, YES, YES, DODGE, TAKE, DODGE]);
    expect(told).toEqual(['round', 'hit', 'dodge', 'enemyHit', 'reflect', 'dodge', 'end']);
    expect(eventsOf(log, 'reflect')).toEqual([{ t: 'reflect', damage: 10, enemyLife: 980 }]);
    // 10 from the hero's hit and 10 reflected from the one attack that landed.
    expect(result).toMatchObject({ dealt: 20, enemyLife: 980, taken: 20 });
  });

  it('heals the enemy at the start of each of its turns, the first included, before it attacks', () => {
    const mender = enemyOf({ life: 200, traits: { regen: 10 } });
    const hero = heroOf({ damage: 30 });
    const { told, log, result } = play(hero, mender, [...HERO, NO, TAKE, ...HERO, NO, TAKE], rounds(2));
    expect(told).toEqual(['round', 'hit', 'enemyRegen', 'enemyHit', 'round', 'hit', 'enemyRegen', 'enemyHit', 'end']);
    // 10% of 200 is 20 a turn: 200 − 30 + 20 = 190, then 190 − 30 + 20 = 180.
    expect(eventsOf(log, 'enemyRegen')).toEqual([
      { t: 'enemyRegen', amount: 20, enemyLife: 190 },
      { t: 'enemyRegen', amount: 20, enemyLife: 180 },
    ]);
    expect(result).toMatchObject({ enemyHealed: 40, enemyLife: 180, dealt: 60 });
  });

  it('does not heal the enemy on a round the hero wins', () => {
    const { told } = play(heroOf(), enemyOf({ life: 10, traits: { regen: 50 } }), [NO, HIT, NO, NO]);
    expect(told).toEqual(['round', 'hit', 'end']);
  });
});

describe('regeneration amounts (GDD 3.1, 4.3, 4.4)', () => {
  const HERO = [NO, HIT, NO, NO, NO];

  it('heals a percentage of maximum life, rounded down', () => {
    // 10% of 205 is 20.5.
    const { log } = play(heroOf({ damage: 50 }), enemyOf({ life: 205, traits: { regen: 10 } }), [...HERO, NO, TAKE]);
    expect(eventsOf(log, 'enemyRegen')).toEqual([{ t: 'enemyRegen', amount: 20, enemyLife: 175 }]);
    // 10% of 105 is 10.5.
    const hero = heroOf({ life: 105, lifeRegen: 10 });
    const second = play(hero, enemyOf({ damage: 40 }), [...HERO, NO, TAKE, ...HERO, NO, TAKE], rounds(2));
    expect(eventsOf(second.log, 'heroRegen')).toEqual([{ t: 'heroRegen', amount: 10, heroLife: 75 }]);
  });

  it('never heals past full life', () => {
    // The enemy would heal 100 and is only 10 short.
    const { log, result } = play(heroOf(), enemyOf({ life: 200, traits: { regen: 50 } }), [...HERO, NO, TAKE]);
    expect(eventsOf(log, 'enemyRegen')).toEqual([{ t: 'enemyRegen', amount: 10, enemyLife: 200 }]);
    expect(result.enemyHealed).toBe(10);
    // The hero would heal 50 and is only 4 short.
    const second = play(heroOf({ lifeRegen: 50 }), enemyOf({ damage: 4 }), [...HERO, NO, TAKE, ...HERO, NO, DODGE], rounds(2));
    expect(eventsOf(second.log, 'heroRegen')).toEqual([{ t: 'heroRegen', amount: 4, heroLife: 100 }]);
    expect(second.result).toMatchObject({ heroHealed: 4, heroLife: 100 });
  });

  it('draws no roll for either heal', () => {
    // Both sides heal, and the round is still seven rolls long.
    const hero = heroOf({ lifeRegen: 10 });
    const enemy = enemyOf({ traits: { regen: 10 } });
    expect(play(hero, enemy, [...HERO, NO, TAKE, ...HERO, NO, TAKE], rounds(2)).told).toEqual(['round', 'hit', 'enemyRegen', 'enemyHit', 'round', 'heroRegen', 'hit', 'enemyRegen', 'enemyHit', 'end']);
  });
});

describe('Last Stand (GDD 3.2, 4.3)', () => {
  const HERO = [NO, HIT, NO, NO, NO];

  it('leaves the hero at 1 Life and spends a charge', () => {
    const hero = heroOf({ life: 50, lastStand: 1 });
    const { told, log, result } = play(hero, enemyOf({ damage: 80 }), [...HERO, NO, TAKE]);
    expect(told).toEqual(['round', 'hit', 'enemyHit', 'lastStand', 'end']);
    expect(eventsOf(log, 'lastStand')).toEqual([{ t: 'lastStand', left: 0 }]);
    // The round limit ended this battle, so the hero is still standing, at 1.
    expect(result).toMatchObject({ win: false, heroLife: 1, hitsTaken: 1 });
  });

  it('loses at once on a fatal hit with no charge left, without rolling the remaining attacks', () => {
    const hero = heroOf({ life: 50, lastStand: 1 });
    const triple = enemyOf({ damage: 80, traits: { doubleAttack: 100, tripleAttack: 100 } });
    // Three attacks were due. The second is fatal with no charge left, so the third has no dodge roll.
    const { told, result } = play(hero, triple, [...HERO, YES, YES, TAKE, TAKE], rounds(5));
    expect(told).toEqual(['round', 'hit', 'enemyHit', 'lastStand', 'enemyHit', 'end']);
    expect(result).toMatchObject({ win: false, rounds: 1, heroLife: 0, hitsTaken: 2 });
  });

  it('survives as many fatal hits in a battle as it has charges', () => {
    const hero = heroOf({ life: 50, lastStand: 2 });
    const triple = enemyOf({ damage: 80, traits: { doubleAttack: 100, tripleAttack: 100 } });
    const { told, log, result } = play(hero, triple, [...HERO, YES, YES, TAKE, TAKE, TAKE], rounds(5));
    expect(told).toEqual(['round', 'hit', 'enemyHit', 'lastStand', 'enemyHit', 'lastStand', 'enemyHit', 'end']);
    expect(eventsOf(log, 'lastStand').map((event) => event.left)).toEqual([1, 0]);
    expect(result).toMatchObject({ win: false, heroLife: 0, hitsTaken: 3 });
  });

  it('carries the 1 Life into the next round, where regeneration builds on it', () => {
    const hero = heroOf({ life: 50, lastStand: 1, lifeRegen: 10 });
    const { log } = play(hero, enemyOf({ damage: 80 }), [...HERO, NO, TAKE, ...HERO, NO, DODGE], rounds(2));
    expect(eventsOf(log, 'heroRegen')).toEqual([{ t: 'heroRegen', amount: 5, heroLife: 6 }]);
  });

  it('loses a hero with no Last Stand on the first fatal hit', () => {
    const { told, result } = play(heroOf({ life: 50 }), enemyOf({ damage: 80 }), [...HERO, NO, TAKE], rounds(5));
    expect(told).toEqual(['round', 'hit', 'enemyHit', 'end']);
    expect(result).toMatchObject({ win: false, rounds: 1, heroLife: 0, enemyLife: 990 });
  });
});

describe('Reflect (GDD 3.1, 3.2)', () => {
  const MISSES = [NO, MISS, NO];

  it('can win the battle', () => {
    const hero = heroOf({ reflect: 100 });
    const { told, result } = play(hero, enemyOf({ life: 20, damage: 20 }), [...MISSES, NO, TAKE], rounds(5));
    expect(told).toEqual(['round', 'miss', 'enemyHit', 'reflect', 'end']);
    expect(result).toMatchObject({ win: true, rounds: 1, enemyLife: 0, heroLife: 80, dealt: 20 });
  });

  it('applies after a Last Stand, since the hero is still standing', () => {
    const hero = heroOf({ life: 10, lastStand: 1, reflect: 100 });
    const { told, result } = play(hero, enemyOf({ life: 20, damage: 20 }), [...MISSES, NO, TAKE], rounds(5));
    expect(told).toEqual(['round', 'miss', 'enemyHit', 'lastStand', 'reflect', 'end']);
    expect(result).toMatchObject({ win: true, heroLife: 1, enemyLife: 0 });
  });

  it('does not apply to the hit that kills the hero', () => {
    const hero = heroOf({ life: 10, reflect: 100 });
    const { told, result } = play(hero, enemyOf({ life: 20, damage: 20 }), [...MISSES, NO, TAKE], rounds(5));
    expect(told).toEqual(['round', 'miss', 'enemyHit', 'end']);
    expect(result).toMatchObject({ win: false, heroLife: 0, enemyLife: 20, dealt: 0 });
  });

  it('ends the enemy’s turn when it kills the enemy part-way through its attacks', () => {
    const hero = heroOf({ reflect: 100 });
    const triple = enemyOf({ life: 40, damage: 20, traits: { doubleAttack: 100, tripleAttack: 100 } });
    // Two of the three attacks land and are reflected; the third has no dodge roll.
    const { told, result } = play(hero, triple, [...MISSES, YES, YES, TAKE, TAKE], rounds(5));
    expect(told).toEqual(['round', 'miss', 'enemyHit', 'reflect', 'enemyHit', 'reflect', 'end']);
    expect(result).toMatchObject({ win: true, heroLife: 60, hitsTaken: 2 });
  });

  it('is the enemy’s Damage times Reflect%, rounded down, less the enemy’s damage reduction', () => {
    const reflected = (hero: HeroStats, enemy: Combatant): number[] => eventsOf(play(hero, enemy, [...MISSES, NO, TAKE]).log, 'reflect').map((event) => event.damage);
    // 55 × 30% = 16.5.
    expect(reflected(heroOf({ reflect: 30 }), enemyOf({ damage: 55 }))).toEqual([16]);
    // 55 × 30% × 0.8 = 13.2.
    expect(reflected(heroOf({ reflect: 30 }), enemyOf({ damage: 55, traits: { damageReduction: 20 } }))).toEqual([13]);
    expect(reflected(heroOf({ reflect: 250 }), enemyOf({ damage: 55 }))).toEqual([137]);
  });

  it('is worked out before the hero’s Defense and ignores the enemy’s Defense, Resistance and the hero’s Damage', () => {
    const reflected = (hero: HeroStats, enemy: Combatant): number[] => eventsOf(play(hero, enemy, [...MISSES, NO, TAKE]).log, 'reflect').map((event) => event.damage);
    const enemy = enemyOf({ damage: 55, defense: 5000, tags: ['t1'] });
    const armored = heroOf({ reflect: 30, defense: 5000, damage: 1, resist: { ...NO_TAGS, t1: 300 }, critChance: 1, critDamage: 9 });
    // The hero takes far less than 55, and the enemy still takes 30% of 55.
    expect(enemyHitDamage(armored, enemy)).toBe(1);
    expect(reflected(armored, enemy)).toEqual([16]);
  });

  it('does nothing for a hero with no Reflect', () => {
    expect(play(heroOf(), enemyOf(), [...MISSES, NO, TAKE]).told).toEqual(['round', 'miss', 'enemyHit', 'end']);
  });
});

describe('the round limit (GDD 3.2)', () => {
  it('makes a battle that reaches 200 rounds a loss, with both still standing', () => {
    const hero = heroOf({ life: 1e9, damage: 1 });
    const enemy = enemyOf({ life: 1e9, damage: 1 });
    const result = resolveBattle(hero, enemy, streamRng(5, 'battle', 0), B, { log: true });
    expect(result.win).toBe(false);
    expect(result.rounds).toBe(200);
    expect(result.heroLife).toBeGreaterThan(0);
    expect(result.enemyLife).toBeGreaterThan(0);
    const log = result.log ?? [];
    expect(log[log.length - 1]).toEqual({ t: 'end', win: false, rounds: 200 });
    expect(eventsOf(log, 'round')).toHaveLength(200);
  });

  it('plays the last round in full, so a kill in that round still wins', () => {
    // QUESTION: GDD 3.2 says "a battle that reaches 200 rounds is a loss". The code plays round 200 to its end
    // and calls a loss only if both are still standing after it. The other reading ends the battle as round 200
    // begins. Shown here with a limit of 3.
    const round = [NO, HIT, NO, NO, NO, NO, DODGE];
    const kill = [NO, HIT, NO, NO];
    const won = play(heroOf(), enemyOf({ life: 30 }), [...round, ...round, ...kill], rounds(3));
    expect(won.result).toMatchObject({ win: true, rounds: 3 });
    const lost = play(heroOf(), enemyOf({ life: 31 }), [...round, ...round, ...round], rounds(3));
    expect(lost.result).toMatchObject({ win: false, rounds: 3, enemyLife: 1, heroLife: 100 });
  });
});

describe('damage amounts (GDD 3.1)', () => {
  // Damage 43 into Defense 172 is 43 × 43 ÷ 215 = 8.6 before anything else.
  const hero = (over: Partial<HeroStats> = {}): HeroStats => heroOf({ damage: 43, ...over });
  const armored = (over: EnemyOver = {}): Combatant => enemyOf({ defense: 172, ...over });

  it('works a hero hit out as Damage × Damage ÷ (Damage + enemy Defense), rounded down', () => {
    expect(heroHitDamage(hero(), armored())).toBe(8);
    expect(heroHitDamage(heroOf({ damage: 10 }), enemyOf({ defense: 4 }))).toBe(7); // 100 ÷ 14 = 7.14
    expect(heroHitDamage(heroOf({ damage: 10 }), enemyOf({ defense: 0 }))).toBe(10);
    expect(heroHitDamage(heroOf({ damage: 1000 }), enemyOf({ defense: 1000 }))).toBe(500);
  });

  it('multiplies by 1 + the sum of the hero’s bonuses against the tags this enemy has', () => {
    const slayer = hero({ versus: { ...NO_TAGS, t1: 50, e1: 50, t2: 300 } });
    // Both tags: ×2, and 8.6 × 2 = 17.2. Rounding 8.6 down first would give 16.
    expect(heroHitDamage(slayer, armored({ tags: ['t1', 'e1'] }))).toBe(17);
    // One tag: ×1.5, and 8.6 × 1.5 = 12.9.
    expect(heroHitDamage(slayer, armored({ tags: ['t1'] }))).toBe(12);
    // Neither tag the enemy has is one the bonuses name.
    expect(heroHitDamage(slayer, armored({ tags: ['t3', 'e2'] }))).toBe(8);
    expect(heroHitDamage(slayer, armored())).toBe(8);
  });

  it('never takes the tag multiplier below 0, and a hit that lands still does 1', () => {
    expect(heroHitDamage(hero({ versus: { ...NO_TAGS, t1: -50 } }), armored({ tags: ['t1'] }))).toBe(4); // 8.6 × 0.5
    expect(heroHitDamage(hero({ versus: { ...NO_TAGS, t1: -400 } }), armored({ tags: ['t1'] }))).toBe(1);
  });

  it('multiplies everything the enemy takes by 1 − its damage reduction', () => {
    expect(heroHitDamage(hero(), armored({ traits: { damageReduction: 20 } }))).toBe(6); // 8.6 × 0.8 = 6.88
    // 8.6 × 2 × 0.8 = 13.76: one product, rounded down once.
    expect(heroHitDamage(hero({ versus: { ...NO_TAGS, t1: 100 } }), armored({ tags: ['t1'], traits: { damageReduction: 20 } }))).toBe(13);
    expect(heroHitDamage(heroOf({ damage: 100 }), enemyOf({ traits: { damageReduction: 85 } }))).toBe(15);
  });

  it('multiplies a crit by Crit Damage inside the same product', () => {
    const critOf = (attacker: HeroStats, enemy: Combatant): number[] => eventsOf(play(attacker, enemy, [NO, HIT, NO, YES, NO, NO, TAKE]).log, 'hit').map((event) => event.damage);
    // 8.6 × 2.5 = 21.5. Rounding 8.6 down first would give 20.
    expect(critOf(hero({ critChance: 0.5, critDamage: 2.5 }), armored())).toEqual([21]);
    // 8.6 × 2 × 0.8 × 2.5 = 34.4. Rounding 13.76 down first would give 32.
    expect(critOf(hero({ critChance: 0.5, critDamage: 2.5, versus: { ...NO_TAGS, t1: 100 } }), armored({ tags: ['t1'], traits: { damageReduction: 20 } }))).toEqual([34]);
    // The base crit of 150%: 10 × 1.5.
    expect(critOf(heroOf({ critChance: 0.5 }), enemyOf())).toEqual([15]);
  });

  it('marks a crit in the log and leaves a plain hit plain', () => {
    const { log } = play(hero({ critChance: 0.5, critDamage: 2.5, extraHit: 1 }), armored(), [NO, HIT, YES, YES, NO, NO, NO, TAKE]);
    expect(eventsOf(log, 'hit')).toEqual([
      { t: 'hit', damage: 21, crit: true, enemyLife: 979 },
      { t: 'hit', damage: 8, crit: false, enemyLife: 971 },
    ]);
  });

  it('lets a hit that lands do at least 1', () => {
    expect(heroHitDamage(heroOf({ damage: 1 }), enemyOf({ defense: 100000 }))).toBe(1);
    expect(heroHitDamage(heroOf({ damage: 50 }), enemyOf({ traits: { damageReduction: 100 } }))).toBe(1);
    expect(enemyHitDamage(heroOf({ defense: 1e9 }), enemyOf({ damage: 1 }))).toBe(1);
    const { log } = play(heroOf({ damage: 1, critChance: 0.5 }), enemyOf({ defense: 100000 }), [NO, HIT, NO, YES, NO, NO, TAKE]);
    expect(eventsOf(log, 'hit').map((event) => event.damage)).toEqual([1]);
  });

  it('works an enemy hit out as E × E ÷ (E + hero Defense), rounded down', () => {
    expect(enemyHitDamage(heroOf({ defense: 15 }), enemyOf({ damage: 30 }))).toBe(20);
    expect(enemyHitDamage(heroOf({ defense: 5 }), enemyOf({ damage: 10 }))).toBe(6); // 100 ÷ 15 = 6.67
    expect(enemyHitDamage(heroOf({ defense: 0 }), enemyOf({ damage: 30 }))).toBe(30);
    expect(enemyHitDamage(heroOf({ defense: 55 }), enemyOf({ damage: 55 }))).toBe(27); // 27.5
  });

  it('halves an enemy’s damage at Resistance 100 and removes two thirds at 200', () => {
    const resisting = (resist: number): HeroStats => heroOf({ resist: { ...NO_TAGS, t1: resist } });
    const enemy = enemyOf({ damage: 300, tags: ['t1'] });
    expect(enemyHitDamage(resisting(0), enemy)).toBe(300);
    expect(enemyHitDamage(resisting(100), enemy)).toBe(150);
    expect(enemyHitDamage(resisting(200), enemy)).toBe(100);
    expect(enemyHitDamage(resisting(50), enemy)).toBe(200);
    expect(enemyHitDamage(resisting(300), enemy)).toBe(75);
  });

  it('sums Resistance over every tag the enemy carries, and no other', () => {
    const hero2 = heroOf({ defense: 15, resist: { ...NO_TAGS, t4: 100, e1: 100, t2: 500 } });
    // 20 before Resistance. Two tags at 100 each sum to 200: a third of 20 is 6.67. Multiplying the two halves would give 5.
    expect(enemyHitDamage(hero2, enemyOf({ damage: 30, tags: ['t4', 'e1'] }))).toBe(6);
    expect(enemyHitDamage(hero2, enemyOf({ damage: 30, tags: ['t4'] }))).toBe(10);
    expect(enemyHitDamage(hero2, enemyOf({ damage: 30, tags: ['t1', 'e3'] }))).toBe(20);
    expect(enemyHitDamage(hero2, enemyOf({ damage: 30 }))).toBe(20);
  });

  it('never takes the summed Resistance below 0', () => {
    const enemy = enemyOf({ damage: 30, tags: ['t4', 'e1'] });
    expect(enemyHitDamage(heroOf({ defense: 15, resist: { ...NO_TAGS, t4: -80 } }), enemy)).toBe(20);
    // It is the sum that is held at 0, so a weakness to one tag does offset a Resistance to the other.
    expect(enemyHitDamage(heroOf({ defense: 15, resist: { ...NO_TAGS, t4: 150, e1: -50 } }), enemy)).toBe(10);
    expect(enemyHitDamage(heroOf({ defense: 15, resist: { ...NO_TAGS, t4: 100, e1: -100 } }), enemy)).toBe(20);
  });

  it('uses the same figures inside a battle', () => {
    const fighter = heroOf({ damage: 43, defense: 15, resist: { ...NO_TAGS, t1: 100 } });
    const enemy = enemyOf({ damage: 30, defense: 172, tags: ['t1'] });
    const { log } = play(fighter, enemy, [NO, HIT, NO, NO, NO, NO, TAKE]);
    expect(eventsOf(log, 'hit').map((event) => event.damage)).toEqual([heroHitDamage(fighter, enemy)]);
    expect(eventsOf(log, 'enemyHit')).toEqual([{ t: 'enemyHit', damage: 10, heroLife: 90 }]);
  });

  it('reports the share of the hero’s Damage that Defense and damage reduction remove', () => {
    expect(shareRemoved(heroOf({ damage: 10 }), enemyOf({ defense: 30 }))).toBeCloseTo(0.75, 12);
    expect(shareRemoved(heroOf({ damage: 10 }), enemyOf({ defense: 30, traits: { damageReduction: 20 } }))).toBeCloseTo(0.8, 12);
    expect(shareRemoved(heroOf({ damage: 10 }), enemyOf({ defense: 0 }))).toBe(0);
    expect(shareRemoved(heroOf({ damage: 10 }), enemyOf({ traits: { damageReduction: 85 } }))).toBeCloseTo(0.85, 12);
  });
});

describe('the result (GDD 3, ARCHITECTURE 5.3)', () => {
  // A fight with every mechanic in it, close enough that both outcomes turn up.
  const hero = heroOf({
    life: 400,
    damage: 30,
    defense: 20,
    accuracy: 180,
    evasion: 300,
    critChance: 0.3,
    critDamage: 1.8,
    extraHit: 0.25,
    extraAttack: 0.25,
    extraTurn: 0.2,
    lifeRegen: 5,
    reflect: 20,
    lastStand: 2,
    resist: { ...NO_TAGS, t4: 50 },
    versus: { ...NO_TAGS, e1: 40 },
  });
  const enemy = enemyOf({ life: 600, damage: 60, defense: 40, tags: ['t4', 'e1'], traits: { doubleAttack: 50, tripleAttack: 50, regen: 2, damageReduction: 10 } });
  const SEEDS = 200;

  it('is the same for the same seed', () => {
    for (let seed = 0; seed < 20; seed += 1) {
      expect(resolveBattle(hero, enemy, streamRng(seed, 'battle', 3), B, { log: true })).toEqual(resolveBattle(hero, enemy, streamRng(seed, 'battle', 3), B, { log: true }));
    }
  });

  it('differs between seeds, and goes both ways', () => {
    let wins = 0;
    const lengths = new Set<number>();
    for (let seed = 0; seed < SEEDS; seed += 1) {
      const result = resolveBattle(hero, enemy, streamRng(seed, 'battle', 0), B, { log: false });
      if (result.win) wins += 1;
      lengths.add(result.rounds);
    }
    expect(wins).toBeGreaterThan(SEEDS / 10);
    expect(wins).toBeLessThan(SEEDS - SEEDS / 10);
    expect(lengths.size).toBeGreaterThan(3);
  });

  it('has the same outcome and the same summary numbers with the log on and off', () => {
    for (let seed = 0; seed < SEEDS; seed += 1) {
      const logged = resolveBattle(hero, enemy, streamRng(seed, 'battle', 0), B, { log: true });
      const silent = resolveBattle(hero, enemy, streamRng(seed, 'battle', 0), B, { log: false });
      expect(silent.log).toBeNull();
      expect(logged.log).not.toBeNull();
      expect({ ...logged, log: null }).toEqual(silent);
    }
  });

  it('draws the same number of rolls with the log on and off', () => {
    for (let seed = 0; seed < 50; seed += 1) {
      const first = streamRng(seed, 'battle', 0);
      const second = streamRng(seed, 'battle', 0);
      resolveBattle(hero, enemy, first, B, { log: true });
      resolveBattle(hero, enemy, second, B, { log: false });
      expect(first.nextUint32()).toBe(second.nextUint32());
    }
  });

  it('adds up to what the log says happened', () => {
    for (let seed = 0; seed < SEEDS; seed += 1) {
      const result = resolveBattle(hero, enemy, streamRng(seed, 'battle', 0), B, { log: true });
      const log = result.log ?? [];
      const sum = (amounts: number[]): number => amounts.reduce((total, amount) => total + amount, 0);
      const hits = eventsOf(log, 'hit');
      const reflects = eventsOf(log, 'reflect');
      const enemyHits = eventsOf(log, 'enemyHit');
      expect(result.dealt).toBe(sum(hits.map((event) => event.damage)) + sum(reflects.map((event) => event.damage)));
      expect(result.taken).toBe(sum(enemyHits.map((event) => event.damage)));
      expect(result.hitsTaken).toBe(enemyHits.length);
      expect(result.heroHealed).toBe(sum(eventsOf(log, 'heroRegen').map((event) => event.amount)));
      expect(result.enemyHealed).toBe(sum(eventsOf(log, 'enemyRegen').map((event) => event.amount)));
      expect(eventsOf(log, 'round')).toHaveLength(result.rounds);
      expect(log[log.length - 1]).toEqual({ t: 'end', win: result.win, rounds: result.rounds });
      expect(result.heroMaxLife).toBe(400);
      expect(result.enemyMaxLife).toBe(600);
      // Last Stand has two charges and is never used a third time.
      expect(eventsOf(log, 'lastStand').length).toBeLessThanOrEqual(2);
      // The loser is at 0, and nobody is ever above full life or below 0.
      if (result.win) expect(result.enemyLife).toBe(0);
      else if (result.rounds < B.battle.roundLimit) expect(result.heroLife).toBe(0);
      for (const event of log) {
        if ('heroLife' in event) expect(event.heroLife >= 0 && event.heroLife <= 400).toBe(true);
        if ('enemyLife' in event) expect(event.enemyLife >= 0 && event.enemyLife <= 600).toBe(true);
      }
    }
  });

  it('starts every battle at full life with every Last Stand charge', () => {
    // The same hero twice from one generator: the second battle owes nothing to the first.
    const rng = streamRng(11, 'battle', 0);
    const first = resolveBattle(hero, enemy, rng, B, { log: true });
    const second = resolveBattle(hero, enemy, rng, B, { log: true });
    for (const result of [first, second]) {
      const enemyHits = eventsOf(result.log ?? [], 'enemyHit');
      const firstHit = enemyHits[0];
      if (firstHit !== undefined) expect(firstHit.heroLife).toBe(400 - firstHit.damage);
    }
  });
});
