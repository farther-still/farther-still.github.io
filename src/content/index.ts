// Turns `data/` into the engine's Content. Phase 3a has one file, `data/dummy.json`: the fake item list.

import { z } from 'zod';
import dummy from '../../data/dummy.json';
import type { Content } from '../engine';

// No run-time code generation: the built page's content security policy forbids it (see src/save/schema.ts).
z.config({ jitless: true });

const dummySchema = z.strictObject({
  items: z.array(z.string().regex(/^d\d{2}$/)).min(1),
});

/** Throws with the schema's own message when a file does not fit. The app stops and logs it (ARCHITECTURE 6). */
export const parseContent = (raw: unknown): Content => {
  const parsed = dummySchema.parse(raw);
  if (new Set(parsed.items).size !== parsed.items.length) throw new Error('content: an item ID is listed twice');
  return { items: parsed.items };
};

export const loadBundledContent = (): Content => parseContent(dummy);
