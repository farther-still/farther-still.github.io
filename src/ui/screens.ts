// The tab-bar screens of GDD 8.2: Map, Hero, Bestiary and the Run menu. Gear and Items are in gear.ts, Settings
// in settings.ts. Every screen but the map is rebuilt from state on each change; the map keeps its canvas.

import { combatantOf, deriveHero, dodgeChance, enemyHitDamage, heroHitDamage, hitChance, level, manualPolicy, owned, remainingEnergy, startingEnergy, unspentPoints } from '../engine';
import { STAT_KEYS, TAGS } from '../engine';
import type { DoorDef, StatKey } from '../engine';
import { daysSinceExport, exportReminderDue } from '../save';
import { button, el, line, section } from './dom';
import { hintLine, openPrefight } from './fight';
import { formatChance, formatNumber, formatPercent } from './format';
import { REJECTIONS, STAT_NAME, backupReminderWords, derivedHelp, exportReminderWords, statHelp, tagList } from './labels';
import { MapView } from './mapview';
import { openSalvage } from './salvage';
import type { ScreenName, Session, SpendAmount } from './session';
import { newRunSheet, openSaveExport } from './sheets';

export const noticeList = (session: Session): HTMLElement | null => {
  const items = session.notices.list();
  if (items.length === 0) return null;
  return el(
    'div',
    { class: 'notices' },
    ...items.map((notice) =>
      el('div', { class: 'notice' }, el('p', { text: notice.text }), button('Dismiss', () => session.notices.dismiss(notice.id), { class: 'small' })),
    ),
  );
};

/** The reminder to export (ARCHITECTURE 7.5). It never blocks play, and "Later" puts it off until the app is next started (D-33). */
const exportReminder = (session: Session): HTMLElement | null => {
  const { controller, shell, view } = session;
  const runs = controller.game.profile.counters.runsStarted;
  const now = Date.now();
  if (view.exportReminderPutOff || !exportReminderDue(controller.app, runs, now)) return null;
  return el(
    'div',
    { class: 'notice' },
    el('p', { text: exportReminderWords(daysSinceExport(controller.app, now), runs - controller.app.exportTracking.runsAtLastExport) }),
    el(
      'div',
      { class: 'row' },
      button('Export now', () => void openSaveExport(session), { class: 'small' }),
      button(
        'Later',
        () => {
          view.exportReminderPutOff = true;
          shell.rerender();
        },
        { class: 'small' },
      ),
    ),
  );
};

/** The reminder that the cloud backup has stopped for a reason only the player can put right. It never blocks play. */
const backupReminder = (session: Session): HTMLElement | null => {
  const { backup, shell, view } = session;
  const outcome = backup.status.standing;
  if (view.backupReminderPutOff || !backup.needsAttention || outcome === null) return null;
  return el(
    'div',
    { class: 'notice' },
    el('p', { text: `${backupReminderWords(outcome)} The save on this phone is unaffected.` }),
    el(
      'div',
      { class: 'row' },
      button('Open Settings', () => shell.show('settings'), { class: 'small' }),
      button(
        'Later',
        () => {
          view.backupReminderPutOff = true;
          shell.rerender();
        },
        { class: 'small' },
      ),
    ),
  );
};

// ---- Map ----

/** The map screen keeps one canvas for as long as the game runs, so walking is not interrupted by a redraw of the page. */
export class MapScreen {
  readonly element: HTMLElement;
  private readonly strip = el('div', { class: 'strip' });
  private readonly above = el('div', { class: 'map-above' });
  private readonly loadouts = el('div', { class: 'loadout-row' });
  private readonly view: MapView;

  constructor(private readonly session: Session) {
    const canvas = el('canvas', { class: 'map-canvas', attrs: { 'aria-label': 'Map' } });
    this.view = new MapView(
      session,
      {
        onEnemy: (spawn) => openPrefight(session, spawn),
        onSite: () => openSalvage(session),
        onDoor: (door) => session.shell.toast(doorMessage(session, door)),
      },
      canvas,
    );
    this.element = el('div', { class: 'map-screen' }, this.strip, this.above, canvas, this.loadouts);
  }

