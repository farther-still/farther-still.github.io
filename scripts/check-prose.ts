// Fails on hard-wrapped markdown: one line per paragraph or bullet (CLAUDE.md conventions). Reports file and
// line number only, so it is safe to run over sealed files. docs/KICKOFF.md is stored verbatim and is excluded.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, report, trackedFiles } from './lib';

const EXCLUDED = new Set(['docs/KICKOFF.md']);

// A line that starts a block of its own, so it may directly follow another line without being a wrapped one.
const STARTS_BLOCK = /^\s*(#{1,6}\s|[-*+]\s|\d+[.)]\s|>|\||```|~~~|<|---+\s*$|\*\*\*+\s*$|___+\s*$|\[[^\]]+\]:\s)/;
const IS_TABLE = /^\s*\|/;
const IS_QUOTE_TEXT = /^\s*>\s*[^\s>|#*+\d-]/;

/** The 1-based numbers of lines that continue the paragraph or bullet above them. */
export const hardWrappedLines = (text: string): number[] => {
  const found: number[] = [];
  let inFence = false;
  let inFrontMatter = false;
  let previous = '';
  const lines = text.split(/\r?\n/);
  lines.forEach((line, index) => {
    if (index === 0 && line.trim() === '---') {
      inFrontMatter = true;
      previous = '';
      return;
    }
    if (inFrontMatter) {
      if (line.trim() === '---') inFrontMatter = false;
      previous = '';
      return;
    }
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      previous = '';
      return;
    }
    if (inFence) return;
    const blank = line.trim() === '';
    const previousIsText = previous.trim() !== '' && !IS_TABLE.test(previous) && !/^\s*#{1,6}\s/.test(previous) && !/^\s*</.test(previous);
    // Two quote lines in a row with text on both are one quoted paragraph, wrapped.
    const quoteContinues = IS_QUOTE_TEXT.test(line) && IS_QUOTE_TEXT.test(previous);
    if (!blank && ((previousIsText && !STARTS_BLOCK.test(line)) || quoteContinues)) found.push(index + 1);
    previous = line;
  });
  return found;
};

const main = (): void => {
  const problems: string[] = [];
  for (const file of trackedFiles()) {
    if (!file.endsWith('.md') || EXCLUDED.has(file)) continue;
    let text: string;
    try {
      text = readFileSync(join(ROOT, file), 'utf8');
    } catch {
      continue; // Tracked but deleted in the working tree.
    }
    for (const line of hardWrappedLines(text)) problems.push(`${file}:${line} continues the line above (hard wrap)`);
  }
  report('check-prose', problems);
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
