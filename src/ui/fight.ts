// A fight, from the player's side (GDD 8.1): the pre-fight sheet, battle playback, and the result sheet. The
// battle is resolved and saved before any of it is shown; playback only walks the event log.

import { deriveHero, dropsHeld, enemyAtSpawn, fightBlock, fightCost, forecast, level, owned, remainingEnergy, startingEnergy, unspentPoints } from '../engine';
import type { BattleEvent, EnemyDef, GameEvent, LimitingFactor, RewardSummary, SpawnId } from '../engine';
import { button, el, line } from './dom';
import { formatNumber, formatOdds } from './format';
import { REJECTIONS, energyWords, hints, tagList } from './labels';
import type { Session } from './session';

const sheet = (title: string, ...children: (Node | null | false)[]): HTMLElement =>
  el('div', { class: 'sheet', attrs: { role: 'dialog', 'aria-label': title } }, el('h2', { text: title }), ...children);

type BattleRecord = Extract<GameEvent, { type: 'Battle' }>;

const FACTOR: Record<LimitingFactor['kind'], (factor: LimitingFactor) => string> = {
  miss: (factor) => (factor.kind === 'miss' ? `You miss too often: ${factor.hitPercent}% to hit.` : ''),
  burst: (factor) => (factor.kind === 'burst' ? `It kills you in ${factor.hits} hit${factor.hits === 1 ? '' : 's'}.` : ''),
  regen: () => 'It heals faster than you hurt it.',
  shrug: (factor) => (factor.kind === 'shrug' ? `It shrugs off ${factor.percent}% of your damage.` : ''),
  rounds: (factor) => (factor.kind === 'rounds' ? `You need about ${factor.need} rounds and last about ${factor.last}.` : ''),
  rolls: () => 'It comes down to the rolls.',
};

const MARK_WORD = { xp: 'XP', drops: 'drop chance', gold: 'gold' } as const;

const traitLines = (enemy: EnemyDef): string[] => {
  const { doubleAttack, tripleAttack, regen, damageReduction } = enemy.traits;
  const out: string[] = [];
  if (doubleAttack > 0) out.push(tripleAttack > 0 ? `Attacks twice ${doubleAttack}% of the time, and a third time ${tripleAttack}% of those.` : `Attacks twice ${doubleAttack}% of the time.`);
  if (regen > 0) out.push(`Heals ${regen}% of its life at the start of each of its turns.`);
  if (damageReduction > 0) out.push(`Takes ${damageReduction}% less from everything.`);
  return out.length === 0 ? ['No special traits.'] : out;
};

/** The first-time line for a screen or sheet, with its own dismiss button (GDD 8.4). */
export const hintLine = (session: Session, id: string): HTMLElement | null => {
  const { controller, content } = session;
  if (controller.game.profile.hintsShown.includes(id)) return null;
  const words = hints(content.balance)[id];
  if (words === undefined) return null;
  const box = el('div', { class: 'hint' }, el('p', { text: words }));
  box.append(
    button(
      'Got it',
      () => {
        // Hidden at once: a sheet is not rebuilt when the state changes, so the line would otherwise stay.
        box.hidden = true;
        void controller.dispatch({ type: 'MarkHintShown', hint: id });
      },
      { class: 'small' },
    ),
  );
  return box;
};

export const openPrefight = (session: Session, spawn: SpawnId): void => {
  session.shell.openSheet((close) => prefightSheet(session, spawn, close));
};

