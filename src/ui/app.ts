// Startup and the screen switcher. There is no URL routing: the shell holds which screen and sheet are open.

import { newGame, repairRun } from '../engine';
import type { Content } from '../engine';
import { loadBundled } from '../content';
import type { GameText } from '../content';
import { UpdateController, bandBelow, browserContainer, captureGlobalErrors, createDiagnostics, isStandalone, readScreen, requestPersistence } from '../platform';
import { CloudBackup, LocalBackend, SaveWriter, buildExport, checkImport, loadSave, newAppState, prepareRecoveryExit } from '../save';
import type { BuildInfo, Classified, LoadResult, QuarantineEntry, SavePayload, SlotRecord, WriteCursor } from '../save';
import { GameController } from './controller';
import { el } from './dom';
import { gearScreen, itemsScreen } from './gear';
import { haltScreen, recoveryScreen } from './recovery';
import type { RecoveryReason, RecoveryView } from './recovery';
import { MapScreen, bestiaryScreen, heroScreen, runScreen, tabBar } from './screens';
import { MapZoom, Notices, newViewState } from './session';
import type { Platform, ScreenName, Session, SheetBuilder } from './session';
import { settingsScreen } from './settings';
import { exportFileName, exportSheet } from './sheets';

export type AppOptions = BuildInfo & {
  /** The service worker exists only in the built app. */
  serviceWorker: boolean;
  baseUrl: string;
};

const LAST_BUILD_KEY = 'lastBuildSeen';
const TOAST_MS = 2600;

const randomSeed = (): number => {
  const box = new Uint32Array(1);
  crypto.getRandomValues(box);
  return box[0] ?? 0;
};

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const storedVersion = (raw: unknown): number | null => {
  const version = typeof raw === 'object' && raw !== null ? (raw as { saveVersion?: unknown }).saveVersion : undefined;
  return typeof version === 'number' ? version : null;
};

