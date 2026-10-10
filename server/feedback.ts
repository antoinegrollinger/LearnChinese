/* The contact and bug report forms of the About page (POST /api/feedback): saved in the feedback
 * table (db/schema.sql), and emailed to the owner when SMTP is configured (mailer.ts). Open to
 * everyone, logged in or not, so:
 * - a hidden "website" field that people leave empty (bots fill in every field);
 * - at most MAX_PER_HOUR messages per IP address.
 */
import mysql from 'mysql2/promise';
import { User } from '../src/app/core/auth.model.ts';
import { FeedbackMessage, cleanFeedback, feedbackErrors } from '../src/app/core/feedback.model.ts';
import { AuthError } from './auth.ts';
import { Mailer } from './mailer.ts';

const MAX_PER_HOUR = 5;
const HOUR = 3600 * 1000;

/** The email of a message: what was sent, who sent it, and (bug reports) where it happened. */
function emailOf(message: FeedbackMessage, user: User | null): { subject: string; text: string } {
  const bug = message.kind === 'bug';
  const sender = [
    message.name,
    message.email ? `<${message.email}>` : '',
    user ? `(account: ${user.username ?? user.email}, id ${user.id})` : '(not logged in)',
  ]
    .filter(Boolean)
    .join(' ');
  const parts = [
    `${bug ? 'Bug report' : 'Contact message'} from ${sender}`,
    '',
    `Subject: ${message.subject}`,
    '',
    message.message,
  ];
  if (bug) {
    if (message.steps) parts.push('', 'Steps to make it happen again:', message.steps);
    if (message.page) parts.push('', `Page: ${message.page}`);
    if (message.context) parts.push(`Context: ${message.context}`);
  }
  parts.push('', '—', 'Sent from the About page of Hanzi Workshop. Answer this email to reply.');
  return {
    subject: `[Hanzi Workshop] ${bug ? 'Bug' : 'Contact'}: ${message.subject}`,
    text: parts.join('\n'),
  };
}

export function createFeedback(pool: mysql.Pool, mailer: Mailer | null = null) {
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

      // Emailed in the background: it is saved already, so a mail problem only gets logged.
      if (mailer) {
        const replyTo = message.email || user?.email || undefined;
        mailer
          .send({ ...emailOf(message, user), replyTo })
          .catch((err) =>
            console.error(`Could not email the message: ${err instanceof Error ? err.message : err}`),
          );
      }
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
