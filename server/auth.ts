/* Accounts and sessions (tables app_user and sessions in db/schema.sql).
 *
 *   POST /api/auth/register  { email, password } → Session (also logs in)
 *   POST /api/auth/login     { email, password } → Session
 *   POST /api/auth/logout    ends the session of the token sent
 *   GET  /api/auth/me        → { user } for the token sent
 *
 * The app sends "Authorization: Bearer <token>" with every other API call. Passwords are only kept
 * as salted scrypt hashes and never logged; tokens are random and only their SHA-256 is stored.
 *
 *   OWNER_EMAIL   optional: the account registered with this email takes over the "default"
 *                 user's lists (the ones imported by npm run db:import), once.
 */
import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import mysql from 'mysql2/promise';
import {
  PASSWORD_MAX_LENGTH,
  Session,
  User,
  emailError,
  normalizeEmail,
  passwordError,
} from '../src/app/core/auth.model.ts';

/** An error with the HTTP status and message to send back. */
export class AuthError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const SESSION_DAYS = 30;
/** scrypt cost: about 50 ms and 16 MB per hash. */
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

function derive(password: string, salt: Buffer, N: number, r: number, p: number, keylen: number) {
  return new Promise<Buffer>((resolve, reject) =>
    scrypt(password, salt, keylen, { N, r, p, maxmem: 64 * 1024 * 1024 }, (err, key) =>
      err ? reject(err) : resolve(key),
    ),
  );
}

