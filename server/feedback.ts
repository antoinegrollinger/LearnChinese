/* The contact and bug report forms of the About page (POST /api/feedback): saved in the feedback
 * table (db/schema.sql), for the owner to read. Open to everyone, logged in or not, so:
 * - a hidden "website" field that people leave empty (bots fill in every field);
 * - at most MAX_PER_HOUR messages per IP address.
 */
import mysql from 'mysql2/promise';
import { User } from '../src/app/core/auth.model.ts';
import { cleanFeedback, feedbackErrors } from '../src/app/core/feedback.model.ts';
import { AuthError } from './auth.ts';

const MAX_PER_HOUR = 5;
const HOUR = 3600 * 1000;

export function createFeedback(pool: mysql.Pool) {
  /** Times of the recent messages, per IP address. */
  const recent = new Map<string, number[]>();

  return {
    async submit(body: unknown, user: User | null, ip: string): Promise<void> {
      const message = cleanFeedback(body);
      // A bot: pretend it worked, keep nothing.
      if (message.website) return;

      const errors = Object.values(feedbackErrors(message));
      if (errors.length) throw new AuthError(400, errors.join(' '));

      const now = Date.now();
      const times = (recent.get(ip) ?? []).filter((t) => now - t < HOUR);
      if (times.length >= MAX_PER_HOUR) {
        throw new AuthError(429, 'Too many messages in a short time. Please try again in an hour.');
      }
      recent.set(ip, [...times, now]);

      await pool.query(
        `INSERT INTO feedback (kind, user_id, name, email, subject, message, steps, page, context)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          message.kind,
          user?.id ?? null,
          message.name || null,
          message.email || user?.email || null,
          message.subject,
          message.message,
          message.steps || null,
          message.page || null,
          message.context || null,
        ],
      );
      console.log(
        `New ${message.kind === 'bug' ? 'bug report' : 'contact message'}: "${message.subject}"` +
          (user ? ` (user ${user.id})` : ''),
      );
    },

    /** Forgets the old rate-limit entries (with the hourly cleanup). */
    cleanup(): void {
      const now = Date.now();
      for (const [ip, times] of recent) {
        if (times.every((t) => now - t >= HOUR)) recent.delete(ip);
      }
    },
  };
}
