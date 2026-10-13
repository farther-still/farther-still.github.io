// The loss summary (GDD 3.5): one line built from the real battle, saying how much of the enemy's life was
// removed and in how many of its hits the hero died.

import { describe, expect, it } from 'vitest';
import { CONTENT } from '../../tests/helpers';
import { deriveHero, resolveBattle, step } from '../engine';
import type { BattleEvent, Combatant, Content, EnemyDef, GameEvent, GameState, HeroStats, Rng } from '../engine';
import { SAMPLE_BALANCE, sampleContent, sampleGame } from '../engine/sample.fixture';
import { defeatEnergyLine, lossSummary, prefightEnergyLine } from './fight';

const LIMIT = CONTENT.balance.battle.roundLimit;

type Lost = Parameters<typeof lossSummary>[0];

/**
 * A lost battle's record, written out by hand in the shape the engine logs one. The enemy lands `hits` hits, one
 * a round. Each of the first `stands` killing blows is caught by Last Stand; `fell` says whether a last one was not.
 */
const lost = (spec: { max: number; left: number; hits: number; fell: boolean; stands?: number; rounds?: number }): Lost => {
  const stands = spec.stands ?? 0;
  const log: BattleEvent[] = [];
  for (let hit = 1; hit <= spec.hits; hit += 1) {
    log.push({ t: 'round', n: hit }, { t: 'miss' });
    const killing = hit > spec.hits - stands - (spec.fell ? 1 : 0);
    log.push({ t: 'enemyHit', damage: 10, heroLife: killing ? 0 : 5 });
    const caught = killing && !(spec.fell && hit === spec.hits);
    if (caught) log.push({ t: 'lastStand', left: spec.hits - hit });
  }
  const rounds = spec.rounds ?? spec.hits;
  for (let round = spec.hits + 1; round <= rounds; round += 1) log.push({ t: 'round', n: round }, { t: 'miss' }, { t: 'dodge' });
  log.push({ t: 'end', win: false, rounds });
  return { enemyMaxLife: spec.max, enemyLifeLeft: spec.left, hitsTaken: spec.hits, log };
};

