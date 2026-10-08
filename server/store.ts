/* The lists are kept in MySQL / MariaDB (tables in db/schema.sql).
 *
 *   DATABASE_URL   required: mysql://user:password@host:3306/dbname
 *                  (on Hostinger: mysql://u123_user:password@localhost:3306/u123_db)
 *   DATABASE_USER  whose lists to use until there is a login system (default: "default")
 *
 * "npm run db:import" creates the tables and copies data/*.json in. A character's components are
 * kept in the components and character_components tables (see db/schema.sql).
 */
import mysql from 'mysql2/promise';
import { CharacterEntry, CharacterPart, cleanEntry } from '../src/app/core/character.model.ts';
import { WordEntry, cleanWord } from '../src/app/core/word.model.ts';

/** One user's list. */
export interface ListStore<T> {
  all(): Promise<T[]>;
  /** Adds the entry at the end, or replaces the one with the same key. Returns true if added. */
  save(entry: T): Promise<boolean>;
  /** Returns false if there was nothing to delete. */
  remove(key: string): Promise<boolean>;
}

export interface Stores {
  characters: ListStore<CharacterEntry>;
  words: ListStore<WordEntry>;
  /** For the startup log. */
  description: string;
  /** Connects and finds the user: fails if the database can't be reached or has no tables. */
  check(): Promise<void>;
}

type Db = mysql.Pool | mysql.PoolConnection | mysql.Connection;
type Rows = mysql.RowDataPacket[];
type Result = mysql.ResultSetHeader;

/** How one list maps to its table (db/schema.sql). */
interface Table<T> {
  name: string;
  /** Key column, then the other columns, in the order of toRow(). */
  columns: string[];
  toRow: (entry: T) => unknown[];
  fromRow: (row: Record<string, unknown>) => T;
}

/** MariaDB returns JSON columns as text, MySQL as values. */
const parseJson = (value: unknown): unknown =>
  typeof value === 'string' ? JSON.parse(value) : value;

/** The characters table; components are in the components and character_components tables. */
export const CHARACTERS_TABLE: Table<CharacterEntry> = {
  name: 'characters',
  columns: ['hanzi', 'pinyin', 'meaning', 'type', 'words', 'notes'],
  toRow: (c) => [
    c.character,
    c.pinyin ?? null,
    c.meaning ?? null,
    c.type ?? null,
    JSON.stringify(c.words ?? []),
    c.notes ?? null,
  ],
  fromRow: (r) => cleanEntry({ ...r, character: r['hanzi'], words: parseJson(r['words']) }),
};

export const WORDS_TABLE: Table<WordEntry> = {
  name: 'words',
  columns: ['word', 'pinyin', 'meaning', 'notes'],
  toRow: (w) => [w.word, w.pinyin ?? null, w.meaning ?? null, w.notes ?? null],
  fromRow: (r) => cleanWord(r),
};

/**
 * Runs fn in a transaction (all or nothing) after locking the user's app_user row, so one user's
 * saves run one after the other while different users don't wait for each other. Retried if the
 * database still reports a deadlock.
 */
async function userTransaction<R>(
  pool: mysql.Pool,
  user: number,
  fn: (db: mysql.PoolConnection) => Promise<R>,
): Promise<R> {
  for (let attempt = 1; ; attempt++) {
    const db = await pool.getConnection();
    try {
      await db.beginTransaction();
      await db.query(`SELECT id FROM app_user WHERE id = ? FOR UPDATE`, [user]);
      const result = await fn(db);
      await db.commit();
      return result;
    } catch (err) {
      await db.rollback().catch(() => {});
      const deadlock = (err as { code?: string }).code === 'ER_LOCK_DEADLOCK';
      if (!deadlock || attempt === 3) throw err;
    } finally {
      db.release();
    }
  }
}

/**
 * Adds the entry at the end of the user's list, or updates the one with the same key (keeping its
 * id and position). Call inside userTransaction().
 */
async function upsert<T>(db: Db, table: Table<T>, user: number, entry: T) {
  const [key, ...rest] = table.columns;
  const [keyValue, ...values] = table.toRow(entry);
  const [[existing]] = await db.query<Rows>(
    `SELECT id FROM ${table.name} WHERE user_id = ? AND ${key} = ?`,
    [user, keyValue],
  );
  if (existing) {
    await db.query(`UPDATE ${table.name} SET ${rest.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`, [
      ...values,
      existing['id'],
    ]);
    return { id: Number(existing['id']), created: false };
  }
  const [[{ next }]] = await db.query<Rows>(
    `SELECT COALESCE(MAX(position), 0) + 1 AS next FROM ${table.name} WHERE user_id = ?`,
    [user],
  );
  const [result] = await db.query<Result>(
    `INSERT INTO ${table.name} (user_id, position, ${table.columns.join(', ')})
     VALUES (?, ?, ${table.columns.map(() => '?').join(', ')})`,
    [user, next, keyValue, ...values],
  );
  return { id: result.insertId, created: true };
}

function tableStore<T>(pool: mysql.Pool, table: Table<T>, userId: () => Promise<number>): ListStore<T> {
  const key = table.columns[0];
  return {
    async all() {
      const [rows] = await pool.query<Rows>(
        `SELECT ${table.columns.join(', ')} FROM ${table.name} WHERE user_id = ? ORDER BY position, ${key}`,
        [await userId()],
      );
      return rows.map(table.fromRow);
    },
    async save(entry) {
      const user = await userId();
      return userTransaction(pool, user, async (db) => (await upsert(db, table, user, entry)).created);
    },
    async remove(value) {
      const [result] = await pool.query<Result>(
        `DELETE FROM ${table.name} WHERE user_id = ? AND ${key} = ?`,
        [await userId(), value],
      );
      return result.affectedRows > 0;
    },
  };
}

