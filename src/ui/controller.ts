// The loop (ARCHITECTURE section 8): input becomes an action, `step` returns state and events, the writer
// commits, and only then is anyone told. Actions are handled one at a time, so input waits on a pending write.

import { repairRun, step } from '../engine';
import type { Action, Content, GameEvent, GameState, RejectReason } from '../engine';
import { encodeTextCode } from '../save';
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
};

// Phase 3a's stand-in for "a Step that only moves the hero": it changes state without a write of its own.
const isDeferred = (action: Action): boolean => action.type === 'Step';

export class GameController {
  private gameState: GameState;
  private appState: AppState;
  private unsaved = false;
  private stopped: Halt | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly deps: ControllerDeps,
    payload: SavePayload,
  ) {
    this.gameState = payload.game;
    this.appState = payload.app;
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

  dispatch(action: Action): Promise<Outcome> {
    return this.enqueue(async () => {
      if (this.stopped !== null) return { kind: 'halted' };
      const result = step(this.gameState, action, this.deps.content);
      if ('rejected' in result) return { kind: 'rejected', reason: result.rejected };
      if (isDeferred(action)) {
        this.gameState = result.state;
        this.unsaved = true;
        this.notify();
        return { kind: 'done', events: result.events, checkpoint: 'none', problems: [] };
      }
      const commit = await this.deps.writer.commit(
        { game: result.state, app: this.appState },
        { checkpoint: action.type === 'NewRun' },
      );
      if (!commit.ok) return this.stop(commit);
      this.gameState = result.state;
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
      const sameContent = record.contentVersion === this.deps.build.contentVersion;
      const game = sameContent ? record.payload.game : repairRun(record.payload.game, this.deps.content);
      const commit = await this.deps.writer.replaceWith({ game, app: record.payload.app });
      if (!commit.ok) return { outcome: this.stop(commit), repaired: false };
      this.gameState = game;
      this.appState = record.payload.app;
      this.unsaved = false;
      this.notify();
      return {
        outcome: { kind: 'done', events: [], checkpoint: 'none', problems: [] },
        repaired: game !== record.payload.game,
      };
    });
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
