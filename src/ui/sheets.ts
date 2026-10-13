// Bottom sheets: new run, export, import. A sheet is built once and is not touched by screen re-renders, so
// text typed into it stays put.

import { level, startingEnergy } from '../engine';
import type { Content } from '../engine';
import { canShareFile, copyText, downloadTextFile, shareTextFile } from '../platform';
import { buildExport, checkImport, cleanToken, encodeTextCode, parseRepository, withExportRecorded } from '../save';
import type { SlotRecord } from '../save';
import { button, el, formatTime, line, shortBuild } from './dom';
import { formatNumber } from './format';
import { backupReadWords } from './labels';
import type { Session } from './session';

const sheet = (title: string, ...children: (Node | null)[]): HTMLElement =>
  el('div', { class: 'sheet', attrs: { role: 'dialog', 'aria-label': title } }, el('h2', { text: title }), ...children);

const ownedCopies = (record: SlotRecord): number =>
  Object.values(record.payload.game.profile.items).reduce((total, copies) => total + copies, 0);

export const newRunSheet = (session: Session, close: () => void): HTMLElement => {
  const { controller, content, text, updates, notices, shell } = session;
  const state = controller.game;
  const { profile, run } = state;
  const nextRun = profile.counters.runsStarted + 1;
  const gained = run.tallies.itemsGained;
  const status = el('p', { class: 'muted' });
  let started = false;

  const start = async (thenUpdate: boolean): Promise<void> => {
    // A second tap while the first is being saved must not start a second run.
    if (started) return;
    started = true;
    status.textContent = 'Saving…';
    const outcome = await controller.newRun();
    if (outcome.kind !== 'done') {
      close();
      return;
    }
    if (outcome.checkpoint === 'skipped') {
      notices.add(
        `A checkpoint was skipped because the save failed a consistency check (${outcome.problems.join('; ')}). Export your save from Settings.${session.backup.configured ? ' The cloud backup was not updated either.' : ''}`,
      );
    }
    if (thenUpdate) {
      status.textContent = 'Run saved. Switching to the new version…';
      const applied = await updates.apply('new-run-sheet');
      if (applied !== 'reloading') {
        notices.add('The new version did not take over. It will the next time the app is fully closed and opened.');
      }
    }
    close();
    shell.show('map');
  };

  return sheet(
    `Start run ${nextRun}?`,
    // What the run gained and what will be lost (GDD 2.4, D-16).
    line('Level reached', formatNumber(level(state, content.balance))),
    line('Strongest enemy beaten', run.strongestBeaten === 0 ? 'None' : `level ${formatNumber(run.strongestBeaten)}`),
    line('New items', gained.length === 0 ? 'None' : gained.map((id) => text.item(id)).join(', ')),
    line('Permanent energy gained', run.tallies.claims === 0 ? 'None' : `+${run.tallies.claims * content.balance.energy.perClaim} (starting energy is now ${startingEnergy(state, content.balance)})`),
    line('Gold that will be lost', formatNumber(run.gold)),
    run.gold > 0 || !run.salvageUsed
      ? el('p', { class: 'flash', text: `Still unused: ${run.gold > 0 ? `${formatNumber(run.gold)} gold` : ''}${run.gold > 0 && !run.salvageUsed ? ' and ' : ''}${run.salvageUsed ? '' : 'the Salvage attempt'}.` })
      : null,
    el('p', { class: 'muted', text: 'Level, stat points and gold start over. Gear, gems and permanent energy stay.' }),
    updates.state === 'ready'
      ? el(
          'div',
          { class: 'callout' },
          el('p', { text: 'Update ready. It is applied only from here, between runs.' }),
          button('Update, then start the run', () => void start(true), { class: 'primary' }),
        )
      : null,
    button('Start the run', () => void start(false), { class: updates.state === 'ready' ? '' : 'primary' }),
    button('Cancel', close),
    status,
  );
};

export type ExportContent = {
  fileName: string;
  fileText: string;
  /** Null in a raw export, which holds no single record to turn into a code. */
  code: string | null;
  onExported: () => void;
};

export const exportFileName = (now: number): string =>
  `farther-still-save-${formatTime(now).replace(/[-: ]/g, '').slice(0, 12)}.json`;

