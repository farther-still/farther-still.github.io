// What every screen is handed: the running game and the platform pieces around it.

import type { Content, ItemId, SlotId, StatKey } from '../engine';
import type { GameText } from '../content';
import type { Diagnostics, PersistStatus, ScreenReading, UpdateController } from '../platform';
import type { BuildInfo, CloudBackup, LocalBackend } from '../save';
import type { GameController } from './controller';
import type { SelfTestResult } from './selftest';

export type Notice = { id: number; text: string };

const NOTICES_KEY = 'notices';

const isNotice = (value: unknown): value is Notice =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as Notice).id === 'number' &&
  typeof (value as Notice).text === 'string';

/** Notices waiting to be shown. They live in the `device` store, so one raised just before a reload is not lost. */
export class Notices {
  private items: Notice[] = [];
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly backend: LocalBackend,
    private readonly log: (kind: string, message: string) => void,
  ) {}

  async restore(): Promise<void> {
    try {
      const stored = await this.backend.getDevice(NOTICES_KEY);
      if (Array.isArray(stored)) this.items = stored.filter(isNotice);
    } catch (error) {
      this.log('notices', `could not read waiting notices: ${String(error)}`);
    }
  }

  list(): readonly Notice[] {
    return this.items;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  add(text: string): void {
    // The same notice is not stacked: a start that was cut short and repeated would otherwise say it twice.
    if (this.items.some((item) => item.text === text)) return;
    const id = this.items.reduce((highest, item) => Math.max(highest, item.id), 0) + 1;
    this.items = [...this.items, { id, text }];
    this.changed();
  }

  dismiss(id: number): void {
    this.items = this.items.filter((item) => item.id !== id);
    this.changed();
  }

  private changed(): void {
    for (const listener of this.listeners) listener();
    this.backend.setDevice(NOTICES_KEY, this.items).catch((error: unknown) => {
      this.log('notices', `could not store waiting notices: ${String(error)}`);
    });
  }
}

const ZOOM_KEY = 'mapZoom';

/** How much of the map is in view: near, or far to see and tap farther (GDD 8.3, D-32). */
export type ZoomLevel = 'near' | 'far';

/**
 * The map's zoom level. It is a fact about this screen, not about the game, so it is kept in the `device` store
 * and in no save. Anything but a stored "far" opens near, and so does a store that cannot be read.
 */
export class MapZoom {
  private current: ZoomLevel = 'near';

  constructor(
    private readonly backend: LocalBackend,
    private readonly log: (kind: string, message: string) => void,
  ) {}

  get level(): ZoomLevel {
    return this.current;
  }

  async restore(): Promise<void> {
    try {
      if ((await this.backend.getDevice(ZOOM_KEY)) === 'far') this.current = 'far';
    } catch (error) {
      this.log('device', `could not read the map zoom: ${String(error)}`);
    }
  }

  /** Switches at once. The choice is then stored; if that fails the map still shows what was asked for. */
  toggle(): void {
    this.current = this.current === 'near' ? 'far' : 'near';
    this.backend.setDevice(ZOOM_KEY, this.current).catch((error: unknown) => {
      this.log('device', `could not store the map zoom: ${String(error)}`);
    });
  }
}

/** The tab bar's screens (GDD 8.1), and Settings, which is reached from the Run menu. */
export type ScreenName = 'map' | 'hero' | 'gear' | 'items' | 'bestiary' | 'run' | 'settings';

export type SheetBuilder = (close: () => void) => HTMLElement;

export type Shell = {
  show: (screen: ScreenName) => void;
  openSheet: (build: SheetBuilder) => void;
  closeSheet: () => void;
  sheetOpen: () => boolean;
  /** True while this very sheet is the one on screen. A sheet that waited on something asks before it goes on. */
  showing: (sheet: HTMLElement) => boolean;
  rerender: () => void;
  /** A line that appears briefly over the current screen, such as "Not enough gold". */
  toast: (text: string) => void;
};

/** How many points one tap on a stat spends. */
export type SpendAmount = 1 | 10 | 100 | 'quarter' | 'all';

export type ItemFilter = 'all' | 'weapon' | 'armor' | 'accessory' | 'key' | 'owned' | 'sale';

/** View state that must survive a re-render. None of it is saved: it is where the player was looking. */
export type ViewState = {
  settings: { showLog: boolean; selfTest: SelfTestResult[] | null };
  hero: { tab: 'core' | 'combat'; amount: SpendAmount; help: StatKey | string | null };
  gear: { open: SlotId | null };
  items: { filter: ItemFilter };
  /** Items gained since the Items or Gear screen was last opened, for the status strip's badge. */
  unseenItems: ItemId[];
  /** True once "Later" has been tapped on the export reminder. It is back the next time the app is started (D-33). */
  exportReminderPutOff: boolean;
  /** The same for the reminder that the cloud backup needs the player. */
  backupReminderPutOff: boolean;
};

export type Platform = {
  build: BuildInfo;
  content: Content;
  text: GameText;
  backend: LocalBackend;
  /** The cloud backup (ARCHITECTURE 7.5). Off until a key is entered in Settings. */
  backup: CloudBackup;
  updates: UpdateController;
  diagnostics: Diagnostics;
  notices: Notices;
  zoom: MapZoom;
  persist: { status: PersistStatus | 'asking' };
  standalone: boolean;
  /** Refreshed in place on a resize, so a screen drawn later shows the latest reading. */
  screen: { reading: ScreenReading };
};

export type Session = Platform & {
  controller: GameController;
  shell: Shell;
  view: ViewState;
};

export const newViewState = (): ViewState => ({
  settings: { showLog: false, selfTest: null },
  hero: { tab: 'core', amount: 1, help: null },
  gear: { open: null },
  items: { filter: 'all' },
  unseenItems: [],
  exportReminderPutOff: false,
  backupReminderPutOff: false,
});
