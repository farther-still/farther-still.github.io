// The two screens that stand in front of the game when a save cannot be used as it is (GDD 8.2): Recovery at
// startup, and the blocking notice when a write fails. Neither writes anything until the player chooses.

import { copyText } from '../platform';
import type { Classified, QuarantineEntry } from '../save';
import type { SlotRecord } from '../save';
import type { Halt } from './controller';
import { button, el, formatTime, section, shortBuild } from './dom';

export type RecoveryReason = 'unreadable' | 'failed-start' | 'suspect' | 'newer' | 'none-usable';

export type RecoveryActions = {
  exportRaw: () => void;
  retry: () => void;
  /** A suspect record, used anyway, or an older good one. */
  use: (record: SlotRecord) => void;
  restore: (entry: QuarantineEntry) => void;
  startNew: () => void;
  checkUpdate: () => void;
  applyUpdate: () => void;
};

const EXPLANATION: Record<RecoveryReason, string> = {
  unreadable: 'The save storage could not be opened or read. Nothing has been changed. Until it can be read, the only choices are to copy it out or to try again.',
  'failed-start': 'The game hit an error while starting. No save has been deleted. If a save needed attention on the way, it may already have been rewritten, with its earlier copy kept among the set-aside saves. The only choices here are to copy storage out or to start again.',
  suspect: 'The newest save is intact but fails a consistency check, so it has not been loaded.',
  newer: 'The newest save was written by a newer version of the game than this one.',
  'none-usable': 'No save on this device could be read.',
};

const describe = (record: Classified): string => {
  const seq = record.seq === null ? 'unreadable' : String(record.seq);
  switch (record.kind) {
    case 'good':
      return `${record.slot}, save ${seq}: good. Run ${record.record.payload.game.profile.runsStarted}, written ${formatTime(record.record.writtenAt)}, build ${shortBuild(record.record.buildId)}.`;
    case 'suspect':
      return `${record.slot}, save ${seq}: fails a check (${record.problems.join('; ')}). Run ${record.record.payload.game.profile.runsStarted}, written ${formatTime(record.record.writtenAt)}.`;
    case 'damaged':
      return `${record.slot}, save ${seq}: damaged (${record.reason}).`;
    case 'newer':
      return `${record.slot}, save ${seq}: from a newer version (save version ${record.saveVersion}).`;
  }
};

export type RecoveryView = {
  reason: RecoveryReason;
  detail: string;
  records: readonly Classified[];
  quarantine: readonly QuarantineEntry[];
  updateReady: boolean;
  status: string;
  /** True once "Start a new game" has been tapped once. It lives here so a redraw does not forget it. */
  confirmNew: boolean;
};

export type RecoveryChoice =
  | { kind: 'export' }
  | { kind: 'retry' }
  | { kind: 'use'; record: SlotRecord; label: string }
  | { kind: 'restore'; entry: QuarantineEntry; label: string }
  | { kind: 'start-new' };

/**
 * The choices the screen offers, in order. After an unreadable start, or a start that failed part-way, nothing
 * is known about the slots, so the only choices are the two that write nothing: copy storage out, or try again.
 */
export const recoveryChoices = (view: Pick<RecoveryView, 'reason' | 'records' | 'quarantine'>): RecoveryChoice[] => {
  const choices: RecoveryChoice[] = [{ kind: 'export' }, { kind: 'retry' }];
  if (view.reason === 'unreadable' || view.reason === 'failed-start') return choices;
  // Newest first, so the save most likely to be wanted is the first one offered.
  const newestFirst = [...view.records].sort((a, b) => (b.seq ?? 0) - (a.seq ?? 0));
  for (const record of newestFirst) {
    if (record.kind === 'suspect') {
      choices.push({ kind: 'use', record: record.record, label: `Use ${record.slot} anyway (run ${record.record.payload.game.profile.runsStarted})` });
    } else if (record.kind === 'good') {
      choices.push({
        kind: 'use',
        record: record.record,
        label: `Use ${record.slot} (run ${record.record.payload.game.profile.runsStarted}, ${formatTime(record.record.writtenAt)})`,
      });
    }
  }
  for (const entry of view.quarantine) {
    choices.push({ kind: 'restore', entry, label: `Restore set-aside ${entry.slot}, save ${entry.seq ?? 'unreadable'} (${entry.reason})` });
  }
  choices.push({ kind: 'start-new' });
  return choices;
};

