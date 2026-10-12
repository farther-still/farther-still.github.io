// Gear and Items (GDD 8.2). Buying happens here, from anywhere, at any time: there are no merchants on the map
// (Q10), and everything in the shop is listed with its price from the start (D-11).

import { ACCESSORY_SLOTS, ARMOR_SLOTS, SLOT_IDS, STAT_KEYS, activeLoadout, deriveHero, loadoutPrice, owned, shopPrice } from '../engine';
import type { GameState, HeroStats, ItemDef, ItemId, ItemKind, SlotId } from '../engine';
import { button, el, line, section } from './dom';
import { hintLine } from './fight';
import { formatNumber, formatPair, formatPercent } from './format';
import { KIND_NAME, REJECTIONS, SLOT_NAME, STAT_NAME, itemLines } from './labels';
import type { ItemFilter, Session } from './session';

const kindOfSlot = (slot: SlotId): ItemKind => ((ACCESSORY_SLOTS as readonly string[]).includes(slot) ? 'accessory' : (slot as ItemKind));

const itemsOfKind = (session: Session, kind: ItemKind): ItemDef[] =>
  session.content.itemOrder.map((id) => session.content.items[id]).filter((item): item is ItemDef => item !== undefined && item.kind === kind);

/** The hero as it would be with `item` in `slot` of the active loadout. */
const heroWith = (session: Session, state: GameState, slot: SlotId, item: ItemId | null): HeroStats => {
  const { content } = session;
  const loadout = activeLoadout(state);
  const worn: ItemDef[] = [];
  for (const cell of SLOT_IDS) {
    const id = cell === slot ? item : (loadout?.slots[cell] ?? null);
    const def = id === null ? undefined : content.items[id];
    if (def !== undefined) worn.push(def);
  }
  return deriveHero(state, content, worn);
};

/** What changes, in plain words: "Life +20, Defense +5". Empty when nothing would. */
const changeLine = (now: HeroStats, then: HeroStats): string => {
  const parts: string[] = [];
  const delta = (label: string, before: number, after: number, percent: boolean): void => {
    if (before === after) return;
    const by = after - before;
    parts.push(`${label} ${by > 0 ? '+' : '−'}${percent ? formatPercent(Math.abs(by)) : formatNumber(Math.abs(by))}`);
  };
  for (const stat of STAT_KEYS) delta(STAT_NAME[stat], now.core[stat].final, then.core[stat].final, false);
  delta('Accuracy', Math.floor(now.accuracy), Math.floor(then.accuracy), false);
  delta('Evasion', Math.floor(now.evasion), Math.floor(then.evasion), false);
  delta('Crit chance', now.critChance * 100, then.critChance * 100, true);
  delta('Energy', now.energy, then.energy, false);
  delta('Last Stand', now.lastStand, then.lastStand, false);
  delta('Growth', now.growth, then.growth, false);
  return parts.join(', ');
};

/** A price, written so it cannot be mistaken for the gold on hand when the two are close (GDD 6.4). */
const priceText = (price: number, gold: number): string => formatPair(price, gold)[0];

const describe = (session: Session, item: ItemDef): string => {
  const lines = itemLines(item, session.text, session.content.balance.claim.damageCutPct);
  return lines.length === 0 ? 'No lines.' : lines.join(' · ');
};

// ---- the slot picker ----

