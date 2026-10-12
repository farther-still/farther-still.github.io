// The map (GDD 8.2, 8.3): a top-down tile view on a canvas, the camera following the hero. Two controls are
// live at once, with no mode switch: a tap walks the hero to a tile or an enemy by the shortest known route, and
// a press-and-drag steers. Walking is an animation; the engine sees each move as one step to a neighbouring tile.
// Placeholder art: tiles are flat colours and enemies are one character each.

import { WALL_TILES, canStep, deriveHero, enemyAtSpawn, findPath, tileKey } from '../engine';
import type { DoorDef, GameEvent, Point, Position, SpawnId, ZoneMap } from '../engine';
import type { Session, ZoomLevel } from './session';

/**
 * Tiles across the screen at each zoom level. On a 402-point-wide phone, near makes a tile 44 points, the smallest
 * allowed tap target. Far makes it 28: the player gives up the full-size target to see and tap farther, on the map
 * alone, where a tap only walks (GDD 8.3, D-32).
 */
export const COLUMNS: Record<ZoomLevel, number> = { near: 9, far: 14 };
const MIN_TILE = 24;
/** A press that moves farther than this, in points, is steering; anything less is a tap. */
const DRAG_THRESHOLD = 14;

export type Viewport = { width: number; height: number; tile: number; originX: number; originY: number };

/**
 * Where the map sits on the canvas when the camera is centred on `focus` (in tiles; fractions while walking),
 * with `columns` tiles across it.
 */
export const viewportFor = (width: number, height: number, map: Pick<ZoneMap, 'width' | 'height'>, focus: Point, columns: number = COLUMNS.near): Viewport => {
  const tile = Math.max(MIN_TILE, Math.floor(width / columns));
  const along = (size: number, cells: number, at: number): number => {
    const span = cells * tile;
    if (span <= size) return Math.floor((size - span) / 2);
    return Math.round(Math.min(0, Math.max(size - span, size / 2 - (at + 0.5) * tile)));
  };
  return { width, height, tile, originX: along(width, map.width, focus.x), originY: along(height, map.height, focus.y) };
};

export const tileAtPoint = (view: Viewport, px: number, py: number): Point => ({
  x: Math.floor((px - view.originX) / view.tile),
  y: Math.floor((py - view.originY) / view.tile),
});

/** The centre of a tile, in canvas points. */
export const pointOfTile = (view: Viewport, x: number, y: number): Point => ({
  x: view.originX + (x + 0.5) * view.tile,
  y: view.originY + (y + 0.5) * view.tile,
});

/** A caption keeps this far, in points, from the side of the canvas. */
const CAPTION_MARGIN = 3;

/**
 * Where the middle of a caption goes, across the canvas. On its tile's centre, unless the words would then run
 * off a side: a caption is wider than its tile, so one on the outermost column would always be cut. It is pulled
 * in by as much as it needs while its tile is wholly on the canvas, and by less and less as the tile slides off,
 * so a caption never jumps and never outstays its tile.
 */
export const captionCentre = (tileCentre: number, textWidth: number, tile: number, width: number): number => {
  const half = textWidth / 2;
  if (half + CAPTION_MARGIN > width / 2) return tileCentre;
  const kept = Math.min(Math.max(tileCentre, half + CAPTION_MARGIN), width - half - CAPTION_MARGIN);
  const onCanvas = Math.min(width, tileCentre + tile / 2) - Math.max(0, tileCentre - tile / 2);
  return tileCentre + (kept - tileCentre) * Math.min(1, Math.max(0, onCanvas / tile));
};

/** The eight directions, from a drag vector. Null while the finger is still inside the dead zone. */
export const steerDirection = (dx: number, dy: number): { dx: number; dy: number } | null => {
  if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return null;
  const octant = Math.round(Math.atan2(dy, dx) / (Math.PI / 4));
  const table: ReadonlyArray<readonly [number, number]> = [
    [1, 0],
    [1, 1],
    [0, 1],
    [-1, 1],
    [-1, 0],
    [-1, -1],
    [0, -1],
    [1, -1],
  ];
  const [sx, sy] = table[((octant % 8) + 8) % 8] ?? [0, 0];
  return { dx: sx, dy: sy };
};

const FLOOR: Record<string, string> = {
  '.': '#7a735f',
  ',': '#41603d',
  ':': '#8f897a',
  ';': '#6b6a66',
  '"': '#4f7040',
  "'": '#58684a',
  '=': '#7d6245',
  _: '#77736a',
};
const WALL = '#232a36';
const BUILT_WALL = '#5d4a33';
const FOUND = '#6d6a52';

