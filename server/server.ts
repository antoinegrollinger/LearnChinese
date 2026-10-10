/* API that reads and writes each user's characters and words in MySQL / MariaDB (DATABASE_URL, see
 * store.ts and db/schema.sql). Every route except /api/auth/register, /api/auth/login and
 * /api/feedback needs "Authorization: Bearer <token>" from a login (see auth.ts).
 *
 *   /api/auth/register, /login, /logout, /me                     accounts and sessions (see auth.ts)
 *   GET    /api/characters             → the list           (same routes for /api/words)
 *   POST   /api/characters             → add or update one character (body: CharacterEntry)
 *   DELETE /api/characters/:character  → delete one character
 *   GET    /api/labels                 → the labels ({ name, color }); same POST and DELETE routes
 *                                         (a character's or word's label is also created when it is saved)
 *   GET    /api/reviews                → completed review sessions, newest first
 *   POST   /api/reviews                → save one (body: ReviewSession) → { entry, created }
 *   DELETE /api/reviews/:id            → delete one
 *
 *   Friends and communities (see social.ts):
 *   GET    /api/social/settings        → { shareReviews }; PATCH { shareReviews } to change it
 *   GET    /api/friends                → { friends, incoming, outgoing }
 *   POST   /api/friends                → send a friend request { username } (accepts theirs, if any)
 *   POST   /api/friends/:username/accept
 *   DELETE /api/friends/:username      → remove a friend, decline or cancel a request
 *   GET    /api/friends/:username      → a friend's counts, and reviews if they share them
 *   GET    /api/communities?q=…&all=1  → yours, or all of them (all=1), whose name contains q
 *   POST   /api/communities            → create one { name, description } and join it
 *   GET    /api/communities/:name      → its counts; members only for members
 *   POST   /api/communities/:name/join     → joins, or asks to join (join policy "approval")
 *   POST   /api/communities/:name/cancel   → withdraws your join request
 *   POST   /api/communities/:name/leave
 *   PATCH  /api/communities/:name          → owner: { description, joinPolicy, memberList }
 *   POST   /api/communities/:name/approve, /reject  { username } → owner or admin
 *   POST   /api/communities/:name/role     { username, role } → owner: "admin", "member" or "owner"
 *   POST   /api/communities/:name/remove   { username } → owner, or admin for regular members
 *   GET    /api/notifications          → requests waiting for you and the latest updates
 *   POST   /api/notifications/read     → marks the updates as read
 *   DELETE /api/notifications/:id      → dismisses one update
 *
 *   POST   /api/feedback               → About page: contact message or bug report (no login needed)
 *
 *   GET    /api/lookup/:word           → CC-CEDICT entries for a word (see cedict.ts)
 *
 * During development (npm start) Angular's dev server forwards /api to this server (proxy.conf.json).
 * With `npm run app`, it also serves the built app from dist/.
 */
import { createReadStream, existsSync } from 'node:fs';
import { IncomingMessage, ServerResponse, createServer } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import { lookupWord, loadCedict } from './cedict.ts';
import { User } from '../src/app/core/auth.model.ts';
import { AuthError, createAuth } from './auth.ts';
import { CHARACTERS, ListFile, ROOT, WORDS } from './data-files.ts';
import { Label, cleanLabel } from '../src/app/core/character.model.ts';
import { cleanReview } from '../src/app/core/review.model.ts';
import { createFeedback } from './feedback.ts';
import { createMailer } from './mailer.ts';
import { createSocial } from './social.ts';
import { ListStore, createStores } from './store.ts';

const DIST = join(ROOT, 'dist', 'hanzi-workshop', 'browser');
/** MySQL / MariaDB (see store.ts). */
const stores = (() => {
  try {
    return createStores();
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
})();
const auth = createAuth(stores.pool);
const social = createSocial(stores.pool, stores.reviews);
/** Emails the contact messages and bug reports (SMTP_*, FEEDBACK_TO: see mailer.ts), if set. */
const mailer = (() => {
  try {
    return createMailer();
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
})();
const feedback = createFeedback(stores.pool, mailer);
/** The labels are only in the database (no JSON file). */
const LABELS: ListFile<Label> = { name: 'labels', key: 'name', clean: cleanLabel };
/** Set by the host in production (a port number or a socket path); 8642 on your computer. */
const PORT = process.env['PORT'];
const LOCAL_PORT = 8642;

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

/** The session token from "Authorization: Bearer <token>". */
function bearerToken(req: IncomingMessage): string | undefined {
  const [scheme, token] = (req.headers.authorization ?? '').split(' ');
  return scheme === 'Bearer' && token ? token : undefined;
}

/** The visitor's address, for limiting failed logins (behind Hostinger's proxy: X-Forwarded-For). */
function clientIp(req: IncomingMessage): string {
  const forwarded = req.headers['x-forwarded-for'];
  const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim();
  return first || req.socket.remoteAddress || '';
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
    if (data.length > 1e6) throw new AuthError(413, 'Request too large.');
  }
  return data;
}

/** The JSON body. Its text never goes into an error message (it may contain a password). */
async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  try {
    const body = JSON.parse(await readBody(req));
    if (body && typeof body === 'object') return body;
  } catch (err) {
    if (err instanceof AuthError) throw err;
  }
  throw new AuthError(400, 'The request is not valid JSON.');
}