const prefightSheet = (session: Session, spawnId: SpawnId, close: () => void): HTMLElement => {
  const { controller, content, text, shell } = session;
  const state = controller.game;
  const enemy = enemyAtSpawn(content, spawnId);
  if (enemy === undefined) return sheet('Nothing there', button('Back', close));

  const hero = deriveHero(state, content);
  const outlook = forecast(state, spawnId, content);
  const block = fightBlock(state, spawnId, content);
  const cost = fightCost(enemy, content);
  const energy = remainingEnergy(state, content);
  const claimed = state.profile.claimedBosses.includes(enemy.id);
  const mark = state.run.marks[spawnId];
  const held = dropsHeld(state, enemy, content);
  const found = enemy.drops.filter((drop) => owned(state, drop.item) > 0);
  const status = el('p', { class: 'muted' });
  let started = false;

  const fight = async (): Promise<void> => {
    // A second tap while the first battle is being saved must not start a second one.
    if (started) return;
    started = true;
    status.textContent = 'Saving…';
    const outcome = await controller.dispatch({ type: 'Fight', spawn: spawnId });
    if (outcome.kind === 'rejected') {
      shell.toast(REJECTIONS[outcome.reason]);
      close();
      return;
    }
    if (outcome.kind !== 'done') return;
    const battle = outcome.events.find((event): event is BattleRecord => event.type === 'Battle');
    const rewards = outcome.events.find((event): event is { type: 'Rewards' } & RewardSummary => event.type === 'Rewards') ?? null;
    if (battle === undefined) {
      close();
      return;
    }
    if (rewards !== null) session.view.unseenItems.push(...rewards.drops);
    const showResult = (): void => shell.openSheet((closeResult) => resultSheet(session, battle, rewards, closeResult));
    if (controller.app.settings.skipPlayback) showResult();
    else shell.openSheet(() => playbackSheet(session, battle, showResult));
  };

  const words = energyWords(content.balance);
  const energyLine = `${enemy.boss ? words.bossCost(cost, claimed ? cost : cost + content.balance.energy.bossSurplus) : words.cost(cost)} You have ${energy}.`;

  return sheet(
    `${text.glyph(enemy.id)} ${text.enemy(enemy.id)}`,
    hintLine(session, 'prefight'),
    line('Level', `${formatNumber(enemy.level)}${enemy.boss ? ' · Boss' : ''}`),
    line('Kind', tagList(enemy.tags, text)),
    ...traitLines(enemy).map((words) => el('p', { text: words })),
    enemy.gate ? el('p', { class: 'flash', text: 'A gate: it stands on the only way on. Beating it opens the way for this run.' }) : null,
    el('p', { text: energyLine }),
    enemy.boss
      ? el('p', {
          text: claimed
            ? 'Claimed. It gives nothing extra now.'
            : hero.claim
              ? `The tool is equipped: a win claims this boss, for +${content.balance.energy.perClaim} starting energy for good, and pays no surplus this once.`
              : 'Unclaimed.',
        })
      : null,
    mark === undefined ? null : el('p', { class: 'ok', text: `Marked: +${mark.percent}% ${MARK_WORD[mark.stat]} for the win that removes it.` }),
    outlook === null
      ? null
      : el(
          'div',
          { class: 'callout' },
          el('p', { class: 'big', text: `Win chance: ${formatOdds(outlook.winChance)}` }),
          outlook.factor === null ? null : el('p', { text: FACTOR[outlook.factor.kind](outlook.factor) }),
        ),
    el('p', {
      text:
        enemy.drops.length === 0
          ? 'It drops nothing.'
          : `Drops: ${found.length} of ${enemy.drops.length} found${found.length > 0 ? ` (${found.map((drop) => text.item(drop.item)).join(', ')})` : ''}. ${held.length === 0 ? 'Nothing left to get here.' : `${held.length} still to get.`}`,
    }),
    button('Fight', () => void fight(), { class: 'primary', disabled: block !== null }),
    block === null ? null : el('p', { class: 'flash', text: REJECTIONS[block] }),
    button('Back', close),
    status,
  );
};

// ---- playback ----

type Frame = { heroLife: number; enemyLife: number; words: string; pause: number };

const framesOf = (battle: BattleRecord): Frame[] => {
  let heroLife = battle.heroMaxLife;
  let enemyLife = battle.enemyMaxLife;
  let round = 0;
  const frames: Frame[] = [];
  const add = (words: string, pause = 1): number => frames.push({ heroLife, enemyLife, words: `Round ${round}: ${words}`, pause });
  for (const event of battle.log as readonly BattleEvent[]) {
    switch (event.t) {
      case 'round':
        round = event.n;
        break;
      case 'heroRegen':
        heroLife = event.heroLife;
        add(`you recover ${formatNumber(event.amount)}`);
        break;
      case 'miss':
        add('you miss');
        break;
      case 'hit':
        enemyLife = event.enemyLife;
        add(event.crit ? `a crit for ${formatNumber(event.damage)}` : `you hit for ${formatNumber(event.damage)}`);
        break;
      case 'extraTurn':
        add('an extra turn', 0.5);
        break;
      case 'enemyRegen':
        enemyLife = event.enemyLife;
        add(`it recovers ${formatNumber(event.amount)}`);
        break;
      case 'dodge':
        add('you dodge');
        break;
      case 'enemyHit':
        heroLife = event.heroLife;
        add(`it hits you for ${formatNumber(event.damage)}`);
        break;
      case 'lastStand':
        heroLife = 1;
        add(`Last Stand: you hold on at 1 Life (${event.left} left)`, 1.5);
        break;
      case 'reflect':
        enemyLife = event.enemyLife;
        add(`${formatNumber(event.damage)} reflected`);
        break;
      case 'end':
        add(event.win ? 'it falls' : 'you fall', 2);
        break;
    }
  }
  return frames;
};