export type MapHooks = {
  onEnemy: (spawn: SpawnId) => void;
  onSite: () => void;
  onDoor: (door: DoorDef) => void;
};

type PointerLike = { clientX: number; clientY: number; pointerId?: number; preventDefault?: () => void };

export class MapView {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private shown: Point;
  private shownZone: string;
  private route: Point[] = [];
  private steer: { dx: number; dy: number } | null = null;
  private walking = false;
  private afterWalk: (() => void) | null = null;
  private press: { x: number; y: number; steering: boolean } | null = null;
  private bumped: SpawnId | null = null;
  private attached = false;
  /** Where the engine last had the hero, and in which run, to tell a step from a jump. */
  private engineAt: Position;
  private runKey: string;
  /** Goes up at every jump, so a glide that was under way does not finish by drawing the hero where it used to be. */
  private walkId = 0;

  constructor(
    private readonly session: Session,
    private readonly hooks: MapHooks,
    canvas: HTMLCanvasElement,
  ) {
    this.canvas = canvas;
    this.ctx = typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
    const position = session.controller.game.run.position;
    this.shown = { x: position.x, y: position.y };
    this.shownZone = position.zone;
    this.engineAt = position;
    this.runKey = `${session.controller.game.profile.counters.runsStarted}:${session.controller.game.run.seed}`;
    canvas.addEventListener('pointerdown', (event) => this.down(event));
    canvas.addEventListener('pointermove', (event) => this.move(event));
    canvas.addEventListener('pointerup', (event) => this.up(event));
    canvas.addEventListener('pointercancel', () => this.cancel());
    canvas.addEventListener('pointerleave', () => this.cancel());
  }

  /** Called when the map screen is put on screen, and again whenever the game state changes. */
  update(): void {
    this.attached = true;
    const { profile, run } = this.session.controller.game;
    const position = run.position;
    // A walk moves the hero one tile at a time within one run. Anything else is a jump: a new run, an import, a
    // zone change. Whatever walk was in hand belongs to where the hero was, so it is dropped, and the map
    // follows at once. The run is told apart by its number and seed, since a new run can start a tile away.
    const runKey = `${profile.counters.runsStarted}:${run.seed}`;
    const jumped = runKey !== this.runKey || position.zone !== this.engineAt.zone || Math.abs(position.x - this.engineAt.x) > 1 || Math.abs(position.y - this.engineAt.y) > 1;
    this.engineAt = position;
    this.runKey = runKey;
    if (jumped) {
      this.route = [];
      this.steer = null;
      this.afterWalk = null;
      this.walkId += 1;
    }
    if (jumped || !this.walking) {
      this.shown = { x: position.x, y: position.y };
      this.shownZone = position.zone;
    }
    this.draw();
  }

  /** Called when another screen takes over: whatever was in hand is dropped. */
  detach(): void {
    this.attached = false;
    this.cancel();
    this.route = [];
    this.afterWalk = null;
  }

  // ---- input ----

  private local(event: PointerLike): Point {
    const box = typeof this.canvas.getBoundingClientRect === 'function' ? this.canvas.getBoundingClientRect() : { left: 0, top: 0 };
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  }

  private size(): { width: number; height: number } {
    return { width: this.canvas.clientWidth || 396, height: this.canvas.clientHeight || 528 };
  }

  /** The one viewport that drawing and taps both go through, so a tap lands on the tile drawn under the finger at either zoom. */
  private view(): Viewport | null {
    const map = this.session.content.zones[this.shownZone]?.map;
    if (map === undefined) return null;
    const { width, height } = this.size();
    return viewportFor(width, height, map, this.shown, COLUMNS[this.session.zoom.level]);
  }

  private down(event: PointerLike): void {
    event.preventDefault?.();
    const at = this.local(event);
    this.press = { x: at.x, y: at.y, steering: false };
    this.bumped = null;
  }

  private move(event: PointerLike): void {
    if (this.press === null) return;
    if (!this.session.controller.app.settings.dragToSteer) return;
    const at = this.local(event);
    const direction = steerDirection(at.x - this.press.x, at.y - this.press.y);
    if (direction === null) return;
    this.press.steering = true;
    this.steer = direction;
    // Steering takes over from a tapped route.
    this.route = [];
    this.afterWalk = null;
    void this.walk();
  }

  private up(event: PointerLike): void {
    const press = this.press;
    this.press = null;
    this.steer = null;
    if (press === null || press.steering) return;
    if (!this.session.controller.app.settings.tapToMove) return;
    this.tap(this.local(event));
  }

  private cancel(): void {
    this.press = null;
    this.steer = null;
  }