/** /api/auth/... (see auth.ts). */
async function handleAuth(req: IncomingMessage, res: ServerResponse, action?: string): Promise<void> {
  const userAgent = req.headers['user-agent'];
  if (req.method === 'POST' && action === 'register') {
    const { email, username, password } = await readJson(req);
    const session = await auth.register(email, username, password, userAgent);
    console.log(`New account ${session.user.username} <${session.user.email}> (user ${session.user.id})`);
    return sendJson(res, 201, session);
  }
  if (req.method === 'POST' && action === 'login') {
    const { login, password } = await readJson(req);
    const session = await auth.login(login, password, clientIp(req), userAgent);
    console.log(`Login ${session.user.username ?? session.user.email} (user ${session.user.id})`);
    return sendJson(res, 200, session);
  }
  if (req.method === 'POST' && action === 'logout') {
    await auth.logout(bearerToken(req));
    return sendJson(res, 200, { ok: true });
  }
  if (action === 'me' && (req.method === 'GET' || req.method === 'PATCH')) {
    const user = await auth.userOf(bearerToken(req));
    if (!user) throw new AuthError(401, 'Please log in.');
    if (req.method === 'GET') return sendJson(res, 200, { user });
    const { username } = await readJson(req);
    const updated = await auth.setUsername(user, username);
    console.log(`User ${user.id} is now ${updated.username}`);
    return sendJson(res, 200, { user: updated });
  }
  sendJson(res, 404, { error: 'Unknown API route.' });
}

/** /api/reviews: the completed review sessions. */
async function handleReviews(
  user: User,
  req: IncomingMessage,
  res: ServerResponse,
  param?: string,
): Promise<void> {
  if (req.method === 'GET' && !param) return sendJson(res, 200, await stores.reviews.all(user.id));

  if (req.method === 'POST' && !param) {
    const session = cleanReview(await readJson(req));
    if (!session.finishedAt || !session.results.length) {
      return sendJson(res, 400, { error: 'The session needs a date and at least one character.' });
    }
    const entry = await stores.reviews.add(user.id, session);
    console.log(`Saved review ${entry.id} of ${session.results.length} characters (user ${user.id})`);
    return sendJson(res, 200, { entry, created: true });
  }

  if (req.method === 'DELETE' && param) {
    if (!(await stores.reviews.remove(user.id, Number(param)))) {
      return sendJson(res, 404, { error: 'Not found.' });
    }
    return sendJson(res, 200, { ok: true });
  }

  sendJson(res, 405, { error: 'Method not allowed.' });
}

/** /api/social, /api/friends and /api/communities (see social.ts). */
async function handleSocial(
  user: User,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  resource: string,
  param?: string,
  action?: string,
): Promise<void> {
  const name = param ? decodeURIComponent(param) : undefined;
  const { method } = req;

  if (resource === 'social' && name === 'settings' && !action) {
    if (method === 'GET') return sendJson(res, 200, await social.settings(user));
    if (method === 'PATCH') return sendJson(res, 200, await social.setSettings(user, await readJson(req)));
  }

  if (resource === 'friends') {
    if (!name && method === 'GET') return sendJson(res, 200, await social.overview(user));
    if (!name && method === 'POST') {
      const relation = await social.request(user, (await readJson(req))['username']);
      return sendJson(res, 200, { relation });
    }
    if (name && action === 'accept' && method === 'POST') {
      return sendJson(res, 200, { relation: await social.accept(user, name) });
    }
    if (name && !action && method === 'DELETE') {
      await social.remove(user, name);
      return sendJson(res, 200, { ok: true });
    }
    if (name && !action && method === 'GET') return sendJson(res, 200, await social.profile(user, name));
  }

  if (resource === 'communities') {
    if (!name && method === 'GET') {
      const all = url.searchParams.get('all') === '1';
      return sendJson(res, 200, await social.searchCommunities(user, url.searchParams.get('q') ?? '', all));
    }
    if (!name && method === 'POST') {
      return sendJson(res, 200, await social.createCommunity(user, await readJson(req)));
    }
    if (name && !action && method === 'GET') return sendJson(res, 200, await social.community(user, name));
    if (name && action === 'join' && method === 'POST') {
      return sendJson(res, 200, await social.join(user, name));
    }
    if (name && action === 'leave' && method === 'POST') {
      await social.leave(user, name);
      return sendJson(res, 200, { ok: true });
    }
    if (name && action === 'cancel' && method === 'POST') {
      return sendJson(res, 200, await social.cancelRequest(user, name));
    }
    if (name && !action && method === 'PATCH') {
      return sendJson(res, 200, await social.updateCommunity(user, name, await readJson(req)));
    }
    if (name && (action === 'approve' || action === 'reject') && method === 'POST') {
      const { username } = await readJson(req);
      return sendJson(res, 200, await social.answerRequest(user, name, username, action === 'approve'));
    }
    if (name && action === 'role' && method === 'POST') {
      const { username, role } = await readJson(req);
      return sendJson(res, 200, await social.setRole(user, name, username, role));
    }
    if (name && action === 'remove' && method === 'POST') {
      const { username } = await readJson(req);
      return sendJson(res, 200, await social.removeMember(user, name, username));
    }
  }

  if (resource === 'notifications') {
    if (!name && method === 'GET') return sendJson(res, 200, await social.notifications(user));
    if (name === 'read' && method === 'POST') {
      await social.markNotificationsRead(user);
      return sendJson(res, 200, { ok: true });
    }
    if (name && !action && method === 'DELETE') {
      await social.dismissNotification(user, Number(name));
      return sendJson(res, 200, { ok: true });
    }
  }

  sendJson(res, 404, { error: 'Unknown API route.' });
}

