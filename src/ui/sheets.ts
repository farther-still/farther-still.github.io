// Bottom sheets: new run, export, import. A sheet is built once and is not touched by screen re-renders, so
// text typed into it stays put.

import type { Content } from '../engine';
import { canShareFile, copyText, downloadTextFile, shareTextFile } from '../platform';
import { buildExport, checkImport, encodeTextCode, withExportRecorded } from '../save';
import type { SlotRecord } from '../save';
import { button, el, formatTime, line, shortBuild } from './dom';
import type { Session } from './session';

const sheet = (title: string, ...children: (Node | null)[]): HTMLElement =>
  el('div', { class: 'sheet', attrs: { role: 'dialog', 'aria-label': title } }, el('h2', { text: title }), ...children);

const ownedCopies = (record: SlotRecord): number =>
  Object.values(record.payload.game.profile.inventory).reduce((total, copies) => total + copies, 0);

export const newRunSheet = (session: Session, close: () => void): HTMLElement => {
  const { controller, updates, notices } = session;
  const nextRun = controller.game.profile.runsStarted + 1;
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
        `A checkpoint was skipped because the save failed a consistency check (${outcome.problems.join('; ')}). Export your save from Settings.`,
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
  };

  return sheet(
    `Start run ${nextRun}?`,
    el('p', { text: 'The counter, the steps and the aim reset. Items and the equipped item stay.' }),
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
          const runs = controller.game.profile.runsStarted;
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
          line('Runs started', String(record.payload.game.profile.runsStarted)),
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
): HTMLElement => {
  const { controller, notices } = session;
  const status = el('p', { class: 'muted' });
  let confirmed = false;
  return sheet(
    'Replace the current game?',
    el('div', { class: 'compare-row' }, describe('Current', controller.lastSaved), describe('Incoming', incoming)),
    problems.length === 0
      ? null
      : el('p', { class: 'flash', text: `The incoming save is intact but fails a consistency check: ${problems.join('; ')}. It can be used anyway, and the app will ask about it again at each launch until it passes.` }),
    el('p', { text: 'The current game is first set aside, so it can be restored from Settings.' }),
    button(
      problems.length === 0 ? 'Replace the current game' : 'Replace the current game anyway',
      () => {
        if (confirmed) return;
        confirmed = true;
        status.textContent = 'Saving…';
        void controller.replaceWith(incoming).then(({ outcome, repaired }) => {
          if (outcome.kind === 'done') {
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
      session.shell.openSheet((closeConfirm) => confirmReplaceSheet(session, result.record, result.problems, closeConfirm));
    },
    { class: 'primary' },
  );

  return sheet('Import', picker, box, check, button('Cancel', close), status);
};
