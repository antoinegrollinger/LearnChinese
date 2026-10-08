# 汉字 Workshop

An Angular app for studying Chinese characters. For each character it shows the stroke order, lets you practise drawing it with the mouse or trackpad, and shows its pinyin, its type and which part gives the meaning and which gives the sound.

## Start

**Double-click `start.command`**, or run:

```sh
nvm use      # Node 24 (see .nvmrc); Angular 21 needs Node ^22.12 or >=24
npm install  # first time only
npm start
```

`npm start` runs two processes and opens http://localhost:4200:

| Process | What it does |
|---|---|
| `web` | `ng serve`, the Angular dev server with live reload. It forwards `/api` to the API (`proxy.conf.json`). |
| `api` | `server/server.ts` (run with `tsx`). It reads and writes your lists in MySQL/MariaDB: see [Local database](#local-database-for-testing) for the first start. |

Other scripts:

- `npm run app` builds everything (`npm run build`) and runs the production server (`node dist/server/server.mjs`) at http://localhost:8642, with no dev server.
- `npm run typecheck` type-checks both the app and the server.

An internet connection is needed: the stroke data (Hanzi Writer) and the dictionary are loaded from a CDN.

## Deploy (e.g. Hostinger Node.js Web App)

`npm run build` produces the Angular app in `dist/hanzi-workshop/browser` and the server as a single file, `dist/server/server.mjs`. That server serves the app and the API.

| Hostinger setting | Value |
|---|---|
| Node version | **22.x** or 24.x |
| Build command | `npm run build` |
| Entry file | `server.js` (it starts `dist/server/server.mjs`) |
| Environment variables | `DATABASE_URL`: **required**, your MySQL database (see [Database](#database-mysql--mariadb)).<br>`OWNER_EMAIL`: your email address, so your account gets the imported lists (see [Accounts](#accounts)). |

Environment variables read by the server:

- `PORT` is set by the host. Without it, the server listens on `localhost:8642`.
- `DATABASE_URL`: see [Database](#database-mysql--mariadb). Without it the server stops with an error.
- `OWNER_EMAIL` (optional): see [Accounts](#accounts).
- `CORS_ORIGINS`: only when the app and the API are on different domains (see below). Comma-separated, e.g. `https://example.com,https://www.example.com`.

### App and API on separate domains (e.g. `example.com` + `api.example.com`)

- **API** (`api.example.com`): a Node.js Web App as above, with `CORS_ORIGINS` set to the app's address(es).
- **App** (`example.com`): plain static hosting. Upload the contents of `dist/hanzi-workshop/browser/` to `public_html/` (the included `.htaccess` sends routes like `/study/马` to `index.html`). In the uploaded `config.json`, set `"apiUrl": "https://api.example.com"`. You can change it later without rebuilding. If the host builds the app from git, set the environment variable `API_URL=https://api.example.com` instead: `npm run build` writes it into `config.json`.

With `"apiUrl": ""` (the default) the app calls `/api` on its own server, as with `npm start` and `npm run app`. The login works the same way on one or two domains.

## Database (MySQL / MariaDB)

The server keeps the lists in MySQL 8.0.16+ or MariaDB 10.6+ (Hostinger runs MariaDB 11.8). `data/characters.json` and `data/words.json` are only the starting data that `npm run db:import` copies in.

1. Create the tables: import `db/schema.sql` (phpMyAdmin → your database → **Import**, or `mariadb -u USER -p DATABASE < db/schema.sql`).
2. Copy your JSON lists in, either:
   - `npm run db:import -- --sql`, which writes `db/seed.sql` from your JSON files: import it the same way, after `schema.sql`. It replaces that user's lists. Or:
   - `DATABASE_URL=… npm run db:import`, if your computer can reach the database (also runs `db/schema.sql`; refuses to overwrite existing data unless you add `-- --replace`).
3. Start the server with these environment variables:
   - `DATABASE_URL` (required): `mysql://user:password@host:3306/database`. On Hostinger the host is `localhost`, e.g. `mysql://u123_hanzi:password@localhost:3306/u123_hanzi`. Special characters in the password must be URL-encoded (`@` → `%40`, `#` → `%23`…).

### On Hostinger

1. hPanel → **Databases → MySQL Databases**: create a database and a user (note the password).
2. **phpMyAdmin** (next to the database) → **Import** `db/schema.sql`, then `db/seed.sql` (made with `npm run db:import -- --sql`).
3. API app → **Environment variables**: `DATABASE_URL=mysql://USER:PASSWORD@localhost:3306/DATABASE` and `OWNER_EMAIL=you@example.com` (remove `DATA_DIR` and `APP_PASSWORD` if they are still there), then redeploy. The log says `Data: MySQL …` and `Database connected`.
4. Open the app and **Create an account** with your `OWNER_EMAIL`: it gets the imported lists.

| Table | Contents |
|---|---|
| `app_user` | users (for the future login) |
| `characters` | your characters, in list order (`position`) |
| `components` | each component once (女, 马, 亻…), with its usual pinyin and meaning |
| `character_components` | which components a character is made of: `character_id` → `characters.id`, `component_id` → `components.id`, in writing order (`position`), with the role and stroke numbers. `pinyin`/`meaning` are only set when they differ in this character (一 in 本: "marker stroke (the root)"): empty = the component's own. |
| `words` | your words |
| `character_components_view` | the links with the names filled in, for browsing: `SELECT * FROM character_components_view WHERE hanzi = '妈'` |

Every table has a numeric `id`, and links use these ids. A hanzi (or word) appears only once per user.

Editing a component's meaning on the Add page changes it for that character only. To change it everywhere, edit the `components` table (e.g. in Adminer).

Every row belongs to a user (`app_user` table): each account has its own characters, components and words.

## Accounts

The app opens on a login screen. **Create an account** with an email address and a password (at least 8 characters, letters and a digit or symbol); each account has its own lists, starting empty.

- **Your existing lists** belong to the `default` user (what `npm run db:import` fills). Set `OWNER_EMAIL` to your email address on the server, then create your account with that address: it takes over these lists. This happens once; afterwards `OWNER_EMAIL` does nothing. Create your account soon after deploying, since until then anyone registering with that address would get the lists.
- **Sessions:** logging in creates a session (table `sessions`) valid for 30 days. The browser keeps only a random token (localStorage `hanzi-workshop-session`) and sends it as `Authorization: Bearer …`; the database keeps only its SHA-256 hash. **Log out** ends that session; the other devices stay logged in. To log someone out everywhere: `DELETE FROM sessions WHERE user_id = …`.
- **Passwords** are stored as salted scrypt hashes (`app_user.password_hash`), never shown, logged or kept in the browser. After 10 wrong passwords for one email (or 50 from one address), logging in is blocked for 15 minutes.
- Email addresses are checked (format and length) in the form and again by the server, and compared in lower case.
- Not included yet: email confirmation and "forgot password".
- Review scores are still kept per browser (localStorage), not per account.

`npm run add-components` still works on the JSON files only: run `npm run db:import -- --replace` afterwards to copy the result into the database (this replaces what is there).

### Local database for testing

Needs Docker Desktop (running). MariaDB 11.8, like Hostinger, on port 3307 (user, password and database name: `hanzi`).

```sh
cp .env.example .env.local   # first time: DATABASE_URL for npm start, npm run app and npm run db:import
npm run db:up                # start MariaDB (docker-compose.yml); tables come from db/schema.sql
npm run db:import            # first time: copy data/*.json into it
npm start                    # the log says "Data: MySQL …"
```

- **http://localhost:8080/?server=db&username=hanzi&db=hanzi** is Adminer, a database admin page (also started by `npm run db:up`). The password is `hanzi`.
- `npm run db:sql` opens a SQL prompt, `npm run db:down` stops the database (the data is kept).
- `npm run db:reset` deletes the database and creates it again empty. Run `npm run db:import` afterwards.

## Pages

| Route | Page |
|---|---|
| `/study/:character` | Character card: *Animate* the stroke order, *Practice* drawing with stroke-by-stroke checking, toggle the outline, 🔊 pronunciation, coloured decomposition (red = meaning, blue = sound), stroke-order strip, words, notes. ← → move between characters. |
| `/words`, `/words/:word` | Your words: compose a word by clicking your characters (or type it). Each character shows your pinyin and meaning, or a *+ Add* link if it is not in your list yet. **🔎 Look up meaning** searches CC-CEDICT; words that aren't in it are split into parts it knows. **Save** writes to the database. Each character's Study card lists your words that contain it. |
| `/review` | You are given the pinyin and meaning and write the character from memory. Characters you have never reviewed, or often miss, come back first. Scores are kept in localStorage. |
| `/add`, `/add/:character` | Add or edit a character. Find one by pinyin (`ma`, `ma3`, `mǎ`, `nv3`), or type it: the form fills itself in from the dictionary (pinyin, meaning, type, components with roles and stroke numbers, example words, notes). **Save** writes to the database. |

## Project structure

```
data/characters.json          starting characters (npm run db:import copies them into the database)
data/words.json               starting words
server/server.ts              local API: /api/characters, /api/words (GET/POST/DELETE), /api/lookup/:word
server/cedict.ts              CC-CEDICT word dictionary (downloaded once into .cache/)
server/data-files.ts          reading/writing data/*.json (db:import, add-components)
server/store.ts               the lists in MySQL / MariaDB (DATABASE_URL)
db/schema.sql                 MySQL / MariaDB tables (npm run db:import copies the JSON lists in)
scripts/                      npm run add-components (adds missing components as characters)
src/app/
  app.ts, app.routes.ts       shell (header + tabs) and routes
  core/
    character.model.ts        CharacterEntry types + cleanEntry() (shared with the server)
    config.ts                 TYPES and ROLES: add your own here
    pinyin.ts                 ma1 → mā, tones, search helpers
    characters.service.ts     list signal + save/delete through the API
    dictionary.service.ts     pinyin search and auto-fill (Make Me a Hanzi, Jun Da frequency, HSK words)
    stroke-data.service.ts    Hanzi Writer stroke data + which strokes belong to which component
    stats.service.ts          review scores (localStorage)
  shared/
    hanzi-writer.ts           <app-hanzi-writer>: animation and drawing practice
    stroke-svg.ts             <app-stroke-svg>: static drawing with one colour per stroke
    pinyin.ts                 <app-pinyin>: pinyin coloured by tone
  features/study | review | add
```

## Data format

```json
{
  "character": "妈",
  "pinyin": "ma1",
  "meaning": "mum, mother",
  "type": "phonosemantic",
  "components": [
    { "character": "女", "role": "meaning", "pinyin": "nü3", "meaning": "woman" },
    { "character": "马", "role": "sound", "pinyin": "ma3", "meaning": "horse" }
  ],
  "words": [["妈妈", "ma1ma5", "mum"]],
  "notes": "…"
}
```

- **Pinyin** can be numbered (`ni3 hao3`, `lv4`, `5` = neutral tone) or tone-marked.
- **Types**: `pictogram`, `ideogram` or `phonosemantic`. They are defined in `src/app/core/config.ts`, where you can add your own.
- **Roles**: `meaning`, `sound` or `other`.
- **Components** are listed in writing order. Stroke colouring is automatic when they are written one after the other (妈 = 女 then 马). Otherwise give each component its `strokes`, counting from 1. For example, 国's frame 囗 is `"1-2,8"` and 玉 is `"3-7"`. The dictionary fills these in for you.

Sources:
- [Hanzi Writer](https://hanziwriter.org): stroke order.
- [Make Me a Hanzi](https://github.com/skishore/makemeahanzi): definitions, etymology, decomposition.
- Jun Da's character frequency list.
- [CC-CEDICT](https://cc-cedict.org) (CC BY-SA 4.0): word meanings on the Words page. It is downloaded once into `.cache/`; delete that folder to get a newer version.
- [Complete HSK vocabulary](https://github.com/drkameleon/complete-hsk-vocabulary): example words.
