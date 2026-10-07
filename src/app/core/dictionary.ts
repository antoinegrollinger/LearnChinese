import { CharacterEntry, CharacterPart, Role, Word } from './character.model';
import { stripTones, toneOf } from './pinyin';

/* Dictionary used for pinyin search and auto-fill. Pure functions (no Angular), also used by scripts/.
 *  - Make Me a Hanzi: pinyin, definition, type, semantic / phonetic parts, stroke → part mapping.
 *  - Jun Da's character frequency list: to rank results (most common first).
 *  - Complete HSK vocabulary: example words, ranked by frequency.
 */
export const DICTIONARY_URL =
  'https://cdn.jsdelivr.net/gh/skishore/makemeahanzi@master/dictionary.txt';
export const FREQUENCY_URL =
  'https://cdn.jsdelivr.net/npm/hanzi@3.2.0/lib/data/frequencyjunda.txt.js';
export const WORDS_URL =
  'https://cdn.jsdelivr.net/gh/drkameleon/complete-hsk-vocabulary@main/complete.min.json';

const TYPE_FROM_ETYMOLOGY: Record<string, string> = {
  pictographic: 'pictogram',
  ideographic: 'ideogram',
  pictophonetic: 'phonosemantic',
};

/** One line of Make Me a Hanzi's dictionary.txt */
export interface DictionaryEntry {
  character: string;
  definition?: string;
  pinyin: string[];
  decomposition?: string;
  etymology?: { type?: string; hint?: string; semantic?: string; phonetic?: string };
  matches?: (number[] | null)[];
  // Added when loading
  rank: number;
  readings: { base: string; tone: number }[];
}

export interface HskWord {
  s?: string;
  q?: number;
  f?: { i?: { n?: string }; m?: string[] }[];
}

interface ExampleWord {
  hanzi: string;
  pinyin: string;
  meaning: string;
  rank: number;
}

export interface Dictionary {
  entries: DictionaryEntry[];
  byCharacter: Map<string, DictionaryEntry>;
  words: ExampleWord[];
}

const HANZI = /[\u3400-\u9fff\uf900-\ufaff]/;

/** "nǚ" / "nv3" / "nü" → "nu" */
function syllableBase(text: string): string {
  return stripTones(text.toLowerCase().replace(/v|u:/g, 'u')).replace(/[^a-z]/g, '');
}

export const shortDefinition = (def?: string): string => (def ?? '').split(/[;,]/)[0].trim();

export function buildDictionary(dict: string, freq: string, hsk: HskWord[]): Dictionary {
  const rank = new Map<string, number>();
  for (const line of freq.split('\n')) {
    const [n, ch] = line.split('\t');
    if (ch && !rank.has(ch)) rank.set(ch, parseInt(n, 10));
  }
  const entries: DictionaryEntry[] = [];
  const byCharacter = new Map<string, DictionaryEntry>();
  for (const line of dict.split('\n')) {
    if (!line.trim()) continue;
    const e = JSON.parse(line) as DictionaryEntry;
    e.pinyin ??= [];
    e.rank = rank.get(e.character) ?? 1e6;
    e.readings = e.pinyin.map((p) => ({ base: syllableBase(p), tone: toneOf(p) }));
    byCharacter.set(e.character, e);
    if (e.readings.length) entries.push(e);
  }
  entries.sort((a, b) => a.rank - b.rank);

  const words = hsk
    .filter((w) => w.s && [...w.s].length > 1 && w.f?.[0])
    .map((w) => ({
      hanzi: w.s!,
      pinyin: (w.f![0].i?.n ?? '').replace(/\s+/g, ''),
      meaning: (w.f![0].m ?? []).slice(0, 2).join('; '),
      rank: w.q || 1e9,
    }))
    .sort((a, b) => a.rank - b.rank);
  return { entries, byCharacter, words };
}

/** Exact syllable matches first, then syllables starting with the input; most frequent first. */
export function searchDictionary(dict: Dictionary, input: string, limit = 60): DictionaryEntry[] {
  const q = parseQuery(input);
  if (q.characters) {
    return q.characters.map((c) => dict.byCharacter.get(c)).filter((e) => !!e);
  }
  if (!q.base) return [];
  const exact: DictionaryEntry[] = [];
  const prefix: DictionaryEntry[] = [];
  const toneOk = (r: { tone: number }) => q.tone == null || r.tone === q.tone;
  for (const e of dict.entries) {
    if (e.readings.some((r) => r.base === q.base && toneOk(r))) exact.push(e);
    else if (e.readings.some((r) => r.base.startsWith(q.base!) && toneOk(r))) prefix.push(e);
    if (exact.length >= limit) break;
  }
  return exact.concat(prefix).slice(0, limit);
}