  private tap(at: Point): void {
    const view = this.view();
    if (view === null) return;
    const { content, controller, shell } = this.session;
    const state = controller.game;
    const from = state.run.position;
    const tile = tileAtPoint(view, at.x, at.y);
    const key = tileKey(from.zone, tile.x, tile.y);

    const go = (path: Point[] | null, then: (() => void) | null): void => {
      if (path === null) {
        shell.toast('There is no way there.');
        return;
      }
      this.route = path;
      this.afterWalk = then;
      void this.walk();
    };

    const spawn = content.index.spawnAt[key];
    const enemy = spawn === undefined ? undefined : enemyAtSpawn(content, spawn);
    if (spawn !== undefined && enemy !== undefined && !(enemy.boss && state.run.bossesBeaten.includes(enemy.id))) {
      go(findPath(state, content, from, tile, { beside: true }), () => this.hooks.onEnemy(spawn));
      return;
    }
    const door = content.index.doorAt[key];
    if (door !== undefined && !canStepOnto(this.session, tile)) {
      this.hooks.onDoor(door);
      return;
    }
    if (content.index.siteAt[key] !== undefined) {
      go(findPath(state, content, from, tile), () => this.hooks.onSite());
      return;
    }
    if (tile.x === from.x && tile.y === from.y) return;
    const path = findPath(state, content, from, tile);
    // A tap on a wall or on a tile nobody knows to be open does nothing: it must not hint at a hidden path.
    if (path !== null) go(path, null);
  }

  // ---- walking ----

