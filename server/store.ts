/* The lists are kept in PostgreSQL (tables in db/schema.sql).
 *
 *   DATABASE_URL   required: postgres://user:password@host:5432/dbname (add ?sslmode=require for
 *                  hosted databases)
 *   DATABASE_USER  whose lists to use until there is a login system (default: "default")
 *
 * "npm run db:import" creates the tables and copies data/*.json in. A character's components are
 * kept in the components and character_components tables (see db/schema.sql).
 */
import pg from 'pg';
import { CharacterEntry, cleanEntry } from '../src/app/core/character.model.ts';
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

/** How one list maps to its table (db/schema.sql). */
interface Table<T> {
  name: string;
  /** Key column, then the other columns, in the order of toRow(). */
  columns: string[];
  toRow: (entry: T) => unknown[];
  fromRow: (row: Record<string, unknown>) => T;
}

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
    RETURNING id, (xmax = 0) AS created`;
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
export const partOverride = (value?: string, general?: string): string | null =>
  (value ?? null) === (general ?? null) ? null : (value ?? '');

/** A character's components, from character_components + components, as CharacterPart[]. */
const COMPONENTS_JSON = `COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
        'character', co.hanzi, 'role', l.role, 'strokes', l.strokes,
        'pinyin', COALESCE(l.pinyin, co.pinyin), 'meaning', COALESCE(l.meaning, co.meaning)
      ) ORDER BY l.position)
    FROM character_components l
    JOIN components co ON co.id = l.component_id
    WHERE l.character_id = ch.id
  ), '[]') AS components`;

function charactersStore(pool: pg.Pool, userId: () => Promise<string>): ListStore<CharacterEntry> {
  const table = CHARACTERS_TABLE;
  const upsert = upsertSql(table);
  const generic = pgStore(pool, table, userId);
  return {
    async all() {
      const { rows } = await pool.query(
        `SELECT ${table.columns.map((c) => 'ch.' + c).join(', ')}, ${COMPONENTS_JSON}
         FROM characters ch WHERE ch.user_id = $1 ORDER BY ch.position, ch.hanzi`,
        [await userId()],
      );
      return rows.map(table.fromRow);
    },
    async save(entry) {
      const user = await userId();
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const { rows } = await client.query(upsert, [user, ...table.toRow(entry)]);
        const characterId = rows[0].id;
        await client.query(`DELETE FROM character_components WHERE character_id = $1`, [characterId]);
        for (const [i, part] of (entry.components ?? []).entries()) {
          // New components take this part's pinyin and meaning; known ones keep theirs.
          const { rows: [component] } = await client.query(
            `INSERT INTO components (user_id, hanzi, pinyin, meaning) VALUES ($1, $2, $3, $4)
             ON CONFLICT (user_id, hanzi) DO UPDATE SET
               pinyin = COALESCE(components.pinyin, EXCLUDED.pinyin),
               meaning = COALESCE(components.meaning, EXCLUDED.meaning)
             RETURNING id, pinyin, meaning`,
            [user, part.character, part.pinyin ?? null, part.meaning ?? null],
          );
          await client.query(
            `INSERT INTO character_components
               (character_id, component_id, position, role, strokes, pinyin, meaning)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
              characterId,
              component.id,
              i + 1,
              part.role,
              part.strokes ?? null,
              partOverride(part.pinyin, component.pinyin ?? undefined),
              partOverride(part.meaning, component.meaning ?? undefined),
            ],
          );
        }
        await client.query('COMMIT');
        return rows[0].created;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },
    remove: generic.remove, // its character_components rows go with it (ON DELETE CASCADE)
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

/** Throws when DATABASE_URL is not set. */
export function createStores(): Stores {
  const url = process.env['DATABASE_URL'];
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. Locally: cp .env.example .env.local and npm run db:up (see README).',
    );
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
    characters: charactersStore(pool, userId),
    words: pgStore(pool, WORDS_TABLE, userId),
    description: `PostgreSQL ${safeUrl(url)} (user "${username}")`,
    check: async () => void (await userId()),
  };
}
