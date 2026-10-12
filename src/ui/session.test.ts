// Notices waiting to be shown. They are kept in the device store, so one raised just before a reload is not
// lost, and one that is already waiting is not said twice. The map's zoom level is kept there too.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { freshIndexedDb } from '../../tests/helpers';
import { LocalBackend } from '../save';
import { MapZoom, Notices } from './session';

let backend: LocalBackend;
let logged: string[];

beforeEach(() => {
  freshIndexedDb();
  backend = new LocalBackend();
  logged = [];
});

const notices = (): Notices => new Notices(backend, (kind, message) => logged.push(`${kind}: ${message}`));

/** What the device store holds, once the write that follows every change has landed. */
const stored = async (): Promise<unknown> => {
  await new Promise((resolve) => setTimeout(resolve, 20));
  return backend.getDevice('notices');
};

describe('Notices', () => {
  it('does not stack a notice whose text is already waiting', async () => {
    const list = notices();
    list.add('The game was updated to a new version.');
    list.add('The game was updated to a new version.');
    list.add('The game was updated to a new version.');
    expect(list.list()).toEqual([{ id: 1, text: 'The game was updated to a new version.' }]);
    expect(await stored()).toEqual([{ id: 1, text: 'The game was updated to a new version.' }]);
  });

  it('keeps notices that say different things, each with its own number', async () => {
    const list = notices();
    list.add('First.');
    list.add('Second.');
    list.add('First.');
    list.add('second.');
    expect(list.list()).toEqual([
      { id: 1, text: 'First.' },
      { id: 2, text: 'Second.' },
      { id: 3, text: 'second.' },
    ]);
    expect(await stored()).toEqual(list.list());
  });

  it('tells its listeners of a new notice, and not of a repeat', () => {
    const list = notices();
    let told = 0;
    list.subscribe(() => {
      told += 1;
    });
    list.add('First.');
    list.add('First.');
    expect(told).toBe(1);
    list.add('Second.');
    expect(told).toBe(2);
  });

  it('says a notice again once the first has been dismissed', async () => {
    const list = notices();
    list.add('First.');
    list.dismiss(1);
    expect(list.list()).toEqual([]);
    list.add('First.');
    expect(list.list()).toEqual([{ id: 1, text: 'First.' }]);
    expect(await stored()).toEqual([{ id: 1, text: 'First.' }]);
  });

  it('does not stack a notice on one left waiting by an earlier launch', async () => {
    // A start that raised its notice and was then cut short, before the save it was about was written.
    notices().add('This save was upgraded.');
    await stored();

    // The next launch reads what is waiting, then goes through the same start and raises the same notice.
    const next = notices();
    await next.restore();
    next.add('This save was upgraded.');
    next.add('Something else happened.');
    expect(next.list()).toEqual([
      { id: 1, text: 'This save was upgraded.' },
      { id: 2, text: 'Something else happened.' },
    ]);
    expect(await stored()).toEqual(next.list());
    expect(logged).toEqual([]);
  });

  it('removes only the notice that was dismissed', async () => {
    const list = notices();
    list.add('First.');
    list.add('Second.');
    list.add('Third.');
    list.dismiss(2);
    expect(list.list().map((notice) => notice.text)).toEqual(['First.', 'Third.']);
    // A number is not handed out twice while a higher one is still waiting.
    list.add('Fourth.');
    expect(list.list().map((notice) => notice.id)).toEqual([1, 3, 4]);
    expect(await stored()).toEqual(list.list());
  });
});

// The map's zoom level (GDD 8.3, D-32): remembered on the device, in no save, and never a reason for the map
// to fail to open or to change.
describe('MapZoom', () => {
  const zoom = (): MapZoom => new MapZoom(backend, (kind, message) => logged.push(`${kind}: ${message}`));

  /** What the device store holds, once the write that follows a switch has landed. */
  const remembered = async (): Promise<unknown> => {
    await new Promise((resolve) => setTimeout(resolve, 20));
    return backend.getDevice('mapZoom');
  };

  it('starts near, switches at once on each call, and stores each choice', async () => {
    const map = zoom();
    expect(map.level).toBe('near');
    expect(await remembered()).toBeUndefined();
    map.toggle();
    expect(map.level).toBe('far');
    expect(await remembered()).toBe('far');
    map.toggle();
    expect(map.level).toBe('near');
    expect(await remembered()).toBe('near');
    expect(logged).toEqual([]);
  });

  it('opens at the level an earlier launch chose', async () => {
    zoom().toggle();
    await remembered();
    const next = zoom();
    await next.restore();
    expect(next.level).toBe('far');

    next.toggle();
    await remembered();
    const third = zoom();
    await third.restore();
    expect(third.level).toBe('near');
    expect(logged).toEqual([]);
  });

  it('opens near when the device store holds nothing, or anything it does not expect', async () => {
    const fresh = zoom();
    await fresh.restore();
    expect(fresh.level).toBe('near');
    for (const junk of ['FAR', 'out', '', 14, true, null, { level: 'far' }, ['far']]) {
      await backend.setDevice('mapZoom', junk);
      const map = zoom();
      await map.restore();
      expect(map.level, JSON.stringify(junk)).toBe('near');
    }
    expect(logged).toEqual([]);
  });

  it('opens near, and says so in the log, when the device store cannot be read', async () => {
    await backend.setDevice('mapZoom', 'far');
    vi.spyOn(backend, 'getDevice').mockRejectedValue(new Error('simulated: the store would not open'));
    const map = zoom();
    await map.restore();
    expect(map.level).toBe('near');
    expect(logged).toEqual(['device: could not read the map zoom: Error: simulated: the store would not open']);
  });

  it('still switches on screen when the choice cannot be stored, and says so in the log', async () => {
    vi.spyOn(backend, 'setDevice').mockRejectedValue(new Error('simulated: the write was refused'));
    const map = zoom();
    map.toggle();
    expect(map.level).toBe('far');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(map.level).toBe('far');
    expect(logged).toEqual(['device: could not store the map zoom: Error: simulated: the write was refused']);
    // The next switch is tried like any other.
    map.toggle();
    expect(map.level).toBe('near');
  });
});