/** Each component once, with its most common pinyin and meaning (on a tie, the first one used). */
export function componentsOf(
  characters: CharacterEntry[],
): Map<string, { pinyin?: string; meaning?: string }> {
  const variants = new Map<string, Map<string, { pinyin?: string; meaning?: string; uses: number }>>();
  for (const part of characters.flatMap((c) => c.components ?? [])) {
    const byValue = variants.get(part.character) ?? new Map();
    variants.set(part.character, byValue);
    const id = JSON.stringify([part.pinyin, part.meaning]);
    const variant = byValue.get(id) ?? { pinyin: part.pinyin, meaning: part.meaning, uses: 0 };
    variant.uses++;
    byValue.set(id, variant);
  }
  const result = new Map<string, { pinyin?: string; meaning?: string }>();
  for (const [hanzi, byValue] of variants) {
    const [{ pinyin, meaning }] = [...byValue.values()].sort((a, b) => b.uses - a.uses);
    result.set(hanzi, { pinyin, meaning });
  }
  return result;
}

/** Value kept in character_components: null = the component's own value, '' = none. */
export const partOverride = (value?: string, general?: string | null): string | null =>
  (value ?? null) === (general ?? null) ? null : (value ?? '');

function charactersStore(pool: mysql.Pool, userId: () => Promise<number>): ListStore<CharacterEntry> {
  const generic = tableStore(pool, CHARACTERS_TABLE, userId);
  return {
    async all() {
      const characters = await generic.all();
      // All the user's component links at once, grouped by character below.
      const [links] = await pool.query<Rows>(
        `SELECT ch.hanzi AS of_hanzi, co.hanzi, l.role, l.strokes,
                COALESCE(l.pinyin, co.pinyin) AS pinyin, COALESCE(l.meaning, co.meaning) AS meaning
         FROM character_components l
         JOIN characters ch ON ch.id = l.character_id
         JOIN components co ON co.id = l.component_id
         WHERE ch.user_id = ?
         ORDER BY l.character_id, l.position`,
        [await userId()],
      );
      const parts = new Map<string, unknown[]>();
      for (const { of_hanzi, hanzi, ...part } of links) {
        parts.set(of_hanzi, [...(parts.get(of_hanzi) ?? []), { character: hanzi, ...part }]);
      }
      // cleanEntry() puts the parts in shape and drops empty values ('' = none).
      return characters.map((c) => cleanEntry({ ...c, components: parts.get(c.character) ?? [] }));
    },
    async save(entry) {
      const user = await userId();
      return userTransaction(pool, user, async (db) => {
        const { id, created } = await upsert(db, CHARACTERS_TABLE, user, entry);
        await db.query(`DELETE FROM character_components WHERE character_id = ?`, [id]);
        for (const [i, part] of (entry.components ?? []).entries()) {
          await saveLink(db, user, id, i + 1, part);
        }
        return created;
      });
    },
    remove: generic.remove, // its character_components rows go with it (ON DELETE CASCADE)
  };
}

/** One component of a character. New components take this part's pinyin and meaning. */
async function saveLink(db: Db, user: number, characterId: number, position: number, part: CharacterPart) {
  const pinyin = part.pinyin ?? null;
  const meaning = part.meaning ?? null;
  const [result] = await db.query<Result>(
    `INSERT INTO components (user_id, hanzi, pinyin, meaning) VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id),
       pinyin = COALESCE(pinyin, ?), meaning = COALESCE(meaning, ?)`,
    [user, part.character, pinyin, meaning, pinyin, meaning],
  );
  const [[component]] = await db.query<Rows>(
    `SELECT pinyin, meaning FROM components WHERE id = ?`,
    [result.insertId],
  );
  await db.query(
    `INSERT INTO character_components
       (character_id, component_id, position, role, strokes, pinyin, meaning)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      characterId,
      result.insertId,
      position,
      part.role,
      part.strokes ?? null,
      partOverride(part.pinyin, component['pinyin']),
      partOverride(part.meaning, component['meaning']),
    ],
  );
}

/** Id of the user, created if missing. */
export async function userIdOf(db: Db, username: string): Promise<number> {
  await db.query(`INSERT IGNORE INTO app_user (username) VALUES (?)`, [username]);
  const [[row]] = await db.query<Rows>(`SELECT id FROM app_user WHERE username = ?`, [username]);
  return Number(row['id']);
}

/** Hides the password in a connection string. */
const safeUrl = (url: string) => url.replace(/\/\/([^:/@]+):[^@]*@/, '//$1:***@');

/** Throws when DATABASE_URL is not set. */
export function createStores(): Stores {
  const url = process.env['DATABASE_URL'];
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. Locally: cp .env.example .env.local and npm run db:up (see README).',
    );
  }
  const username = process.env['DATABASE_USER'] || 'default';
  const pool = mysql.createPool({ uri: url, connectionLimit: 5, charset: 'utf8mb4' });
  let id: Promise<number> | null = null;
  const userId = () => {
    id ??= userIdOf(pool, username).catch((err) => {
      id = null; // try again on the next request
      throw err;
    });
    return id;
  };
  return {
    characters: charactersStore(pool, userId),
    words: tableStore(pool, WORDS_TABLE, userId),
    description: `MySQL ${safeUrl(url)} (user "${username}")`,
    check: async () => void (await userId()),
  };
}
