// A stand-in for the few parts of the DOM the UI uses, so the app's startup and recovery wiring can be driven in
// tests without a browser. It is not a DOM: it holds a tree, text, a `hidden` flag and click listeners.

import { vi } from 'vitest';

type Node = FakeElement | string;

export class FakeElement {
  readonly children: Node[] = [];
  readonly attributes: Record<string, string> = {};
  className = '';
  hidden = false;
  disabled = false;
  value = '';
  scrollTop = 0;
  private ownText = '';
  private readonly listeners = new Map<string, Array<() => void>>();

  constructor(readonly tagName: string) {}

  get textContent(): string {
    return this.ownText + this.children.map((child) => (typeof child === 'string' ? child : child.textContent)).join('');
  }

  set textContent(value: string) {
    this.ownText = value;
    this.children.length = 0;
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

  addEventListener(type: string, listener: () => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  click(): void {
    if (this.disabled) return;
    for (const listener of this.listeners.get('click') ?? []) listener();
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

export type FakeDom = {
  root: HTMLElement;
  /** The labels of every button on screen, in order. */
  buttons: () => string[];
  /** Taps the first button whose label is, or matches, `label`. Throws if there is none. */
  tap: (label: string | RegExp) => void;
  /** All text on screen, each element's text separated by " | ". */
  text: () => string;
  reloads: () => number;
  /** Fires a listener registered on `window` or `document`, such as `pagehide`. */
  fire: (type: string) => void;
};

export const installFakeDom = (): FakeDom => {
  const root = new FakeElement('div');
  const listeners = new Map<string, Array<() => void>>();
  const listen = (type: string, listener: () => void): void => {
    listeners.set(type, [...(listeners.get(type) ?? []), listener]);
  };
  let reloads = 0;

  vi.stubGlobal('document', {
    createElement: (tag: string) => new FakeElement(tag),
    addEventListener: listen,
    visibilityState: 'visible',
    body: new FakeElement('body'),
  });
  vi.stubGlobal('window', {
    addEventListener: listen,
    setTimeout: (fire: () => void, ms: number) => setTimeout(fire, ms),
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
  return {
    root: root as unknown as HTMLElement,
    buttons: () => buttons().map((button) => button.textContent),
    tap: (label) => {
      const found = buttons().find((button) => (typeof label === 'string' ? button.textContent === label : label.test(button.textContent)));
      if (found === undefined) throw new Error(`no button ${String(label)} among: ${buttons().map((button) => button.textContent).join(' | ')}`);
      found.click();
    },
    text: () =>
      root
        .shown()
        .filter((element) => element.children.every((child) => typeof child === 'string'))
        .map((element) => element.textContent)
        .filter((text) => text !== '')
        .join(' | '),
    reloads: () => reloads,
    fire: (type) => {
      for (const listener of listeners.get(type) ?? []) listener();
    },
  };
};
