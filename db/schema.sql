-- Hanzi Workshop: PostgreSQL schema (PostgreSQL 13 or newer).
-- Same data as data/characters.json and data/words.json, with one list per user.
-- Safe to run again: it only creates what is missing.
--
--   psql "$DATABASE_URL" -f db/schema.sql
--
-- Until there is a login system every request uses one user, "default" (or DATABASE_USER, see
-- server/store.ts). Accounts later only add rows to app_user and pick the user per request.

CREATE TABLE IF NOT EXISTS app_user (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  username      text NOT NULL UNIQUE,
  display_name  text,
  -- For the future login system (e.g. an argon2 or bcrypt hash). NULL = can't log in.
  password_hash text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

INSERT INTO app_user (username, display_name) VALUES ('default', 'Default')
ON CONFLICT (username) DO NOTHING;

-- One row per character in data/characters.json (CharacterEntry in src/app/core/character.model.ts).
CREATE TABLE IF NOT EXISTS characters (
  user_id    bigint  NOT NULL REFERENCES app_user (id) ON DELETE CASCADE,
  hanzi      text    NOT NULL,             -- "character" in the JSON
  position   integer NOT NULL,             -- order of the list (the JSON array order)
  pinyin     text,                         -- "ma1" or "mā"
  meaning    text,
  type       text,                         -- key of TYPES in src/app/core/config.ts
  components jsonb   NOT NULL DEFAULT '[]' -- CharacterPart[]: [{"character", "role", "pinyin"?, "meaning"?, "strokes"?}]
    CHECK (jsonb_typeof(components) = 'array'),
  words      jsonb   NOT NULL DEFAULT '[]' -- example words: [["中国人", "Zhong1guo2ren2", "Chinese person"], ...]
    CHECK (jsonb_typeof(words) = 'array'),
  notes      text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, hanzi),
  CHECK (hanzi <> '')
);
CREATE INDEX IF NOT EXISTS characters_user_position ON characters (user_id, position);

-- One row per word in data/words.json (WordEntry in src/app/core/word.model.ts).
CREATE TABLE IF NOT EXISTS words (
  user_id    bigint  NOT NULL REFERENCES app_user (id) ON DELETE CASCADE,
  word       text    NOT NULL,
  position   integer NOT NULL,
  pinyin     text,                         -- "ma1ma5" or "māma"
  meaning    text,
  notes      text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, word),
  CHECK (word <> '')
);
CREATE INDEX IF NOT EXISTS words_user_position ON words (user_id, position);