  update(): void {
    const { controller, content, shell, view, zoom } = this.session;
    const state = controller.game;
    const energy = remainingEnergy(state, content);
    const chip = (label: string, value: string): HTMLElement => el('span', { class: 'chip' }, el('span', { class: 'label', text: label }), el('span', { class: 'value', text: value }));
    this.strip.replaceChildren(
      chip('Level', formatNumber(level(state, content.balance))),
      chip('Energy', formatNumber(energy)),
      chip('Gold', formatNumber(state.run.gold)),
      chip('Gems', formatNumber(state.profile.gems)),
      ...(view.unseenItems.length > 0 ? [button(`New item${view.unseenItems.length > 1 ? 's' : ''}`, () => shell.show('items'), { class: 'small badge' })] : []),
    );

    const unspent = unspentPoints(state, content.balance);
    const spent =
      energy < 1
        ? el(
            'div',
            { class: 'notice' },
            el('p', {
              text: `The run is spent. Still unused: ${formatNumber(state.run.gold)} gold${state.run.salvageUsed ? '' : ', and the Salvage attempt'}.`,
            }),
            el(
              'div',
              { class: 'row' },
              button('New run…', () => shell.openSheet((close) => newRunSheet(this.session, close)), { class: 'small' }),
              // Salvage needs no walk back to its site (DV-9), so the attempt is offered here, where the run ends.
              state.run.salvageUsed ? null : button('Salvage…', () => openSalvage(this.session), { class: 'small' }),
            ),
          )
        : null;
    const above = [
      noticeList(this.session),
      hintLine(this.session, 'map'),
      exportReminder(this.session),
      backupReminder(this.session),
      spent,
      unspent > 0 ? button(`${formatNumber(unspent)} stat point${unspent === 1 ? '' : 's'} to spend`, () => shell.show('hero'), { class: 'small' }) : null,
    ].filter((node): node is HTMLElement => node !== null);
    this.above.replaceChildren(...above);

    this.loadouts.replaceChildren(
      el('span', { class: 'label', text: 'Loadout' }),
      ...state.profile.loadouts.map((loadout, index) =>
        button(loadout.name === '' ? String(index + 1) : loadout.name, () => void controller.dispatch({ type: 'SwitchLoadout', index }), {
          class: index === state.profile.activeLoadout ? 'small current' : 'small',
        }),
      ),
      // The label says what a tap will do. The map is drawn again at once; a walk in hand carries on.
      button(
        zoom.level === 'near' ? 'Zoom out' : 'Zoom in',
        () => {
          zoom.toggle();
          shell.rerender();
        },
        { class: 'small end' },
      ),
    );
    this.view.update();
  }

  detach(): void {
    this.view.detach();
  }
}

const doorMessage = (session: Session, door: DoorDef): string => {
  if (door.key === null) return 'Sealed. This is as far as the game goes for now.';
  return `Locked. It needs a key, found in ${door.keyZone === null ? 'another zone' : session.text.zone(door.keyZone)}.`;
};

// ---- Hero ----

const AMOUNTS: ReadonlyArray<{ value: SpendAmount; label: string }> = [
  { value: 1, label: '+1' },
  { value: 10, label: '+10' },
  { value: 100, label: '+100' },
  { value: 'quarter', label: '25%' },
  { value: 'all', label: 'All' },
];

const pointsFor = (amount: SpendAmount, unspent: number): number => {
  if (amount === 'all') return unspent;
  if (amount === 'quarter') return Math.max(1, Math.floor(unspent / 4));
  return Math.min(amount, unspent);
};