export const exportSheet = (content: ExportContent, close: () => void): HTMLElement => {
  const status = el('p', { class: 'muted', text: 'Nothing has been shared or copied yet.' });
  const codeBox = el('textarea', { class: 'code', attrs: { readonly: '', rows: '5', 'aria-label': 'Text code' } });
  codeBox.value = content.code ?? content.fileText;

  const shareable = canShareFile(navigator, content.fileName, content.fileText);
  const share = button(
    shareable ? 'Share the file' : 'Download the file',
    () => {
      if (!shareable) {
        downloadTextFile(document, content.fileName, content.fileText);
        status.textContent = 'File downloaded.';
        content.onExported();
        return;
      }
      // Called straight from the tap, with the text already built: Safari requires it.
      void shareTextFile(navigator, content.fileName, content.fileText).then((outcome) => {
        if (outcome === 'shared') {
          status.textContent = 'File shared.';
          content.onExported();
        } else if (outcome === 'cancelled') {
          status.textContent = 'Sharing was cancelled. Nothing was exported.';
        } else {
          status.textContent = 'Sharing a file did not work here. Use the text below instead.';
        }
      });
    },
    { class: 'primary' },
  );

  const copy = button(content.code === null ? 'Copy the text' : 'Copy the text code', () => {
    void copyText(navigator, codeBox.value).then((copied) => {
      if (copied) {
        status.textContent = 'Copied.';
        content.onExported();
      } else {
        codeBox.focus();
        codeBox.select();
        status.textContent = 'Copying is not available here. The text is selected: copy it by hand.';
      }
    });
  });

  return sheet(
    'Export',
    el('p', {
      text: shareable
        ? 'The file holds the save, the set-aside saves and the diagnostics log.'
        : 'File sharing is not available in this browser, so the file is downloaded instead.',
    }),
    share,
    copy,
    codeBox,
    status,
    button('Done', close),
  );
};

export const openSaveExport = async (session: Session): Promise<void> => {
  const { controller, backend, build, notices, shell } = session;
  await controller.flush();
  const record = controller.lastSaved;
  if (record === null) {
    notices.add('There is no save to export yet.');
    return;
  }
  const now = Date.now();
  const fileText = await buildExport(backend, record, build, now);
  shell.openSheet((close) =>
    exportSheet(
      {
        fileName: exportFileName(now),
        fileText,
        code: encodeTextCode(record),
        onExported: () => {
          const runs = controller.game.profile.counters.runsStarted;
          void controller.updateApp((app) => withExportRecorded(app, runs, Date.now()));
        },
      },
      close,
    ),
  );
};

const describe = (title: string, record: SlotRecord | null): HTMLElement =>
  el(
    'div',
    { class: 'compare' },
    el('h3', { text: title }),
    record === null
      ? el('p', { text: 'Nothing saved.' })
      : el(
          'div',
          {},
          line('Runs started', String(record.payload.game.profile.counters.runsStarted)),
          line('Items owned', String(ownedCopies(record))),
          line('Written', formatTime(record.writtenAt)),
          line('Build', shortBuild(record.buildId)),
        ),
  );

/**
 * The side-by-side comparison and the question, shared by import and by restoring a set-aside save. Nothing is
 * replaced until the player confirms.
 */
