-- Hanzi Workshop: PostgreSQL schema (PostgreSQL 13 or newer).
-- Same data as data/characters.json and data/words.json, with one list per user.
-- Safe to run again: it only creates what is missing.
--
--   psql "$DATABASE_URL" -f db/schema.sql
--
-- Every table has a numeric id; links between tables use these ids. The hanzi (or word) is unique
-- per user. Until there is a login system every request uses one user, "default" (or
-- DATABASE_USER, see server/store.ts). Accounts later only add rows to app_user.

-- The first version of this schema linked tables on the hanzi. Stop rather than mix both layouts.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = current_schema() AND table_name = 'characters')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_schema = current_schema() AND table_name = 'characters'
                       AND column_name = 'id') THEN
    RAISE EXCEPTION 'The tables have an older layout. Recreate them: locally "npm run db:reset" '
                    'then "npm run db:import" (this reloads data/*.json).';
  END IF;
END
$$;

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
  id         bigint  GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    bigint  NOT NULL REFERENCES app_user (id) ON DELETE CASCADE,
  hanzi      text    NOT NULL CHECK (hanzi <> ''), -- "character" in the JSON
  position   integer NOT NULL,             -- order of the list (the JSON array order)
  pinyin     text,                         -- "ma1" or "mā"
  meaning    text,
  type       text,                         -- key of TYPES in src/app/core/config.ts
  -- components: see the components and character_components tables below
  words      jsonb   NOT NULL DEFAULT '[]' -- example words: [["中国人", "Zhong1guo2ren2", "Chinese person"], ...]
    CHECK (jsonb_typeof(words) = 'array'),
  notes      text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, hanzi)
);
CREATE INDEX IF NOT EXISTS characters_user_position ON characters (user_id, position);

-- The parts characters are made of (女 and 马 in 妈), with their usual pinyin and meaning.
-- A component doesn't have to be in the characters table (e.g. 亻 or 疋).
CREATE TABLE IF NOT EXISTS components (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    bigint NOT NULL REFERENCES app_user (id) ON DELETE CASCADE,
  hanzi      text   NOT NULL CHECK (hanzi <> ''),
  pinyin     text,
  meaning    text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, hanzi)
);

-- Which components a character is made of, in writing order (CharacterPart in character.model.ts).
-- pinyin and meaning are only set when they differ from the component's, e.g. 一 in 本 means
-- "marker stroke (the root)". NULL = the component's value, '' = none for this character.
CREATE TABLE IF NOT EXISTS character_components (
  id           bigint  GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  character_id bigint  NOT NULL REFERENCES characters (id) ON DELETE CASCADE,
  component_id bigint  NOT NULL REFERENCES components (id),
  position     integer NOT NULL,           -- writing order, from 1
  role         text    NOT NULL DEFAULT 'other' CHECK (role IN ('meaning', 'sound', 'other')),
  strokes      text,                       -- stroke numbers of this part: "1-3", "4,5,8"
  pinyin       text,
  meaning      text,
  UNIQUE (character_id, position)
);
CREATE INDEX IF NOT EXISTS character_components_component ON character_components (component_id);

-- One row per word in data/words.json (WordEntry in src/app/core/word.model.ts).
CREATE TABLE IF NOT EXISTS words (
  id         bigint  GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    bigint  NOT NULL REFERENCES app_user (id) ON DELETE CASCADE,
  word       text    NOT NULL CHECK (word <> ''),
  position   integer NOT NULL,
  pinyin     text,                         -- "ma1ma5" or "māma"
  meaning    text,
  notes      text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, word)
);
CREATE INDEX IF NOT EXISTS words_user_position ON words (user_id, position);

-- A character with its components by name, for browsing (e.g. in Adminer):
--   SELECT * FROM character_components_view WHERE hanzi = '妈';
CREATE OR REPLACE VIEW character_components_view AS
SELECT ch.user_id, ch.hanzi, l.position, co.hanzi AS component, l.role, l.strokes,
       NULLIF(COALESCE(l.pinyin, co.pinyin), '')   AS pinyin,
       NULLIF(COALESCE(l.meaning, co.meaning), '') AS meaning,
       l.id AS link_id, ch.id AS character_id, co.id AS component_id
FROM character_components l
JOIN characters ch ON ch.id = l.character_id
JOIN components co ON co.id = l.component_id;
