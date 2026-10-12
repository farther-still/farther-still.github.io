// Rebuilds tests/refnames.hashes.json from the private reference material (ARCHITECTURE section 11). Local only:
// it needs reference/, which is gitignored, so CI never runs it. It reads every enemy, item and zone name from
// the three data files there and writes salted hashes of the normalized names. It never writes or prints a name.
//
//   npm run refnames:build

import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from './lib';
import { REFNAME_CANARY, hashNames, readRefNames } from './refnames';

const SOURCES = 'reference/_chatgpt_project_recap/linked_sources';
const OUTPUT = 'tests/refnames.hashes.json';

/** Comma-separated text as rows of cells: quoted cells, doubled quotes and line breaks inside quotes. */
export const parseCsv = (text: string): string[][] => {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < source.length; i += 1) {
    const ch = source.charAt(i);
    if (quoted) {
      if (ch !== '"') cell += ch;
      else if (source.charAt(i + 1) === '"') {
        cell += '"';
        i += 1;
      } else quoted = false;
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && source.charAt(i + 1) === '\n') i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
};

/** The rows under the header row, which is the first row with a `Name` cell, as lookups by column title. */
const records = (text: string): Array<Record<string, string>> | null => {
  const rows = parseCsv(text);
  const headerAt = rows.findIndex((row) => row.some((cell) => cell.trim() === 'Name'));
  const header = rows[headerAt];
  if (header === undefined) return null;
  return rows.slice(headerAt + 1).map((row) => {
    const record: Record<string, string> = {};
    header.forEach((title, column) => {
      record[title.trim()] = (row[column] ?? '').trim();
    });
    return record;
  });
};

export type ReferenceNames = {
  names: string[];
  /** How many names each source gave, before duplicates are dropped. Counts only: safe to print. */
  counts: { zones: number; enemies: number; drops: number; weapons: number; armor: number };
};

/**
 * Every name in the three data files. In the enemy file a row whose first cell is `Z` is a zone heading with the
 * zone's name in the name column; every other named row is an enemy, and its drop columns name items. The two
 * item files hold one item per named row. Null when a file has no header row.
 */
export const referenceNames = (csv: { enemies: string; weapons: string; armors: string }): ReferenceNames | null => {
  const enemies = records(csv.enemies);
  const weapons = records(csv.weapons);
  const armors = records(csv.armors);
  if (enemies === null || weapons === null || armors === null) return null;

  const names: string[] = [];
  const counts = { zones: 0, enemies: 0, drops: 0, weapons: 0, armor: 0 };
  const take = (name: string | undefined, source: keyof typeof counts): void => {
    if (name === undefined || name === '') return;
    names.push(name);
    counts[source] += 1;
  };
  for (const row of enemies) {
    if (row['Id'] === 'Z') {
      take(row['Name'], 'zones');
      continue;
    }
    take(row['Name'], 'enemies');
    for (const column of ['Drop1', 'Drop2', 'Drop3']) take(row[column], 'drops');
  }
  for (const row of weapons) take(row['Name'], 'weapons');
  for (const row of armors) take(row['Name'], 'armor');
  return { names, counts };
};

const main = (): void => {
  const folder = join(ROOT, SOURCES);
  if (!existsSync(folder)) {
    console.error(`build-refnames: ${SOURCES}/ is not here. This script runs only on the machine that holds the private reference material; ${OUTPUT} is left as it is.`);
    process.exitCode = 1;
    return;
  }
  const read = (file: string): string | null => (existsSync(join(folder, file)) ? readFileSync(join(folder, file), 'utf8') : null);
  const enemies = read('enemies.csv');
  const weapons = read('weapons.csv');
  const armors = read('armors.csv');
  if (enemies === null || weapons === null || armors === null) {
    console.error(`build-refnames: ${SOURCES}/ must hold enemies.csv, weapons.csv and armors.csv; ${OUTPUT} is left as it is.`);
    process.exitCode = 1;
    return;
  }
  const found = referenceNames({ enemies, weapons, armors });
  if (found === null) {
    console.error(`build-refnames: a data file has no header row with a Name column; ${OUTPUT} is left as it is.`);
    process.exitCode = 1;
    return;
  }

  // The salt is kept from one build to the next, so a rebuild with no new names writes the same file.
  const output = join(ROOT, OUTPUT);
  const previous = existsSync(output) ? readRefNames(readFileSync(output, 'utf8')) : null;
  const salt = previous?.salt ?? randomBytes(16).toString('hex');
  // The canary goes in with the names, so the test can tell that this salt and these hashes belong together.
  const hashes = hashNames(salt, [...found.names, REFNAME_CANARY]);
  writeFileSync(output, `${JSON.stringify({ salt, count: hashes.length, hashes }, null, 2)}\n`);

  const { zones, enemies: enemyCount, drops, weapons: weaponCount, armor } = found.counts;
  console.log(`build-refnames: ${hashes.length} hashes written to ${OUTPUT}: ${hashes.length - 1} distinct names and the canary`);
  console.log(`  read ${zones} zone, ${enemyCount} enemy, ${weaponCount} weapon and ${armor} armor or accessory names, and ${drops} drop entries`);
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