export const startApp = async (root: HTMLElement, options: AppOptions): Promise<void> => {
  const build: BuildInfo = { buildId: options.buildId, contentVersion: options.contentVersion };
  const diagnostics = createDiagnostics(build.buildId, Date.now);
  captureGlobalErrors(window, diagnostics);

  const screenHost = el('main', { class: 'host' });
  const barHost = el('div', { class: 'bar-host' });
  const sheetHost = el('div', { class: 'sheet-layer' });
  const toastHost = el('div', { class: 'toast' });
  const insetProbe = el('div', { class: 'inset-probe' });
  sheetHost.hidden = true;
  toastHost.hidden = true;
  root.replaceChildren(screenHost, barHost, sheetHost, toastHost, insetProbe);

  // iOS can hand the installed app a page that stops short of the screen (ARCHITECTURE A-32). The style sheet is
  // told through an attribute, so that the room kept clear for the home bar is not kept twice.
  const screen = { reading: readScreen(window, insetProbe) };
  const measureScreen = (): void => {
    screen.reading = readScreen(window, insetProbe);
    document.documentElement.setAttribute('data-band-below', bandBelow(screen.reading) ? 'yes' : 'no');
  };
  measureScreen();

  let sheetShown: HTMLElement | null = null;
  const closeSheet = (): void => {
    sheetShown = null;
    sheetHost.hidden = true;
    sheetHost.replaceChildren();
  };
  const openSheet = (builder: SheetBuilder): void => {
    sheetShown = builder(closeSheet);
    sheetHost.replaceChildren(sheetShown);
    sheetHost.hidden = false;
  };
  let toastTimer: ReturnType<typeof setTimeout> | null = null;
  const toast = (words: string): void => {
    if (words === '') return;
    toastHost.textContent = words;
    toastHost.hidden = false;
    if (toastTimer !== null) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastHost.hidden = true;
    }, TOAST_MS);
  };

  let content: Content;
  let text: GameText;
  try {
    ({ content, text } = loadBundled());
  } catch (error) {
    diagnostics.log('content', message(error));
    screenHost.replaceChildren(
      el('div', { class: 'screen' }, el('h1', { text: 'The game could not start' }), el('p', { class: 'flash', text: `Its content failed a check: ${message(error)}` })),
    );
    return;
  }

  const backend = new LocalBackend();
  diagnostics.attach(() => backend.handle());
  const log = (kind: string, words: string): void => diagnostics.log(kind, words);

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

  // The backup is given the `device` store and the network, and nothing that can reach a slot.
  const backup = new CloudBackup({
    device: { getDevice: (key) => backend.getDevice(key), setDevice: (key, value) => backend.setDevice(key, value) },
    fetch: (url, init) => fetch(url, init),
    timer: (fire, ms) => {
      const id = window.setTimeout(fire, ms);
      return () => window.clearTimeout(id);
    },
    now: Date.now,
    log,
  });

  const platform: Platform = {
    build,
    content,
    text,
    backend,
    backup,
    updates,
    diagnostics,
    notices: new Notices(backend, log),
    zoom: new MapZoom(backend, log),
    persist: { status: 'asking' },
    standalone: isStandalone(window),
    screen,
  };

  // ---- the game, once a save has been chosen ----

  const runGame = async (payload: SavePayload, cursor: WriteCursor, lastGood: SlotRecord | null, commitNow: boolean): Promise<void> => {
    const writer = new SaveWriter({ store: backend, build, content, now: Date.now, log }, cursor, lastGood);
    const controller = new GameController({ content, writer, build, randomSeed, now: Date.now, onRunEnded: (record) => backup.runEnded(record) }, payload);
    let current: ScreenName = 'map';
    let mapMounted = false;

    const render = (): void => {
      if (controller.halt !== null) {
        barHost.replaceChildren();
        closeSheet();
        map.detach();
        mapMounted = false;
        screenHost.className = 'host';
        screenHost.replaceChildren(haltScreen(controller.halt, () => window.location.reload()));
        return;
      }
      if (current === 'map') {
        // The map keeps its canvas between renders, so a walk in progress is not cut off.
        if (!mapMounted) {
          screenHost.className = 'host fixed';
          screenHost.replaceChildren(map.element);
          mapMounted = true;
        }
        map.update();
      } else {
        if (mapMounted) map.detach();
        mapMounted = false;
        screenHost.className = 'host';
        const screen =
          current === 'hero'
            ? heroScreen(session)
            : current === 'gear'
              ? gearScreen(session)
              : current === 'items'
                ? itemsScreen(session)
                : current === 'bestiary'
                  ? bestiaryScreen(session)
                  : current === 'run'
                    ? runScreen(session)
                    : settingsScreen(session);
        screenHost.replaceChildren(screen);
      }
      barHost.replaceChildren(tabBar(session, current));
    };

    const session: Session = {
      ...platform,
      controller,
      shell: {
        show: (screen) => {
          if (screen !== current) screenHost.scrollTop = 0;
          current = screen;
          render();
        },
        // Once the game has stopped on the save-failed screen, nothing may open over it.
        openSheet: (builder) => {
          if (controller.halt === null) openSheet(builder);
        },
        closeSheet,
        sheetOpen: () => !sheetHost.hidden,
        showing: (sheet) => sheetShown === sheet,
        rerender: render,
        toast,
      },
      view: newViewState(),
    };
    const map = new MapScreen(session);

    // The first write and the first draw come before any listener is registered: if either throws, the start has
    // failed, and nothing of this half-built game may be left subscribed to draw itself over the failed-start
    // screen later.
    if (commitNow) await controller.updateApp((app) => app);
    // The map's zoom is read here, where every way into the game passes, so the first draw is at the remembered level.
    // So is the cloud backup's key: a game reached through the recovery screen is backed up like any other.
    await platform.zoom.restore();
    await backup.restore();
    render();

    controller.subscribe(render);
    platform.notices.subscribe(render);
    updates.subscribe(render);
    backup.subscribe(render);

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        void controller.flush();
      } else {
        controller.resume();
        measureScreen();
        void updates.check();
      }
    });
    window.addEventListener('pagehide', () => void controller.flush());
    window.addEventListener('resize', () => {
      measureScreen();
      if (mapMounted) map.update();
    });

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

  const play = async (record: SlotRecord, cursor: WriteCursor, lastGood: SlotRecord | null, forceCommit: boolean, migratedFrom: number | null): Promise<void> => {
    const stored = record.payload.game;
    // Run repair is tried on every load, whatever content the record says it was written with: it returns the
    // same object when the run already fits, and a migrated record always needs it (ARCHITECTURE 7.3).
    const game = repairRun(stored, content);
    const contentChanged = record.contentVersion !== build.contentVersion;
    if (migratedFrom === 1) {
      platform.notices.add(
        'This save came from the test build, so it has been upgraded to the real game, which starts at run 1. The test counter and test items are gone, as planned. A copy of the old save is kept among the set-aside saves; there is nothing in it to restore.',
      );
    } else if (game !== stored) {
      platform.notices.add('The game was updated in the middle of a run. Part of the run no longer fitted the new version and was put right. Nothing you keep between runs was touched.');
    } else if (contentChanged && stored.run.battleCount > 0) {
      platform.notices.add('The game was updated in the middle of a run. Nothing in the run needed changing.');
    }
    // A repaired run or a changed content version is written at once, so the record says which content its run now fits.
    await runGame({ game, app: record.payload.app }, cursor, lastGood, forceCommit || contentChanged || game !== stored);
  };

  const recover = (reason: RecoveryReason, records: readonly Classified[], detail: string): void => {
    const view: RecoveryView = { reason, detail, records, quarantine: [], updateReady: updates.state === 'ready', status: '', confirmNew: false };
    // `left` is set the moment a choice is taken, so a second tap on any choice does nothing.
    let left = false;

    const draw = (): void => {
      if (left) return;
      view.updateReady = updates.state === 'ready';
      barHost.replaceChildren();
      screenHost.className = 'host';
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
      // Whatever is chosen here, the game that follows is not simply the one this phone was backing up. The
      // cloud backup is left alone until the player has looked at it (GDD D-40).
      await backup.restore();
      await backup.disown();
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
        const source = records.find((entry) => (entry.kind === 'good' || entry.kind === 'suspect') && entry.record === record);
        const from = source !== undefined && (source.kind === 'good' || source.kind === 'suspect') && source.migrated ? storedVersion(source.raw) : null;
        void leave((cursor) => play(record, cursor, null, true, from));
      },
      restore: (entry: QuarantineEntry): void => {
        const checked = checkImport(JSON.stringify(entry.raw), content);
        if (!checked.ok) {
          view.status = `That set-aside save cannot be restored. ${checked.reason}`;
          draw();
          return;
        }
        // A suspect one may be restored from here: this screen is where "use anyway" is asked.
        const from = storedVersion(entry.raw);
        void leave((cursor) => play(checked.record, cursor, null, true, from !== null && from < checked.record.saveVersion ? from : null));
      },
      startNew: (): void => {
        if (!view.confirmNew) {
          view.confirmNew = true;
          draw();
          return;
        }
        void leave((cursor) => runGame({ game: newGame(randomSeed(), content), app: newAppState(Date.now()) }, cursor, null, true));
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
      await runGame({ game: newGame(randomSeed(), content), app: newAppState(Date.now()) }, result.cursor, null, true);
      return;
    }
    for (const notice of result.notices) platform.notices.add(notice.text);
    await play(result.record, result.cursor, result.record, result.rewriteHot, result.migratedFrom);
  };

  try {
    await boot();
  } catch (error) {
    diagnostics.log('startup', message(error), error instanceof Error ? (error.stack ?? '') : '');
    recover('failed-start', [], message(error));
  }
};
