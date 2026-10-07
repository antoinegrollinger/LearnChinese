/* Reading and writing the JSON lists in data/ (used by server.ts and scripts/). */
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { CharacterEntry, cleanEntry } from '../src/app/core/character.model.ts';
import { WordEntry, cleanWord } from '../src/app/core/word.model.ts';

/** Project root: the folder with package.json (works from server/ and from the bundled dist/server/). */
function findRoot(start: string): string {
  let dir = start;
  while (!existsSync(join(dir, 'package.json'))) {
    const parent = dirname(dir);
    if (parent === dir) return resolve(start, '..');
    dir = parent;
  }
  return dir;
}

export const ROOT = findRoot(import.meta.dirname);

/** The data/ folder in the project: your lists as committed in git. */
const BUNDLED_DATA_DIR = join(ROOT, 'data');

/**
 * Where the lists are read and written. Set DATA_DIR on a server so your changes survive
 * redeploys; it starts as a copy of the project's data/ folder.
 */
export const DATA_DIR = process.env['DATA_DIR']
  ? resolve(process.env['DATA_DIR'])
  : BUNDLED_DATA_DIR;

export interface ListFile<T> {
  /** data/<name>.json */
  name: string;
  /** Field that identifies an item (no duplicates). */
  key: keyof T & string;
  clean: (raw: unknown) => T;
}

export const CHARACTERS: ListFile<CharacterEntry> = {
  name: 'characters',
  key: 'character',
  clean: cleanEntry,
};

export const WORDS: ListFile<WordEntry> = { name: 'words', key: 'word', clean: cleanWord };

const pathOf = (list: { name: string }, suffix = '', dir = DATA_DIR) =>
  join(dir, `${list.name}${suffix}.json`);

export async function readList<T>(list: ListFile<T>): Promise<T[]> {
  const file = pathOf(list);
  if (!existsSync(file)) {
    // First run with DATA_DIR: start from the project's copy.
    const bundled = pathOf(list, '', BUNDLED_DATA_DIR);
    if (DATA_DIR === BUNDLED_DATA_DIR || !existsSync(bundled)) return [];
    await mkdir(DATA_DIR, { recursive: true });
    await copyFile(bundled, file);
  }
  const items: unknown = JSON.parse(await readFile(file, 'utf8'));
  return Array.isArray(items) ? items.map(list.clean) : [];
}

/** Writes the list, keeping the previous version in data/<name>.backup.json. */
export async function writeList<T>(list: ListFile<T>, items: T[]): Promise<void> {
  const file = pathOf(list);
  await mkdir(DATA_DIR, { recursive: true });
  if (existsSync(file)) await copyFile(file, pathOf(list, '.backup'));
  const tmp = file + '.tmp';
  await writeFile(tmp, JSON.stringify(items.map(list.clean), null, 2) + '\n');
  await rename(tmp, file);
}

export const readCharacters = () => readList(CHARACTERS);
export const writeCharacters = (items: CharacterEntry[]) => writeList(CHARACTERS, items);
