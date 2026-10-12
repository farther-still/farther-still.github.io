// Shared by the check scripts: git plumbing and a common way to report.

import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export const git = (...args: string[]): string =>
  execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });

/** Null when git cannot answer, for example because the path did not exist in that commit. */
export const gitOrNull = (...args: string[]): string | null => {
  try {
    return git(...args);
  } catch {
    return null;
  }
};

export const trackedFiles = (): string[] =>
  git('ls-files', '-z')
    .split('\0')
    .filter((name) => name !== '');

/** Prints the findings and sets the exit code. Findings name files, lines and IDs only, never content. */
export const report = (name: string, problems: readonly string[]): void => {
  if (problems.length === 0) {
    console.log(`${name}: ok`);
    return;
  }
  console.error(`${name}: ${problems.length} problem(s)`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exitCode = 1;
};
