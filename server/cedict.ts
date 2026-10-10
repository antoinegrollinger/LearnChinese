/* CC-CEDICT word dictionary (https://cc-cedict.org, CC BY-SA 4.0).
 * Downloaded once from MDBG into .cache/ (delete that folder to get a newer version),
 * then kept in memory to look up words. */
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { stripTones, toneOf } from '../src/app/core/pinyin.ts';
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

// ---------- Search by pinyin ----------

/** One dictionary entry with its pinyin as letters only ("nihao", ü as v) and its tones ("33"). */
interface PinyinKey {
  letters: string;
  tones: string;
  entry: CedictEntry;
}

let pinyinIndex: Promise<PinyinKey[]> | null = null;

/** Letters of numbered pinyin, lower case, without spaces or tones: "Ni3 hao3" → "nihao". */
const lettersOf = (pinyin: string): string =>
  pinyin
    .toLowerCase()
    .replace(/u:|ü/g, 'v')
    .replace(/[^a-z]/g, '');

/** Every entry once, sorted by its letters (for prefix search). */
function buildPinyinIndex(dict: Map<string, CedictEntry[]>): PinyinKey[] {
  const seen = new Set<CedictEntry>();
  const keys: PinyinKey[] = [];
  for (const entries of dict.values()) {
    for (const entry of entries) {
      if (seen.has(entry)) continue;
      seen.add(entry);
      const letters = lettersOf(entry.pinyin);
      if (!letters) continue;
      keys.push({ letters, tones: entry.pinyin.replace(/[^1-5]/g, ''), entry });
    }
  }
  return keys.sort((a, b) => (a.letters < b.letters ? -1 : a.letters > b.letters ? 1 : 0));
}

/**
 * The query as letters and the tones it gives (digits or tone marks, in order):
 * "nǐ hǎo" → nihao + "33", "ni3hao3" → nihao + "33", "nihao" → nihao + "".
 */
function parsePinyinQuery(query: string): { letters: string; tones: string } {
  const text = query.trim();
  let tones = '';
  for (const syllable of text.split(/(?<=[0-5])|\s+/)) {
    const digit = /[0-5]$/.exec(syllable)?.[0];
    if (digit) tones += digit === '0' ? '5' : digit;
    else {
      const tone = toneOf(syllable);
      if (tone < 5) tones += tone;
    }
  }
  return { letters: lettersOf(stripTones(text.replace(/ü|v/gi, 'v'))), tones };
}

/**
 * Dictionary words whose pinyin is the query (then those starting with it); with tones in the
 * query, only the words with these tones. Exact matches first, then shorter words; names
 * (capitalised pinyin) after the common words.
 */
export async function searchPinyin(query: string, limit = 60): Promise<CedictEntry[]> {
  pinyinIndex ??= loadCedict().then(buildPinyinIndex);
  const index = await pinyinIndex;
  const q = parsePinyinQuery(query);
  if (q.letters.length < 2 && !q.tones) return [];
  // First key not before the query (binary search), then every key starting with it.
  let lo = 0;
  let hi = index.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (index[mid].letters < q.letters) lo = mid + 1;
    else hi = mid;
  }
  const found: PinyinKey[] = [];
  for (let i = lo; i < index.length && index[i].letters.startsWith(q.letters); i++) {
    if (index[i].tones.startsWith(q.tones)) found.push(index[i]);
    if (found.length >= 5000) break;
  }
  const isName = (k: PinyinKey) => /^[A-Z]/.test(k.entry.pinyin);
  return found
    .sort(
      (a, b) =>
        Number(a.letters !== q.letters) - Number(b.letters !== q.letters) ||
        Number(isName(a)) - Number(isName(b)) ||
        [...a.entry.simplified].length - [...b.entry.simplified].length ||
        a.letters.length - b.letters.length,
    )
    .reduce<CedictEntry[]>((list, { entry }) => {
      // The same simplified word and pinyin (several traditional forms): one entry, all meanings.
      const same = list.find((e) => e.simplified === entry.simplified && e.pinyin === entry.pinyin);
      if (same) same.definitions = [...new Set([...same.definitions, ...entry.definitions])];
      else if (list.length < limit) list.push({ ...entry, definitions: [...entry.definitions] });
      return list;
    }, []);
}
