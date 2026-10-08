/* Builds the SQL that puts one user's lists in the database (used by db-import.ts and db-export.ts).
 * The result can be imported in phpMyAdmin or run with the mariadb client, after db/schema.sql. */
import mysql from 'mysql2/promise';
import { CharacterEntry } from '../src/app/core/character.model.ts';
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
}

/** One transaction that replaces the user's characters, components and words with these. */
export function seedSql(characters: CharacterEntry[], words: WordEntry[], options: SeedOptions): string {
  const { username, title, createUser } = options;
  const name = quote(username);
  return [
    `-- ${title}\n` +
      `-- Replaces the characters, components and words of user ${name}. Run db/schema.sql first.` +
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
      `DELETE FROM words WHERE user_id = @user;`,
    listSql(CHARACTERS_TABLE, characters),
    componentsSql(characters),
    listSql(WORDS_TABLE, words),
    `COMMIT;`,
    ``,
  ]
    .filter((part, i, all) => part || i === all.length - 1)
    .join('\n\n');
}
