/** Shared by the Angular app and server/server.ts. */

export type Role = 'meaning' | 'sound' | 'other';

/** One part of a character (e.g. 女 in 妈). */
export interface CharacterPart {
  character: string;
  role: Role;
  pinyin?: string;
  meaning?: string;
  /** Stroke numbers of this part, counting from 1 ("1-3", "4,5,8"). Optional. */
  strokes?: string;
}

/** [hanzi, pinyin, translation] */
export type Word = [string, string?, string?];

export interface CharacterEntry {
  character: string;
  /** "ma1" or "mā" */
  pinyin?: string;
  meaning?: string;
  /** Key of TYPES in config.ts */
  type?: string;
  /** In writing order */
  components?: CharacterPart[];
  words?: Word[];
  notes?: string;
}

const ROLES: Role[] = ['meaning', 'sound', 'other'];

const text = (v: unknown): string => (v == null ? '' : String(v).trim());

/** Keeps only known fields, trims text and drops empty values. */
export function cleanEntry(raw: unknown): CharacterEntry {
  const r = (raw ?? {}) as Record<string, unknown>;
  const entry: CharacterEntry = { character: text(r['character']) };
  for (const key of ['pinyin', 'meaning', 'type', 'notes'] as const) {
    if (text(r[key])) entry[key] = text(r[key]);
  }

  const components = (Array.isArray(r['components']) ? r['components'] : [])
    .map((k: Record<string, unknown>): CharacterPart => {
      const role = text(k?.['role']) as Role;
      const part: CharacterPart = {
        character: text(k?.['character']),
        role: ROLES.includes(role) ? role : 'other',
      };
      for (const key of ['pinyin', 'meaning', 'strokes'] as const) {
        if (text(k?.[key])) part[key] = text(k[key]);
      }
      return part;
    })
    .filter((k) => k.character);
  if (components.length) entry.components = components;

  const words = (Array.isArray(r['words']) ? r['words'] : [])
    .map((w: unknown) => {
      const parts = (Array.isArray(w) ? w : [w]).map(text);
      while (parts.length > 1 && !parts[parts.length - 1]) parts.pop();
      return parts as Word;
    })
    .filter((w) => w[0]);
  if (words.length) entry.words = words;

  // Keep a stable key order in the JSON file.
  const ordered: CharacterEntry = { character: entry.character };
  for (const key of ['pinyin', 'meaning', 'type', 'components', 'words', 'notes'] as const) {
    if (entry[key] !== undefined) (ordered as unknown as Record<string, unknown>)[key] = entry[key];
  }
  return ordered;
}
