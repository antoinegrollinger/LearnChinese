/* Local API that reads and writes data/characters.json and data/words.json (no dependencies besides Node).
 *
 *   GET    /api/characters             → the list           (same routes for /api/words)
 *   POST   /api/characters             → add or update one character (body: CharacterEntry)
 *   DELETE /api/characters/:character  → delete one character
 *   GET    /api/lookup/:word           → CC-CEDICT entries for a word (see cedict.ts)
 *
 * During development (npm start) Angular's dev server forwards /api to this server (proxy.conf.json).
 * With `npm run app`, it also serves the built app from dist/.
 */
import { createReadStream, existsSync } from 'node:fs';
import { IncomingMessage, ServerResponse, createServer } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import { lookupWord, loadCedict } from './cedict.ts';
import { CHARACTERS, ListFile, ROOT, WORDS, readList, writeList } from './data-files.ts';

const DIST = join(ROOT, 'dist', 'hanzi-workshop', 'browser');
const PORT = Number(process.env['PORT']) || 8642;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<string> {
  let data = '';
  for await (const chunk of req) {
    data += chunk;
    if (data.length > 1e6) throw new Error('Request too large');
  }
  return data;
}

/** CRUD routes for one JSON list: GET /api/<name>, POST /api/<name>, DELETE /api/<name>/:key */
async function handleList<T>(
  list: ListFile<T>,
  req: IncomingMessage,
  res: ServerResponse,
  param?: string,
): Promise<void> {
  const keyOf = (item: T) => String(item[list.key]);

  if (req.method === 'GET' && !param) return sendJson(res, 200, await readList(list));

  if (req.method === 'POST' && !param) {
    const entry = list.clean(JSON.parse(await readBody(req)));
    if (!keyOf(entry)) return sendJson(res, 400, { error: `The ${list.key} is missing.` });
    const items = await readList(list);
    const i = items.findIndex((item) => keyOf(item) === keyOf(entry));
    if (i >= 0) items[i] = entry;
    else items.push(entry);
    await writeList(list, items);
    console.log(`${i >= 0 ? 'Updated' : 'Added'} ${list.key} ${keyOf(entry)}`);
    return sendJson(res, 200, { entry, created: i < 0 });
  }

  if (req.method === 'DELETE' && param) {
    const key = decodeURIComponent(param);
    const items = await readList(list);
    const kept = items.filter((item) => keyOf(item) !== key);
    if (kept.length === items.length) return sendJson(res, 404, { error: 'Not found.' });
    await writeList(list, kept);
    console.log(`Deleted ${list.key} ${key}`);
    return sendJson(res, 200, { ok: true });
  }

  sendJson(res, 405, { error: 'Method not allowed.' });
}

async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const [, , resource, param] = url.pathname.split('/'); // "", "api", "characters", ":character"
  if (resource === 'characters') return handleList(CHARACTERS, req, res, param);
  if (resource === 'words') return handleList(WORDS, req, res, param);
  if (resource === 'lookup' && param && req.method === 'GET') {
    return sendJson(res, 200, await lookupWord(decodeURIComponent(param)));
  }
  sendJson(res, 404, { error: 'Unknown API route.' });
}

/** Serves the built app (npm run app), falling back to index.html for client-side routes. */
function serveApp(res: ServerResponse, url: URL): void {
  if (!existsSync(DIST)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('API only. Use "npm start" and open http://localhost:4200');
    return;
  }
  let file = resolve(DIST, '.' + decodeURIComponent(url.pathname));
  if (!file.startsWith(DIST + sep) || !existsSync(file) || !extname(file)) {
    file = join(DIST, 'index.html');
  }
  res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) await handleApi(req, res, url);
    else serveApp(res, url);
  } catch (err) {
    console.error(err);
    sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
  }
});

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use: is the app already running?`);
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(
    `API ready on http://localhost:${PORT} (data: data/characters.json, data/words.json)`,
  );
  loadCedict().catch(() => {}); // warm up the word dictionary
});
