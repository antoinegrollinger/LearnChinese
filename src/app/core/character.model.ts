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
  /** Optional label for grouping and filtering ("HSK 1", "food"…). At most LABEL_MAX_LENGTH. */
  label?: string;
  /** In writing order */
  components?: CharacterPart[];
  words?: Word[];
  notes?: string;
}

const ROLES: Role[] = ['meaning', 'sound', 'other'];

/** Size of labels.name in db/schema.sql. */
export const LABEL_MAX_LENGTH = 64;

/** One of your labels (the labels table). */
export interface Label {
  name: string;
  /** "#d1495b"; when missing, labelColor() picks one from the name. */
  color?: string;
}

/** Colours offered for new labels, and used for labels without one. */
export const LABEL_COLORS = [
  '#d1495b',
  '#e8833a',
  '#e6b800',
  '#2e8b57',
  '#16a085',
  '#2e86de',
  '#6c5ce7',
  '#8e44ad',
  '#c2185b',
  '#7f8c8d',
];

/** The label's colour, or a fixed one picked from its name. */
export function labelColor(label: Label): string {
  if (label.color) return label.color;
  let hash = 0;
  for (const ch of label.name) hash = (hash * 31 + ch.codePointAt(0)!) | 0;
  return LABEL_COLORS[Math.abs(hash) % LABEL_COLORS.length];
}

/** Keeps a valid name (trimmed, at most LABEL_MAX_LENGTH) and colour ("#rrggbb", lower case). */
export function cleanLabel(raw: unknown): Label {
  const r = (raw ?? {}) as Record<string, unknown>;
  const label: Label = { name: text(r['name']).slice(0, LABEL_MAX_LENGTH).trim() };
  const color = text(r['color']).toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(color)) label.color = color;
  return label;
}

const text = (v: unknown): string => (v == null ? '' : String(v).trim());

/** Keeps only known fields, trims text and drops empty values. */
export function cleanEntry(raw: unknown): CharacterEntry {
  const r = (raw ?? {}) as Record<string, unknown>;
  const entry: CharacterEntry = { character: text(r['character']) };
  for (const key of ['pinyin', 'meaning', 'type', 'notes'] as const) {
    if (text(r[key])) entry[key] = text(r[key]);
  }
  const label = text(r['label']).slice(0, LABEL_MAX_LENGTH).trim();
  if (label) entry.label = label;

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
  for (const key of [
    'pinyin',
    'meaning',
    'type',
    'label',
    'components',
    'words',
    'notes',
  ] as const) {
    if (entry[key] !== undefined) (ordered as unknown as Record<string, unknown>)[key] = entry[key];
  }
  return ordered;
}
