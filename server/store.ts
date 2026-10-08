/* Where the lists are kept: JSON files in DATA_DIR (default), or PostgreSQL when DATABASE_URL is set.
 *
 *   DATABASE_URL   postgres://user:password@host:5432/dbname (add ?sslmode=require for hosted databases)
 *   DATABASE_USER  whose lists to use until there is a login system (default: "default")
 *
 * Create the tables with db/schema.sql and copy the JSON files in with "npm run db:import".
 */
import pg from 'pg';
import { CharacterEntry, cleanEntry } from '../src/app/core/character.model.ts';
import { WordEntry, cleanWord } from '../src/app/core/word.model.ts';
import { CHARACTERS, DATA_DIR, ListFile, WORDS, readList, writeList } from './data-files.ts';

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
}

// ---------- JSON files ----------

function jsonStore<T>(list: ListFile<T>): ListStore<T> {
  const keyOf = (item: T) => String(item[list.key]);
  return {
    all: () => readList(list),
    async save(entry) {
      const items = await readList(list);
      const i = items.findIndex((item) => keyOf(item) === keyOf(entry));
      if (i >= 0) items[i] = entry;
      else items.push(entry);
      await writeList(list, items);
      return i < 0;
    },
    async remove(key) {
      const items = await readList(list);
      const kept = items.filter((item) => keyOf(item) !== key);
      if (kept.length === items.length) return false;
      await writeList(list, kept);
      return true;
    },
  };
}

// ---------- PostgreSQL ----------

/** How one list maps to its table (db/schema.sql). */
interface Table<T> {
  name: string;
  /** Key column, then the other columns, in the order of toRow(). */
  columns: string[];
  toRow: (entry: T) => unknown[];
  fromRow: (row: Record<string, unknown>) => T;
}

export const CHARACTERS_TABLE: Table<CharacterEntry> = {
  name: 'characters',
  columns: ['hanzi', 'pinyin', 'meaning', 'type', 'components', 'words', 'notes'],
  toRow: (c) => [
    c.character,
    c.pinyin ?? null,
    c.meaning ?? null,
    c.type ?? null,
    JSON.stringify(c.components ?? []),
    JSON.stringify(c.words ?? []),
    c.notes ?? null,
  ],
  fromRow: (r) => cleanEntry({ ...r, character: r['hanzi'] }),
};

export const WORDS_TABLE: Table<WordEntry> = {
  name: 'words',
  columns: ['word', 'pinyin', 'meaning', 'notes'],
  toRow: (w) => [w.word, w.pinyin ?? null, w.meaning ?? null, w.notes ?? null],
  fromRow: (r) => cleanWord(r),
};

/** INSERT … ON CONFLICT for one entry; $1 is the user id. New entries go at the end of the list. */
export function upsertSql<T>(table: Table<T>): string {
  const [key, ...rest] = table.columns;
  const values = table.columns.map((_, i) => `$${i + 2}`);
  return `INSERT INTO ${table.name} (user_id, position, ${table.columns.join(', ')})
    VALUES ($1, (SELECT COALESCE(MAX(position), 0) + 1 FROM ${table.name} WHERE user_id = $1), ${values.join(', ')})
    ON CONFLICT (user_id, ${key}) DO UPDATE SET
      ${rest.map((c) => `${c} = EXCLUDED.${c}`).join(', ')}, updated_at = now()
    RETURNING (xmax = 0) AS created`;
}

function pgStore<T>(pool: pg.Pool, table: Table<T>, userId: () => Promise<string>): ListStore<T> {
  const key = table.columns[0];
  const upsert = upsertSql(table);
  return {
    async all() {
      const { rows } = await pool.query(
        `SELECT ${table.columns.join(', ')} FROM ${table.name} WHERE user_id = $1 ORDER BY position, ${key}`,
        [await userId()],
      );
      return rows.map(table.fromRow);
    },
    async save(entry) {
      const { rows } = await pool.query(upsert, [await userId(), ...table.toRow(entry)]);
      return rows[0].created;
    },
    async remove(value) {
      const { rowCount } = await pool.query(
        `DELETE FROM ${table.name} WHERE user_id = $1 AND ${key} = $2`,
        [await userId(), value],
      );
      return (rowCount ?? 0) > 0;
    },
  };
}

/** Id of the user, created if missing. */
export async function userIdOf(db: pg.Pool | pg.Client, username: string): Promise<string> {
  const { rows } = await db.query(
    `INSERT INTO app_user (username) VALUES ($1)
     ON CONFLICT (username) DO UPDATE SET username = EXCLUDED.username
     RETURNING id`,
    [username],
  );
  return String(rows[0].id);
}

/** Hides the password in a connection string. */
const safeUrl = (url: string) => url.replace(/\/\/([^:/@]+):[^@]*@/, '//$1:***@');

export function createStores(): Stores {
  const url = process.env['DATABASE_URL'];
  if (!url) {
    return {
      characters: jsonStore(CHARACTERS),
      words: jsonStore(WORDS),
      description: `JSON files in ${DATA_DIR}`,
    };
  }
  const username = process.env['DATABASE_USER'] || 'default';
  const pool = new pg.Pool({ connectionString: url, max: 5 });
  pool.on('error', (err) => console.error('PostgreSQL:', err.message));
  let id: Promise<string> | null = null;
  const userId = () => {
    id ??= userIdOf(pool, username).catch((err) => {
      id = null; // try again on the next request
      throw err;
    });
    return id;
  };
  return {
    characters: pgStore(pool, CHARACTERS_TABLE, userId),
    words: pgStore(pool, WORDS_TABLE, userId),
    description: `PostgreSQL ${safeUrl(url)} (user "${username}")`,
  };
}
