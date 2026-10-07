/* Reading and writing data/characters.json (used by server.ts and scripts/). */
import { existsSync } from 'node:fs';
import { copyFile, readFile, rename, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { CharacterEntry, cleanEntry } from '../src/app/core/character.model.ts';

export const ROOT = resolve(import.meta.dirname, '..');
export const DATA_FILE = join(ROOT, 'data', 'characters.json');
export const BACKUP_FILE = join(ROOT, 'data', 'characters.backup.json');

export async function readCharacters(): Promise<CharacterEntry[]> {
  if (!existsSync(DATA_FILE)) return [];
  const list: unknown = JSON.parse(await readFile(DATA_FILE, 'utf8'));
  return Array.isArray(list) ? list.map(cleanEntry) : [];
}

/** Writes the list, keeping the previous version in characters.backup.json. */
export async function writeCharacters(list: CharacterEntry[]): Promise<void> {
  if (existsSync(DATA_FILE)) await copyFile(DATA_FILE, BACKUP_FILE);
  const tmp = DATA_FILE + '.tmp';
  await writeFile(tmp, JSON.stringify(list.map(cleanEntry), null, 2) + '\n');
  await rename(tmp, DATA_FILE);
}
