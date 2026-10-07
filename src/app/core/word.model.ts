/** Shared by the Angular app and server/server.ts. */

/** A word or expression you are learning (stored in data/words.json). */
export interface WordEntry {
  /** The word in Chinese characters, e.g. 妈妈 */
  word: string;
  /** "ma1ma5" or "māma" */
  pinyin?: string;
  meaning?: string;
  notes?: string;
}

const text = (v: unknown): string => (v == null ? '' : String(v).trim());

/** Keeps only known fields, trims text and drops empty values. */
export function cleanWord(raw: unknown): WordEntry {
  const r = (raw ?? {}) as Record<string, unknown>;
  const entry: WordEntry = { word: text(r['word']).replace(/\s+/g, '') };
  for (const key of ['pinyin', 'meaning', 'notes'] as const) {
    if (text(r[key])) entry[key] = text(r[key]);
  }
  return entry;
}
