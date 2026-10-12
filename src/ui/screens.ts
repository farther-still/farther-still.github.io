// Phase 3a's two screens. The main screen is the dummy game: a counter and a fake inventory. Settings is the
// real one from GDD 8.2, less the playback and movement controls that have nothing to control yet.

import type { Action, ItemId, RejectReason } from '../engine';
import { SAVE_VERSION, checkImport, daysSinceExport, exportReminderDue } from '../save';
import golden from '../../tests/golden/golden.json';
import { button, el, formatTime, line, section, shortBuild } from './dom';
import { runSelfTest } from './selftest';
import type { Session } from './session';
import { confirmReplaceSheet, importSheet, newRunSheet, openSaveExport } from './sheets';

const REJECTIONS: Record<RejectReason, string> = {
  'bad-seed': 'That run could not be started.',
  'unknown-item': 'That item does not exist in this version.',
  'not-owned': 'You do not own that item.',
  'item-in-use': 'Unequip it before removing the last copy.',
  'count-limit': 'That number cannot go any higher.',
};

const itemLabel = (item: ItemId): string => `Test item ${Number(item.slice(1))}`;

const noticeList = (session: Session): HTMLElement | null => {
  const items = session.notices.list();
  if (items.length === 0) return null;
  return el(
    'div',
    { class: 'notices' },
    ...items.map((notice) =>
      el(
        'div',
        { class: 'notice' },
        el('p', { text: notice.text }),
        button('Dismiss', () => session.notices.dismiss(notice.id), { class: 'small' }),
      ),
    ),
  );
};

export const mainScreen = (session: Session): HTMLElement => {
  const { controller, content, shell, flash } = session;
  const { profile, run } = controller.game;

  const act = (action: Action): void => {
    void controller.dispatch(action).then((outcome) => {
      if (outcome.kind === 'rejected') {
        flash.text = REJECTIONS[outcome.reason];
        shell.rerender();
      }
    });
  };

  const message = flash.text;
  flash.text = null;

  const reminder = exportReminderDue(controller.app, profile.runsStarted, Date.now())
    ? el(
        'div',
        { class: 'notice' },
        el('p', {
          text: `No export for ${daysSinceExport(controller.app, Date.now())} days and ${profile.runsStarted - controller.app.exportTracking.runsAtLastExport} runs. The only copy of this save is on this phone.`,
        }),
        button('Export now', () => void openSaveExport(session), { class: 'small' }),
      )
    : null;

  const items = content.items.map((item) => {
    const copies = profile.inventory[item] ?? 0;
    const equipped = profile.equipped === item;
    const aimed = run.target === item;
    return el(
      'div',
      { class: 'item' },
      el('p', { class: 'item-name', text: `${itemLabel(item)} × ${copies}${equipped ? ' · equipped' : ''}${aimed ? ' · aimed at' : ''}` }),
      el(
        'div',
        { class: 'row' },
        button('−', () => act({ type: 'RemoveItem', item }), { class: 'square' }),
        button('+', () => act({ type: 'AddItem', item }), { class: 'square' }),
        button(equipped ? 'Unequip' : 'Equip', () => act({ type: 'Equip', item: equipped ? null : item })),
        button(aimed ? 'Unaim' : 'Aim', () => act({ type: 'SetTarget', item: aimed ? null : item })),
      ),
    );
  });

  return el(
    'div',
    { class: 'screen' },
    el('h1', { text: 'Farther Still' }),
    el('p', { class: 'muted', text: 'Walking skeleton: no game yet. This screen exists to prove saving, installing and updating.' }),
    noticeList(session),
    reminder,
    section(
      `Run ${profile.runsStarted}`,
      line('Counter', String(run.counter)),
      line('Last roll', String(run.lastRoll)),
      line('Steps', controller.dirty ? `${run.steps} (not saved yet)` : String(run.steps)),
      message === null ? null : el('p', { class: 'flash', text: message }),
      el(
        'div',
        { class: 'row' },
        button('Count + 1', () => act({ type: 'Count' }), { class: 'primary grow' }),
        button('Step + 1', () => act({ type: 'Step' }), { class: 'grow' }),
      ),
      el('p', { class: 'muted', text: 'Count saves before it shows. Step saves with the next save, or when the app is hidden.' }),
    ),
    section('Fake inventory', ...items),
  );
};

const PERSIST_TEXT = {
  asking: 'Asking…',
  granted: 'Granted: the browser will not clear this save on its own',
  denied: 'Not granted: export regularly',
  unsupported: 'Not available in this browser',
  error: 'The request failed',
} as const;

const UPDATE_TEXT = {
  unsupported: 'Updates are not available here (no service worker in this context)',
  idle: 'No update is waiting',
  ready: 'Update ready. Apply it from the New run sheet',
} as const;