export const heroScreen = (session: Session): HTMLElement => {
  const { controller, content, text, shell, view } = session;
  const state = controller.game;
  const { balance } = content;
  const hero = deriveHero(state, content);
  const unspent = unspentPoints(state, balance);
  const give = pointsFor(view.hero.amount, unspent);
  const help = statHelp(balance);
  const more = derivedHelp(balance);

  const explain = (key: string): void => {
    view.hero.help = view.hero.help === key ? null : key;
    shell.rerender();
  };
  // The player's own choice goes through the same policy interface as Auto-assign and the simulator's
  // strategies (ARCHITECTURE 5.6). A second tap while the first is being saved does nothing.
  let spending = false;
  const spend = (stat: StatKey): void => {
    if (spending) return;
    spending = true;
    const chosen = { life: 0, damage: 0, defense: 0, dexterity: 0, luck: 0 };
    chosen[stat] = give;
    const points = manualPolicy(chosen)({ unspent, spent: state.run.pointsSpent, hero });
    void controller.dispatch({ type: 'Allocate', points }).then((outcome) => {
      spending = false;
      if (outcome.kind === 'rejected') shell.toast(REJECTIONS[outcome.reason]);
    });
  };

  const tabs = el(
    'div',
    { class: 'row' },
    ...(['core', 'combat'] as const).map((tab) =>
      button(tab === 'core' ? 'Core' : 'Combat', () => {
        view.hero.tab = tab;
        shell.rerender();
      }, { class: view.hero.tab === tab ? 'grow current' : 'grow' }),
    ),
  );

  const explained = (key: string, words: string | undefined): HTMLElement | null => (view.hero.help === key && words !== undefined ? el('p', { class: 'muted', text: words }) : null);
  const fact = (key: string, label: string, value: string): Array<HTMLElement | null> => [
    el('p', { class: 'line tappable' }, button(label, () => explain(key), { class: 'linkish' }), el('span', { class: 'value', text: value })),
    explained(key, more[key]),
  ];

  const core = (): Array<HTMLElement | null> => [
    section(
      unspent > 0 ? `${formatNumber(unspent)} stat point${unspent === 1 ? '' : 's'} to spend` : 'No stat points to spend',
      el('div', { class: 'row' }, ...AMOUNTS.map((option) => button(option.label, () => {
        view.hero.amount = option.value;
        shell.rerender();
      }, { class: view.hero.amount === option.value ? 'grow current' : 'grow' }))),
      ...STAT_KEYS.flatMap((stat) => [
        el(
          'div',
          { class: 'stat-row' },
          button(STAT_NAME[stat], () => explain(stat), { class: 'linkish stat-name' }),
          el('span', { class: 'stat-math', text: `${formatNumber(hero.core[stat].base)} × ${hero.core[stat].mult.toFixed(2)} = ` }),
          el('span', { class: 'stat-final', text: formatNumber(hero.core[stat].final) }),
          button(`+${formatNumber(Math.max(1, give))}`, () => spend(stat), { class: 'small', disabled: unspent < 1 }),
        ),
        explained(stat, help[stat]),
      ]),
      hero.claim ? el('p', { class: 'flash', text: `The tool is equipped: your Damage is cut by ${balance.claim.damageCutPct}%.` }) : null,
      el('p', { class: 'muted', text: 'Spent points cannot be taken back this run. Tap a name for what it does.' }),
    ),
    section(
      'Also',
      ...fact('accuracy', 'Accuracy', formatNumber(hero.accuracy)),
      ...fact('evasion', 'Evasion', formatNumber(hero.evasion)),
      ...fact('crit', 'Crit', `${formatPercent(hero.critChance * 100)} for ×${hero.critDamage.toFixed(2)}`),
      line('XP bonus', formatPercent(hero.xpBonus)),
      line('Gold bonus', formatPercent(hero.goldBonus)),
      line('Drop bonus', formatPercent(hero.dropBonus)),
      ...fact('growth', 'Growth', `+${hero.growth} per level`),
      ...fact('energy', 'Energy', `${formatNumber(remainingEnergy(state, content))} left of ${formatNumber(startingEnergy(state, balance) + hero.energy + state.run.energyPaidBack)}`),
      line('Move speed', `+${formatPercent(hero.moveSpeed)}`),
    ),
  ];

  const combat = (): Array<HTMLElement | null> => {
    const last = state.run.lastEnemy === null ? undefined : content.enemies[state.run.lastEnemy];
    const foe = last === undefined ? null : combatantOf(last);
    const average = (chance: number): string => `${formatPercent(chance * 100)} chance, ${(1 + chance).toFixed(2)} on average`;
    const tagged = (values: Record<string, number>, unit: string): HTMLElement[] =>
      TAGS.filter((tag) => (values[tag] ?? 0) !== 0).map((tag) => line(text.tag(tag), `${formatNumber(values[tag] ?? 0)}${unit}`));
    const resist = tagged(hero.resist, '');
    const versus = tagged(hero.versus, '%');
    return [
      section(
        'Each round',
        ...fact('extraHit', 'Hits per attack', average(hero.extraHit)),
        ...fact('extraAttack', 'Attacks per turn', average(hero.extraAttack)),
        ...fact('extraTurn', 'Turns per round', average(hero.extraTurn)),
        ...fact('reflect', 'Reflect', formatPercent(hero.reflect)),
        ...fact('lifeRegen', 'Regen', `${formatPercent(hero.lifeRegen)} a turn`),
        ...fact('lastStand', 'Last Stand', String(hero.lastStand)),
      ),
      section(
        last === undefined || foe === null ? 'Against the last enemy fought' : `Against ${text.enemy(last.id)}, level ${formatNumber(last.level)}`,
        ...(last === undefined || foe === null
          ? [el('p', { class: 'muted', text: 'Fight something first: these figures use the last enemy fought.' })]
          : [
              line('You hit', formatChance(hitChance(hero.accuracy, foe.level, balance))),
              line('You dodge', formatChance(dodgeChance(hero.evasion, foe.level, balance))),
              line('Your hit', formatNumber(heroHitDamage(hero, foe))),
              line('Its hit', formatNumber(enemyHitDamage(hero, foe))),
              el('p', { class: 'muted', text: 'These use the last enemy fought, not the next one.' }),
            ]),
      ),
      section('Resistance', ...(resist.length === 0 ? [el('p', { class: 'muted', text: 'None.' })] : resist)),
      section('Damage against a kind', ...(versus.length === 0 ? [el('p', { class: 'muted', text: 'None.' })] : versus)),
    ];
  };

  return el(
    'div',
    { class: 'screen' },
    el('h1', { text: `Hero · level ${formatNumber(hero.level)}` }),
    hintLine(session, 'hero'),
    tabs,
    ...(view.hero.tab === 'core' ? core() : combat()),
  );
};

