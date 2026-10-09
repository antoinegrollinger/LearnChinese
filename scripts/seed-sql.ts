/* Builds the SQL that puts one user's lists in the database (used by db-import.ts and db-export.ts).
 * The result can be imported in phpMyAdmin or run with the mariadb client, after db/schema.sql. */
import mysql from 'mysql2/promise';
import { CharacterEntry, Label } from '../src/app/core/character.model.ts';
import { WordEntry } from '../src/app/core/word.model.ts';
import { CHARACTERS_TABLE, WORDS_TABLE, componentsOf, partOverride } from '../server/store.ts';

/** SQL literal (mysql2 escapes quotes and backslashes). */
export const quote = (value: unknown): string => (value == null ? 'NULL' : mysql.escape(String(value)));

/** INSERT … VALUES with one line per row, or nothing when there are no rows. */
const insertSql = (table: string, columns: string[], rows: string[][]): string =>
  rows.length
    ? `INSERT INTO ${table} (${columns.join(', ')}) VALUES\n` +
      rows.map((values) => `  (${values.join(', ')})`).join(',\n') +
      ';'
    : '';

/** The user's list, with the JSON array order as position. */
function listSql(table: typeof CHARACTERS_TABLE | typeof WORDS_TABLE, items: unknown[]): string {
  const toRow = table.toRow as (item: unknown) => unknown[];
  return insertSql(
    table.name,
    ['user_id', 'position', ...table.columns],
    items.map((item, i) => ['@user', String(i + 1), ...toRow(item).map(quote)]),
  );
}

/** The components and character_components tables, from the characters' components. */
function componentsSql(characters: CharacterEntry[]): string {
  const components = componentsOf(characters);
  const idOf = (table: string, hanzi: string) =>
    `(SELECT id FROM ${table} WHERE user_id = @user AND hanzi = ${quote(hanzi)})`;
  return [
    insertSql(
      'components',
      ['user_id', 'hanzi', 'pinyin', 'meaning'],
      [...components].map(([hanzi, c]) => ['@user', quote(hanzi), quote(c.pinyin), quote(c.meaning)]),
    ),
    insertSql(
      'character_components',
      ['character_id', 'component_id', 'position', 'role', 'strokes', 'pinyin', 'meaning'],
      characters.flatMap((c) =>
        (c.components ?? []).map((part, i) => {
          const general = components.get(part.character)!;
          return [
            idOf('characters', c.character),
            idOf('components', part.character),
            String(i + 1),
            quote(part.role),
            quote(part.strokes),
            quote(partOverride(part.pinyin, general.pinyin)),
            quote(partOverride(part.meaning, general.meaning)),
          ];
        }),
      ),
    ),
  ].join('\n\n');
}

export interface SeedOptions {
  /** app_user.username whose lists are replaced. */
  username: string;
  /** First comment line: where the data comes from. */
  title: string;
  /**
   * true: creates the user if missing (the "default" user of npm run db:import).
   * false: the account must exist (created in the app); otherwise nothing is changed.
   */
  createUser: boolean;
  /** The labels with their colours (also those no character uses). Default: the characters' labels. */
  labels?: Label[];
  /** The review history, as stored (db-export.ts). When given, it replaces the user's. */
  reviews?: ReviewRow[];
  /** Whether friends see the reviews (app_user.share_reviews). Unchanged when missing. */
  shareReviews?: boolean;
}

/** A review_sessions row; dates as stored ("2026-10-09 17:15:00"), results as JSON text. */
export interface ReviewRow {
  kind: string;
  mode: string;
  startedAt: string;
  finishedAt: string;
  results: string;
}

/** The review_sessions rows, oldest first. */
function reviewsSql(reviews: ReviewRow[]): string {
  return insertSql(
    'review_sessions',
    ['user_id', 'kind', 'mode', 'started_at', 'finished_at', 'results'],
    reviews.map((r) => [
      '@user',
      quote(r.kind),
      quote(r.mode),
      quote(r.startedAt),
      quote(r.finishedAt),
      quote(r.results),
    ]),
  );
}

/** The labels table, and each labelled character's and word's label_id (run after both lists). */
function labelsSql(characters: CharacterEntry[], words: WordEntry[], labels: Label[]): string {
  const colors = new Map(labels.map((l) => [l.name, l.color]));
  const names = new Set(labels.map((l) => l.name));
  for (const item of [...characters, ...words]) if (item.label) names.add(item.label);
  /** One UPDATE per label: its rows in this table get its id. */
  const updates = (table: string, column: string, items: [string, string | undefined][]) =>
    [...names].flatMap((name) => {
      const keys = items.filter(([, label]) => label === name).map(([key]) => key);
      return keys.length
        ? [
            `UPDATE ${table} SET label_id = ` +
              `(SELECT id FROM labels WHERE user_id = @user AND name = ${quote(name)})\n` +
              `  WHERE user_id = @user AND ${column} IN (${keys.map(quote).join(', ')});`,
          ]
        : [];
    });
  return [
    insertSql(
      'labels',
      ['user_id', 'name', 'color'],
      [...names].map((name) => ['@user', quote(name), quote(colors.get(name))]),
    ),
    ...updates('characters', 'hanzi', characters.map((c) => [c.character, c.label])),
    ...updates('words', 'word', words.map((w) => [w.word, w.label])),
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * One transaction that replaces the user's characters, labels, components and words with these
 * (and their review history and sharing setting, when given).
 */
export function seedSql(characters: CharacterEntry[], words: WordEntry[], options: SeedOptions): string {
  const { username, title, createUser, labels = [], reviews, shareReviews } = options;
  const name = quote(username);
  const replaced = `characters, labels, components, words${reviews ? ' and review history' : ''}`;
  return [
    `-- ${title}\n` +
      `-- Replaces the ${replaced} of user ${name}. Run db/schema.sql first.` +
      (createUser
        ? ''
        : `\n-- The account ${name} must exist (create it in the app first). If it doesn't, this stops\n` +
          `-- with "Column 'user_id' cannot be null" and nothing is changed.`),
    `SET NAMES utf8mb4;`,
    `START TRANSACTION;`,
    (createUser ? `INSERT IGNORE INTO app_user (username) VALUES (${name});\n` : '') +
      `SET @user = (SELECT id FROM app_user WHERE username = ${name});`,
    `DELETE FROM characters WHERE user_id = @user; -- and their character_components\n` +
      `DELETE FROM components WHERE user_id = @user;\n` +
      `DELETE FROM labels WHERE user_id = @user;\n` +
      `DELETE FROM words WHERE user_id = @user;` +
      (reviews ? `\nDELETE FROM review_sessions WHERE user_id = @user;` : ''),
    listSql(CHARACTERS_TABLE, characters),
    componentsSql(characters),
    listSql(WORDS_TABLE, words),
    labelsSql(characters, words, labels),
    reviews ? reviewsSql(reviews) : '',
    shareReviews === undefined
      ? ''
      : `UPDATE app_user SET share_reviews = ${shareReviews ? 'TRUE' : 'FALSE'} WHERE id = @user;`,
    `COMMIT;`,
    ``,
  ]
    .filter((part, i, all) => part || i === all.length - 1)
    .join('\n\n');
}
