/* CC-CEDICT word dictionary (https://cc-cedict.org, CC BY-SA 4.0).
 * Downloaded once from MDBG into .cache/ (delete that folder to get a newer version),
 * then kept in memory to look up words. */
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { ROOT } from './data-files.ts';

const CEDICT_URL = 'https://www.mdbg.net/chinese/export/cedict/cedict_1_0_ts_utf-8_mdbg.txt.gz';
const CACHE_FILE = join(ROOT, '.cache', 'cedict_ts.u8.gz');

export interface CedictEntry {
  traditional: string;
  simplified: string;
  /** Numbered pinyin, e.g. "ma1 ma5" */
  pinyin: string;
  definitions: string[];
}

export interface LookupResult {
  /** Entries for the whole word. */
  exact: CedictEntry[];
  /** The word split into dictionary words (longest match first), when it has more than one character. */
  parts: { text: string; entries: CedictEntry[] }[];
}

const LONGEST_WORD = 8;
let index: Promise<Map<string, CedictEntry[]>> | null = null;

async function download(): Promise<Buffer> {
  if (!existsSync(CACHE_FILE)) {
    console.log('Downloading CC-CEDICT (about 4 MB, only once)…');
    const response = await fetch(CEDICT_URL);
    if (!response.ok) throw new Error(`CC-CEDICT download failed: HTTP ${response.status}`);
    await mkdir(join(ROOT, '.cache'), { recursive: true });
    await writeFile(CACHE_FILE, Buffer.from(await response.arrayBuffer()));
  }
  return readFile(CACHE_FILE);
}

/** Line format: 傳統 传统 [chuan2 tong3] /tradition/traditional/ */
function parse(text: string): Map<string, CedictEntry[]> {
  const map = new Map<string, CedictEntry[]>();
  const add = (key: string, entry: CedictEntry) => {
    const list = map.get(key);
    if (list) list.push(entry);
    else map.set(key, [entry]);
  };
  for (const line of text.split('\n')) {
    if (line.startsWith('#')) continue;
    const m = line.match(/^(\S+) (\S+) \[([^\]]*)\] \/(.*)\/\s*$/);
    if (!m) continue;
    const entry: CedictEntry = {
      traditional: m[1],
      simplified: m[2],
      pinyin: m[3],
      definitions: m[4].split('/').filter(Boolean),
    };
    add(entry.simplified, entry);
    if (entry.traditional !== entry.simplified) add(entry.traditional, entry);
  }
  return map;
}

/** Starts loading the dictionary (called when the server starts). */
export function loadCedict(): Promise<Map<string, CedictEntry[]>> {
  if (!index) {
    index = download().then((gz) => parse(gunzipSync(gz).toString('utf8')));
    index.then(
      (map) => console.log(`CC-CEDICT ready (${map.size} words)`),
      (err) => {
        console.error(err instanceof Error ? err.message : err);
        index = null; // try again on the next lookup
      },
    );
  }
  return index;
}

export async function lookupWord(word: string): Promise<LookupResult> {
  const dict = await loadCedict();
  const chars = [...word];
  const parts: LookupResult['parts'] = [];
  if (chars.length > 1) {
    for (let i = 0; i < chars.length;) {
      let len = Math.min(LONGEST_WORD, chars.length - i);
      while (len > 1 && !dict.has(chars.slice(i, i + len).join(''))) len--;
      const text = chars.slice(i, i + len).join('');
      parts.push({ text, entries: dict.get(text) ?? [] });
      i += len;
    }
  }
  return { exact: dict.get(word) ?? [], parts };
}