  private nextStep(): { dx: number; dy: number } | null {
    const { content, controller } = this.session;
    const state = controller.game;
    const here = state.run.position;
    const target = this.route[0];
    if (target !== undefined) {
      const dx = target.x - here.x;
      const dy = target.y - here.y;
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1 || !canStep(state, content, here, dx, dy, 'step')) {
        this.route = [];
        this.afterWalk = null;
        return null;
      }
      return { dx, dy };
    }
    const steer = this.steer;
    if (steer === null) return null;
    // Slide along walls: if the diagonal is shut, take whichever of its two straight parts is open.
    const tries: Array<{ dx: number; dy: number }> = steer.dx !== 0 && steer.dy !== 0 ? [steer, { dx: steer.dx, dy: 0 }, { dx: 0, dy: steer.dy }] : [steer];
    for (const option of tries) if (canStep(state, content, here, option.dx, option.dy, 'step')) return option;
    // Walking straight into an enemy asks about the fight, as tapping it would.
    const ahead = content.index.spawnAt[tileKey(here.zone, here.x + steer.dx, here.y + steer.dy)];
    const enemy = ahead === undefined ? undefined : enemyAtSpawn(content, ahead);
    if (ahead !== undefined && enemy !== undefined && this.bumped !== ahead && !(enemy.boss && state.run.bossesBeaten.includes(enemy.id))) {
      this.bumped = ahead;
      this.steer = null;
      this.press = null;
      this.afterWalk = () => this.hooks.onEnemy(ahead);
    }
    return null;
  }

  private async walk(): Promise<void> {
    if (this.walking) return;
    this.walking = true;
    const { controller, content, shell } = this.session;
    try {
      while (this.attached) {
        // A sheet over the map has the player's attention: the hero stands still under it. That also means no
        // step is in flight when a choice on the sheet, such as a new run, changes the game.
        if (shell.sheetOpen()) {
          this.route = [];
          this.steer = null;
          this.afterWalk = null;
          break;
        }
        const next = this.nextStep();
        if (next === null) break;
        const before: Position = controller.game.run.position;
        const outcome = await controller.dispatch({ type: 'Step', dx: next.dx, dy: next.dy });
        if (outcome.kind !== 'done') {
          this.route = [];
          this.afterWalk = null;
          break;
        }
        if (this.route.length > 0) this.route.shift();
        const after = controller.game.run.position;
        const changedZone = outcome.events.some((event: GameEvent) => event.type === 'ZoneEntered');
        const foundWay = outcome.events.some((event: GameEvent) => event.type === 'SecretFound');
        if (foundWay) shell.toast('That was not a wall. You found a way through.');
        if (changedZone) {
          this.route = [];
          this.steer = null;
          this.press = null;
          this.shown = { x: after.x, y: after.y };
          this.shownZone = after.zone;
          this.draw();
        } else {
          const speed = content.balance.map.tilesPerSecond * (1 + deriveHero(controller.game, content).moveSpeed / 100);
          await this.glide(before, after, 1000 / speed);
        }
        await this.collectStash(foundWay);
      }
    } finally {
      this.walking = false;
    }
    const then = this.afterWalk;
    this.afterWalk = null;
    // A sheet the player opened while the hero was still walking is not replaced by the one the walk was for.
    if (this.attached && !shell.sheetOpen()) then?.();
  }

  /** Picks up a stash the hero has walked up to. It pays once per run (GDD 7.8). */
  private async collectStash(foundWay: boolean): Promise<void> {
    const { content, controller, shell } = this.session;
    const { position, stashesCollected } = controller.game.run;
    for (const id of content.secretOrder) {
      const secret = content.secrets[id];
      if (secret === undefined || secret.kind !== 'stash' || secret.zone !== position.zone || stashesCollected.includes(id)) continue;
      if (Math.abs(secret.x - position.x) > 1 || Math.abs(secret.y - position.y) > 1) continue;
      const outcome = await controller.dispatch({ type: 'CollectStash', secret: id });
      // One line for both, when the step that found the way in also reached the stash: a second toast would replace the first unread.
      if (outcome.kind === 'done') shell.toast(`${foundWay ? 'That was not a wall. Behind it, a' : 'A'} stash: ${secret.gold} gold.`);
    }
  }

  private glide(from: Point, to: Point, ms: number): Promise<void> {
    const frame = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : null;
    if (frame === null || this.ctx === null) {
      this.shown = { x: to.x, y: to.y };
      this.draw();
      return Promise.resolve();
    }
    const walk = this.walkId;
    return new Promise((resolve) => {
      const start = performance.now();
      let arrived = false;
      // Frames only draw the steps in between. The walk itself is timed by a timer, because a browser stops
      // sending frames to a page it is not painting, and a walk must never wait on one that will not come.
      const tick = (now: number): void => {
        if (arrived || walk !== this.walkId) return;
        const part = Math.min(1, Math.max(0, (now - start) / ms));
        this.shown = { x: from.x + (to.x - from.x) * part, y: from.y + (to.y - from.y) * part };
        this.draw();
        frame(tick);
      };
      frame(tick);
      setTimeout(() => {
        arrived = true;
        if (walk === this.walkId) {
          this.shown = { x: to.x, y: to.y };
          this.draw();
        }
        resolve();
      }, ms);
    });
  }

  // ---- drawing ----

  private draw(): void {
    const ctx = this.ctx;
    const view = this.view();
    if (ctx === null || view === null) return;
    const { content, text, controller } = this.session;
    const state = controller.game;
    const zone = this.shownZone;
    const map = content.zones[zone]?.map;
    if (map === undefined) return;

    const ratio = typeof devicePixelRatio === 'number' ? devicePixelRatio : 1;
    const { width, height } = this.size();
    if (this.canvas.width !== Math.round(width * ratio) || this.canvas.height !== Math.round(height * ratio)) {
      this.canvas.width = Math.round(width * ratio);
      this.canvas.height = Math.round(height * ratio);
    }
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.fillStyle = WALL;
    ctx.fillRect(0, 0, width, height);

    const { tile } = view;
    const first = tileAtPoint(view, 0, 0);
    const last = tileAtPoint(view, width, height);
    const found = (key: string): boolean => {
      const secret = content.index.hiddenAt[key];
      return secret !== undefined && state.profile.secretsFound.includes(secret);
    };

    for (let y = Math.max(0, first.y); y <= Math.min(map.height - 1, last.y); y += 1) {
      for (let x = Math.max(0, first.x); x <= Math.min(map.width - 1, last.x); x += 1) {
        const char = (map.tiles[y] ?? '').charAt(x);
        const key = tileKey(zone, x, y);
        const left = view.originX + x * tile;
        const top = view.originY + y * tile;
        // A hidden tile looks like the wall it is drawn as until someone has stood on it.
        const open = found(key);
        if (!open && WALL_TILES.includes(char)) {
          if (char === '%') {
            ctx.fillStyle = BUILT_WALL;
            ctx.fillRect(left, top, tile, tile);
            ctx.strokeStyle = '#3d2f1f';
            ctx.lineWidth = 2;
            for (let bar = 1; bar < 4; bar += 1) {
              ctx.beginPath();
              ctx.moveTo(left + (bar * tile) / 4, top + 4);
              ctx.lineTo(left + (bar * tile) / 4, top + tile - 4);
              ctx.stroke();
            }
          }
          continue;
        }
        ctx.fillStyle = open ? FOUND : (FLOOR[char] ?? '#55604d');
        ctx.fillRect(left, top, tile, tile);
        if (char === ':') {
          ctx.strokeStyle = 'rgba(0, 0, 0, 0.25)';
          ctx.lineWidth = 1;
          for (let tread = 1; tread < 4; tread += 1) {
            ctx.beginPath();
            ctx.moveTo(left + 3, top + (tread * tile) / 4);
            ctx.lineTo(left + tile - 3, top + (tread * tile) / 4);
            ctx.stroke();
          }
        }
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.12)';
        ctx.lineWidth = 1;
        ctx.strokeRect(left + 0.5, top + 0.5, tile - 1, tile - 1);
      }
    }

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const glyph = (symbol: string, x: number, y: number, scale: number): void => {
      const at = pointOfTile(view, x, y);
      ctx.font = `${Math.round(tile * scale)}px system-ui, -apple-system, sans-serif`;
      ctx.fillStyle = '#f4f1e8';
      ctx.fillText(symbol, at.x, at.y);
    };
    const caption = (words: string, x: number, y: number, colour: string, above: boolean): void => {
      const at = pointOfTile(view, x, y);
      ctx.font = `600 ${Math.max(10, Math.round(tile * 0.26))}px system-ui, -apple-system, sans-serif`;
      const at_x = captionCentre(at.x, ctx.measureText(words).width, tile, width);
      const at_y = at.y + (above ? -tile * 0.42 : tile * 0.4);
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(10, 12, 16, 0.85)';
      ctx.strokeText(words, at_x, at_y);
      ctx.fillStyle = colour;
      ctx.fillText(words, at_x, at_y);
    };

    for (const exit of map.exits) glyph('⇧', exit.x, exit.y, 0.6);
    for (const door of map.doors) glyph(door.key !== null && (state.profile.items[door.key] ?? 0) > 0 ? '▯' : door.key === null ? '✕' : '▮', door.x, door.y, 0.6);
    for (const site of map.salvageSites) {
      glyph('♻', site.x, site.y, 0.62);
      caption(text.line('site.salvage') || 'Salvage', site.x, site.y, '#e9d9a8', false);
    }
    for (const id of content.secretOrder) {
      const secret = content.secrets[id];
      if (secret === undefined || secret.kind !== 'stash' || secret.zone !== zone) continue;
      const hidden = content.index.hiddenAt[tileKey(zone, secret.x, secret.y)];
      const visible = hidden === undefined ? true : state.profile.secretsFound.includes(hidden);
      if (visible && !state.run.stashesCollected.includes(id)) glyph('◆', secret.x, secret.y, 0.5);
    }
    for (const place of map.places) caption(text.place(place.key), place.x, place.y, '#cfd6df', true);

    for (const id of content.spawnOrder) {
      const spawn = content.spawns[id];
      const enemy = spawn === undefined ? undefined : enemyAtSpawn(content, id);
      if (spawn === undefined || enemy === undefined || spawn.zone !== zone) continue;
      if (enemy.boss && state.run.bossesBeaten.includes(enemy.id)) continue;
      const at = pointOfTile(view, spawn.x, spawn.y);
      if (enemy.boss) {
        ctx.beginPath();
        ctx.arc(at.x, at.y, tile * 0.46, 0, Math.PI * 2);
        ctx.strokeStyle = '#e9a23b';
        ctx.lineWidth = 3;
        ctx.stroke();
      }
      glyph(text.glyph(enemy.id), spawn.x, spawn.y, 0.62);
      caption(`${enemy.boss ? 'Boss ' : ''}Lv ${enemy.level}`, spawn.x, spawn.y, enemy.boss ? '#ffd27a' : '#f4f1e8', false);
      if (state.run.marks[id] !== undefined) {
        ctx.beginPath();
        ctx.arc(at.x + tile * 0.32, at.y - tile * 0.32, tile * 0.14, 0, Math.PI * 2);
        ctx.fillStyle = '#62d0ff';
        ctx.fill();
        ctx.strokeStyle = '#0b2533';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }

    ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
    for (const step of this.route) {
      const at = pointOfTile(view, step.x, step.y);
      ctx.beginPath();
      ctx.arc(at.x, at.y, Math.max(2, tile * 0.07), 0, Math.PI * 2);
      ctx.fill();
    }

    const hero = pointOfTile(view, this.shown.x, this.shown.y);
    ctx.beginPath();
    ctx.arc(hero.x, hero.y, tile * 0.3, 0, Math.PI * 2);
    ctx.fillStyle = '#f6c453';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#1a1408';
    ctx.stroke();
  }
}

const canStepOnto = (session: Session, tile: Point): boolean => {
  const { content, controller } = session;
  const state = controller.game;
  const door = content.index.doorAt[tileKey(state.run.position.zone, tile.x, tile.y)];
  return door !== undefined && door.key !== null && (state.profile.items[door.key] ?? 0) > 0;
};