const pickerSheet = (session: Session, slot: SlotId, close: () => void): HTMLElement => {
  const { controller, content, text, shell } = session;
  const state = controller.game;
  const index = state.profile.activeLoadout;
  const loadout = activeLoadout(state);
  const current = loadout?.slots[slot] ?? null;
  const now = deriveHero(state, content);
  let busy = false;

  const act = async (item: ItemId | null, buyFirst: boolean): Promise<void> => {
    if (busy) return;
    busy = true;
    if (buyFirst && item !== null) {
      const bought = await controller.dispatch({ type: 'Buy', item });
      if (bought.kind === 'rejected') {
        shell.toast(REJECTIONS[bought.reason]);
        close();
        return;
      }
    }
    const worn = await controller.dispatch({ type: 'Equip', loadout: index, slot, item });
    if (worn.kind === 'rejected') shell.toast(REJECTIONS[worn.reason]);
    close();
  };

  const rows = itemsOfKind(session, kindOfSlot(slot)).flatMap((item) => {
    const copies = owned(state, item.id);
    const price = shopPrice(item, content.balance);
    // Copies already worn elsewhere in this loadout are spoken for.
    let elsewhere = 0;
    for (const cell of SLOT_IDS) if (cell !== slot && loadout?.slots[cell] === item.id) elsewhere += 1;
    const free = copies - elsewhere;
    const canBuy = price !== null && copies < item.copyCap;
    if (copies === 0 && price === null) return [];
    const change = changeLine(now, heroWith(session, state, slot, item.id));
    const wearing = current === item.id;
    return [
      el(
        'div',
        { class: 'item' },
        el('p', { class: 'item-name', text: `${text.item(item.id)}${wearing ? ' · worn here' : ''}` }),
        el('p', { class: 'muted', text: `${describe(session, item)} · owned ${copies} of ${item.copyCap}` }),
        wearing ? null : el('p', { class: change === '' ? 'muted' : 'ok', text: change === '' ? 'No change to your stats.' : change }),
        wearing
          ? null
          : free > 0
            ? button('Wear', () => void act(item.id, false), { class: 'primary' })
            : canBuy && price !== null
              ? button(`Buy for ${priceText(price, state.run.gold)} gold and wear`, () => void act(item.id, true), { disabled: state.run.gold < price })
              : el('p', { class: 'muted', text: 'Every copy you own is worn in another slot.' }),
      ),
    ];
  });

  return el(
    'div',
    { class: 'sheet', attrs: { role: 'dialog', 'aria-label': SLOT_NAME[slot] } },
    el('h2', { text: SLOT_NAME[slot] }),
    line('Gold on hand', formatNumber(state.run.gold)),
    ...(rows.length === 0 ? [el('p', { class: 'muted', text: 'You own nothing for this slot, and nothing for it is sold.' })] : rows),
    current === null ? null : button('Take it off', () => void act(null, false)),
    button('Back', close),
  );
};

const renameSheet = (session: Session, index: number, close: () => void): HTMLElement => {
  const { controller, content, shell } = session;
  const max = content.balance.loadouts.nameMax;
  const box = el('input', { class: 'code', attrs: { type: 'text', maxlength: String(max), 'aria-label': 'Loadout name', autocomplete: 'off' } });
  box.value = controller.game.profile.loadouts[index]?.name ?? '';
  return el(
    'div',
    { class: 'sheet', attrs: { role: 'dialog', 'aria-label': 'Rename the loadout' } },
    el('h2', { text: `Name loadout ${index + 1}` }),
    el('p', { class: 'muted', text: `Up to ${max} characters. Leave it empty to show its number.` }),
    box,
    button(
      'Save the name',
      () => {
        void controller.dispatch({ type: 'RenameLoadout', index, name: box.value.trim().slice(0, max) }).then((outcome) => {
          if (outcome.kind === 'rejected') shell.toast(REJECTIONS[outcome.reason]);
          close();
        });
      },
      { class: 'primary' },
    ),
    button('Cancel', close),
  );
};

// ---- Gear ----

export const gearScreen = (session: Session): HTMLElement => {
  const { controller, content, text, shell } = session;
  const state = controller.game;
  const active = state.profile.activeLoadout;
  const loadout = activeLoadout(state);
  const nextPrice = loadoutPrice(state, content.balance);
  session.view.unseenItems = [];
  // A second tap while the first purchase is being saved must not buy twice.
  let buying = false;

  const slotRow = (slot: SlotId): HTMLElement => {
    const id = loadout?.slots[slot] ?? null;
    const item = id === null ? undefined : content.items[id];
    return el(
      'button',
      { class: 'btn slot', attrs: { type: 'button' } },
      el('span', { class: 'label', text: SLOT_NAME[slot] }),
      el('span', { class: 'slot-item', text: item === undefined ? 'Empty' : text.item(item.id) }),
      item === undefined ? null : el('span', { class: 'muted', text: describe(session, item) }),
    );
  };
  const rows = SLOT_IDS.map((slot) => {
    const row = slotRow(slot);
    row.addEventListener('click', () => shell.openSheet((close) => pickerSheet(session, slot, close)));
    return row;
  });

  return el(
    'div',
    { class: 'screen' },
    el('h1', { text: 'Gear' }),
    hintLine(session, 'gear'),
    el(
      'div',
      { class: 'row' },
      ...state.profile.loadouts.map((entry, index) =>
        button(entry.name === '' ? `Loadout ${index + 1}` : entry.name, () => void controller.dispatch({ type: 'SwitchLoadout', index }), {
          class: index === active ? 'grow current' : 'grow',
        }),
      ),
    ),
    el(
      'div',
      { class: 'row' },
      button('Rename this loadout', () => shell.openSheet((close) => renameSheet(session, active, close)), { class: 'grow' }),
      nextPrice === null
        ? null
        : button(
            `Buy a loadout: ${formatNumber(nextPrice)} gold`,
            () => {
              if (buying) return;
              buying = true;
              void controller.dispatch({ type: 'BuyLoadoutSlot' }).then((outcome) => {
                buying = false;
                if (outcome.kind === 'rejected') shell.toast(REJECTIONS[outcome.reason]);
              });
            },
            { class: 'grow', disabled: state.run.gold < nextPrice },
          ),
    ),
    section('Weapon', ...rows.slice(0, 1)),
    section('Armor', ...rows.slice(1, 1 + ARMOR_SLOTS.length)),
    section('Accessories', ...rows.slice(1 + ARMOR_SLOTS.length)),
  );
};