// ---- Bestiary ----

export const bestiaryScreen = (session: Session): HTMLElement => {
  const { controller, content, text } = session;
  const state = controller.game;
  const seen = (id: string): boolean => state.profile.bestiary[id] !== undefined;
  const total = content.enemyOrder.length;
  const found = content.enemyOrder.filter(seen).length;
  let number = 0;

  const zones = content.zoneOrder.map((zone) => {
    const rows = content.enemyOrder
      .filter((id) => content.enemies[id]?.zone === zone)
      .map((id) => {
        number += 1;
        const enemy = content.enemies[id];
        const entry = state.profile.bestiary[id];
        if (enemy === undefined || entry === undefined) return el('div', { class: 'item' }, el('p', { class: 'muted', text: `${number}. ???` }));
        const traits: string[] = [];
        if (enemy.traits.doubleAttack > 0) traits.push(`attacks twice ${enemy.traits.doubleAttack}%`);
        if (enemy.traits.tripleAttack > 0) traits.push(`a third time ${enemy.traits.tripleAttack}%`);
        if (enemy.traits.regen > 0) traits.push(`heals ${enemy.traits.regen}% a turn`);
        if (enemy.traits.damageReduction > 0) traits.push(`takes ${enemy.traits.damageReduction}% less`);
        const drops = enemy.drops.map((drop) => (owned(state, drop.item) > 0 ? text.item(drop.item) : '?'));
        return el(
          'div',
          { class: 'item' },
          el('p', { class: 'item-name', text: `${number}. ${text.glyph(id)} ${text.enemy(id)} · level ${formatNumber(enemy.level)}${enemy.boss ? ' · Boss' : ''}` }),
          el('p', { class: 'muted', text: `${tagList(enemy.tags, text)}${traits.length > 0 ? ` · ${traits.join(', ')}` : ''} · beaten ${formatNumber(entry.timesBeaten)} time${entry.timesBeaten === 1 ? '' : 's'}` }),
          el('p', { class: 'muted', text: enemy.drops.length === 0 ? 'Drops nothing.' : `Drops: ${drops.join(', ')}` }),
          enemy.boss ? el('p', { class: state.profile.claimedBosses.includes(id) ? 'ok' : 'flash', text: state.profile.claimedBosses.includes(id) ? 'Claimed' : 'Unclaimed' }) : null,
        );
      });
    const known = content.enemyOrder.some((id) => content.enemies[id]?.zone === zone && seen(id));
    return section(known ? text.zone(zone) : '???', ...rows);
  });

  return el('div', { class: 'screen' }, el('h1', { text: `Bestiary · ${found} of ${total}` }), hintLine(session, 'bestiary'), ...zones);
};

