/* Reading and writing the JSON lists in data/ (used by server.ts and scripts/). */
import { existsSync } from 'node:fs';
import { copyFile, readFile, rename, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { CharacterEntry, cleanEntry } from '../src/app/core/character.model.ts';
import { WordEntry, cleanWord } from '../src/app/core/word.model.ts';

export const ROOT = resolve(import.meta.dirname, '..');

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

const pathOf = (list: { name: string }, suffix = '') =>
  join(ROOT, 'data', `${list.name}${suffix}.json`);

export async function readList<T>(list: ListFile<T>): Promise<T[]> {
  const file = pathOf(list);
  if (!existsSync(file)) return [];
  const items: unknown = JSON.parse(await readFile(file, 'utf8'));
  return Array.isArray(items) ? items.map(list.clean) : [];
}

/** Writes the list, keeping the previous version in data/<name>.backup.json. */
export async function writeList<T>(list: ListFile<T>, items: T[]): Promise<void> {
  const file = pathOf(list);
  if (existsSync(file)) await copyFile(file, pathOf(list, '.backup'));
  const tmp = file + '.tmp';
  await writeFile(tmp, JSON.stringify(items.map(list.clean), null, 2) + '\n');
  await rename(tmp, file);
}

export const readCharacters = () => readList(CHARACTERS);
export const writeCharacters = (items: CharacterEntry[]) => writeList(CHARACTERS, items);