export const settingsScreen = (session: Session): HTMLElement => {
  const { controller, content, backend, build, updates, diagnostics, persist, shell, settingsView, standalone } = session;
  const saved = controller.lastSaved;
  const toggle = controller.app.settings.testToggle;

  const quarantine = el('div', {}, el('p', { class: 'muted', text: 'Loading…' }));
  void backend.listQuarantine().then((entries) => {
    quarantine.replaceChildren(
      ...(entries.length === 0
        ? [el('p', { class: 'muted', text: 'None.' })]
        : entries.map((entry) =>
            el(
              'div',
              { class: 'item' },
              el('p', { text: `${entry.slot}, save ${entry.seq ?? 'unreadable'}: ${entry.reason} (${entry.kind})` }),
              button(
                'Restore…',
                () => {
                  const result = checkImport(JSON.stringify(entry.raw), content);
                  if (!result.ok) {
                    session.notices.add(`That set-aside save cannot be restored. ${result.reason}`);
                    return;
                  }
                  shell.openSheet((close) => confirmReplaceSheet(session, result.record, result.problems, close));
                },
                { class: 'small' },
              ),
            ),
          )),
    );
  });

  const log = el('div', {});
  if (settingsView.showLog) {
    void backend.readDiagnostics().then((entries) => {
      const all = [...entries, ...diagnostics.unwritten()];
      log.replaceChildren(
        ...(all.length === 0
          ? [el('p', { class: 'muted', text: 'The log is empty.' })]
          : all
              .slice()
              .reverse()
              .map((entry) =>
                el(
                  'div',
                  { class: 'log-entry' },
                  el('p', { class: 'log-head', text: `${formatTime(entry.at)} · ${entry.kind} · ${shortBuild(entry.buildId)}` }),
                  el('p', { text: entry.message }),
                  entry.stack === '' ? null : el('pre', { text: entry.stack }),
                ),
              )),
      );
    });
  }

  const selfTest = settingsView.selfTest;
  const passed = selfTest?.filter((result) => result.pass).length ?? 0;

  return el(
    'div',
    { class: 'screen' },
    el('h1', { text: 'Settings' }),
    section(
      'This install',
      line('Running as', standalone ? 'Home Screen app' : 'Browser tab'),
      standalone
        ? null
        : el('p', { class: 'flash', text: 'A browser tab and the Home Screen app keep separate saves. Play from the Home Screen icon.' }),
      line('Build', shortBuild(build.buildId)),
      line('Content', build.contentVersion),
      line('Save version', String(SAVE_VERSION)),
      line('Storage persistence', PERSIST_TEXT[persist.status]),
      line('Last write', saved === null ? 'None yet' : `save ${saved.seq} at ${formatTime(saved.writtenAt)}`),
      line('Write durability', backend.lastDurability),
    ),
    section(
      'Update',
      el('p', { text: UPDATE_TEXT[updates.state] }),
      button('Check for an update', () => void updates.check(), { disabled: updates.state === 'unsupported' }),
    ),
    section(
      'Backup',
      line('Days since last export', controller.app.exportTracking.lastExportAt === null ? `Never exported (${daysSinceExport(controller.app, Date.now())} days)` : String(daysSinceExport(controller.app, Date.now()))),
      el(
        'div',
        { class: 'row' },
        button('Export…', () => void openSaveExport(session), { class: 'primary grow' }),
        button('Import…', () => shell.openSheet((close) => importSheet(session, content, close)), { class: 'grow' }),
      ),
      el('p', { class: 'muted', text: 'Deleting the Home Screen icon deletes the save. An export is the only copy off this phone.' }),
    ),
    section(
      'Test setting',
      el('p', { class: 'muted', text: 'Does nothing. It shows that settings are saved, exported and imported with the game.' }),
      button(toggle ? 'On: turn off' : 'Off: turn on', () => {
        void controller.updateApp((app) => ({ ...app, settings: { ...app.settings, testToggle: !toggle } }));
      }),
    ),
    section('Notices', noticeList(session) ?? el('p', { class: 'muted', text: 'None waiting.' })),
    section('Set-aside saves', quarantine),
    section(
      'Engine self-test',
      el('p', { class: 'muted', text: 'Runs the engine’s arithmetic on this device and compares it with the values the build expects.' }),
      button('Run the self-test', () => {
        settingsView.selfTest = runSelfTest(golden, content);
        shell.rerender();
      }),
      selfTest === null
        ? null
        : el(
            'div',
            {},
            el('p', { class: passed === selfTest.length ? 'ok' : 'flash', text: `${passed} of ${selfTest.length} checks match.` }),
            ...selfTest.map((result) => el('p', { class: 'log-head', text: `${result.pass ? 'PASS' : 'FAIL'} · ${result.name}${result.pass ? '' : ` · got ${result.actual.slice(0, 16)}`}` })),
          ),
    ),
    section(
      'Diagnostics log',
      button(settingsView.showLog ? 'Hide the log' : 'Show the log', () => {
        settingsView.showLog = !settingsView.showLog;
        shell.rerender();
      }),
      log,
    ),
  );
};

export const tabBar = (session: Session, current: 'main' | 'settings'): HTMLElement =>
  el(
    'nav',
    { class: 'tabbar' },
    button('Game', () => session.shell.show('main'), { class: current === 'main' ? 'tab current' : 'tab' }),
    button('New run', () => session.shell.openSheet((close) => newRunSheet(session, close)), { class: 'tab' }),
    button(session.updates.state === 'ready' ? 'Settings •' : 'Settings', () => session.shell.show('settings'), {
      class: current === 'settings' ? 'tab current' : 'tab',
    }),
  );
