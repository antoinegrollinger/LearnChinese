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
| `api` | `server/server.ts` (run with `tsx`). It reads and writes `data/characters.json`. |

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
| Environment variables | `APP_PASSWORD`: **set one**, otherwise anyone can edit or delete your data. The browser asks for it (any user name).<br>`DATA_DIR`: a folder outside the deployed build, e.g. `/home/<user>/domains/<domain>/hanzi-data`, so your changes survive redeploys. |

Environment variables read by the server:

- `PORT` is set by the host. Without it, the server listens on `localhost:8642`.
- `DATA_DIR`: where `characters.json` and `words.json` are kept. On the first run it is filled with a copy of the project's `data/` folder. Without it, the server uses `data/`, which a redeploy replaces with the version from git.
- `APP_PASSWORD` enables password protection (HTTP Basic auth). It is only safe over HTTPS.
- `CORS_ORIGINS`: only when the app and the API are on different domains (see below). Comma-separated, e.g. `https://example.com,https://www.example.com`.

### App and API on separate domains (e.g. `example.com` + `api.example.com`)

- **API** (`api.example.com`): a Node.js Web App as above, with `CORS_ORIGINS` set to the app's address(es).
- **App** (`example.com`): plain static hosting. Upload the contents of `dist/hanzi-workshop/browser/` to `public_html/` (the included `.htaccess` sends routes like `/study/马` to `index.html`). In the uploaded `config.json`, set `"apiUrl": "https://api.example.com"`. You can change it later without rebuilding.

With `"apiUrl": ""` (the default) the app calls `/api` on its own server, as with `npm start` and `npm run app`. When the API is on another domain and has a password, the app asks for it once and keeps it in the browser's localStorage.

## Pages

| Route | Page |
|---|---|
| `/study/:character` | Character card: *Animate* the stroke order, *Practice* drawing with stroke-by-stroke checking, toggle the outline, 🔊 pronunciation, coloured decomposition (red = meaning, blue = sound), stroke-order strip, words, notes. ← → move between characters. |
| `/words`, `/words/:word` | Your words: compose a word by clicking your characters (or type it). Each character shows your pinyin and meaning, or a *+ Add* link if it is not in your list yet. **🔎 Look up meaning** searches CC-CEDICT; words that aren't in it are split into parts it knows. **Save** writes to `data/words.json`. Each character's Study card lists your words that contain it. |
| `/review` | You are given the pinyin and meaning and write the character from memory. Characters you have never reviewed, or often miss, come back first. Scores are kept in localStorage. |
| `/add`, `/add/:character` | Add or edit a character. Find one by pinyin (`ma`, `ma3`, `mǎ`, `nv3`), or type it: the form fills itself in from the dictionary (pinyin, meaning, type, components with roles and stroke numbers, example words, notes). **Save** writes to `data/characters.json`, keeping the previous version in `data/characters.backup.json`. |

## Project structure

```
data/characters.json          your characters (written by the API)
data/words.json               your words (written by the API)
server/server.ts              local API: /api/characters, /api/words (GET/POST/DELETE), /api/lookup/:word
server/cedict.ts              CC-CEDICT word dictionary (downloaded once into .cache/)
server/data-files.ts          reading/writing data/*.json with backups
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