describe('lossSummary', () => {
  it('says how much of the enemy’s life was removed and which of its hits the hero fell to', () => {
    expect(lossSummary(lost({ max: 100, left: 60, hits: 3, fell: true }), LIMIT)).toBe('You took off 40% of its life and fell to its 3rd hit.');
    expect(lossSummary(lost({ max: 480, left: 480, hits: 2, fell: true }), LIMIT)).toBe('You took off 0% of its life and fell to its 2nd hit.');
    expect(lossSummary(lost({ max: 2500, left: 1, hits: 1, fell: true }), LIMIT)).toBe('You took off 99% of its life and fell to its 1st hit.');
  });

  it('counts the hit correctly in words: 1st, 2nd, 3rd, 4th, 11th, 12th, 13th, 21st, 22nd, 23rd, 101st, 111th', () => {
    const ending = (hits: number): string => lossSummary(lost({ max: 100, left: 50, hits, fell: true }), LIMIT).replace('You took off 50% of its life and fell to its ', '');
    expect([1, 2, 3, 4, 10, 11, 12, 13, 14, 20, 21, 22, 23, 24, 100, 101, 102, 103, 111, 112, 113, 121].map(ending)).toEqual([
      '1st hit.',
      '2nd hit.',
      '3rd hit.',
      '4th hit.',
      '10th hit.',
      '11th hit.',
      '12th hit.',
      '13th hit.',
      '14th hit.',
      '20th hit.',
      '21st hit.',
      '22nd hit.',
      '23rd hit.',
      '24th hit.',
      '100th hit.',
      '101st hit.',
      '102nd hit.',
      '103rd hit.',
      '111th hit.',
      '112th hit.',
      '113th hit.',
      '121st hit.',
    ]);
  });

  it('cuts the share to a whole percentage and never rounds it up: almost all is not all', () => {
    const share = (max: number, left: number): string => lossSummary(lost({ max, left, hits: 1, fell: true }), LIMIT).replace(/^You took off (\d+%).*$/, '$1');
    expect(share(3, 1)).toBe('66%');
    expect(share(3, 2)).toBe('33%');
    expect(share(1000, 1)).toBe('99%');
    expect(share(1000, 995)).toBe('0%');
    expect(share(7, 7)).toBe('0%');
  });

  it('shows an exact share as itself, not one below', () => {
    // 29 of 100 is 29%. Dividing first and multiplying after makes it 28.999…, which cuts to 28.
    const share = (max: number, left: number): string => lossSummary(lost({ max, left, hits: 1, fell: true }), LIMIT).replace(/^You took off (\d+%).*$/, '$1');
    expect(share(100, 71)).toBe('29%');
    expect(share(200, 86)).toBe('57%');
    expect(share(100, 42)).toBe('58%');
    const wrong: string[] = [];
    for (const max of [100, 200, 480, 1000, 12000]) {
      for (let percent = 0; percent <= 99; percent += 1) {
        const left = max - (max * percent) / 100;
        if (!Number.isInteger(left)) continue;
        if (share(max, left) !== `${percent}%`) wrong.push(`${max - left} of ${max}: ${share(max, left)}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it('says so when the round limit ended it with both still standing', () => {
    const summary = lossSummary(lost({ max: 1000, left: 250, hits: 4, fell: false, rounds: LIMIT }), LIMIT);
    expect(summary).toBe(`You took off 75% of its life, and neither of you fell in ${LIMIT} rounds. That counts as a loss.`);
    // No hit landed at all.
    expect(lossSummary(lost({ max: 1000, left: 1000, hits: 0, fell: false, rounds: LIMIT }), LIMIT)).toBe(
      `You took off 0% of its life, and neither of you fell in ${LIMIT} rounds. That counts as a loss.`,
    );
  });

  it('says the hero fell when the killing blow came in the very last round', () => {
    expect(lossSummary(lost({ max: 1000, left: 250, hits: LIMIT, fell: true }), LIMIT)).toBe(`You took off 75% of its life and fell to its ${LIMIT}th hit.`);
  });

  it('counts a blow that Last Stand caught as a hit, and the blow after it as the one the hero fell to', () => {
    expect(lossSummary(lost({ max: 100, left: 90, hits: 3, fell: true, stands: 1 }), LIMIT)).toBe('You took off 10% of its life and fell to its 3rd hit.');
  });

  it('does not say the hero fell when Last Stand caught the blow and the round limit then ended the battle', () => {
    const summary = lossSummary(lost({ max: 100, left: 90, hits: 3, fell: false, stands: 1, rounds: LIMIT }), LIMIT);
    expect(summary).toBe(`You took off 10% of its life, and neither of you fell in ${LIMIT} rounds. That counts as a loss.`);
  });

  describe('on battles the engine itself resolved', () => {
    const isBattle = (event: GameEvent): event is Extract<GameEvent, { type: 'Battle' }> => event.type === 'Battle';

    /** The share removed, worked out in whole numbers. */
    const percentOff = (max: number, left: number): number => Number((BigInt(max - left) * 100n) / BigInt(max));

    /** A generator that hands back `first` for its first `count` rolls and `rest` for ever after. */
    const scripted = (first: number, count: number, rest: number): Rng => {
      let drawn = 0;
      const next = (): number => {
        drawn += 1;
        return drawn <= count ? first : rest;
      };
      return { next, nextUint32: () => Math.floor(next() * 0x100000000) };
    };

    const hero = (changes: Partial<HeroStats>): HeroStats => ({
      ...deriveHero(sampleGame(), CONTENT),
      extraAttack: 0,
      extraHit: 0,
      extraTurn: 0,
      critChance: 0,
      lifeRegen: 0,
      reflect: 0,
      lastStand: 0,
      ...changes,
    });
    const wall: Combatant = { level: 1, life: 1_000_000, damage: 50, defense: 0, tags: [], traits: { doubleAttack: 0, tripleAttack: 0, regen: 0, damageReduction: 0 } };

    const summaryOf = (result: ReturnType<typeof resolveBattle>): string =>
      lossSummary({ enemyMaxLife: result.enemyMaxLife, enemyLifeLeft: result.enemyLife, hitsTaken: result.hitsTaken, log: result.log ?? [] }, LIMIT);

    it('a new hero who walks up to the boss falls to its second hit', () => {
      // The sample world's boss hits for 50 and the new hero has 60 Life, whatever the rolls.
      const fresh = sampleGame();
      const beside = { ...fresh, run: { ...fresh.run, position: { zone: 'z01', x: 3, y: 2 } } };
      const result = step(beside, { type: 'Fight', spawn: 's003' }, CONTENT);
      if ('rejected' in result) throw new Error(`the fight was rejected: ${result.rejected}`);
      const battle = result.events.find(isBattle);
      if (battle === undefined || battle.win) throw new Error('expected a lost battle');
      expect(lossSummary(battle, LIMIT)).toBe(`You took off ${percentOff(battle.enemyMaxLife, battle.enemyLifeLeft)}% of its life and fell to its 2nd hit.`);
    });

    it('a battle that runs to the round limit is reported as neither falling', () => {
      // Every roll is 0: the hero always hits, for far too little, and always dodges.
      const result = resolveBattle(hero({}), wall, scripted(0, 0, 0), CONTENT.balance, { log: true });
      expect(result).toMatchObject({ win: false, rounds: LIMIT, hitsTaken: 0 });
      expect(summaryOf(result)).toBe(`You took off ${percentOff(result.enemyMaxLife, result.enemyLife)}% of its life, and neither of you fell in ${LIMIT} rounds. That counts as a loss.`);
    });

    it('a hero caught once by Last Stand who then lasts to the round limit did not fall', () => {
      // The first round's five rolls are high, so the hero misses and the one enemy hit lands; every roll after
      // that is 0, so the enemy never lands another.
      const result = resolveBattle(hero({ life: 1, lastStand: 1 }), wall, scripted(0.999, 5, 0), CONTENT.balance, { log: true });
      const log = result.log ?? [];
      expect(result).toMatchObject({ win: false, rounds: LIMIT, hitsTaken: 1, heroLife: 1 });
      expect(log.filter((event) => event.t === 'lastStand')).toHaveLength(1);
      expect(summaryOf(result)).toBe(`You took off ${percentOff(result.enemyMaxLife, result.enemyLife)}% of its life, and neither of you fell in ${LIMIT} rounds. That counts as a loss.`);
    });

    it('a hero caught once by Last Stand and then killed fell to the second hit', () => {
      // Every roll is high: the hero misses and every enemy hit lands.
      const result = resolveBattle(hero({ life: 1, lastStand: 1 }), wall, scripted(0.999, 0, 0.999), CONTENT.balance, { log: true });
      expect(result).toMatchObject({ win: false, rounds: 2, hitsTaken: 2, heroLife: 0 });
      expect(summaryOf(result)).toBe('You took off 0% of its life and fell to its 2nd hit.');
    });
  });
});

// The two lines that say what a fight costs, where the sheets build them (GDD 2.2, DV-10). They are checked
// under both positions of the switch, in the sample world, where a fight costs 1 and a boss pays back 3.
describe('prefightEnergyLine and defeatEnergyLine', () => {
  const free = sampleContent({ ...SAMPLE_BALANCE, energy: { ...SAMPLE_BALANCE.energy, chargeLosses: false } });
  const charged = CONTENT;
  const enemyOf = (id: string): EnemyDef => {
    const enemy = free.enemies[id];
    if (enemy === undefined) throw new Error(`test setup: no enemy ${id}`);
    return enemy;
  };
  const game = (run: Partial<GameState['run']> = {}, profile: Partial<GameState['profile']> = {}): GameState => {
    const base = sampleGame();
    return { profile: { ...base.profile, ...profile }, run: { ...base.run, ...run } };
  };

  it('has a loss charged in the sample balance, as the GDD now rules (R-11)', () => {
    expect(charged.balance.energy.chargeLosses).toBe(true);
    expect(free.balance.energy.chargeLosses).toBe(false);
  });

  it('gives a normal fight’s cost and the energy in hand, under either rule', () => {
    expect(prefightEnergyLine(game(), enemyOf('e001'), free)).toBe('Costs 1 energy on a win. You have 20.');
    expect(prefightEnergyLine(game(), enemyOf('e001'), charged)).toBe('Costs 1 energy, win or lose. You have 20.');
    expect(prefightEnergyLine(game({ energySpent: 7, energyPaidBack: 3 }), enemyOf('e002'), free)).toBe('Costs 1 energy on a win. You have 16.');
    expect(prefightEnergyLine(game({ energySpent: 7, energyPaidBack: 3 }), enemyOf('e002'), charged)).toBe('Costs 1 energy, win or lose. You have 16.');
  });

  it('gives a boss’s payback: cost and surplus while unclaimed, cost alone once claimed', () => {
    expect(prefightEnergyLine(game(), enemyOf('e003'), free)).toBe('Costs 1 energy on a win and pays back 3. You have 20.');
    expect(prefightEnergyLine(game(), enemyOf('e003'), charged)).toBe('Costs 1 energy, win or lose, and pays back 3 on a win. You have 20.');
    const claimed = game({}, { claimedBosses: ['e003'] });
    expect(prefightEnergyLine(claimed, enemyOf('e003'), free)).toBe('Costs 1 energy on a win and pays back 1. You have 23.');
    expect(prefightEnergyLine(claimed, enemyOf('e003'), charged)).toBe('Costs 1 energy, win or lose, and pays back 1 on a win. You have 23.');
  });

  it('follows the zone’s cost where a fight costs 2', () => {
    const costly = (content: Content): Content => {
      const zone = content.zones['z01'];
      if (zone === undefined) throw new Error('test setup: no zone');
      return { ...content, zones: { ...content.zones, z01: { ...zone, balanceKey: 'Z7' } } };
    };
    expect(prefightEnergyLine(game(), enemyOf('e001'), costly(free))).toBe('Costs 2 energy on a win. You have 20.');
    expect(prefightEnergyLine(game(), enemyOf('e003'), costly(charged))).toBe('Costs 2 energy, win or lose, and pays back 4 on a win. You have 20.');
    expect(defeatEnergyLine(game({ energySpent: 2 }), enemyOf('e003'), costly(charged))).toBe('That fight cost 2 energy. You have 18 left. No gold was lost.');
  });

  it('says after a real lost fight what it cost and what is left, and says a loss is free only where it is', () => {
    const beside = game({ position: { zone: 'z01', x: 3, y: 2 } });
    const after = (content: Content): GameState => {
      const result = step(beside, { type: 'Fight', spawn: 's003' }, content);
      if ('rejected' in result) throw new Error(`test setup: the fight was rejected: ${result.rejected}`);
      expect(result.state.run.tallies.losses).toBe(1);
      return result.state;
    };
    expect(defeatEnergyLine(after(free), enemyOf('e003'), free)).toBe('A loss costs nothing: no energy, no gold.');
    expect(defeatEnergyLine(after(charged), enemyOf('e003'), charged)).toBe('That fight cost 1 energy. You have 19 left. No gold was lost.');
    // The second loss in a row is charged again.
    const again = step(after(charged), { type: 'Fight', spawn: 's003' }, charged);
    if ('rejected' in again) throw new Error('test setup: the retry was rejected');
    expect(defeatEnergyLine(again.state, enemyOf('e003'), charged)).toBe('That fight cost 1 energy. You have 18 left. No gold was lost.');
  });
});
