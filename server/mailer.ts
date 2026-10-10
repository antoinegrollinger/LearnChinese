/* Emails the contact messages and bug reports (feedback.ts) through an SMTP server, when it is
 * configured. Without it, they are only saved in the feedback table.
 *
 *   SMTP_HOST      the SMTP server, e.g. smtp.hostinger.com (required to send emails)
 *   SMTP_PORT      465 (SSL, default) or 587 (STARTTLS)
 *   SMTP_USER      the mailbox that sends, e.g. contact@grolltech.be
 *   SMTP_PASS      its password
 *   FEEDBACK_TO    where the messages go (default: SMTP_USER)
 *   FEEDBACK_FROM  the sender shown (default: "Hanzi Workshop <SMTP_USER>")
 */
import nodemailer from 'nodemailer';

export interface Mail {
  subject: string;
  text: string;
  /** Answering the email writes to this address (the person who sent the message). */
  replyTo?: string;
}

export interface Mailer {
  /** For the startup log. */
  description: string;
  send(mail: Mail): Promise<void>;
}

/** The mailer, or null when SMTP_HOST is not set. */
export function createMailer(env: NodeJS.ProcessEnv = process.env): Mailer | null {
  const host = env['SMTP_HOST'];
  if (!host) return null;
  const port = Number(env['SMTP_PORT'] || 465);
  const user = env['SMTP_USER'] ?? '';
  const to = env['FEEDBACK_TO'] || user;
  if (!to) throw new Error('SMTP_HOST is set: also set FEEDBACK_TO (or SMTP_USER).');
  const from = env['FEEDBACK_FROM'] || (user ? `Hanzi Workshop <${user}>` : to);

  const transport = nodemailer.createTransport({
    host,
    port,
    // Port 465: SSL from the start; other ports (587): upgraded with STARTTLS.
    secure: port === 465,
    auth: user ? { user, pass: env['SMTP_PASS'] ?? '' } : undefined,
  });

  return {
    description: `emailed to ${to} via ${host}:${port}`,
    async send(mail) {
      await transport.sendMail({ from, to, replyTo: mail.replyTo, subject: mail.subject, text: mail.text });
    },
  };
}