/** Builds an entry in the data/characters.json format from a dictionary entry. */
export function entryFromDictionary(
  dict: Dictionary,
  entry: DictionaryEntry,
  query = '',
): CharacterEntry {
  const ety = entry.etymology ?? {};
  const result: CharacterEntry = {
    character: entry.character,
    pinyin: matchingReading(entry, query),
    meaning: entry.definition ?? '',
    type: TYPE_FROM_ETYMOLOGY[ety.type ?? ''] ?? '',
  };

  const tree = parseIDS(entry.decomposition ?? '');
  if (typeof tree !== 'string' && ety.type !== 'pictographic') {
    const matches = entry.matches ?? [];
    const parts = tree.children
      .map((child, j) => {
        const chars = leaves(child);
        const strokes = matches.map((m, i) => (m && m[0] === j ? i : -1)).filter((i) => i >= 0);
        const contains = (c?: string) =>
          !!c && (chars === c || (chars.includes(c) && [...chars].length > 1));
        let role: Role = ety.type === 'ideographic' ? 'meaning' : 'other';
        if (contains(ety.semantic)) role = 'meaning';
        if (contains(ety.phonetic)) role = 'sound';
        // A nested part (e.g. "日月") is replaced by the semantic or phonetic character it contains.
        let character = chars;
        if ([...chars].length > 1) {
          if (role === 'sound' && ety.phonetic) character = ety.phonetic;
          else if (role === 'meaning' && ety.semantic) character = ety.semantic;
        }
        return { character, role, strokes };
      })
      .filter((k) => !k.character.includes('？'));

    // Writing order: by each part's first stroke (这: 文 before 辶).
    parts.sort((a, b) => (a.strokes[0] ?? 99) - (b.strokes[0] ?? 99));

    // Stroke numbers are only written when automatic assignment would not work.
    const allMatched = matches.every((m) => m && m[0] != null);
    let t = 0;
    const sequential =
      allMatched && parts.every((k) => k.strokes.every((i) => i === t++)) && t === matches.length;
    const simple = parts.every((k) => [...k.character].length === 1);

    const components = parts.map((k) => {
      const sub = dict.byCharacter.get(k.character);
      const part: CharacterPart = { character: k.character, role: k.role };
      if (sub?.pinyin[0]) part.pinyin = sub.pinyin[0];
      if (sub?.definition) part.meaning = shortDefinition(sub.definition);
      if (!(sequential && simple) && k.strokes.length) {
        part.strokes = toRanges(k.strokes.map((i) => i + 1));
      }
      return part;
    });
    if (components.length) result.components = components;
  }

  const words = wordsWith(dict, entry.character);
  if (words.length) result.words = words;
  // For phono-semantic characters the hint only repeats the semantic part's meaning.
  if (ety.hint && ety.type !== 'pictophonetic') result.notes = ety.hint;
  return result;
}

/** Parses the search box: "ma", "ma1", "mā", "nv3", or Chinese characters. */
function parseQuery(input: string): { characters?: string[]; base?: string; tone?: number | null } {
  const s = input.trim().toLowerCase();
  if (HANZI.test(s)) return { characters: [...s].filter((c) => HANZI.test(c)) };
  const digit = s.match(/[0-5]/);
  let tone: number | null = null;
  if (digit) tone = Number(digit[0]) % 5 || 5;
  else if (toneOf(s) !== 5) tone = toneOf(s);
  return { base: syllableBase(s), tone };
}

/** The reading matching the search (for characters with several pronunciations). */
function matchingReading(entry: DictionaryEntry, input: string): string {
  const q = parseQuery(input);
  const i = entry.readings.findIndex(
    (r) => r.base === q.base && (q.tone == null || r.tone === q.tone),
  );
  return entry.pinyin[Math.max(0, i)] ?? '';
}

/** The most frequent HSK words containing the character (short words first). */
function wordsWith(dict: Dictionary, character: string, limit = 3): Word[] {
  const matching = dict.words.filter((w) => w.hanzi.includes(character));
  const short = matching.filter((w) => [...w.hanzi].length <= 3);
  const long = matching.filter((w) => [...w.hanzi].length > 3);
  return short
    .concat(long)
    .slice(0, limit)
    .map((w) => [w.hanzi, w.pinyin, w.meaning]);
}

// ---------- Decomposition (Ideographic Description Sequences) ----------
type IdsNode = string | { op: string; children: IdsNode[] };

const IDC_BINARY = /[\u2FF0\u2FF1\u2FF4-\u2FFB]/;
const IDC_TERNARY = /[\u2FF2\u2FF3]/;

/** "⿰氵⿱一口" → { op: "⿰", children: ["氵", { op: "⿱", children: ["一", "口"] }] } */
function parseIDS(text: string): IdsNode {
  const chars = [...text];
  let i = 0;
  const node = (): IdsNode => {
    const c = chars[i++];
    if (c === undefined) return '？';
    const n = IDC_TERNARY.test(c) ? 3 : IDC_BINARY.test(c) ? 2 : 0;
    if (!n) return c;
    const children: IdsNode[] = [];
    for (let k = 0; k < n; k++) children.push(node());
    return { op: c, children };
  };
  return node();
}

const leaves = (n: IdsNode): string =>
  typeof n === 'string' ? n : n.children.map(leaves).join('');

/** [1,2,3,8] → "1-3,8" */
function toRanges(numbers: number[]): string {
  const res: string[] = [];
  for (let i = 0; i < numbers.length; i++) {
    let j = i;
    while (j + 1 < numbers.length && numbers[j + 1] === numbers[j] + 1) j++;
    res.push(j > i ? `${numbers[i]}-${numbers[j]}` : `${numbers[i]}`);
    i = j;
  }
  return res.join(',');
}