export const recoveryScreen = (view: RecoveryView, actions: RecoveryActions): HTMLElement => {
  const { reason, records } = view;
  // The first tap asks, the second starts. `actions.startNew` is told of both and keeps count in the view.
  const startNew = button(
    view.confirmNew ? 'Tap again to start a new game. Everything found is set aside first.' : 'Start a new game…',
    actions.startNew,
    { class: 'danger' },
  );

  const choiceButton = (choice: RecoveryChoice): HTMLElement => {
    switch (choice.kind) {
      case 'export':
        return button('Export everything as it is', actions.exportRaw, { class: 'primary' });
      case 'retry':
        return button('Try again', actions.retry);
      case 'use':
        return button(choice.label, () => actions.use(choice.record));
      case 'restore':
        return button(choice.label, () => actions.restore(choice.entry));
      case 'start-new':
        return startNew;
    }
  };

  return el(
    'div',
    { class: 'screen' },
    el('h1', { text: 'Save recovery' }),
    el('p', { class: 'flash', text: EXPLANATION[reason] }),
    view.detail === '' ? null : el('p', { class: 'muted', text: view.detail }),
    view.status === '' ? null : el('p', { class: 'ok', text: view.status }),
    section(
      'What was found',
      ...(records.length === 0
        ? [el('p', { class: 'muted', text: 'Nothing could be listed.' })]
        : [...records].sort((a, b) => (b.seq ?? 0) - (a.seq ?? 0)).map((record) => el('p', { text: describe(record) }))),
    ),
    reason === 'newer'
      ? section(
          'Update',
          el('p', { text: view.updateReady ? 'A new version is ready.' : 'No new version has been downloaded yet.' }),
          view.updateReady
            ? button('Switch to the new version', actions.applyUpdate, { class: 'primary' })
            : button('Check for an update', actions.checkUpdate),
          el('p', { class: 'muted', text: 'Closing the app fully and opening it again also switches to a downloaded version.' }),
        )
      : null,
    section(
      'Choices',
      el('p', { class: 'muted', text: 'Nothing is written until you choose. Any choice that replaces a save sets it aside first.' }),
      ...recoveryChoices(view).map(choiceButton),
    ),
  );
};

const HALT_TEXT: Record<Halt['kind'], string> = {
  'engine-bug': 'The game reached a state that failed its own checks, so it was not saved. The last good save is below as a text code.',
  'save-failed': 'The game could not be saved, even after a second try. The game as it stands is below as a text code.',
};

export const haltScreen = (halt: Halt, reload: () => void): HTMLElement => {
  const status = el('p', { class: 'muted' });
  const box = el('textarea', { class: 'code', attrs: { readonly: '', rows: '6', 'aria-label': 'Text code' } });
  box.value = halt.code ?? '';
  return el(
    'div',
    { class: 'screen' },
    el('h1', { text: halt.kind === 'save-failed' ? 'Save failed' : 'The game has stopped' }),
    el('p', { class: 'flash', text: HALT_TEXT[halt.kind] }),
    el('p', { class: 'muted', text: halt.detail }),
    halt.code === null ? el('p', { text: 'There is no earlier save to offer.' }) : box,
    halt.code === null
      ? null
      : button(
          'Copy the text code',
          () => {
            void copyText(navigator, box.value).then((copied) => {
              if (!copied) {
                box.focus();
                box.select();
              }
              status.textContent = copied ? 'Copied. Keep it somewhere safe before reloading.' : 'The text is selected: copy it by hand.';
            });
          },
          { class: 'primary' },
        ),
    button('Reload the app', reload),
    status,
  );
};
