// Startup and the screen switcher. There is no URL routing: the shell holds which screen and sheet are open.

import { newGame, repairRun } from '../engine';
import type { Content } from '../engine';
import { loadBundledContent } from '../content';
import { UpdateController, browserContainer, captureGlobalErrors, createDiagnostics, isStandalone, requestPersistence } from '../platform';
import { LocalBackend, SaveWriter, buildExport, checkImport, loadSave, newAppState, prepareRecoveryExit } from '../save';
import type { BuildInfo, Classified, LoadResult, QuarantineEntry, SavePayload, SlotRecord, WriteCursor } from '../save';
import { GameController } from './controller';
import { el } from './dom';
import { haltScreen, recoveryScreen } from './recovery';
import type { RecoveryReason, RecoveryView } from './recovery';
import { mainScreen, settingsScreen, tabBar } from './screens';
import { Notices } from './session';
import type { Platform, ScreenName, Session, SheetBuilder } from './session';
import { exportFileName, exportSheet } from './sheets';

export type AppOptions = BuildInfo & {
  /** The service worker exists only in the built app. */
  serviceWorker: boolean;
  baseUrl: string;
};

const LAST_BUILD_KEY = 'lastBuildSeen';

const randomSeed = (): number => {
  const box = new Uint32Array(1);
  crypto.getRandomValues(box);
  return box[0] ?? 0;
};

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export const startApp = async (root: HTMLElement, options: AppOptions): Promise<void> => {
  const build: BuildInfo = { buildId: options.buildId, contentVersion: options.contentVersion };
  const diagnostics = createDiagnostics(build.buildId, Date.now);
  captureGlobalErrors(window, diagnostics);

  const screenHost = el('main', { class: 'host' });
  const barHost = el('div', { class: 'bar-host' });
  const sheetHost = el('div', { class: 'sheet-layer' });
  sheetHost.hidden = true;
  root.replaceChildren(screenHost, barHost, sheetHost);

  const openSheet = (builder: SheetBuilder): void => {
    const close = (): void => {
      sheetHost.hidden = true;
      sheetHost.replaceChildren();
    };
    sheetHost.replaceChildren(builder(close));
    sheetHost.hidden = false;
  };

  let content: Content;
  try {
    content = loadBundledContent();
  } catch (error) {
    diagnostics.log('content', message(error));
    screenHost.replaceChildren(
      el('div', { class: 'screen' }, el('h1', { text: 'The game could not start' }), el('p', { class: 'flash', text: `Its content failed a check: ${message(error)}` })),
    );
    return;
  }

  const backend = new LocalBackend();
  diagnostics.attach(() => backend.handle());
  const log = (kind: string, text: string): void => diagnostics.log(kind, text);

  const updates = new UpdateController({
    container: options.serviceWorker ? browserContainer(navigator) : null,
    reload: () => window.location.reload(),
    log,
    timer: (fire, ms) => {
      const id = window.setTimeout(fire, ms);
      return () => window.clearTimeout(id);
    },
  });
  void updates.start(`${options.baseUrl}sw.js`, options.baseUrl);

  const platform: Platform = {
    build,
    content,
    backend,
    updates,
    diagnostics,
    notices: new Notices(backend, log),
    persist: { status: 'asking' },
    standalone: isStandalone(window),
  };

  // ---- the game, once a save has been chosen ----

  const runGame = async (payload: SavePayload, cursor: WriteCursor, lastGood: SlotRecord | null, commitNow: boolean): Promise<void> => {
    const writer = new SaveWriter({ store: backend, build, content, now: Date.now, log }, cursor, lastGood);
    const controller = new GameController({ content, writer, build, randomSeed }, payload);
    let current: ScreenName = 'main';

    const render = (): void => {
      if (controller.halt !== null) {
        barHost.replaceChildren();
        sheetHost.hidden = true;
        sheetHost.replaceChildren();
        screenHost.replaceChildren(haltScreen(controller.halt, () => window.location.reload()));
        return;
      }
      screenHost.replaceChildren(current === 'main' ? mainScreen(session) : settingsScreen(session));
      barHost.replaceChildren(tabBar(session, current));
    };

    const session: Session = {
      ...platform,
      controller,
      shell: {
        show: (screen) => {
          current = screen;
          screenHost.scrollTop = 0;
          render();
        },
        openSheet,
        rerender: render,
      },
      settingsView: { showLog: false, selfTest: null },
      flash: { text: null },
    };

    controller.subscribe(render);
    platform.notices.subscribe(render);
    updates.subscribe(render);

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        void controller.flush();
      } else {
        void updates.check();
      }
    });
    window.addEventListener('pagehide', () => void controller.flush());

    if (commitNow) await controller.updateApp((app) => app);
    render();

    void requestPersistence(navigator).then((status) => {
      platform.persist.status = status;
      render();
    });
  };

  // ---- startup: load, then either play or recover ----

  const noteBuild = async (): Promise<void> => {
    try {
      const last = await backend.getDevice(LAST_BUILD_KEY);
      if (last === build.buildId) return;
      if (typeof last === 'string') platform.notices.add('The game was updated to a new version.');
      await backend.setDevice(LAST_BUILD_KEY, build.buildId);
    } catch (error) {
      log('device', `could not record the build: ${message(error)}`);
    }
  };

  const play = async (record: SlotRecord, cursor: WriteCursor, lastGood: SlotRecord | null, forceCommit: boolean): Promise<void> => {
    let game = record.payload.game;
    const contentChanged = record.contentVersion !== build.contentVersion;
    if (contentChanged) {
      const repaired = repairRun(game, content);
      const midRun = game.run.counter > 0 || game.run.steps > 0 || game.run.target !== null;
      if (midRun) {
        platform.notices.add(
          repaired === game
            ? 'The game was updated in the middle of a run. Nothing in the run needed changing.'
            : 'The game was updated in the middle of a run. The run pointed at something that no longer exists, which was cleared.',
        );
      }
      game = repaired;
    }
    // A changed content version is written at once, so the record says which content its run now fits.
    await runGame({ game, app: record.payload.app }, cursor, lastGood, forceCommit || contentChanged);
  };

  const recover = (reason: RecoveryReason, records: readonly Classified[], detail: string): void => {
    const view: RecoveryView = { reason, detail, records, quarantine: [], updateReady: updates.state === 'ready', status: '', confirmNew: false };
    // `left` is set the moment a choice is taken, so a second tap on any choice does nothing.
    let left = false;

    const draw = (): void => {
      if (left) return;
      view.updateReady = updates.state === 'ready';
      barHost.replaceChildren();
      screenHost.replaceChildren(recoveryScreen(view, actions));
    };

    // The one write a recovery choice makes before the game takes over. The slots are read again here, as they
    // are now, and what is about to be replaced is set aside. If that cannot be done, nothing is changed.
    const leave = async (start: (cursor: WriteCursor) => Promise<void>): Promise<void> => {
      if (left || reason === 'unreadable' || reason === 'failed-start') return;
      left = true;
      const exit = await prepareRecoveryExit(backend, content);
      if (!exit.ok) {
        left = false;
        view.status = `Could not read the existing saves and set them aside, so nothing was changed: ${exit.detail}`;
        draw();
        return;
      }
      await start(exit.cursor);
    };

    const actions = {
      exportRaw: (): void => {
        const now = Date.now();
        void buildExport(backend, null, build, now, { raw: true }).then(
          (fileText) => openSheet((close) => exportSheet({ fileName: exportFileName(now), fileText, code: null, onExported: () => undefined }, close)),
          (error: unknown) => {
            view.status = `The export could not be built: ${message(error)}`;
            draw();
          },
        );
      },
      retry: (): void => {
        if (left) return;
        left = true;
        // After a start that failed part-way, a game may be half set up in this page. Start the page again.
        if (reason === 'failed-start') window.location.reload();
        else void boot();
      },
      use: (record: SlotRecord): void => {
        void leave((cursor) => play(record, cursor, null, true));
      },
      restore: (entry: QuarantineEntry): void => {
        const checked = checkImport(JSON.stringify(entry.raw), content);
        if (!checked.ok) {
          view.status = `That set-aside save cannot be restored. ${checked.reason}`;
          draw();
          return;
        }
        // A suspect one may be restored from here: this screen is where "use anyway" is asked.
        void leave((cursor) => play(checked.record, cursor, null, true));
      },
      startNew: (): void => {
        if (!view.confirmNew) {
          view.confirmNew = true;
          draw();
          return;
        }
        void leave((cursor) => runGame({ game: newGame(randomSeed()), app: newAppState(Date.now()) }, cursor, null, true));
      },
      checkUpdate: (): void => {
        view.status = 'Checking…';
        draw();
        void updates.check().then(() => {
          view.status = updates.state === 'ready' ? '' : 'No new version was found. Check that the phone is online.';
          draw();
        });
      },
      applyUpdate: (): void => {
        void updates.apply('recovery-screen').then((outcome) => {
          if (outcome !== 'reloading') {
            view.status = 'The new version did not take over. Close the app fully and open it again.';
            draw();
          }
        });
      },
    };

    updates.subscribe(draw);
    draw();
    backend.listQuarantine().then(
      (entries) => {
        view.quarantine = entries;
        draw();
      },
      () => undefined,
    );
  };

  const boot = async (): Promise<void> => {
    screenHost.replaceChildren(el('div', { class: 'screen' }, el('p', { class: 'muted', text: 'Loading…' })));
    const result: LoadResult = await loadSave(backend, content);
    if (result.kind === 'recovery') {
      recover(result.reason, result.records, result.detail);
      return;
    }
    await platform.notices.restore();
    await noteBuild();
    if (result.kind === 'new-install') {
      await runGame({ game: newGame(randomSeed()), app: newAppState(Date.now()) }, result.cursor, null, true);
      return;
    }
    for (const notice of result.notices) platform.notices.add(notice.text);
    await play(result.record, result.cursor, result.record, result.rewriteHot);
  };

  try {
    await boot();
  } catch (error) {
    diagnostics.log('startup', message(error), error instanceof Error ? (error.stack ?? '') : '');
    recover('failed-start', [], message(error));
  }
};
