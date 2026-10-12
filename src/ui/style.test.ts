// The style sheet's part of the short-page workaround (ARCHITECTURE A-32). The app leaves word on the page's root
// element; these check that the style sheet listens for it, and that no rule keeps clear of the home bar by a
// route the workaround cannot reach.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const CSS = readFileSync(join(import.meta.dirname, 'style.css'), 'utf8');

/** The body of the one rule with this selector. */
const rule = (selector: string): string => {
  const start = CSS.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`style.css has no rule for ${selector}`);
  return CSS.slice(start, CSS.indexOf('}', start));
};

describe('the style sheet and the home bar', () => {
  it('names the room kept clear above the home bar once, as --safe-bottom', () => {
    expect(rule(':root')).toContain('--safe-bottom: env(safe-area-inset-bottom, 0px);');
  });

  it('lifts that room when the app says the page stops short of the screen', () => {
    expect(rule("html[data-band-below='yes']")).toContain('--safe-bottom: 0px;');
  });

  it('uses the bottom inset itself only there and in the probe a script reads it from', () => {
    expect(rule('.inset-probe')).toContain('padding-bottom: env(safe-area-inset-bottom);');
    expect(rule('.inset-probe')).toContain('padding-top: env(safe-area-inset-top);');
    expect(CSS.split('env(safe-area-inset-bottom').length - 1).toBe(2);
  });

  it('keeps every bottom edge clear through --safe-bottom: the screen, the tab bar, a sheet and the toast', () => {
    for (const selector of ['.screen', '.tabbar', '.sheet', '.toast']) {
      expect(rule(selector), selector).toContain('var(--safe-bottom)');
    }
  });
});
