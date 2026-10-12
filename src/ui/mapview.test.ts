// The map's arithmetic: where the map sits on the canvas, which tile a point is in, and which way a drag
// steers. A tap lands on the wrong tile if any of it is off by one. Then the two controls themselves (GDD 8.3),
// driven by pointer events on a stand-in canvas in the sample world.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeCanvas } from '../../tests/fake-dom';
import type { FakePoint } from '../../tests/fake-dom';
import { BUILD, CONTENT, FIXED_NOW, dump, freshIndexedDb, game, payload } from '../../tests/helpers';
import type { DoorDef, GameState, Point } from '../engine';
import { LocalBackend, SaveWriter, cursorFor } from '../save';
import type { AppState, SlotRecord } from '../save';
import { GameController } from './controller';
import { COLUMNS, MapView, pointOfTile, steerDirection, tileAtPoint, viewportFor } from './mapview';
import type { Session } from './session';

// A phone-sized canvas and a map larger than it both ways: 15 by 34 tiles of 44 points is 660 by 1,496.
const WIDTH = 402;
const HEIGHT = 560;
const TALL = { width: 15, height: 34 };

describe('viewportFor', () => {
  it('fits nine tiles across the canvas, which on a phone makes a tile 44 points', () => {
    expect(COLUMNS).toBe(9);
    expect(viewportFor(WIDTH, HEIGHT, TALL, { x: 7, y: 17 }).tile).toBe(44);
    expect(viewportFor(396, 528, TALL, { x: 7, y: 17 }).tile).toBe(44);
    expect(viewportFor(820, 1100, TALL, { x: 7, y: 17 }).tile).toBe(91);
  });

  it('never makes a tile smaller than 24 points, however narrow the canvas', () => {
    expect(viewportFor(100, 300, TALL, { x: 7, y: 17 }).tile).toBe(24);
    expect(viewportFor(0, 0, TALL, { x: 7, y: 17 }).tile).toBe(24);
  });

  it('puts the centre of the focus tile at the centre of the canvas, away from the edges', () => {
    const focus = { x: 7, y: 17 };
    const view = viewportFor(WIDTH, HEIGHT, TALL, focus);
    expect(pointOfTile(view, focus.x, focus.y)).toEqual({ x: WIDTH / 2, y: HEIGHT / 2 });
    expect(view).toMatchObject({ width: WIDTH, height: HEIGHT });
  });

  it('stops the camera at each edge of the map, so nothing beyond the map is shown', () => {
    const span = { x: TALL.width * 44, y: TALL.height * 44 };
    // Top left corner: the map starts at the canvas's own corner.
    expect(viewportFor(WIDTH, HEIGHT, TALL, { x: 0, y: 0 })).toMatchObject({ originX: 0, originY: 0 });
    // Bottom right corner: the map's far edges meet the canvas's far edges.
    expect(viewportFor(WIDTH, HEIGHT, TALL, { x: 14, y: 33 })).toMatchObject({ originX: WIDTH - span.x, originY: HEIGHT - span.y });
    // One axis at an edge and the other free.
    const side = viewportFor(WIDTH, HEIGHT, TALL, { x: 0, y: 17 });
    expect(side.originX).toBe(0);
    expect(pointOfTile(side, 0, 17).y).toBe(HEIGHT / 2);
    // Everywhere on the map, every point of the canvas shows a tile of the map.
    for (let y = 0; y < TALL.height; y += 1) {
      for (let x = 0; x < TALL.width; x += 1) {
        const view = viewportFor(WIDTH, HEIGHT, TALL, { x, y });
        expect(view.originX, `${x},${y}`).toBeLessThanOrEqual(0);
        expect(view.originY, `${x},${y}`).toBeLessThanOrEqual(0);
        expect(view.originX + span.x, `${x},${y}`).toBeGreaterThanOrEqual(WIDTH);
        expect(view.originY + span.y, `${x},${y}`).toBeGreaterThanOrEqual(HEIGHT);
      }
    }
  });

  it('keeps the focus tile wholly on the canvas wherever the hero stands', () => {
    for (let y = 0; y < TALL.height; y += 1) {
      for (let x = 0; x < TALL.width; x += 1) {
        const view = viewportFor(WIDTH, HEIGHT, TALL, { x, y });
        const centre = pointOfTile(view, x, y);
        expect(centre.x - view.tile / 2, `${x},${y}`).toBeGreaterThanOrEqual(0);
        expect(centre.x + view.tile / 2, `${x},${y}`).toBeLessThanOrEqual(WIDTH);
        expect(centre.y - view.tile / 2, `${x},${y}`).toBeGreaterThanOrEqual(0);
        expect(centre.y + view.tile / 2, `${x},${y}`).toBeLessThanOrEqual(HEIGHT);
      }
    }
  });

  it('centres a map smaller than the canvas, and does not move it with the hero', () => {
    const small = { width: 5, height: 4 };
    const view = viewportFor(396, 528, small, { x: 1, y: 1 });
    // 5 tiles of 44 leave 176 points across, and 4 leave 352 down: half on each side.
    expect(view).toMatchObject({ tile: 44, originX: 88, originY: 176 });
    for (const focus of [{ x: 0, y: 0 }, { x: 4, y: 3 }, { x: 2.5, y: 1.5 }]) {
      expect(viewportFor(396, 528, small, focus)).toEqual(view);
    }
  });

  it('centres on one axis and follows the hero on the other when the map is narrow but tall', () => {
    const narrow = { width: 5, height: 34 };
    const view = viewportFor(396, 528, narrow, { x: 2, y: 17 });
    expect(view.originX).toBe(88);
    expect(pointOfTile(view, 2, 17).y).toBe(264);
  });

  it('follows a hero part-way between two tiles, on a whole point', () => {
    const from = viewportFor(WIDTH, HEIGHT, TALL, { x: 7, y: 17 });
    const half = viewportFor(WIDTH, HEIGHT, TALL, { x: 7.5, y: 17 });
    const to = viewportFor(WIDTH, HEIGHT, TALL, { x: 8, y: 17 });
    expect(half.originX).toBe(from.originX - 22);
    expect(to.originX).toBe(from.originX - 44);
    expect(Number.isInteger(viewportFor(WIDTH, HEIGHT, TALL, { x: 7.37, y: 17.81 }).originX)).toBe(true);
    expect(Number.isInteger(viewportFor(WIDTH, HEIGHT, TALL, { x: 7.37, y: 17.81 }).originY)).toBe(true);
  });
});

