// The short-page check (ARCHITECTURE A-32): what the page is told about the screen, and when that means the
// installed app has been handed a page that ends above the bottom of the screen.

import { describe, expect, it } from 'vitest';
import { bandBelow, readScreen } from './device';
import type { ScreenReading } from './device';

// Michael's iPhone 16 Pro on 2026-10-12, read off his screenshots: a screen 874 points high, a page of 812, the
// status bar's 62 as the top inset and the home bar's 34 as the bottom one.
const SHORT: ScreenReading = { standalone: true, portrait: true, screenHeight: 874, pageHeight: 812, insetTop: 62, insetBottom: 34 };

describe('bandBelow', () => {
  it('is true for the page the phone was handed: short of the screen by exactly the top inset', () => {
    expect(bandBelow(SHORT)).toBe(true);
    // A point either way is rounding, not a different fault.
    expect(bandBelow({ ...SHORT, pageHeight: 811 })).toBe(true);
    expect(bandBelow({ ...SHORT, pageHeight: 813 })).toBe(true);
  });

  it('is false for a page that fills the screen, which is what the installed app is meant to get', () => {
    expect(bandBelow({ ...SHORT, pageHeight: 874 })).toBe(false);
  });

  it('is false for a page pushed down below an opaque status bar: it reports no top inset, and it reaches the home bar', () => {
    expect(bandBelow({ ...SHORT, insetTop: 0 })).toBe(false);
  });

  it('is false in a browser tab, whose page is short because of the browser itself', () => {
    expect(bandBelow({ ...SHORT, standalone: false })).toBe(false);
    expect(bandBelow({ standalone: false, portrait: true, screenHeight: 874, pageHeight: 740, insetTop: 0, insetBottom: 0 })).toBe(false);
  });

  it('is false on its side, where the screen is still measured upright', () => {
    expect(bandBelow({ ...SHORT, portrait: false, pageHeight: 402 })).toBe(false);
    expect(bandBelow({ ...SHORT, portrait: false })).toBe(false);
  });

  it('is false when the page is short by some other amount, such as while a keyboard is up', () => {
    expect(bandBelow({ ...SHORT, pageHeight: 744 })).toBe(false);
    expect(bandBelow({ ...SHORT, pageHeight: 815 })).toBe(false);
    expect(bandBelow({ ...SHORT, pageHeight: 538 })).toBe(false);
  });

  it('is false when the band would not hold the home bar, so the room above it is still needed', () => {
    expect(bandBelow({ ...SHORT, screenHeight: 832, insetTop: 20, insetBottom: 34 })).toBe(false);
  });

  it('is false when nothing is reported at all', () => {
    expect(bandBelow({ standalone: false, portrait: true, screenHeight: 0, pageHeight: 0, insetTop: 0, insetBottom: 0 })).toBe(false);
    expect(bandBelow({ standalone: true, portrait: true, screenHeight: 0, pageHeight: 0, insetTop: 0, insetBottom: 0 })).toBe(false);
  });
});

describe('readScreen', () => {
  const windowOf = (extra: Record<string, unknown>, standalone = true): Window => ({ matchMedia: () => ({ matches: standalone }), navigator: {}, ...extra }) as unknown as Window;
  const probe = {} as Element;

  it('reads the screen, the page and the two insets, the insets from the padding of the probe', () => {
    const win = windowOf({
      innerHeight: 812,
      innerWidth: 402,
      screen: { height: 874 },
      getComputedStyle: (of: Element) => (of === probe ? { paddingTop: '62px', paddingBottom: '34px' } : {}),
    });
    expect(readScreen(win, probe)).toEqual(SHORT);
  });

  it('rounds to whole points', () => {
    const win = windowOf({ innerHeight: 811.6, innerWidth: 402, screen: { height: 874 }, getComputedStyle: () => ({ paddingTop: '61.667px', paddingBottom: '34px' }) });
    expect(readScreen(win, probe)).toMatchObject({ pageHeight: 812, insetTop: 62, insetBottom: 34 });
  });

  it('calls a page wider than it is high not upright', () => {
    const win = windowOf({ innerHeight: 402, innerWidth: 874, screen: { height: 874 }, getComputedStyle: () => ({ paddingTop: '0px', paddingBottom: '21px' }) });
    expect(readScreen(win, probe).portrait).toBe(false);
  });

  it('reads 0 for whatever is not reported, and that is never a short page', () => {
    const bare = readScreen(windowOf({}), null);
    expect(bare).toEqual({ standalone: true, portrait: true, screenHeight: 0, pageHeight: 0, insetTop: 0, insetBottom: 0 });
    expect(bandBelow(bare)).toBe(false);
    // Insets a browser reports as something other than a length.
    const odd = readScreen(windowOf({ innerHeight: 812, innerWidth: 402, screen: { height: 874 }, getComputedStyle: () => ({ paddingTop: '', paddingBottom: 'auto' }) }), probe);
    expect(odd).toMatchObject({ insetTop: 0, insetBottom: 0 });
    expect(bandBelow(odd)).toBe(false);
  });

  it('says whether it is the installed app, by either sign', () => {
    expect(readScreen(windowOf({}, false), null).standalone).toBe(false);
    expect(readScreen({ matchMedia: () => ({ matches: false }), navigator: { standalone: true } } as unknown as Window, null).standalone).toBe(true);
  });
});
