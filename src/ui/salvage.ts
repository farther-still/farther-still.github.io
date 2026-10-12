// The Salvage sheet (GDD 7.4, 8.2): spend all gold on hand for one chance at a drop you have missed. The chance,
// the pool and its split by level band are shown before anything is paid (DV-2).

import { salvageBands, salvageChance, salvagePool } from '../engine';
import { hintLine } from './fight';
import { button, el, line } from './dom';
import { formatChance, formatNumber } from './format';
import { REJECTIONS } from './labels';
import type { Session } from './session';

export const openSalvage = (session: Session): void => {
  session.shell.openSheet((close) => salvageSheet(session, close));
};

const salvageSheet = (session: Session, close: () => void): HTMLElement => {
  const { controller, content, text, shell } = session;
  const state = controller.game;
  const { balance } = content;
  const pool = salvagePool(state, content);
  const bands = salvageBands(state, content);
  const plain = salvageChance(state, balance, false);
  const boosted = salvageChance(state, balance, true);
  const used = state.run.salvageUsed;
  const site = text.line('site.salvage');
  const title = site === '' ? 'Salvage' : `Salvage · ${site}`;
  const result = el('p', { class: 'ok' });
  let spent = false;

  const attempt = async (boost: boolean): Promise<void> => {
    if (spent) return;
    spent = true;
    const outcome = await controller.dispatch({ type: 'Salvage', boost });
    if (outcome.kind === 'rejected') {
      shell.toast(REJECTIONS[outcome.reason]);
      close();
      return;
    }
    if (outcome.kind !== 'done') return;
    const event = outcome.events.find((entry) => entry.type === 'Salvaged');
    if (event === undefined || event.type !== 'Salvaged') return;
    if (event.item !== null) session.view.unseenItems.push(event.item);
    // The sheet is rebuilt as a plain result, so there is nothing left to tap twice.
    shell.openSheet((closeResult) =>
      el(
        'div',
        { class: 'sheet', attrs: { role: 'dialog', 'aria-label': title } },
        el('h2', { text: title }),
        el('p', { class: event.item === null ? 'flash' : 'ok', text: event.item === null ? `Nothing turned up. ${formatNumber(event.goldSpent)} gold is gone.` : `Found: ${text.item(event.item)}.` }),
        button('Back to the map', closeResult, { class: 'primary' }),
      ),
    );
  };

  const why = used ? 'Salvage has been used this run.' : pool.length === 0 ? 'There is nothing to find yet: the pool holds drops you have missed from enemies you have beaten.' : state.run.gold <= 0 ? 'You have no gold to put in.' : null;

  return el(
    'div',
    { class: 'sheet', attrs: { role: 'dialog', 'aria-label': title } },
    el('h2', { text: title }),
    hintLine(session, 'salvage'),
    line('Gold on hand', formatNumber(state.run.gold)),
    line('Chance', formatChance(plain)),
    line('Items in the pool', String(pool.length)),
    el('p', { class: 'muted', text: 'The pool by how strong the enemy that drops each one is, against the strongest you have beaten this run:' }),
    line(`Over ${Math.round(balance.salvage.bandHigh * 100)}% of it`, String(bands.high)),
    line(`${Math.round(balance.salvage.bandLow * 100)}% to ${Math.round(balance.salvage.bandHigh * 100)}%`, String(bands.mid)),
    line(`Under ${Math.round(balance.salvage.bandLow * 100)}%`, String(bands.low)),
    why === null ? el('p', { class: 'muted', text: 'It takes all your gold, win or lose, and can be used once per run. Each item in the pool is equally likely.' }) : el('p', { class: 'flash', text: why }),
    button(`Put in ${formatNumber(state.run.gold)} gold`, () => void attempt(false), { class: 'primary', disabled: why !== null }),
    button(
      `Add ${balance.salvage.boostGems} gems: chance ${formatChance(boosted)} (you have ${formatNumber(state.profile.gems)})`,
      () => void attempt(true),
      { disabled: why !== null || state.profile.gems < balance.salvage.boostGems || boosted <= plain },
    ),
    button('Back', close),
    result,
  );
};
