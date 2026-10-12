// A stand-in for the few parts of the DOM the UI uses, so the app's startup, play and recovery wiring can be
// driven in tests without a browser. It is not a DOM: it holds a tree, text, a `hidden` flag, listeners that are
// handed a plain event object, and a box that a test can set, since nothing here lays anything out.

import { vi } from 'vitest';

type Node = FakeElement | string;

/** What a listener is handed. Pointer listeners read the coordinates; everything else ignores it. */
export type FakeEvent = { type: string; clientX: number; clientY: number; pointerId: number; preventDefault: () => void };

type Listener = (event: FakeEvent) => void;

/** Where a pointer event lands, in page coordinates, as a browser reports them. */
export type FakePoint = { clientX: number; clientY: number };

const eventOf = (type: string, at: FakePoint = { clientX: 0, clientY: 0 }): FakeEvent => ({
  type,
  clientX: at.clientX,
  clientY: at.clientY,
  pointerId: 1,
  preventDefault: () => undefined,
});

export class FakeElement {
  readonly children: Node[] = [];
  readonly attributes: Record<string, string> = {};
  className = '';
  hidden = false;
  disabled = false;
  value = '';
  scrollTop = 0;
  /** Where the element sits on the page and how big it is. All zero until a test says otherwise. */
  box = { left: 0, top: 0, width: 0, height: 0 };
  private ownText = '';
  private readonly listeners = new Map<string, Listener[]>();

  constructor(readonly tagName: string) {}

  get textContent(): string {
    return this.ownText + this.children.map((child) => (typeof child === 'string' ? child : child.textContent)).join('');
  }

  set textContent(value: string) {
    this.ownText = value;
    this.children.length = 0;
  }

  get clientWidth(): number {
    return this.box.width;
  }

  get clientHeight(): number {
    return this.box.height;
  }

  getBoundingClientRect(): { left: number; top: number; right: number; bottom: number; width: number; height: number } {
    const { left, top, width, height } = this.box;
    return { left, top, right: left + width, bottom: top + height, width, height };
  }

  setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
  }

  append(...nodes: Node[]): void {
    this.children.push(...nodes);
  }

  replaceChildren(...nodes: Node[]): void {
    this.ownText = '';
    this.children.length = 0;
    this.children.push(...nodes);
  }

  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  /** Fires an event at this element, such as `fire('pointerdown', { clientX, clientY })`. Nothing bubbles. */
  fire(type: string, at?: FakePoint): void {
    for (const listener of this.listeners.get(type) ?? []) listener(eventOf(type, at));
  }

  click(): void {
    if (this.disabled) return;
    this.fire('click');
  }

  remove(): void {}
  focus(): void {}
  select(): void {}

  /** This element and everything under it that is not inside a hidden element. */
  shown(): FakeElement[] {
    if (this.hidden) return [];
    return [this, ...this.children.flatMap((child) => (typeof child === 'string' ? [] : child.shown()))];
  }
}

/** A canvas with nothing to draw on: the map takes its input from it and skips the drawing. */
export class FakeCanvas extends FakeElement {
  width = 0;
  height = 0;

  getContext(): null {
    return null;
  }
}

export type FakeDom = {
  root: HTMLElement;
  /** The labels of every button on screen, in order. */
  buttons: () => string[];
  /**
   * Taps the first button whose label is, or matches, `label`. Throws if there is none. Where several buttons
   * carry one label, `nth` picks among them, counting from 0 in the order they are on screen.
   */
  tap: (label: string | RegExp, nth?: number) => void;
  /** All text on screen, each element's text separated by " | ". */
  text: () => string;
  /** What each text box on screen holds, in order. A file picker is not a text box. */
  fields: () => string[];
  /** Types into a text box on screen, replacing what it held: the first, or the `nth` counting from 0. */
  fill: (value: string, nth?: number) => void;
  /** The map's canvas, or null while no canvas is on screen. */
  canvas: () => FakeCanvas | null;
  reloads: () => number;
  /** Fires a listener registered on `window` or `document`, such as `pagehide` or `resize`. */
  fire: (type: string) => void;
  /** Sends the page to the background or brings it back, as `document.visibilityState` and its event report it. */
  setVisibility: (state: 'visible' | 'hidden') => void;
  /** How many listeners `window` and `document` hold for an event. Two games would each have registered one. */
  listenerCount: (type: string) => number;
};

export const installFakeDom = (): FakeDom => {
  const root = new FakeElement('div');
  const listeners = new Map<string, Listener[]>();
  const listen = (type: string, listener: Listener): void => {
    listeners.set(type, [...(listeners.get(type) ?? []), listener]);
  };
  const fire = (type: string): void => {
    for (const listener of listeners.get(type) ?? []) listener(eventOf(type));
  };
  let reloads = 0;

  const page = {
    createElement: (tag: string) => (tag === 'canvas' ? new FakeCanvas(tag) : new FakeElement(tag)),
    addEventListener: listen,
    visibilityState: 'visible',
    body: new FakeElement('body'),
  };
  vi.stubGlobal('document', page);
  vi.stubGlobal('window', {
    addEventListener: listen,
    setTimeout: (run: () => void, ms: number) => setTimeout(run, ms),
    clearTimeout: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
    matchMedia: () => ({ matches: false }),
    navigator: {},
    location: {
      reload: () => {
        reloads += 1;
      },
    },
  });

  const buttons = (): FakeElement[] => root.shown().filter((element) => element.tagName === 'button');
  const textBoxes = (): FakeElement[] =>
    root.shown().filter((element) => element.tagName === 'textarea' || (element.tagName === 'input' && element.attributes['type'] !== 'file'));
  return {
    root: root as unknown as HTMLElement,
    buttons: () => buttons().map((button) => button.textContent),
    tap: (label, nth = 0) => {
      const found = buttons().filter((button) => (typeof label === 'string' ? button.textContent === label : label.test(button.textContent)))[nth];
      if (found === undefined) {
        throw new Error(`no button ${String(label)}${nth === 0 ? '' : ` number ${nth + 1}`} among: ${buttons().map((button) => button.textContent).join(' | ')}`);
      }
      found.click();
    },
    text: () =>
      root
        .shown()
        .filter((element) => element.children.every((child) => typeof child === 'string'))
        .map((element) => element.textContent)
        .filter((text) => text !== '')
        .join(' | '),
    fields: () => textBoxes().map((element) => element.value),
    fill: (value, nth = 0) => {
      const box = textBoxes()[nth];
      if (box === undefined) throw new Error(`no text box number ${nth + 1} on screen: there are ${textBoxes().length}`);
      box.value = value;
    },
    canvas: () => root.shown().find((element): element is FakeCanvas => element instanceof FakeCanvas) ?? null,
    reloads: () => reloads,
    fire,
    setVisibility: (state) => {
      page.visibilityState = state;
      fire('visibilitychange');
    },
    listenerCount: (type) => (listeners.get(type) ?? []).length,
  };
};