describe('tileAtPoint and pointOfTile', () => {
  const views = [
    viewportFor(WIDTH, HEIGHT, TALL, { x: 7, y: 17 }),
    viewportFor(WIDTH, HEIGHT, TALL, { x: 0, y: 0 }),
    viewportFor(WIDTH, HEIGHT, TALL, { x: 14, y: 33 }),
    viewportFor(WIDTH, HEIGHT, TALL, { x: 6.4, y: 31.7 }),
    viewportFor(396, 528, { width: 5, height: 4 }, { x: 1, y: 1 }),
    viewportFor(100, 300, TALL, { x: 3, y: 9 }),
  ];

  it('are inverses: the centre of every tile is in that tile', () => {
    for (const view of views) {
      for (let y = -2; y < 36; y += 1) {
        for (let x = -2; x < 17; x += 1) {
          const centre = pointOfTile(view, x, y);
          expect(tileAtPoint(view, centre.x, centre.y), `${x},${y}`).toEqual({ x, y });
        }
      }
    }
  });

  it('give a tile its left and top edges, and the next tile its right and bottom edges', () => {
    for (const view of views) {
      const centre = pointOfTile(view, 3, 2);
      const half = view.tile / 2;
      expect(tileAtPoint(view, centre.x - half, centre.y - half)).toEqual({ x: 3, y: 2 });
      expect(tileAtPoint(view, centre.x + half - 0.5, centre.y + half - 0.5)).toEqual({ x: 3, y: 2 });
      expect(tileAtPoint(view, centre.x + half, centre.y)).toEqual({ x: 4, y: 2 });
      expect(tileAtPoint(view, centre.x, centre.y + half)).toEqual({ x: 3, y: 3 });
      expect(tileAtPoint(view, centre.x - half - 0.5, centre.y)).toEqual({ x: 2, y: 2 });
      expect(tileAtPoint(view, centre.x, centre.y - half - 0.5)).toEqual({ x: 3, y: 1 });
    }
  });

  it('put every point of the canvas in exactly the tile whose square holds it', () => {
    const view = viewportFor(WIDTH, HEIGHT, TALL, { x: 6.4, y: 31.7 });
    for (let py = 0; py < HEIGHT; py += 7) {
      for (let px = 0; px < WIDTH; px += 7) {
        const tile = tileAtPoint(view, px, py);
        const centre = pointOfTile(view, tile.x, tile.y);
        expect(Math.abs(px - centre.x), `${px},${py}`).toBeLessThanOrEqual(view.tile / 2);
        expect(Math.abs(py - centre.y), `${px},${py}`).toBeLessThanOrEqual(view.tile / 2);
      }
    }
  });

  it('name a tile outside the map for a point outside it, so a tap there finds nothing', () => {
    const view = viewportFor(396, 528, { width: 5, height: 4 }, { x: 1, y: 1 });
    expect(tileAtPoint(view, 0, 0)).toEqual({ x: -2, y: -4 });
    expect(tileAtPoint(view, 87, 175)).toEqual({ x: -1, y: -1 });
    expect(tileAtPoint(view, 88, 176)).toEqual({ x: 0, y: 0 });
    expect(tileAtPoint(view, 88 + 5 * 44, 176 + 4 * 44)).toEqual({ x: 5, y: 4 });
  });
});

