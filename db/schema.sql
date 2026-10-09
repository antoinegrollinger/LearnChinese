-- Hanzi Workshop: MariaDB schema (MariaDB 10.6+, which Hostinger runs; on MySQL 8 the upgrade
-- statements below need a fresh database).
-- Same data as data/characters.json and data/words.json, with one list per user.
-- Safe to run again: it only creates what is missing.
--
--   mariadb -u USER -p DATABASE < db/schema.sql       (or import it in phpMyAdmin)
--
-- Every table has a numeric id; links between tables use these ids. The hanzi (or word) is unique
-- per user. Each account (app_user, unique email) has its own lists; logging in creates a row in
-- sessions (see server/auth.ts). The "default" user holds the data imported by npm run db:import,
-- until the account with OWNER_EMAIL takes it over.
--
-- utf8mb4_bin: compares characters exactly, so different characters are never treated as equal.

CREATE TABLE IF NOT EXISTS app_user (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  email         VARCHAR(254) UNIQUE,         -- lower case; NULL for the "default" user
  username      VARCHAR(64)  UNIQUE,         -- only for the "default" user (npm run db:import)
  display_name  VARCHAR(255),
  -- "scrypt$N$r$p$salt$hash" (server/auth.ts): never the password itself. NULL = can't log in.
  password_hash VARCHAR(255),
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_login_at TIMESTAMP NULL
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_bin;

-- Upgrade from the version without accounts.
ALTER TABLE app_user
  ADD COLUMN IF NOT EXISTS email VARCHAR(254) UNIQUE AFTER id,
  ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP NULL,
  MODIFY username VARCHAR(64) NULL;

-- Upgrade from the version without friends: your friends see your reviews only when this is on.
ALTER TABLE app_user ADD COLUMN IF NOT EXISTS share_reviews BOOLEAN NOT NULL DEFAULT FALSE;

INSERT IGNORE INTO app_user (username, display_name) VALUES ('default', 'Default');

-- One row per login. The token is only sent to the browser; this table keeps its SHA-256 hash, so
-- someone who reads the database still can't use a session.
CREATE TABLE IF NOT EXISTS sessions (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id      BIGINT UNSIGNED NOT NULL,
  token_hash   CHAR(64) NOT NULL,            -- hex SHA-256 of the token
  created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at   TIMESTAMP NOT NULL,
  user_agent   VARCHAR(255),
  UNIQUE KEY sessions_token (token_hash),
  KEY sessions_user (user_id),
  CONSTRAINT sessions_user FOREIGN KEY (user_id) REFERENCES app_user (id) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_bin;

-- The user's labels for grouping characters ("HSK 1", "food"…), offered in a dropdown.
CREATE TABLE IF NOT EXISTS labels (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id    BIGINT UNSIGNED NOT NULL,
  name       VARCHAR(64) NOT NULL,
  color      CHAR(7),                      -- "#d1495b"; NULL = a colour picked from the name
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY labels_user_name (user_id, name),
  CONSTRAINT labels_user FOREIGN KEY (user_id) REFERENCES app_user (id) ON DELETE CASCADE,
  CONSTRAINT labels_name_not_empty CHECK (name <> '')
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_bin;

-- Upgrade from the version without label colours.
ALTER TABLE labels ADD COLUMN IF NOT EXISTS color CHAR(7) AFTER name;

-- One row per character in data/characters.json (CharacterEntry in src/app/core/character.model.ts).
CREATE TABLE IF NOT EXISTS characters (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id    BIGINT UNSIGNED NOT NULL,
  hanzi      VARCHAR(32) NOT NULL,         -- "character" in the JSON
  position   INT NOT NULL,                 -- order of the list (the JSON array order)
  pinyin     VARCHAR(255),                 -- "ma1" or "mā"
  meaning    TEXT,
  type       VARCHAR(32),                  -- key of TYPES in src/app/core/config.ts
  label_id   BIGINT UNSIGNED,              -- optional; "label" (its name) in the JSON
  -- components: see the components and character_components tables below
  words      JSON NOT NULL,                -- example words: [["中国人", "Zhong1guo2ren2", "Chinese person"], ...]
  notes      TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY characters_user_hanzi (user_id, hanzi),
  KEY characters_user_position (user_id, position),
  CONSTRAINT characters_user FOREIGN KEY (user_id) REFERENCES app_user (id) ON DELETE CASCADE,
  CONSTRAINT characters_hanzi_not_empty CHECK (hanzi <> ''),
  CONSTRAINT characters_words_array CHECK (JSON_TYPE(words) = 'ARRAY'),
  CONSTRAINT characters_label FOREIGN KEY (label_id) REFERENCES labels (id) ON DELETE SET NULL
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_bin;

-- Upgrade from the version without labels.
ALTER TABLE characters
  ADD COLUMN IF NOT EXISTS label_id BIGINT UNSIGNED AFTER type,
  ADD CONSTRAINT characters_label FOREIGN KEY IF NOT EXISTS (label_id)
    REFERENCES labels (id) ON DELETE SET NULL;

-- The parts characters are made of (女 and 马 in 妈), with their usual pinyin and meaning.
-- A component doesn't have to be in the characters table (e.g. 亻 or 疋).
CREATE TABLE IF NOT EXISTS components (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id    BIGINT UNSIGNED NOT NULL,
  hanzi      VARCHAR(32) NOT NULL,
  pinyin     VARCHAR(255),
  meaning    TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY components_user_hanzi (user_id, hanzi),
  CONSTRAINT components_user FOREIGN KEY (user_id) REFERENCES app_user (id) ON DELETE CASCADE,
  CONSTRAINT components_hanzi_not_empty CHECK (hanzi <> '')
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_bin;

-- Which components a character is made of, in writing order (CharacterPart in character.model.ts).
-- pinyin and meaning are only set when they differ from the component's, e.g. 一 in 本 means
-- "marker stroke (the root)". NULL = the component's value, '' = none for this character.
CREATE TABLE IF NOT EXISTS character_components (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  character_id BIGINT UNSIGNED NOT NULL,
  component_id BIGINT UNSIGNED NOT NULL,
  position     INT NOT NULL,               -- writing order, from 1
  role         VARCHAR(16) NOT NULL DEFAULT 'other',
  strokes      VARCHAR(64),                -- stroke numbers of this part: "1-3", "4,5,8"
  pinyin       VARCHAR(255),
  meaning      TEXT,
  UNIQUE KEY character_components_order (character_id, position),
  KEY character_components_component (component_id),
  CONSTRAINT character_components_character FOREIGN KEY (character_id)
    REFERENCES characters (id) ON DELETE CASCADE,
  CONSTRAINT character_components_part FOREIGN KEY (component_id) REFERENCES components (id),
  CONSTRAINT character_components_role CHECK (role IN ('meaning', 'sound', 'other'))
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_bin;

-- One row per word in data/words.json (WordEntry in src/app/core/word.model.ts).
CREATE TABLE IF NOT EXISTS words (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id    BIGINT UNSIGNED NOT NULL,
  word       VARCHAR(64) NOT NULL,
  position   INT NOT NULL,
  pinyin     VARCHAR(255),                 -- "ma1ma5" or "māma"
  meaning    TEXT,
  notes      TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY words_user_word (user_id, word),
  KEY words_user_position (user_id, position),
  CONSTRAINT words_user FOREIGN KEY (user_id) REFERENCES app_user (id) ON DELETE CASCADE,
  CONSTRAINT words_word_not_empty CHECK (word <> '')
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_bin;

-- One row per completed review session (ReviewSession in src/app/core/review.model.ts). The
-- characters are kept by hanzi, so the history stays when a character is deleted.
CREATE TABLE IF NOT EXISTS review_sessions (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id     BIGINT UNSIGNED NOT NULL,
  mode        VARCHAR(16) NOT NULL DEFAULT 'write', -- ReviewMode: 'write' or 'pinyin'
  started_at  DATETIME NOT NULL,
  finished_at DATETIME NOT NULL,
  results     JSON NOT NULL,                -- [{"character": "妈", "tries": 2, "mistakes": 3}, ...]
  KEY review_sessions_user (user_id, finished_at),
  CONSTRAINT review_sessions_user FOREIGN KEY (user_id) REFERENCES app_user (id) ON DELETE CASCADE,
  CONSTRAINT review_sessions_results_array CHECK (JSON_TYPE(results) = 'ARRAY')
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_bin;

-- Upgrade from the version without review modes, then without word reviews.
ALTER TABLE review_sessions ADD COLUMN IF NOT EXISTS mode VARCHAR(16) NOT NULL DEFAULT 'write' AFTER user_id;
-- ReviewKind: 'characters' or 'words' (then results[].character holds the word).
ALTER TABLE review_sessions
  ADD COLUMN IF NOT EXISTS kind VARCHAR(16) NOT NULL DEFAULT 'characters' AFTER user_id;

-- Friends: one row per pair. A request is 'pending' until the other user accepts it; then both
-- are friends and see each other's counts (and reviews, if they share them: app_user.share_reviews).
CREATE TABLE IF NOT EXISTS friendships (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  requester_id BIGINT UNSIGNED NOT NULL,
  addressee_id BIGINT UNSIGNED NOT NULL,
  status       VARCHAR(16) NOT NULL DEFAULT 'pending',
  created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  accepted_at  TIMESTAMP NULL,
  UNIQUE KEY friendships_pair (requester_id, addressee_id),
  KEY friendships_addressee (addressee_id),
  CONSTRAINT friendships_requester FOREIGN KEY (requester_id) REFERENCES app_user (id) ON DELETE CASCADE,
  CONSTRAINT friendships_addressee FOREIGN KEY (addressee_id) REFERENCES app_user (id) ON DELETE CASCADE,
  CONSTRAINT friendships_not_self CHECK (requester_id <> addressee_id),
  CONSTRAINT friendships_status CHECK (status IN ('pending', 'accepted'))
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_bin;

-- Communities anyone can create and join by name. name_key (lower case) keeps names unique
-- without regard to case. A community is deleted when its last member leaves.
CREATE TABLE IF NOT EXISTS communities (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(64) NOT NULL,
  name_key    VARCHAR(64) NOT NULL,
  description VARCHAR(500),
  created_by  BIGINT UNSIGNED,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY communities_name (name_key),
  CONSTRAINT communities_creator FOREIGN KEY (created_by) REFERENCES app_user (id) ON DELETE SET NULL
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_bin;

CREATE TABLE IF NOT EXISTS community_members (
  community_id BIGINT UNSIGNED NOT NULL,
  user_id      BIGINT UNSIGNED NOT NULL,
  joined_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (community_id, user_id),
  KEY community_members_user (user_id),
  CONSTRAINT community_members_community FOREIGN KEY (community_id)
    REFERENCES communities (id) ON DELETE CASCADE,
  CONSTRAINT community_members_user FOREIGN KEY (user_id) REFERENCES app_user (id) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_bin;

-- Upgrade from the version without community settings and roles.
--   join_policy: 'open' (anyone joins) or 'approval' (an owner or admin approves each request)
--   member_list: 'members' (only members see the members) or 'everyone'
--   role: 'owner' (settings and admins), 'admin' (approves requests, removes members), 'member'
ALTER TABLE communities
  ADD COLUMN IF NOT EXISTS join_policy VARCHAR(16) NOT NULL DEFAULT 'open' AFTER description,
  ADD COLUMN IF NOT EXISTS member_list VARCHAR(16) NOT NULL DEFAULT 'members' AFTER join_policy;
ALTER TABLE community_members
  ADD COLUMN IF NOT EXISTS role VARCHAR(16) NOT NULL DEFAULT 'member' AFTER user_id;

-- Communities created before roles existed: their creator (or else their first member) owns them.
UPDATE community_members m JOIN communities c ON c.id = m.community_id
SET m.role = 'owner'
WHERE m.user_id = c.created_by
  AND c.id NOT IN (SELECT community_id FROM (
    SELECT community_id FROM community_members WHERE role = 'owner') AS owned);
UPDATE community_members m
JOIN (SELECT community_id, MIN(joined_at) AS first_join FROM community_members
      GROUP BY community_id HAVING SUM(role = 'owner') = 0) AS unowned
  ON unowned.community_id = m.community_id AND m.joined_at = unowned.first_join
SET m.role = 'owner';

-- Requests to join a community whose join_policy is 'approval'.
CREATE TABLE IF NOT EXISTS community_join_requests (
  community_id BIGINT UNSIGNED NOT NULL,
  user_id      BIGINT UNSIGNED NOT NULL,
  created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (community_id, user_id),
  KEY community_join_requests_user (user_id),
  CONSTRAINT community_join_requests_community FOREIGN KEY (community_id)
    REFERENCES communities (id) ON DELETE CASCADE,
  CONSTRAINT community_join_requests_user FOREIGN KEY (user_id)
    REFERENCES app_user (id) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_bin;

-- What happened to you (InfoType in src/app/core/social.model.ts), for the notification menu.
-- Requests waiting for your answer are not stored here: they come from friendships and
-- community_join_requests. The community is kept by name, so a notice survives its deletion.
CREATE TABLE IF NOT EXISTS notifications (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id    BIGINT UNSIGNED NOT NULL,
  type       VARCHAR(32) NOT NULL,
  actor_id   BIGINT UNSIGNED,              -- who did it
  community  VARCHAR(64),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  read_at    TIMESTAMP NULL,
  KEY notifications_user (user_id, created_at),
  CONSTRAINT notifications_user FOREIGN KEY (user_id) REFERENCES app_user (id) ON DELETE CASCADE,
  CONSTRAINT notifications_actor FOREIGN KEY (actor_id) REFERENCES app_user (id) ON DELETE SET NULL
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_bin;

-- A character with its components by name, for browsing (e.g. in phpMyAdmin or Adminer):
--   SELECT * FROM character_components_view WHERE hanzi = '妈';
CREATE OR REPLACE VIEW character_components_view AS
SELECT ch.user_id, ch.hanzi, l.position, co.hanzi AS component, l.role, l.strokes,
       NULLIF(COALESCE(l.pinyin, co.pinyin), '')   AS pinyin,
       NULLIF(COALESCE(l.meaning, co.meaning), '') AS meaning,
       l.id AS link_id, ch.id AS character_id, co.id AS component_id
FROM character_components l
JOIN characters ch ON ch.id = l.character_id
JOIN components co ON co.id = l.component_id;
