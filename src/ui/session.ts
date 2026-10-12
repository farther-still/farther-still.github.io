// What every screen is handed: the running game and the platform pieces around it.

import type { Content } from '../engine';
import type { Diagnostics, PersistStatus, UpdateController } from '../platform';
import type { BuildInfo, LocalBackend } from '../save';
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

export type ScreenName = 'main' | 'settings';

export type SheetBuilder = (close: () => void) => HTMLElement;

export type Shell = {
  show: (screen: ScreenName) => void;
  openSheet: (build: SheetBuilder) => void;
  rerender: () => void;
};

/** View state that must survive a re-render of Settings. */
export type SettingsView = {
  showLog: boolean;
  selfTest: SelfTestResult[] | null;
};

export type Platform = {
  build: BuildInfo;
  content: Content;
  backend: LocalBackend;
  updates: UpdateController;
  diagnostics: Diagnostics;
  notices: Notices;
  persist: { status: PersistStatus | 'asking' };
  standalone: boolean;
};

export type Session = Platform & {
  controller: GameController;
  shell: Shell;
  settingsView: SettingsView;
  /** The message from the last tap that the engine turned down, shown once on the main screen. */
  flash: { text: string | null };
};
