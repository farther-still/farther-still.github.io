// Settings (GDD 8.2): playback, the two movement controls, the install's facts, backup, set-aside saves, the
// run-duration log, the engine self-test and the diagnostics log.

import { bandBelow } from '../platform';
import type { ScreenReading } from '../platform';
import { SAVE_VERSION, checkImport, daysSinceExport } from '../save';
import type { AppState } from '../save';
import golden from '../../tests/golden/golden.json';
import { button, el, formatTime, line, section, shortBuild } from './dom';
import { formatDuration, formatNumber } from './format';
import { noticeList } from './screens';
import { backupWords } from './labels';
import { runSelfTest } from './selftest';
import type { Session } from './session';
import { backupKeySheet, confirmReplaceSheet, importSheet, openBackupRestore, openSaveExport, replaceBackupSheet } from './sheets';

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

/** The numbers behind the short-page check (ARCHITECTURE A-32). The phone has no Web Inspector to read them with. */
const screenText = (reading: ScreenReading): string =>
  `${reading.screenHeight} high, page ${reading.pageHeight}, insets ${reading.insetTop} and ${reading.insetBottom}${bandBelow(reading) ? ': the page stops short of the screen' : ''}`;

export const settingsScreen = (session: Session): HTMLElement => {
  const { controller, content, backend, backup, build, updates, diagnostics, persist, shell, view, standalone, screen } = session;
  const saved = controller.lastSaved;
  const { settings, runLog } = controller.app;
  const settingsView = view.settings;

  const set = (change: Partial<AppState['settings']>): void => {
    void controller.updateApp((app) => ({ ...app, settings: { ...app.settings, ...change } }));
  };
  const toggle = (label: string, on: boolean, change: Partial<AppState['settings']>, disabled = false): HTMLElement =>
    button(`${label}: ${on ? 'on' : 'off'}`, () => set(change), { disabled });

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
                  shell.openSheet((close) => confirmReplaceSheet(session, result.record, result.problems, close, result.migratedFrom));
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

  const cloud = backup.status;
  const backUpNow = async (): Promise<void> => {
    await controller.flush();
    const record = controller.lastSaved;
    if (record === null) {
      shell.toast('There is no save to back up yet.');
      return;
    }
    shell.toast((await backup.backUp(record)) === 'ok' ? 'Backed up.' : 'The backup did not go through.');
  };

  const selfTest = settingsView.selfTest;
  const passed = selfTest?.filter((result) => result.pass).length ?? 0;
  const lastRuns = runLog.slice(-8).reverse();

  return el(
    'div',
    { class: 'screen' },
    el('h1', { text: 'Settings' }),
    button('Back to the Run menu', () => shell.show('run')),
    section(
      'Battles',
      el(
        'div',
        { class: 'row' },
        ...([1, 2, 4] as const).map((speed) => button(`${speed}×`, () => set({ playbackSpeed: speed }), { class: settings.playbackSpeed === speed ? 'grow current' : 'grow' })),
      ),
      toggle('Skip every battle to its result', settings.skipPlayback, { skipPlayback: !settings.skipPlayback }),
    ),
    section(
      'Moving',
      // At least one control stays on: with both off the hero could not move.
      toggle('Tap a tile to walk there', settings.tapToMove, { tapToMove: !settings.tapToMove }, settings.tapToMove && !settings.dragToSteer),
      toggle('Press and drag to steer', settings.dragToSteer, { dragToSteer: !settings.dragToSteer }, settings.dragToSteer && !settings.tapToMove),
    ),
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
      line('Screen', screenText(screen.reading)),
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
      'Cloud backup',
      ...(cloud.repository === null
        ? [
            el('p', { class: 'muted', text: 'Off. With a key for a private GitHub repository of yours, a copy of the save is sent there after every run. The save on this phone stays the real one.' }),
            button('Set up…', () => shell.openSheet((close) => backupKeySheet(session, close)), { class: 'primary' }),
          ]
        : [
            line('Repository', cloud.repository),
            line('Key', 'Set, on this phone only'),
            line('Last backup', cloud.lastOk === null ? 'None yet' : `run ${formatNumber(cloud.lastOk.run)}, save ${cloud.lastOk.seq} at ${formatTime(cloud.lastOk.at)}`),
            line('Last attempt', cloud.busy ? 'Sending…' : cloud.lastAttempt === null ? 'None yet' : `${cloud.lastAttempt.outcome === 'ok' ? 'Worked' : 'Did not go through'} at ${formatTime(cloud.lastAttempt.at)}`),
            cloud.lastAttempt === null || cloud.lastAttempt.outcome === 'ok'
              ? null
              : el('p', { class: 'flash', text: backupWords(cloud.lastAttempt.outcome, cloud.lastAttempt.status) }),
            el(
              'div',
              { class: 'row' },
              button('Back up now', () => void backUpNow(), { class: 'primary grow', disabled: cloud.busy }),
              button('Restore from backup…', () => openBackupRestore(session), { class: 'grow' }),
            ),
            cloud.lastAttempt?.outcome === 'unseen' ? button('Overwrite the backup…', () => shell.openSheet((close) => replaceBackupSheet(session, close))) : null,
            button('Change or forget the key…', () => shell.openSheet((close) => backupKeySheet(session, close))),
          ]),
    ),
    section(
      'Run times',
      el('p', { class: 'muted', text: 'Time actually played in each finished run. Kept only to check pacing; nothing in the game reads it.' }),
      line('This run so far', formatDuration(controller.app.runTiming.activeMs)),
      ...(lastRuns.length === 0
        ? [el('p', { class: 'muted', text: 'No finished runs yet.' })]
        : lastRuns.map((entry) => line(`Run ${formatNumber(entry.run)}`, `${formatDuration(entry.activeMs)} · ${entry.wins} wins · level ${formatNumber(entry.level)}`))),
    ),
    section('Notices', noticeList(session) ?? el('p', { class: 'muted', text: 'None waiting.' })),
    section('Set-aside saves', quarantine),
    section(
      'Engine self-test',
      el('p', { class: 'muted', text: 'Runs the engine’s arithmetic and a set of recorded battles on this device and compares them with the values the build expects.' }),
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