export const confirmReplaceSheet = (
  session: Session,
  incoming: SlotRecord,
  problems: readonly string[],
  close: () => void,
  migratedFrom: number | null = null,
): HTMLElement => {
  const { backup, controller, notices } = session;
  const status = el('p', { class: 'muted' });
  let confirmed = false;
  return sheet(
    'Replace the current game?',
    el('div', { class: 'compare-row' }, describe('Current', controller.lastSaved), describe('Incoming', incoming)),
    problems.length === 0
      ? null
      : el('p', { class: 'flash', text: `The incoming save is intact but fails a consistency check: ${problems.join('; ')}. It can be used anyway, and the app will ask about it again at each launch until it passes.` }),
    // A version 1 record is the test build's dummy save. It migrates to an empty game, and the upgrade notice
    // points at the set-aside copy of it, so the sheet says plainly what replacing with it would do.
    migratedFrom === 1
      ? el('p', { class: 'flash', text: 'The incoming save is from the test build. It holds nothing of the real game: replacing with it starts again from run 1, with no items.' })
      : null,
    el('p', { text: 'The current game is first set aside, so it can be restored from Settings.' }),
    button(
      problems.length === 0 ? 'Replace the current game' : 'Replace the current game anyway',
      () => {
        if (confirmed) return;
        confirmed = true;
        status.textContent = 'Saving…';
        void controller.replaceWith(incoming).then(({ outcome, repaired }) => {
          if (outcome.kind === 'done') {
            // The game on the phone is now another one, so the cloud backup is looked at again at once: it is
            // replaced only if this game follows from the one it holds (GDD D-40), and if not, the reminder says
            // so now and not a run later. A save that fails a check is not sent by itself (D-44).
            const saved = controller.lastSaved;
            if (problems.length === 0 && saved !== null) backup.runEnded(saved);
            notices.add(
              repaired
                ? 'Save replaced. Its run pointed at something this version no longer has, which was cleared.'
                : 'Save replaced. The previous game is under Settings, Set-aside saves.',
            );
          }
          close();
        });
      },
      { class: 'danger' },
    ),
    button('Cancel', close),
    status,
  );
};

export const importSheet = (session: Session, content: Content, close: () => void): HTMLElement => {
  const status = el('p', { class: 'muted', text: 'Choose an export file, or paste a text code.' });
  const box = el('textarea', {
    class: 'code',
    attrs: { rows: '5', placeholder: 'Paste a text code here', 'aria-label': 'Text code to import', autocapitalize: 'off', autocomplete: 'off', spellcheck: 'false' },
  });
  const picker = el('input', { class: 'file', attrs: { type: 'file', accept: 'application/json,.json,text/plain', 'aria-label': 'Export file' } });
  picker.addEventListener('change', () => {
    const file = picker.files?.[0];
    if (file === undefined) return;
    void file.text().then(
      (text) => {
        box.value = text;
        status.textContent = `Read ${file.name}. Tap Check.`;
      },
      () => {
        status.textContent = 'That file could not be read.';
      },
    );
  });

  const check = button(
    'Check',
    () => {
      const result = checkImport(box.value, content);
      if (!result.ok) {
        status.textContent = result.reason;
        return;
      }
      close();
      session.shell.openSheet((closeConfirm) => confirmReplaceSheet(session, result.record, result.problems, closeConfirm, result.migratedFrom));
    },
    { class: 'primary' },
  );

  return sheet('Import', picker, box, check, button('Cancel', close), status);
};

// ---- cloud backup (ARCHITECTURE 7.5) ----

const FIELD_ATTRS = { autocapitalize: 'off', autocomplete: 'off', autocorrect: 'off', spellcheck: 'false' };

/**
 * Where the key is entered. It is a sheet because a sheet is not redrawn under the player's typing. The key goes
 * from the box to the `device` store and is cleared from the box; no screen ever shows it again.
 */