/** "scrypt$N$r$p$salt$hash": everything needed to check the password later, but not the password. */
export async function hashPassword(password: string): Promise<string> {
  const { N, r, p, keylen } = SCRYPT;
  const salt = randomBytes(16);
  const hash = await derive(password, salt, N, r, p, keylen);
  return ['scrypt', N, r, p, salt.toString('base64'), hash.toString('base64')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algorithm, N, r, p, salt, hash] = stored.split('$');
  if (algorithm !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = await derive(password, Buffer.from(salt, 'base64'), +N, +r, +p, expected.length);
  return timingSafeEqual(actual, expected);
}

/** Checked when the email is unknown, so that takes as long as a wrong password. */
const DUMMY_HASH = hashPassword(randomBytes(16).toString('hex'));

const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');

/** Failed logins per email and per IP address: after too many, wait a quarter of an hour. */
class Limiter {
  private readonly failures = new Map<string, { count: number; since: number }>();
  constructor(
    private readonly max: number,
    private readonly windowMs = 15 * 60 * 1000,
  ) {}
  blocked(key: string): boolean {
    const f = this.failures.get(key);
    if (f && Date.now() - f.since > this.windowMs) this.failures.delete(key);
    return (this.failures.get(key)?.count ?? 0) >= this.max;
  }
  fail(key: string): void {
    const f = this.failures.get(key) ?? { count: 0, since: Date.now() };
    f.count++;
    this.failures.set(key, f);
  }
  reset(key: string): void {
    this.failures.delete(key);
  }
}

type Rows = mysql.RowDataPacket[];
type Result = mysql.ResultSetHeader;

export function createAuth(pool: mysql.Pool, ownerEmail = process.env['OWNER_EMAIL']) {
  const byEmail = new Limiter(10);
  const byIp = new Limiter(50);
  const owner = ownerEmail ? normalizeEmail(ownerEmail) : null;

  async function newSession(user: User, userAgent?: string): Promise<Session> {
    const token = randomBytes(32).toString('base64url');
    await pool.query(
      `INSERT INTO sessions (user_id, token_hash, expires_at, user_agent)
       VALUES (?, ?, CURRENT_TIMESTAMP + INTERVAL ? DAY, ?)`,
      [user.id, tokenHash(token), SESSION_DAYS, userAgent?.slice(0, 255) ?? null],
    );
    await pool.query(`UPDATE app_user SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?`, [user.id]);
    const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 3600 * 1000).toISOString();
    return { token, user, expiresAt };
  }

  return {
    owner,

    async register(email: unknown, password: unknown, userAgent?: string): Promise<Session> {
      if (typeof email !== 'string' || typeof password !== 'string') {
        throw new AuthError(400, 'Enter an email address and a password.');
      }
      const invalid = emailError(email) ?? passwordError(password);
      if (invalid) throw new AuthError(400, invalid);
      const address = normalizeEmail(email);
      const hash = await hashPassword(password);

      try {
        // The owner's first registration takes over the imported lists of the "default" user.
        if (owner && address === owner) {
          const [claimed] = await pool.query<Result>(
            `UPDATE app_user SET email = ?, password_hash = ? WHERE username = 'default' AND email IS NULL`,
            [address, hash],
          );
          if (claimed.affectedRows) {
            const [[row]] = await pool.query<Rows>(`SELECT id FROM app_user WHERE email = ?`, [address]);
            return newSession({ id: Number(row['id']), email: address }, userAgent);
          }
        }
        const [result] = await pool.query<Result>(
          `INSERT INTO app_user (email, password_hash) VALUES (?, ?)`,
          [address, hash],
        );
        return newSession({ id: result.insertId, email: address }, userAgent);
      } catch (err) {
        if ((err as { code?: string }).code === 'ER_DUP_ENTRY') {
          throw new AuthError(409, 'An account with this email address already exists. Log in instead.');
        }
        throw err;
      }
    },

    async login(email: unknown, password: unknown, ip: string, userAgent?: string): Promise<Session> {
      const address = typeof email === 'string' ? normalizeEmail(email) : '';
      if (byEmail.blocked(address) || byIp.blocked(ip)) {
        throw new AuthError(429, 'Too many failed attempts. Try again in 15 minutes.');
      }
      const valid =
        typeof password === 'string' &&
        password.length > 0 &&
        password.length <= PASSWORD_MAX_LENGTH &&
        !emailError(address);
      const [[row]] = valid
        ? await pool.query<Rows>(`SELECT id, email, password_hash FROM app_user WHERE email = ?`, [
            address,
          ])
        : [[undefined]];
      const stored = row?.['password_hash'] ?? (await DUMMY_HASH);
      const ok = valid && (await verifyPassword(password as string, stored)) && !!row?.['password_hash'];
      if (!ok || !row) {
        byEmail.fail(address);
        byIp.fail(ip);
        throw new AuthError(401, 'Wrong email or password.');
      }
      byEmail.reset(address);
      return newSession({ id: Number(row['id']), email: row['email'] }, userAgent);
    },

    /** The user of a valid, unexpired session token, or null. */
    async userOf(token: string | undefined): Promise<User | null> {
      if (!token || token.length > 100) return null;
      const [[row]] = await pool.query<Rows>(
        `SELECT u.id, u.email, s.id AS session_id FROM sessions s JOIN app_user u ON u.id = s.user_id
         WHERE s.token_hash = ? AND s.expires_at > CURRENT_TIMESTAMP`,
        [tokenHash(token)],
      );
      if (!row) return null;
      await pool.query(
        `UPDATE sessions SET last_seen_at = CURRENT_TIMESTAMP
         WHERE id = ? AND last_seen_at < CURRENT_TIMESTAMP - INTERVAL 1 MINUTE`,
        [row['session_id']],
      );
      return { id: Number(row['id']), email: row['email'] };
    },

    async logout(token: string | undefined): Promise<void> {
      if (token) await pool.query(`DELETE FROM sessions WHERE token_hash = ?`, [tokenHash(token)]);
    },

    /** Deletes expired sessions. */
    async cleanup(): Promise<void> {
      await pool.query(`DELETE FROM sessions WHERE expires_at <= CURRENT_TIMESTAMP`);
    },
  };
}

export type Auth = ReturnType<typeof createAuth>;
