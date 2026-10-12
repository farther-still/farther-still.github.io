import { describe, expect, it } from 'vitest';
import { loadBundledContent, parseContent } from './index';

describe('content', () => {
  it('loads the file that ships with the build', () => {
    const content = loadBundledContent();
    expect(content.items.length).toBeGreaterThan(0);
    expect(new Set(content.items).size).toBe(content.items.length);
  });

  it('accepts a well-formed file', () => {
    expect(parseContent({ items: ['d01', 'd02'] })).toEqual({ items: ['d01', 'd02'] });
  });

  it.each([
    ['an ID listed twice', { items: ['d01', 'd01'] }],
    ['an ID in the wrong form', { items: ['item-1'] }],
    ['an empty list', { items: [] }],
    ['an unknown field', { items: ['d01'], extra: true }],
    ['a missing list', {}],
    ['something that is not an object', 'items'],
  ])('refuses %s', (_name, raw) => {
    expect(() => parseContent(raw)).toThrow();
  });
});