export const backupKeySheet = (session: Session, close: () => void): HTMLElement => {
  const { backup, controller, shell } = session;
  const current = backup.status.repository;
  const status = el('p', {
    class: 'muted',
    text: current === null ? 'Nothing is sent anywhere until a key is saved here.' : `A key is set for ${current}. Saving a new one replaces it.`,
  });
  const repository = el('input', { class: 'field', attrs: { type: 'text', placeholder: 'owner/repository', 'aria-label': 'Backup repository', ...FIELD_ATTRS } });
  repository.value = current ?? '';
  const token = el('input', { class: 'field', attrs: { type: 'password', placeholder: 'Key', 'aria-label': 'Backup key', ...FIELD_ATTRS } });
  let busy = false;

  const save = button(
    'Save the key',
    () => {
      if (busy) return;
      const parsed = parseRepository(repository.value);
      if (parsed === null) {
        status.textContent = 'Enter the repository as owner/name.';
        return;
      }
      if (token.value.trim() === '') {
        status.textContent = 'Paste the key.';
        return;
      }
      const entered = cleanToken(token.value);
      if (entered === null) {
        token.value = '';
        status.textContent = 'That is not a key: it holds a character no key has. Copy it again from GitHub and paste it here.';
        return;
      }
      busy = true;
      token.value = '';
      status.textContent = 'Saving the key…';
      void (async () => {
        if (!(await backup.setKey({ ...parsed, token: entered }))) {
          busy = false;
          status.textContent = 'The key could not be stored on this phone.';
          return;
        }
        // The first backup is the test of the key. It replaces nothing it should not: a backup the game on
        // this phone does not follow from is left alone (GDD D-40), and Settings then offers the choice. The
        // sheet does not wait for it: the network can take its time, and Settings shows the attempt and its result.
        close();
        shell.rerender();
        await controller.flush();
        const record = controller.lastSaved;
        if (record !== null) void backup.backUp(record);
      })();
    },
    { class: 'primary' },
  );

  const forget =
    current === null
      ? null
      : button(
          'Forget the key on this phone',
          () => {
            if (busy) return;
            busy = true;
            void backup.forget().then((forgotten) => {
              if (!forgotten) {
                busy = false;
                status.textContent = 'The key could not be removed from this phone. It is still set, and still in use.';
                return;
              }
              close();
              shell.rerender();
            });
          },
          { class: 'danger' },
        );

  return sheet(
    'Cloud backup key',
    el('p', { text: 'The repository as owner/name, and the key GitHub gave you for it. The key stays on this phone: it is in no save, no export and no backup.' }),
    repository,
    token,
    save,
    forget,
    button('Cancel', () => {
      token.value = '';
      close();
    }),
    status,
  );
};

/**
 * Fetches the backup and puts it through the same checks and the same question as an imported file. Its own
 * sheet is up while the answer is on its way, which can be a while; if that sheet has been closed or replaced by
 * the time the answer comes, the answer is dropped.
 */
export const openBackupRestore = (session: Session): void => {
  const { backup, content, shell } = session;
  const status = el('p', { text: 'Fetching the backup…' });
  const mine: { node: HTMLElement | null } = { node: null };
  shell.openSheet((close) => {
    mine.node = sheet('Restore from backup', status, button('Cancel', close));
    return mine.node;
  });
  void backup.look().then((file) => {
    if (mine.node === null || !shell.showing(mine.node)) return;
    if (!file.ok) {
      status.textContent = `The backup could not be fetched. ${backupReadWords(file.failure, file.status)} Nothing on this phone was changed.`;
      return;
    }
    if (file.value === null) {
      status.textContent = 'There is no backup in the repository yet.';
      return;
    }
    if (file.value.text === null) {
      status.textContent = 'The backup cannot be restored: the file in the repository is not one this game wrote. Nothing on this phone was changed.';
      return;
    }
    const checked = checkImport(file.value.text, content);
    if (!checked.ok) {
      status.textContent = `The backup cannot be restored. ${checked.reason} Nothing on this phone was changed.`;
      return;
    }
    shell.openSheet((close) => confirmReplaceSheet(session, checked.record, checked.problems, close, checked.migratedFrom));
  });
};

/** The other answer to a backup that was left alone: overwrite it with the game on this phone. The words differ from the restore sheet's on purpose, so the two cannot be taken for each other. */
export const replaceBackupSheet = (session: Session, close: () => void): HTMLElement => {
  const { backup, controller, shell } = session;
  let confirmed = false;
  return sheet(
    'Overwrite the backup?',
    el('p', { text: 'The backup holds a different game, or one that has something the game on this phone does not. Overwriting puts the game on this phone in its place.' }),
    el('p', { class: 'flash', text: 'If the app was just reinstalled, the backup is the game to keep: cancel, and use Restore from backup.' }),
    el('p', { class: 'muted', text: 'Every backup is a commit in the repository, so the save being overwritten can still be found in its history on GitHub.' }),
    button(
      'Overwrite the backup with this game',
      () => {
        if (confirmed) return;
        confirmed = true;
        // Not waited for, like every backup: Settings shows the attempt and then its result.
        close();
        shell.rerender();
        void (async () => {
          await controller.flush();
          const record = controller.lastSaved;
          if (record !== null) void backup.backUp(record, { replace: true });
        })();
      },
      { class: 'danger' },
    ),
    button('Cancel', close),
  );
};