describe('steerDirection', () => {
  it('ignores a press that has not moved 14 points: that is a tap', () => {
    expect(steerDirection(0, 0)).toBeNull();
    expect(steerDirection(13, 0)).toBeNull();
    expect(steerDirection(0, -13.9)).toBeNull();
    expect(steerDirection(9.8, 9.8)).toBeNull();
    expect(steerDirection(-9.8, 9.8)).toBeNull();
  });

  it('steers from 14 points out, measured in a straight line', () => {
    expect(steerDirection(14, 0)).toEqual({ dx: 1, dy: 0 });
    expect(steerDirection(0, -14)).toEqual({ dx: 0, dy: -1 });
    expect(steerDirection(10, 10)).toEqual({ dx: 1, dy: 1 });
  });

  it('picks one of eight directions, with down the screen as +y', () => {
    expect(steerDirection(30, 0)).toEqual({ dx: 1, dy: 0 });
    expect(steerDirection(30, 30)).toEqual({ dx: 1, dy: 1 });
    expect(steerDirection(0, 30)).toEqual({ dx: 0, dy: 1 });
    expect(steerDirection(-30, 30)).toEqual({ dx: -1, dy: 1 });
    expect(steerDirection(-30, 0)).toEqual({ dx: -1, dy: 0 });
    expect(steerDirection(-30, -30)).toEqual({ dx: -1, dy: -1 });
    expect(steerDirection(0, -30)).toEqual({ dx: 0, dy: -1 });
    expect(steerDirection(30, -30)).toEqual({ dx: 1, dy: -1 });
  });

  it('gives each direction the eighth of the circle around it', () => {
    // 22.5 degrees is where one direction hands over to the next: 20 and 30 degrees fall either side of it.
    const at = (degrees: number): { dx: number; dy: number } | null => {
      const angle = (degrees * Math.PI) / 180;
      return steerDirection(40 * Math.cos(angle), 40 * Math.sin(angle));
    };
    const around = [
      { dx: 1, dy: 0 },
      { dx: 1, dy: 1 },
      { dx: 0, dy: 1 },
      { dx: -1, dy: 1 },
      { dx: -1, dy: 0 },
      { dx: -1, dy: -1 },
      { dx: 0, dy: -1 },
      { dx: 1, dy: -1 },
    ];
    around.forEach((direction, index) => {
      const centre = index * 45;
      for (const offset of [-20, -10, 0, 10, 20]) expect(at(centre + offset), `${centre + offset} degrees`).toEqual(direction);
    });
    expect(at(-20)).toEqual({ dx: 1, dy: 0 });
    expect(at(340)).toEqual({ dx: 1, dy: 0 });
    expect(at(-30)).toEqual({ dx: 1, dy: -1 });
  });

  it('does not depend on how far the finger has gone, only on which way', () => {
    for (const reach of [14, 15, 44, 200, 1000]) {
      expect(steerDirection(reach, 0)).toEqual({ dx: 1, dy: 0 });
      expect(steerDirection(-reach, -reach)).toEqual({ dx: -1, dy: -1 });
      expect(steerDirection(0, reach)).toEqual({ dx: 0, dy: 1 });
    }
  });

  it('never answers with no direction at all once past the dead zone', () => {
    for (let degrees = 0; degrees < 360; degrees += 1) {
      const angle = (degrees * Math.PI) / 180;
      const direction = steerDirection(50 * Math.cos(angle), 50 * Math.sin(angle));
      expect(direction, String(degrees)).not.toBeNull();
      expect(direction !== null && (direction.dx !== 0 || direction.dy !== 0), String(degrees)).toBe(true);
    }
  });
});

