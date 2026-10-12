// The in-app diagnostics log: `error` and `unhandledrejection` go into a ring buffer in IndexedDB, viewable in
// Settings and included in exports. There is no Mac to attach Web Inspector to the phone, so this is the only
// way to see what went wrong on it.

import { DIAGNOSTICS_LIMIT, STORE_DIAGNOSTICS } from '../save/constants';
import type { DiagnosticEntry, SaveDb } from '../save/db';

const MAX_TEXT = 2000;

const clip = (text: string): string => (text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}…` : text);

export type Diagnostics = {
  log: (kind: string, message: string, stack?: string) => void;
  /** Entries are held in memory until a database handle is available. */
  attach: (getDb: () => Promise<SaveDb>) => void;
  /** Resolves when everything logged so far has been written or given up on. */
  settled: () => Promise<void>;
  /** Entries that could not be written, newest last. Settings lists them after the stored ones. */
  unwritten: () => readonly DiagnosticEntry[];
};

export const createDiagnostics = (buildId: string, now: () => number): Diagnostics => {
  let getDb: (() => Promise<SaveDb>) | null = null;
  let waiting: DiagnosticEntry[] = [];
  let chain: Promise<void> = Promise.resolve();

  const persist = async (entry: DiagnosticEntry): Promise<void> => {
    if (getDb === null) return;
    const db = await getDb();
    const tx = db.transaction(STORE_DIAGNOSTICS, 'readwrite');
    await tx.store.add(entry);
    let extra = (await tx.store.count()) - DIAGNOSTICS_LIMIT;
    let cursor = await tx.store.openCursor();
    while (extra > 0 && cursor !== null) {
      await cursor.delete();
      extra -= 1;
      cursor = await cursor.continue();
    }
    await tx.done;
  };

  const enqueue = (entry: DiagnosticEntry): void => {
    chain = chain.then(async () => {
      try {
        await persist(entry);
      } catch {
        // A failure to log cannot itself be logged to the same store. Keep it in memory instead.
        waiting = [...waiting, entry].slice(-DIAGNOSTICS_LIMIT);
      }
    });
  };

  return {
    log(kind, message, stack = '') {
      const entry: DiagnosticEntry = { at: now(), kind, message: clip(message), stack: clip(stack), buildId };
      if (getDb === null) {
        waiting = [...waiting, entry].slice(-DIAGNOSTICS_LIMIT);
      } else {
        enqueue(entry);
      }
    },
    attach(source) {
      getDb = source;
      const held = waiting;
      waiting = [];
      for (const entry of held) enqueue(entry);
    },
    settled: () => chain,
    unwritten: () => waiting,
  };
};

type ErrorTarget = {
  addEventListener: (type: string, listener: (event: Event) => void) => void;
};

const describe = (reason: unknown): { message: string; stack: string } => {
  if (reason instanceof Error) return { message: `${reason.name}: ${reason.message}`, stack: reason.stack ?? '' };
  if (typeof reason === 'string') return { message: reason, stack: '' };
  try {
    return { message: JSON.stringify(reason) ?? String(reason), stack: '' };
  } catch {
    return { message: String(reason), stack: '' };
  }
};

export const captureGlobalErrors = (target: ErrorTarget, diagnostics: Diagnostics): void => {
  target.addEventListener('error', (event) => {
    const detail = event as Partial<ErrorEvent>;
    const from = describe(detail.error ?? detail.message ?? 'unknown error');
    const where = detail.filename ? `${detail.filename}:${detail.lineno ?? 0}:${detail.colno ?? 0}` : '';
    diagnostics.log('error', from.message, from.stack || where);
  });
  target.addEventListener('unhandledrejection', (event) => {
    const from = describe((event as Partial<PromiseRejectionEvent>).reason);
    diagnostics.log('unhandledrejection', from.message, from.stack);
  });
  // Something the content security policy blocked. Without this it would fail silently on the phone.
  target.addEventListener('securitypolicyviolation', (event) => {
    const detail = event as Partial<SecurityPolicyViolationEvent>;
    diagnostics.log('blocked-by-policy', `${detail.violatedDirective ?? 'unknown directive'} blocked ${detail.blockedURI ?? 'unknown'}`, detail.sourceFile ?? '');
  });
};
