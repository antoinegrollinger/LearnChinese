/* Local API that reads and writes data/characters.json (no dependencies besides Node).
 *
 *   GET    /api/characters             → the list
 *   POST   /api/characters             → add or update one character (body: CharacterEntry)
 *   DELETE /api/characters/:character  → delete one character
 *
 * During development (npm start) Angular's dev server forwards /api to this server (proxy.conf.json).
 * With `npm run app`, it also serves the built app from dist/.
 */
import { createReadStream, existsSync } from 'node:fs';
import { IncomingMessage, ServerResponse, createServer } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import { cleanEntry } from '../src/app/core/character.model.ts';
import { ROOT, readCharacters, writeCharacters } from './characters-file.ts';

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

async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const [, , resource, param] = url.pathname.split('/'); // "", "api", "characters", ":character"
  if (resource !== 'characters') return sendJson(res, 404, { error: 'Unknown API route.' });

  if (req.method === 'GET' && !param) {
    return sendJson(res, 200, await readCharacters());
  }

  if (req.method === 'POST' && !param) {
    const entry = cleanEntry(JSON.parse(await readBody(req)));
    if (!entry.character) return sendJson(res, 400, { error: 'The character is missing.' });
    const list = await readCharacters();
    const i = list.findIndex((c) => c.character === entry.character);
    if (i >= 0) list[i] = entry;
    else list.push(entry);
    await writeCharacters(list);
    console.log(`${i >= 0 ? 'Updated' : 'Added'} ${entry.character}`);
    return sendJson(res, 200, { entry, created: i < 0 });
  }

  if (req.method === 'DELETE' && param) {
    const character = decodeURIComponent(param);
    const list = await readCharacters();
    const kept = list.filter((c) => c.character !== character);
    if (kept.length === list.length) return sendJson(res, 404, { error: 'Character not found.' });
    await writeCharacters(kept);
    console.log(`Deleted ${character}`);
    return sendJson(res, 200, { ok: true });
  }

  sendJson(res, 405, { error: 'Method not allowed.' });
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
  console.log(`API ready on http://localhost:${PORT} (data: data/characters.json)`);
});