// The sample world's first zone, 9 tiles by 10, which a 396 by 528 canvas shows whole:
//
//   #########
//   #..2#...#   2  enemy s002           B  boss s003, a gate        >  exit
//   #...B..>#
//   #..1#...#   1  enemy s001
//   #.S.#####   S  Salvage site
//   #.@.%_###   @  run start            %  hidden tile x01          _  stash x02
//   #...#####
//   #D#######   D  door, opened by key i004
//   #.#######
//   #########
describe('MapView', () => {
  const BOX = { left: 10, top: 100, width: 396, height: 528 };
  const ZONE = CONTENT.zones['z01'];

  let backend: LocalBackend;

  beforeEach(() => {
    freshIndexedDb();
    backend = new LocalBackend();
  });

  type Mounted = {
    controller: GameController;
    canvas: FakeCanvas;
    view: MapView;
    asked: { enemies: string[]; sites: number; doors: DoorDef[]; toasts: string[] };
    /** Set `open` to stand in for a sheet the player has opened over the map. */
    sheet: { open: boolean };
    /** Where the hero stood each time the screen was told of a change: once per step. */
    trail: Point[];
    shown: () => number;
  };

  const at = (x: number, y: number): GameState['run']['position'] => ({ zone: 'z01', x, y });

  /** A map on screen over the sample game, with both controls on unless `settings` says otherwise. */
  const mount = (state: GameState = game(), settings: Partial<AppState['settings']> = {}): Mounted => {
    const base = payload(state);
    const app: AppState = { ...base.app, settings: { ...base.app.settings, tapToMove: true, dragToSteer: true, ...settings } };
    const writer = new SaveWriter({ store: backend, build: BUILD, content: CONTENT, now: () => FIXED_NOW, log: () => undefined }, cursorFor([]), null);
    const controller = new GameController({ content: CONTENT, writer, build: BUILD, randomSeed: () => 777, now: () => FIXED_NOW }, { game: base.game, app });
    const asked: Mounted['asked'] = { enemies: [], sites: 0, doors: [], toasts: [] };
    // The map uses the content, the controller and the toast, and nothing else of the session unless it draws.
    const sheet = { open: false };
    const session = { content: CONTENT, controller, shell: { toast: (words: string) => asked.toasts.push(words), sheetOpen: () => sheet.open } } as unknown as Session;
    const canvas = new FakeCanvas('canvas');
    canvas.box = { ...BOX };
    const hooks = {
      onEnemy: (spawn: string) => asked.enemies.push(spawn),
      onSite: () => {
        asked.sites += 1;
      },
      onDoor: (door: DoorDef) => asked.doors.push(door),
    };
    const view = new MapView(session, hooks, canvas as unknown as HTMLCanvasElement);
    view.update();
    const trail: Point[] = [];
    controller.subscribe(() => {
      trail.push({ x: controller.game.run.position.x, y: controller.game.run.position.y });
    });
    return { controller, canvas, view, asked, sheet, trail, shown: () => trail.length };
  };

  /** Where on the page the centre of a tile is. The whole zone fits the canvas, so the camera does not move. */
  const pageOf = (tile: Point): FakePoint => {
    if (ZONE === undefined) throw new Error('the sample world has no z01');
    const centre = pointOfTile(viewportFor(BOX.width, BOX.height, ZONE.map, { x: 0, y: 0 }), tile.x, tile.y);
    return { clientX: BOX.left + centre.x, clientY: BOX.top + centre.y };
  };

  const tap = (mounted: Mounted, tile: Point): void => {
    mounted.canvas.fire('pointerdown', pageOf(tile));
    mounted.canvas.fire('pointerup', pageOf(tile));
  };

  /** A finger down on a tile, then moved by so many points and held there. */
  const press = (mounted: Mounted, tile: Point, dx: number, dy: number): FakePoint => {
    const from = pageOf(tile);
    const to = { clientX: from.clientX + dx, clientY: from.clientY + dy };
    mounted.canvas.fire('pointerdown', from);
    mounted.canvas.fire('pointermove', to);
    return to;
  };

  /** Long enough for a walk that writes nothing to play out: with nothing to draw on, each step is taken at once. */
  const walked = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 20));

  /** True when each step went to a tile beside the one before it. */
  const stepByStep = (from: Point, trail: readonly Point[]): boolean =>
    trail.every((to, index) => {
      const before = index === 0 ? from : trail[index - 1];
      return before !== undefined && Math.max(Math.abs(to.x - before.x), Math.abs(to.y - before.y)) === 1;
    });

  const where = (mounted: Mounted): Point => ({ x: mounted.controller.game.run.position.x, y: mounted.controller.game.run.position.y });
  const storedGame = async (): Promise<GameState | undefined> => ((await dump(backend)).slots['hot'] as SlotRecord | undefined)?.payload.game;

  describe('a tap', () => {
    it('on a floor tile walks the hero there by the shortest route, a step at a time, and writes nothing', async () => {
      const mounted = mount();
      tap(mounted, { x: 1, y: 6 });
      await walked();
      expect(where(mounted)).toEqual({ x: 1, y: 6 });
      // Four rows down is four steps, straight or diagonal, each to a tile beside the last.
      expect(mounted.shown()).toBe(4);
      expect(stepByStep({ x: 2, y: 2 }, mounted.trail)).toBe(true);
      expect(mounted.controller.dirty).toBe(true);
      expect((await dump(backend)).slots).toEqual({});
      expect(mounted.asked).toEqual({ enemies: [], sites: 0, doors: [], toasts: [] });
    });

    it('lands on the tile under the finger wherever the canvas sits on the page', async () => {
      const mounted = mount();
      mounted.canvas.box = { left: 0, top: 0, width: 396, height: 528 };
      // With the canvas at the corner of the page, the map begins 44 points down it: this is tile 1,3.
      const point = { clientX: 1 * 44 + 22, clientY: 44 + 3 * 44 + 22 };
      mounted.canvas.fire('pointerdown', point);
      mounted.canvas.fire('pointerup', point);
      await walked();
      expect(where(mounted)).toEqual({ x: 1, y: 3 });
    });

    it('on an enemy walks up beside it, never onto it, and then asks about the fight', async () => {
      const mounted = mount(game({ run: { position: at(1, 6) } }));
      tap(mounted, { x: 3, y: 3 });
      await walked();
      const hero = where(mounted);
      expect(Math.max(Math.abs(hero.x - 3), Math.abs(hero.y - 3))).toBe(1);
      expect(mounted.shown()).toBe(2);
      expect(mounted.asked.enemies).toEqual(['s001']);
      // Nothing starts a fight but the Fight button.
      expect(mounted.controller.game.run.battleCount).toBe(5);
    });

    it('on an enemy the hero already stands beside asks at once, without a step', async () => {
      const mounted = mount();
      tap(mounted, { x: 3, y: 1 });
      await walked();
      expect(where(mounted)).toEqual({ x: 2, y: 2 });
      expect(mounted.shown()).toBe(0);
      expect(mounted.asked.enemies).toEqual(['s002']);
    });

    it('on a boss that stands in the way walks up to it and asks; once beaten, its tile is one to walk through', async () => {
      const blocked = mount();
      tap(blocked, { x: 4, y: 2 });
      await walked();
      expect(where(blocked)).toEqual({ x: 3, y: 2 });
      expect(blocked.asked.enemies).toEqual(['s003']);
      // Past the gate there is no way while it stands.
      tap(blocked, { x: 6, y: 2 });
      await walked();
      expect(where(blocked)).toEqual({ x: 3, y: 2 });

      const open = mount(game({ run: { bossesBeaten: ['e003'] } }));
      tap(open, { x: 6, y: 2 });
      await walked();
      expect(where(open)).toEqual({ x: 6, y: 2 });
      expect(open.asked.enemies).toEqual([]);
    });

    it('on a wall, or outside the map, does nothing', async () => {
      const mounted = mount();
      tap(mounted, { x: 4, y: 4 });
      tap(mounted, { x: 0, y: 0 });
      tap(mounted, { x: 4, y: -1 });
      tap(mounted, { x: 4, y: 10 });
      await walked();
      expect(where(mounted)).toEqual({ x: 2, y: 2 });
      expect(mounted.shown()).toBe(0);
      expect(mounted.asked).toEqual({ enemies: [], sites: 0, doors: [], toasts: [] });
    });

    it('on the tile the hero stands on does nothing', async () => {
      const mounted = mount();
      tap(mounted, { x: 2, y: 2 });
      await walked();
      expect(mounted.shown()).toBe(0);
    });

    it('on a hidden tile nobody has found does nothing, and says nothing: it must not give the way away', async () => {
      const unfound = game({ profile: { secretsFound: ['x02'] }, run: { position: at(3, 5) } });
      const mounted = mount(unfound);
      tap(mounted, { x: 4, y: 5 });
      // Nor does a tap on the stash behind it, which can only be reached through the hidden tile.
      tap(mounted, { x: 5, y: 5 });
      await walked();
      expect(where(mounted)).toEqual({ x: 3, y: 5 });
      expect(mounted.shown()).toBe(0);
      expect(mounted.asked.toasts).toEqual([]);
    });

    it('on a hidden tile that has been found walks onto it like any other', async () => {
      const mounted = mount(game({ run: { position: at(3, 5) } }));
      tap(mounted, { x: 4, y: 5 });
      await walked();
      expect(where(mounted)).toEqual({ x: 4, y: 5 });
      // The stash beside it was collected earlier this run, so nothing more happens.
      expect(mounted.asked.toasts).toEqual([]);
      expect(mounted.controller.dirty).toBe(true);
    });

    it('that brings the hero beside a stash collects it, once, and that is written at once', async () => {
      const mounted = mount(game({ run: { position: at(3, 5), stashesCollected: [] } }));
      tap(mounted, { x: 4, y: 5 });
      await vi.waitFor(() => expect(mounted.controller.game.run.gold).toBe(77 + 40));
      expect(mounted.controller.game.run.stashesCollected).toEqual(['x02']);
      expect(mounted.asked.toasts).toHaveLength(1);
      expect(mounted.asked.toasts[0]).toContain('40 gold');
      expect(await storedGame()).toMatchObject({ run: { gold: 117, stashesCollected: ['x02'], position: at(4, 5) } });
      expect(mounted.controller.dirty).toBe(false);

      // Walking away and back does not pay again.
      tap(mounted, { x: 3, y: 5 });
      await walked();
      tap(mounted, { x: 4, y: 5 });
      await walked();
      expect(mounted.controller.game.run.gold).toBe(117);
      expect(mounted.asked.toasts).toHaveLength(1);
    });

    it('on the Salvage site walks onto it and opens Salvage', async () => {
      const mounted = mount();
      tap(mounted, { x: 2, y: 4 });
      await walked();
      expect(where(mounted)).toEqual({ x: 2, y: 4 });
      expect(mounted.asked.sites).toBe(1);
    });

    it('on a locked door says so and does not move; with its key the door is a tile to walk onto', async () => {
      const keyless = game({ profile: { items: { i001: 1, i002: 1, i003: 2, i005: 1 } }, run: { position: at(1, 5) } });
      const locked = mount(keyless);
      tap(locked, { x: 1, y: 7 });
      await walked();
      expect(where(locked)).toEqual({ x: 1, y: 5 });
      expect(locked.asked.doors).toEqual([{ x: 1, y: 7, key: 'i004', keyZone: 'z01' }]);
      // Nor is there a way to what lies behind it.
      tap(locked, { x: 1, y: 8 });
      await walked();
      expect(where(locked)).toEqual({ x: 1, y: 5 });

      const unlocked = mount(game({ run: { position: at(1, 5) } }));
      tap(unlocked, { x: 1, y: 8 });
      await walked();
      expect(where(unlocked)).toEqual({ x: 1, y: 8 });
      expect(unlocked.asked.doors).toEqual([]);
    });

    it('does nothing when tap to move is turned off', async () => {
      const mounted = mount(game(), { tapToMove: false });
      tap(mounted, { x: 1, y: 6 });
      tap(mounted, { x: 3, y: 1 });
      await walked();
      expect(where(mounted)).toEqual({ x: 2, y: 2 });
      expect(mounted.asked.enemies).toEqual([]);
    });

    it('does nothing once another screen has taken the place of the map', async () => {
      const mounted = mount();
      mounted.view.detach();
      tap(mounted, { x: 1, y: 6 });
      tap(mounted, { x: 3, y: 1 });
      await walked();
      expect(where(mounted)).toEqual({ x: 2, y: 2 });
      expect(mounted.asked.enemies).toEqual([]);
    });
  });

  describe('a press and drag', () => {
    it('steers the hero that way, a step at a time, until something is in the way, and writes nothing', async () => {
      const mounted = mount(game({ run: { position: at(2, 5) } }));
      const held = press(mounted, { x: 2, y: 5 }, 0, -30);
      await walked();
      // Up the screen from the run start: four open tiles, then the wall.
      expect(where(mounted)).toEqual({ x: 2, y: 1 });
      expect(mounted.shown()).toBe(4);
      expect(mounted.controller.dirty).toBe(true);
      expect((await dump(backend)).slots).toEqual({});
      // Letting go is not a tap: nothing more happens.
      mounted.canvas.fire('pointerup', held);
      await walked();
      expect(where(mounted)).toEqual({ x: 2, y: 1 });
      expect(mounted.asked).toEqual({ enemies: [], sites: 0, doors: [], toasts: [] });
    });

    it('can start anywhere on the map, not only on the hero', async () => {
      const mounted = mount(game({ run: { position: at(2, 5) } }));
      press(mounted, { x: 6, y: 8 }, -30, 0);
      await walked();
      expect(where(mounted)).toEqual({ x: 1, y: 5 });
    });

    it('that moves less than 14 points is still a tap', async () => {
      const mounted = mount();
      const held = press(mounted, { x: 2, y: 4 }, 9, -9);
      await walked();
      expect(where(mounted)).toEqual({ x: 2, y: 2 });
      mounted.canvas.fire('pointerup', held);
      await walked();
      expect(where(mounted)).toEqual({ x: 2, y: 4 });
      expect(mounted.asked.sites).toBe(1);
    });

    it('slides along a wall when the diagonal is shut', async () => {
      // Down and to the left from the top left corner: the wall on the left turns it into a walk straight down,
      // through the door, whose key the sample game holds, to the foot of the map.
      const mounted = mount(game({ run: { position: at(1, 1) } }));
      press(mounted, { x: 1, y: 1 }, -30, 30);
      await walked();
      expect(where(mounted)).toEqual({ x: 1, y: 8 });
    });

    it('takes a diagonal only when both tiles beside it are open, so no corner is cut', async () => {
      // Up and to the left from 3,4 is 2,3, which is open, but the way there would clip the corner of the enemy
      // on 3,3. The hero goes left first instead.
      const mounted = mount(game({ run: { position: at(3, 4) } }));
      press(mounted, { x: 3, y: 4 }, -30, -30);
      await walked();
      expect(mounted.trail[0]).toEqual({ x: 2, y: 4 });
      expect(mounted.trail[1]).toEqual({ x: 1, y: 3 });
      expect(stepByStep({ x: 3, y: 4 }, mounted.trail)).toBe(true);
      expect(mounted.asked.enemies).toEqual([]);
    });

    it('does not move at all when the diagonal and both of its straight parts are shut', async () => {
      // Up and to the right from 3,2 is a wall; straight right is the boss, and straight up is an enemy.
      const mounted = mount(game({ run: { position: at(3, 2) } }));
      press(mounted, { x: 3, y: 2 }, 30, -30);
      await walked();
      expect(where(mounted)).toEqual({ x: 3, y: 2 });
      expect(mounted.shown()).toBe(0);
    });

    it('that the browser cancels, or that leaves the canvas, is neither a tap nor a walk', async () => {
      for (const ending of ['pointercancel', 'pointerleave']) {
        const mounted = mount();
        mounted.canvas.fire('pointerdown', pageOf({ x: 1, y: 6 }));
        mounted.canvas.fire(ending);
        mounted.canvas.fire('pointerup', pageOf({ x: 1, y: 6 }));
        mounted.canvas.fire('pointermove', pageOf({ x: 5, y: 6 }));
        await walked();
        expect(where(mounted), ending).toEqual({ x: 2, y: 2 });
      }
    });

    it('straight into an enemy stops beside it and asks about the fight once, as a tap on it would', async () => {
      const mounted = mount(game({ run: { position: at(1, 3) } }));
      const held = press(mounted, { x: 1, y: 3 }, 30, 0);
      await walked();
      expect(where(mounted)).toEqual({ x: 2, y: 3 });
      expect(mounted.asked.enemies).toEqual(['s001']);
      // Holding on, and moving the finger again, does not ask a second time.
      mounted.canvas.fire('pointermove', { clientX: held.clientX + 10, clientY: held.clientY });
      await walked();
      expect(mounted.asked.enemies).toEqual(['s001']);
      expect(mounted.controller.game.run.battleCount).toBe(5);
      // A new press does.
      mounted.canvas.fire('pointerup', held);
      press(mounted, { x: 2, y: 3 }, 30, 0);
      await walked();
      expect(mounted.asked.enemies).toEqual(['s001', 's001']);
    });

    it('can walk onto a hidden tile, which is how one is found: that step is written at once, and so is the stash behind it', async () => {
      const unfound = game({ profile: { secretsFound: [] }, run: { position: at(2, 5), stashesCollected: [] } });
      const mounted = mount(unfound);
      press(mounted, { x: 2, y: 5 }, 30, 0);
      // Through what looked like a wall, onto the tile the stash is on, and up against the real wall beyond it.
      await vi.waitFor(() => expect(where(mounted)).toEqual({ x: 5, y: 5 }));
      expect(mounted.controller.game.profile.secretsFound).toEqual(['x01', 'x02']);
      expect(mounted.controller.game.run.gold).toBe(117);
      expect(mounted.asked.toasts.length).toBeGreaterThan(0);
      expect(await storedGame()).toMatchObject({ profile: { secretsFound: ['x01', 'x02'] }, run: { gold: 117, stashesCollected: ['x02'] } });
    });

    it('through an exit carries the hero into the next zone and stops there', async () => {
      const mounted = mount(game({ run: { position: at(5, 2), bossesBeaten: ['e003'] } }));
      press(mounted, { x: 5, y: 2 }, 30, 0);
      await walked();
      // The far side of the exit, and the press ended with the zone: the hero does not walk on into the enemy
      // that stands one tile further that way, nor ask about it.
      expect(mounted.controller.game.run.position).toEqual({ zone: 'z02', x: 1, y: 1 });
      expect(mounted.shown()).toBe(2);
      expect(mounted.asked.enemies).toEqual([]);
    });

    it('steers nothing when drag to steer is turned off', async () => {
      const mounted = mount(game({ run: { position: at(2, 5) } }), { dragToSteer: false });
      press(mounted, { x: 2, y: 5 }, 0, -30);
      await walked();
      expect(where(mounted)).toEqual({ x: 2, y: 5 });
      expect(mounted.shown()).toBe(0);
    });

    it('works beside tap to move with no switch between them', async () => {
      const mounted = mount();
      tap(mounted, { x: 1, y: 6 });
      await walked();
      const held = press(mounted, { x: 4, y: 4 }, 30, 0);
      await walked();
      mounted.canvas.fire('pointerup', held);
      expect(where(mounted)).toEqual({ x: 3, y: 6 });
      tap(mounted, { x: 2, y: 4 });
      await walked();
      expect(where(mounted)).toEqual({ x: 2, y: 4 });
      expect(mounted.asked.sites).toBe(1);
    });
  });

  // Found by the Phase 3b verifier through the real app: a walk in hand when something else took over.
  describe('a walk that is overtaken', () => {
    it('does not open its sheet over one the player opened in the meantime', async () => {
      // Far enough from the enemy that the walk takes several steps.
      const mounted = mount(game({ run: { position: at(1, 6) } }));
      tap(mounted, { x: 3, y: 3 });
      // The player opens another sheet (the new-run sheet, say) before the hero gets there.
      mounted.sheet.open = true;
      await walked();
      expect(mounted.asked.enemies).toEqual([]);
      // With the sheet closed again, a tap on the enemy asks as usual.
      mounted.sheet.open = false;
      tap(mounted, { x: 3, y: 3 });
      await walked();
      expect(mounted.asked.enemies).toEqual(['s001']);
    });

    it('is dropped when a new run moves the hero, and does not then ask about the fight it was walking to', async () => {
      const mounted = mount(game({ run: { position: at(1, 6) } }));
      // As in the app, the map is told of every change to the game.
      mounted.controller.subscribe(() => mounted.view.update());
      tap(mounted, { x: 3, y: 1 });
      // The player opens the new-run sheet while the hero is still walking, and confirms: the hero is back at
      // the run start. The sheet stops the walk, so no step computed for the old run lands in the new one.
      mounted.sheet.open = true;
      await walked();
      await mounted.controller.newRun();
      mounted.sheet.open = false;
      await walked();
      expect(mounted.controller.game.run.position).toEqual(CONTENT.start);
      expect(mounted.asked.enemies).toEqual([]);
      // The walk did not carry on from the run start towards where it had been going.
      const stepsAfter = mounted.trail.length;
      await walked();
      expect(mounted.trail.length).toBe(stepsAfter);
    });
  });
});
