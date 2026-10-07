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
import { createHash, timingSafeEqual } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { IncomingMessage, ServerResponse, createServer } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import { lookupWord, loadCedict } from './cedict.ts';
import { CHARACTERS, DATA_DIR, ListFile, ROOT, WORDS, readList, writeList } from './data-files.ts';

const DIST = join(ROOT, 'dist', 'hanzi-workshop', 'browser');
/** Set by the host in production (a port number or a socket path); 8642 on your computer. */
const PORT = process.env['PORT'];
const LOCAL_PORT = 8642;
/** When set, every request needs this password (HTTP Basic auth, any user name). */
const PASSWORD = process.env['APP_PASSWORD'];

/**
 * Sites allowed to call the API from another domain, comma-separated
 * (e.g. "https://example.com,https://www.example.com"). Only needed when the app and the API are on different domains.
 */
const CORS_ORIGINS = (process.env['CORS_ORIGINS'] ?? '')
  .split(',')
  .map((origin) => origin.trim().replace(/\/+$/, ''))
  .filter(Boolean);

/** Adds the CORS headers for an allowed origin. Returns true when the request came from one. */
function allowCors(req: IncomingMessage, res: ServerResponse): boolean {
  const origin = req.headers.origin;
  if (!origin || !CORS_ORIGINS.includes(origin)) return false;
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  return true;
}

/** Checks the password, if one is configured. Returns false after asking the browser for it. */
function authorized(req: IncomingMessage, res: ServerResponse, crossOrigin: boolean): boolean {
  if (!PASSWORD) return true;
  const [scheme, encoded] = (req.headers.authorization ?? '').split(' ');
  if (scheme === 'Basic' && encoded) {
    const decoded = Buffer.from(encoded, 'base64').toString('utf8');
    const sha = (text: string) => createHash('sha256').update(text).digest();
    if (timingSafeEqual(sha(decoded.slice(decoded.indexOf(':') + 1)), sha(PASSWORD))) return true;
  }
  // From another domain the app asks for the password itself (src/app/core/api.interceptor.ts).
  res.writeHead(
    401,
    crossOrigin ? {} : { 'WWW-Authenticate': 'Basic realm="Hanzi Workshop", charset="UTF-8"' },
  );
  res.end('Password required.');
  return false;
}

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
    const crossOrigin = allowCors(req, res);
    if (crossOrigin && req.method === 'OPTIONS') {
      // Preflight: the browser checks what it may send before the real request (no password yet).
      res.writeHead(204, {
        'Access-Control-Allow-Methods': 'GET, POST, DELETE',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Max-Age': '86400',
      });
      res.end();
      return;
    }
    if (!authorized(req, res, crossOrigin)) return;
    if (url.pathname.startsWith('/api/')) await handleApi(req, res, url);
    else serveApp(res, url);
  } catch (err) {
    console.error(err);
    sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
  }
});

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT ?? LOCAL_PORT} is already in use: is the app already running?`);
    process.exit(1);
  }
  throw err;
});

const onListening = () => {
  console.log(
    PORT ? `Hanzi Workshop listening on ${PORT}` : `API ready on http://localhost:${LOCAL_PORT}`,
  );
  console.log(`Data: ${DATA_DIR}${PASSWORD ? ' · password protected' : ''}`);
  if (CORS_ORIGINS.length) console.log(`Accepting API calls from ${CORS_ORIGINS.join(', ')}`);
  loadCedict().catch(() => {}); // warm up the word dictionary
};

// In production listen where the host says; on your computer only accept local connections.
if (PORT) server.listen(/^\d+$/.test(PORT) ? Number(PORT) : PORT, onListening);
else server.listen(LOCAL_PORT, '127.0.0.1', onListening);