/** About this long for a whole battle at 1×, whatever its length (GDD 5.9: 3 to 6 seconds a fight). */
const TARGET_MS = 4200;
const MIN_FRAME_MS = 45;
const MAX_FRAME_MS = 420;

const playbackSheet = (session: Session, battle: BattleRecord, done: () => void): HTMLElement => {
  const { controller, text } = session;
  const frames = framesOf(battle);
  const beat = Math.min(MAX_FRAME_MS, Math.max(MIN_FRAME_MS, TARGET_MS / Math.max(1, frames.length)));
  let speed: number = controller.app.settings.playbackSpeed;
  let at = 0;
  let finished = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const words = el('p', { class: 'battle-words', text: 'The fight begins.' });
  const bar = (label: string): { row: HTMLElement; fill: HTMLElement; value: HTMLElement } => {
    const fill = el('div', { class: 'bar-fill' });
    const value = el('span', { class: 'value' });
    return { row: el('div', { class: 'bar-row' }, el('p', { class: 'line' }, el('span', { class: 'label', text: label }), value), el('div', { class: 'bar' }, fill)), fill, value };
  };
  const enemyBar = bar(`${text.glyph(battle.enemy)} ${text.enemy(battle.enemy)}`);
  const heroBar = bar('You');

  // Widths are set as classes, never as inline styles: the content security policy forbids those.
  const setBar = (target: { fill: HTMLElement; value: HTMLElement }, life: number, max: number): void => {
    const share = Math.max(0, Math.min(20, Math.ceil((life / Math.max(1, max)) * 20)));
    target.fill.className = `bar-fill w${share}`;
    target.value.textContent = `${formatNumber(life)} / ${formatNumber(max)}`;
  };
  const show = (frame: Frame | undefined): void => {
    if (frame === undefined) return;
    setBar(enemyBar, frame.enemyLife, battle.enemyMaxLife);
    setBar(heroBar, frame.heroLife, battle.heroMaxLife);
    words.textContent = frame.words;
  };
  setBar(enemyBar, battle.enemyMaxLife, battle.enemyMaxLife);
  setBar(heroBar, battle.heroMaxLife, battle.heroMaxLife);

  const finish = (): void => {
    if (finished) return;
    finished = true;
    if (timer !== null) clearTimeout(timer);
    // If a write failed while the battle played (remembering a speed is a write), the game has stopped on its
    // save-failed screen, and the result sheet must not open over it.
    if (controller.halt === null) done();
  };
  const next = (): void => {
    if (finished) return;
    if (controller.halt !== null) {
      finish();
      return;
    }
    const frame = frames[at];
    if (frame === undefined) {
      finish();
      return;
    }
    show(frame);
    at += 1;
    timer = setTimeout(next, (beat * frame.pause) / speed);
  };
  timer = setTimeout(next, 250 / speed);

  const speedButtons = ([1, 2, 4] as const).map((option) =>
    button(`${option}×`, () => {
      speed = option;
      for (const [index, node] of speedButtons.entries()) node.className = `btn grow${[1, 2, 4][index] === option ? ' current' : ''}`;
      // The setting is remembered (GDD 8.2). It is not game state.
      void controller.updateApp((app) => ({ ...app, settings: { ...app.settings, playbackSpeed: option } }));
    }, { class: `grow${speed === option ? ' current' : ''}` }),
  );

  return sheet(
    'Battle',
    enemyBar.row,
    heroBar.row,
    words,
    el('div', { class: 'row' }, ...speedButtons, button('Skip', finish, { class: 'grow primary' })),
  );
};