/** CRUD routes for one list: GET /api/<name>, POST /api/<name>, DELETE /api/<name>/:key */
async function handleList<T>(
  list: ListFile<T>,
  store: ListStore<T>,
  user: User,
  req: IncomingMessage,
  res: ServerResponse,
  param?: string,
): Promise<void> {
  if (req.method === 'GET' && !param) return sendJson(res, 200, await store.all(user.id));

  if (req.method === 'POST' && !param) {
    const entry = list.clean(await readJson(req));
    const key = String(entry[list.key]);
    if (!key) return sendJson(res, 400, { error: `The ${list.key} is missing.` });
    const created = await store.save(user.id, entry);
    console.log(`${created ? 'Added' : 'Updated'} ${list.key} ${key} (user ${user.id})`);
    return sendJson(res, 200, { entry, created });
  }

  if (req.method === 'DELETE' && param) {
    const key = decodeURIComponent(param);
    if (!(await store.remove(user.id, key))) return sendJson(res, 404, { error: 'Not found.' });
    console.log(`Deleted ${list.key} ${key} (user ${user.id})`);
    return sendJson(res, 200, { ok: true });
  }

  sendJson(res, 405, { error: 'Method not allowed.' });
}

async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  // "", "api", "characters", ":character" (and "accept", "join"… for friends and communities)
  const [, , resource, param, action] = url.pathname.split('/');
  if (resource === 'auth') return handleAuth(req, res, param);
  // The About page's forms: for everyone (with the account, when logged in).
  if (resource === 'feedback' && !param && req.method === 'POST') {
    const sender = await auth.userOf(bearerToken(req));
    await feedback.submit(await readJson(req), sender, clientIp(req));
    return sendJson(res, 200, { ok: true });
  }

  // Everything else: only for a logged-in user, on their own data.
  const user = await auth.userOf(bearerToken(req));
  if (!user) throw new AuthError(401, 'Please log in.');
  if (resource === 'characters') return handleList(CHARACTERS, stores.characters, user, req, res, param);
  if (resource === 'words') return handleList(WORDS, stores.words, user, req, res, param);
  if (resource === 'labels') return handleList(LABELS, stores.labels, user, req, res, param);
  if (resource === 'reviews') return handleReviews(user, req, res, param);
  if (['social', 'friends', 'communities', 'notifications'].includes(resource)) {
    return handleSocial(user, req, res, url, resource, param, action);
  }
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
      // Preflight: the browser checks what it may send before the real request (no token yet).
      res.writeHead(204, {
        'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Max-Age': '86400',
      });
      res.end();
      return;
    }
    if (url.pathname.startsWith('/api/')) await handleApi(req, res, url);
    else serveApp(res, url);
  } catch (err) {
    if (err instanceof AuthError) return sendJson(res, err.status, { error: err.message });
    // Details (database errors…) only go to the server log, not to the browser.
    console.error(err);
    sendJson(res, 500, { error: 'Server error. Please try again later.' });
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
  console.log(`Data: ${stores.description} · accounts${auth.owner ? ` (owner: ${auth.owner})` : ''}`);
  if (CORS_ORIGINS.length) console.log(`Accepting API calls from ${CORS_ORIGINS.join(', ')}`);
  console.log(
    `Contact messages: saved in the feedback table` +
      (mailer ? ` and ${mailer.description}` : ' (set SMTP_HOST to also get them by email)'),
  );
  stores.check().then(
    () => console.log('Database connected'),
    (err) =>
      console.error(
        `Database not ready: ${err.message}. Is it running, and were the tables created (npm run db:import)?`,
      ),
  );
  loadCedict().catch(() => {}); // warm up the word dictionary
  // Expired sessions and old notifications
  const cleanup = () => {
    auth.cleanup().catch(() => {});
    social.cleanup().catch(() => {});
    feedback.cleanup();
  };
  setInterval(cleanup, 3600 * 1000).unref();
  cleanup();
};

// In production listen where the host says; on your computer only accept local connections.
if (PORT) server.listen(/^\d+$/.test(PORT) ? Number(PORT) : PORT, onListening);
else server.listen(LOCAL_PORT, '127.0.0.1', onListening);