// ---- Run menu ----

export const runScreen = (session: Session): HTMLElement => {
  const { controller, content, shell, updates } = session;
  const state = controller.game;
  const { profile, run } = state;
  const { balance } = content;
  const itemsOwned = content.itemOrder.filter((id) => owned(state, id) > 0).length;
  const bosses = content.enemyOrder.filter((id) => content.enemies[id]?.boss === true);
  const zonesReached = content.zoneOrder.filter((zone) => content.enemyOrder.some((id) => content.enemies[id]?.zone === zone && (profile.bestiary[id]?.timesBeaten ?? 0) > 0)).length;

  return el(
    'div',
    { class: 'screen' },
    el('h1', { text: `Run ${formatNumber(profile.counters.runsStarted)}` }),
    hintLine(session, 'run'),
    noticeList(session),
    section(
      'This run',
      line('Level', formatNumber(level(state, balance))),
      line('Strongest enemy beaten', run.strongestBeaten === 0 ? 'None yet' : `level ${formatNumber(run.strongestBeaten)}`),
      line('Energy', `${formatNumber(remainingEnergy(state, content))} left`),
      line('Wins and losses', `${formatNumber(run.tallies.wins)} and ${formatNumber(run.tallies.losses)}`),
      line('Gold', formatNumber(run.gold)),
      line('Salvage', run.salvageUsed ? 'Used' : 'Not used yet'),
      // The same sheet a Salvage site on the map opens, from wherever the hero stands (GDD 7.4, DV-9).
      button('Salvage…', () => openSalvage(session), { disabled: run.salvageUsed }),
      button('New run…', () => shell.openSheet((close) => newRunSheet(session, close)), { class: 'primary' }),
    ),
    section(
      'Ever',
      line('Strongest enemy beaten', profile.strongestEverBeaten === 0 ? 'None yet' : `level ${formatNumber(profile.strongestEverBeaten)}`),
      line('Best level', formatNumber(profile.counters.bestLevel)),
      line('Starting energy', formatNumber(startingEnergy(state, balance))),
      line('Items', `${itemsOwned} of ${content.itemOrder.length}`),
      line('Bestiary', `${Object.keys(profile.bestiary).length} of ${content.enemyOrder.length}`),
      line('Bosses claimed', `${profile.claimedBosses.length} of ${bosses.length}`),
      line('Zones reached', `${zonesReached} of ${content.zoneOrder.length}`),
      line('Gems', formatNumber(profile.gems)),
    ),
    button(updates.state === 'ready' ? 'Settings • update ready' : 'Settings', () => shell.show('settings')),
  );
};

// ---- tab bar ----

const TABS: ReadonlyArray<{ screen: ScreenName; label: string }> = [
  { screen: 'map', label: 'Map' },
  { screen: 'hero', label: 'Hero' },
  { screen: 'gear', label: 'Gear' },
  { screen: 'items', label: 'Items' },
  { screen: 'bestiary', label: 'Bestiary' },
  { screen: 'run', label: 'Run' },
];

export const tabBar = (session: Session, current: ScreenName): HTMLElement =>
  el(
    'nav',
    { class: 'tabbar' },
    ...TABS.map((tab) => {
      const here = tab.screen === current || (tab.screen === 'run' && current === 'settings');
      const dot = tab.screen === 'run' && session.updates.state === 'ready' ? ' •' : '';
      return button(`${tab.label}${dot}`, () => session.shell.show(tab.screen), { class: here ? 'tab current' : 'tab' });
    }),
  );
