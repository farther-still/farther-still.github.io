// The loop (ARCHITECTURE section 8): input becomes an action, `step` returns state and events, the writer
// commits, and only then is anyone told. Actions are handled one at a time, so input waits on a pending write.

import { level, repairRun, step } from '../engine';
import type { Action, Content, GameEvent, GameState, RejectReason } from '../engine';
import { RUN_LOG_LIMIT, encodeTextCode } from '../save';
import type { AppState, BuildInfo, CheckpointOutcome, CommitResult, SavePayload, SaveWriter, SlotRecord } from '../save';

export type Halt =
  /** The state failed its checks before a write. `code` is the last good save, if there is one. */
  | { kind: 'engine-bug'; detail: string; code: string | null }
  /** Storage refused the write twice. `code` is the game as it stands, unsaved. */
  | { kind: 'save-failed'; detail: string; code: string };

export type Outcome =
  | { kind: 'done'; events: GameEvent[]; checkpoint: CheckpointOutcome; problems: string[] }
  | { kind: 'rejected'; reason: RejectReason }
  | { kind: 'halted' };

export type ControllerDeps = {
  content: Content;
  writer: SaveWriter;
  build: BuildInfo;
  /** A fresh run seed from the browser's random source. The engine never draws its own (GDD 2.5). */
  randomSeed: () => number;
  /** The clock, for the run-duration log only. No game rule reads it (hard rule 3). */
  now: () => number;
};

/** A gap between two actions longer than this is the player being away, and is not counted as play. */
const IDLE_CAP_MS = 60_000;

// A step that only moved the hero is not written at once: the position goes out with the next write, or when
// the app is hidden (ARCHITECTURE 7.2). A step that found something is written like any other action.
const onlyMoved = (events: readonly GameEvent[]): boolean => events.every((event) => event.type === 'Moved' || event.type === 'ZoneEntered');

export class GameController {
  private gameState: GameState;
  private appState: AppState;
  private unsaved = false;
  private stopped: Halt | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  private lastTouch: number;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly deps: ControllerDeps,
    payload: SavePayload,
  ) {
    this.gameState = payload.game;
    this.appState = payload.app;
    this.lastTouch = deps.now();
  }

  get game(): GameState {
    return this.gameState;
  }

  get app(): AppState {
    return this.appState;
  }

  /** True while a move-only step has not yet gone out with a write. */
  get dirty(): boolean {
    return this.unsaved;
  }

  get halt(): Halt | null {
    return this.stopped;
  }

  /** The newest record known to be in the hot slot. */
  get lastSaved(): SlotRecord | null {
    return this.deps.writer.lastGood;
  }

  /** Listeners are told after a commit, never before it: save before show. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** The player has come back to the app: time away is not play. */
  resume(): void {
    this.lastTouch = this.deps.now();
  }

  dispatch(action: Action): Promise<Outcome> {
    return this.enqueue(async () => {
      if (this.stopped !== null) return { kind: 'halted' };
      const result = step(this.gameState, action, this.deps.content);
      if ('rejected' in result) return { kind: 'rejected', reason: result.rejected };
      const app = action.type === 'NewRun' ? this.closeRun(this.timed()) : this.timed();
      if (action.type === 'Step' && onlyMoved(result.events)) {
        this.gameState = result.state;
        this.appState = app;
        this.unsaved = true;
        this.notify();
        return { kind: 'done', events: result.events, checkpoint: 'none', problems: [] };
      }
      const commit = await this.deps.writer.commit({ game: result.state, app }, { checkpoint: action.type === 'NewRun' });
      if (!commit.ok) return this.stop(commit);
      this.gameState = result.state;
      this.appState = app;
      this.unsaved = false;
      this.notify();
      return { kind: 'done', events: result.events, checkpoint: commit.checkpoint, problems: commit.problems };
    });
  }

  newRun(): Promise<Outcome> {
    return this.dispatch({ type: 'NewRun', seed: this.deps.randomSeed() });
  }

  /** Any change to the `app` half is written at once, like an accepted action. */
  updateApp(change: (app: AppState) => AppState): Promise<Outcome> {
    return this.enqueue(async () => {
      if (this.stopped !== null) return { kind: 'halted' };
      const next = change(this.appState);
      const commit = await this.deps.writer.commit({ game: this.gameState, app: next });
      if (!commit.ok) return this.stop(commit);
      this.appState = next;
      this.unsaved = false;
      this.notify();
      return { kind: 'done', events: [], checkpoint: 'none', problems: [] };
    });
  }

  /** Called when the page is hidden: writes the hot slot if anything is unsaved. */
  flush(): Promise<Outcome> {
    return this.enqueue(async () => {
      if (this.stopped !== null) return { kind: 'halted' };
      if (!this.unsaved) return { kind: 'done', events: [], checkpoint: 'none', problems: [] };
      const commit = await this.deps.writer.commit({ game: this.gameState, app: this.appState });
      if (!commit.ok) return this.stop(commit);
      this.unsaved = false;
      this.notify();
      return { kind: 'done', events: [], checkpoint: 'none', problems: [] };
    });
  }

  /** Swaps in an imported or restored record. Returns whether its run needed repair for this build's content. */
  replaceWith(record: SlotRecord): Promise<{ outcome: Outcome; repaired: boolean }> {
    return this.enqueue(async () => {
      if (this.stopped !== null) return { outcome: { kind: 'halted' }, repaired: false };
      // Always checked, whatever content the record says it was written with: it costs nothing when the run fits.
      const game = repairRun(record.payload.game, this.deps.content);
      const commit = await this.deps.writer.replaceWith({ game, app: record.payload.app });
      if (!commit.ok) return { outcome: this.stop(commit), repaired: false };
      this.gameState = game;
      this.appState = record.payload.app;
      this.unsaved = false;
      this.lastTouch = this.deps.now();
      this.notify();
      return {
        outcome: { kind: 'done', events: [], checkpoint: 'none', problems: [] },
        repaired: game !== record.payload.game,
      };
    });
  }

  /** The `app` half with the time since the last action added to the run in progress. */
  private timed(): AppState {
    const now = this.deps.now();
    const played = Math.min(IDLE_CAP_MS, Math.max(0, now - this.lastTouch));
    this.lastTouch = now;
    const { runTiming } = this.appState;
    return { ...this.appState, runTiming: { ...runTiming, activeMs: runTiming.activeMs + Math.floor(played) } };
  }

  /** Files the finished run in the run-duration log and starts timing the next one. */
  private closeRun(app: AppState): AppState {
    const now = this.deps.now();
    const { profile, run } = this.gameState;
    const entry = {
      run: profile.counters.runsStarted,
      startedAt: app.runTiming.startedAt,
      endedAt: now,
      activeMs: app.runTiming.activeMs,
      wins: run.tallies.wins,
      losses: run.tallies.losses,
      level: level(this.gameState, this.deps.content.balance),
      strongest: run.strongestBeaten,
    };
    return { ...app, runTiming: { startedAt: now, activeMs: 0 }, runLog: [...app.runLog, entry].slice(-RUN_LOG_LIMIT) };
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = this.chain.then(task, task);
    this.chain = result.catch(() => undefined);
    return result;
  }

  private stop(commit: Extract<CommitResult, { ok: false }>): Outcome {
    this.stopped =
      commit.reason === 'invalid-state'
        ? {
            kind: 'engine-bug',
            detail: commit.detail,
            code: commit.lastGood === null ? null : encodeTextCode(commit.lastGood),
          }
        : { kind: 'save-failed', detail: commit.detail, code: encodeTextCode(commit.unsaved) };
    this.notify();
    return { kind: 'halted' };
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}