// ---- result ----

const ordinal = (n: number): string => {
  const tail = n % 100;
  if (tail >= 11 && tail <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
};

/** One line built from the real battle: how much of the enemy's life was removed, and in how many of its hits the hero died (GDD 3.5). */
export const lossSummary = (battle: Pick<BattleRecord, 'enemyMaxLife' | 'enemyLifeLeft' | 'hitsTaken' | 'log'>, roundLimit: number): string => {
  // Multiplied before it is divided: 29 of 100 worked the other way round is 28.99…, which would show as 28%.
  const removed = Math.floor(((battle.enemyMaxLife - battle.enemyLifeLeft) * 100) / Math.max(1, battle.enemyMaxLife));
  const ended = battle.log[battle.log.length - 1];
  // The hero fell only if the battle ended on a killing blow. One that Last Stand caught is followed by its own event, and the battle goes on.
  const last = battle.log[battle.log.length - 2];
  const fell = last !== undefined && last.t === 'enemyHit' && last.heroLife <= 0;
  const timedOut = ended !== undefined && ended.t === 'end' && ended.rounds >= roundLimit && battle.hitsTaken >= 0 && !fell;
  if (timedOut) return `You took off ${removed}% of its life, and neither of you fell in ${roundLimit} rounds. That counts as a loss.`;
  return `You took off ${removed}% of its life and fell to its ${ordinal(Math.max(1, battle.hitsTaken))} hit.`;
};

const resultSheet = (session: Session, battle: BattleRecord, rewards: RewardSummary | null, close: () => void): HTMLElement => {
  const { controller, content, text, shell } = session;
  const state = controller.game;
  const enemy = content.enemies[battle.enemy];
  const again = (): void => {
    close();
    openPrefight(session, battle.spawn);
  };
  const canFightAgain = enemy !== undefined && fightBlock(state, battle.spawn, content) === null;
  const back = button('Back to the map', close);

  if (!battle.win || rewards === null) {
    return sheet(
      'Defeat',
      el('p', { text: lossSummary(battle, content.balance.battle.roundLimit) }),
      el('p', { class: 'muted', text: energyWords(content.balance).afterLoss(enemy === undefined ? 0 : fightCost(enemy, content), remainingEnergy(state, content)) }),
      button('Try again', again, { class: 'primary', disabled: !canFightAgain }),
      back,
    );
  }

  const gained = rewards.levelAfter - rewards.levelBefore;
  const unspent = unspentPoints(state, content.balance);
  const tool = rewards.drops.find((id) => content.items[id]?.claim === true);
  return sheet(
    'Victory',
    line('XP', `+${formatNumber(rewards.xp)}`),
    gained > 0 ? line('Level', `${formatNumber(rewards.levelBefore)} → ${formatNumber(rewards.levelAfter)}`) : line('Level', formatNumber(level(state, content.balance))),
    line('Gold', `+${formatNumber(rewards.gold)}`),
    rewards.gems > 0 ? line('Gems', `+${rewards.gems}`) : null,
    rewards.mark === null ? null : el('p', { class: 'ok', text: `It was marked: +${rewards.mark.percent}% ${MARK_WORD[rewards.mark.stat]}.` }),
    ...rewards.drops.map((id) => el('p', { class: 'ok', text: `Dropped: ${text.item(id)}` })),
    tool === undefined ? null : el('p', { text: text.line(`handover.${tool}`) }),
    tool === undefined ? null : el('div', { class: 'hint' }, el('p', { text: hints(content.balance)['tool'] ?? '' })),
    rewards.claimed
      ? el('p', { class: 'ok', text: `${text.line('claim')} Claimed: starting energy is now ${startingEnergy(state, content.balance)}, for good.`.trim() })
      : null,
    line('Energy', `−${rewards.energyCost}${rewards.energyBack > 0 ? `, +${rewards.energyBack} back` : ''}, ${rewards.energyLeft} left`),
    unspent > 0
      ? button(`Spend ${formatNumber(unspent)} stat point${unspent === 1 ? '' : 's'}`, () => {
          close();
          shell.show('hero');
        })
      : null,
    button('Fight again', again, { class: 'primary', disabled: !canFightAgain }),
    back,
  );
};
