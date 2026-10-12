import { beforeEach, describe, expect, it } from 'vitest';
import { freshIndexedDb } from '../../tests/helpers';
import { DIAGNOSTICS_LIMIT, STORE_DIAGNOSTICS } from '../save/constants';
import { openSaveDb } from '../save/db';
import type { SaveDb } from '../save/db';
import { captureGlobalErrors, createDiagnostics } from './diagnostics';

let db: SaveDb;

beforeEach(async () => {
  freshIndexedDb();
  db = await openSaveDb();
});

describe('diagnostics log', () => {
  it('writes entries with their time, kind and build', async () => {
    const diagnostics = createDiagnostics('build-1', () => 1234);
    diagnostics.attach(() => Promise.resolve(db));
    diagnostics.log('error', 'something broke', 'at line 1');
    await diagnostics.settled();
    expect(await db.getAll(STORE_DIAGNOSTICS)).toEqual([
      { at: 1234, kind: 'error', message: 'something broke', stack: 'at line 1', buildId: 'build-1' },
    ]);
  });

  it('is a ring buffer: only the newest 200 entries stay', async () => {
    const diagnostics = createDiagnostics('build-1', () => 1);
    diagnostics.attach(() => Promise.resolve(db));
    for (let i = 1; i <= DIAGNOSTICS_LIMIT + 7; i += 1) diagnostics.log('error', `entry ${i}`);
    await diagnostics.settled();
    const held = await db.getAll(STORE_DIAGNOSTICS);
    expect(held).toHaveLength(DIAGNOSTICS_LIMIT);
    expect(held[0]?.message).toBe('entry 8');
    expect(held.at(-1)?.message).toBe(`entry ${DIAGNOSTICS_LIMIT + 7}`);
  });

  it('holds what is logged before the database is ready, then writes it', async () => {
    const diagnostics = createDiagnostics('build-1', () => 1);
    diagnostics.log('startup', 'early');
    expect(diagnostics.unwritten().map((entry) => entry.message)).toEqual(['early']);
    diagnostics.attach(() => Promise.resolve(db));
    await diagnostics.settled();
    expect((await db.getAll(STORE_DIAGNOSTICS)).map((entry) => entry.message)).toEqual(['early']);
    expect(diagnostics.unwritten()).toEqual([]);
  });

  it('keeps an entry in memory, and does not throw, when the database cannot be written', async () => {
    const diagnostics = createDiagnostics('build-1', () => 1);
    diagnostics.attach(() => Promise.reject(new Error('database is gone')));
    diagnostics.log('error', 'lost?');
    await diagnostics.settled();
    expect(diagnostics.unwritten().map((entry) => entry.message)).toEqual(['lost?']);
  });

  it('clips very long text', async () => {
    const diagnostics = createDiagnostics('build-1', () => 1);
    diagnostics.attach(() => Promise.resolve(db));
    diagnostics.log('error', 'x'.repeat(50000), 'y'.repeat(50000));
    await diagnostics.settled();
    const [entry] = await db.getAll(STORE_DIAGNOSTICS);
    expect(entry?.message.length).toBeLessThan(2100);
    expect(entry?.stack.length).toBeLessThan(2100);
  });

  it('captures error and unhandledrejection events', async () => {
    const listeners = new Map<string, (event: Event) => void>();
    const diagnostics = createDiagnostics('build-1', () => 1);
    diagnostics.attach(() => Promise.resolve(db));
    captureGlobalErrors({ addEventListener: (type, listener) => listeners.set(type, listener) }, diagnostics);
    expect([...listeners.keys()].sort()).toEqual(['error', 'securitypolicyviolation', 'unhandledrejection']);

    const thrown = new TypeError('bad call');
    listeners.get('error')?.({ error: thrown, message: 'Uncaught TypeError: bad call', filename: 'app.js', lineno: 3, colno: 9 } as unknown as Event);
    listeners.get('error')?.({ message: 'Script error.', filename: 'app.js', lineno: 1, colno: 2 } as unknown as Event);
    listeners.get('unhandledrejection')?.({ reason: new Error('rejected') } as unknown as Event);
    listeners.get('unhandledrejection')?.({ reason: { code: 7 } } as unknown as Event);
    listeners.get('securitypolicyviolation')?.({ violatedDirective: 'script-src', blockedURI: 'eval', sourceFile: 'app.js' } as unknown as Event);
    await diagnostics.settled();

    const held = await db.getAll(STORE_DIAGNOSTICS);
    expect(held.map((entry) => `${entry.kind}|${entry.message}`)).toEqual([
      'error|TypeError: bad call',
      'error|Script error.',
      'unhandledrejection|Error: rejected',
      'unhandledrejection|{"code":7}',
      'blocked-by-policy|script-src blocked eval',
    ]);
    expect(held[0]?.stack).toContain('TypeError');
    expect(held[1]?.stack).toBe('app.js:1:2');
  });
});