// ---- Items ----

const FILTERS: ReadonlyArray<{ value: ItemFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'weapon', label: 'Weapons' },
  { value: 'armor', label: 'Armor' },
  { value: 'accessory', label: 'Accessories' },
  { value: 'owned', label: 'Owned' },
  { value: 'sale', label: 'For sale' },
];

const KIND_ORDER: readonly ItemKind[] = ['weapon', ...ARMOR_SLOTS, 'accessory', 'key'];

export const itemsScreen = (session: Session): HTMLElement => {
  const { controller, content, text, shell, view } = session;
  const state = controller.game;
  const filter = view.items.filter;
  view.unseenItems = [];
  // A second tap while the first purchase is being saved must not buy a second copy.
  let buying = false;

  const all = KIND_ORDER.flatMap((kind) => itemsOfKind(session, kind));
  const ownedCount = all.filter((item) => owned(state, item.id) > 0).length;
  const armor = (kind: ItemKind): boolean => (ARMOR_SLOTS as readonly string[]).includes(kind);
  const passes = (item: ItemDef): boolean => {
    switch (filter) {
      case 'all':
        return true;
      case 'weapon':
        return item.kind === 'weapon';
      case 'armor':
        return armor(item.kind);
      case 'accessory':
        return item.kind === 'accessory';
      case 'key':
        return item.kind === 'key';
      case 'owned':
        return owned(state, item.id) > 0;
      case 'sale':
        return item.priceFactor !== null;
    }
  };

  const rows = all.filter(passes).map((item) => {
    const copies = owned(state, item.id);
    const price = shopPrice(item, content.balance);
    // An item not yet found is a blank row: its name and lines are not shown until it is owned or sold (GDD 8.2).
    if (copies === 0 && price === null) {
      return el('div', { class: 'item' }, el('p', { class: 'muted', text: `${KIND_NAME[item.kind]} · not found yet` }));
    }
    return el(
      'div',
      { class: 'item' },
      el('p', { class: 'item-name', text: `${text.item(item.id)} · ${KIND_NAME[item.kind]}` }),
      el('p', { class: 'muted', text: `${describe(session, item)} · owned ${copies} of ${item.copyCap}` }),
      price === null
        ? null
        : copies >= item.copyCap
          ? el('p', { class: 'muted', text: 'You own as many as you can.' })
          : button(
              `Buy for ${priceText(price, state.run.gold)} gold`,
              () => {
                if (buying) return;
                buying = true;
                void controller.dispatch({ type: 'Buy', item: item.id }).then((outcome) => {
                  buying = false;
                  if (outcome.kind === 'rejected') shell.toast(REJECTIONS[outcome.reason]);
                  else if (outcome.kind === 'done') shell.toast('Bought. Put it on from Gear.');
                });
              },
              { disabled: state.run.gold < price },
            ),
    );
  });

  return el(
    'div',
    { class: 'screen' },
    el('h1', { text: `Items · ${ownedCount} of ${all.length}` }),
    hintLine(session, 'items'),
    line('Gold on hand', formatNumber(state.run.gold)),
    el(
      'div',
      { class: 'row' },
      ...FILTERS.map((option) =>
        button(option.label, () => {
          view.items.filter = option.value;
          shell.rerender();
        }, { class: filter === option.value ? 'small current' : 'small' }),
      ),
    ),
    section('', ...(rows.length === 0 ? [el('p', { class: 'muted', text: 'Nothing here.' })] : rows)),
  );
};
