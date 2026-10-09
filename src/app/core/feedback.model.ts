/** Shared by the Angular app and server/feedback.ts: the contact and bug report forms (About page). */
import { emailError } from './auth.model';

export type FeedbackKind = 'contact' | 'bug';

/** POST /api/feedback */
export interface FeedbackMessage {
  kind: FeedbackKind;
  /** Contact: who writes (optional). */
  name?: string;
  /** Where to answer: required for a contact message, optional for a bug report. */
  email?: string;
  /** Contact: the subject; bug: what went wrong, in a few words. */
  subject: string;
  /** Contact: the message; bug: what happened. */
  message: string;
  /** Bug: how to make it happen again (optional). */
  steps?: string;
  /** Bug: added by the page (where the person came from, browser, screen, theme). */
  page?: string;
  context?: string;
  /** Left empty by people; bots filling every field are ignored. */
  website?: string;
}

export const FEEDBACK_LIMITS = {
  name: 100,
  email: 254,
  subject: 150,
  message: 5000,
  steps: 5000,
  page: 500,
  context: 1000,
};
export const MESSAGE_MIN_LENGTH = 10;

const text = (v: unknown, max: number): string =>
  typeof v === 'string' ? v.trim().slice(0, max) : '';

/** Keeps the known fields, trimmed and within their limits. */
export function cleanFeedback(raw: unknown): FeedbackMessage {
  const r = (raw ?? {}) as Record<string, unknown>;
  const L = FEEDBACK_LIMITS;
  return {
    kind: r['kind'] === 'bug' ? 'bug' : 'contact',
    name: text(r['name'], L.name),
    email: text(r['email'], L.email).toLowerCase(),
    subject: text(r['subject'], L.subject),
    message: text(r['message'], L.message),
    steps: text(r['steps'], L.steps),
    page: text(r['page'], L.page),
    context: text(r['context'], L.context),
    website: text(r['website'], 200),
  };
}

/** Errors by field ('' when valid), with the same rules on both sides. */
export function feedbackErrors(m: FeedbackMessage): Partial<Record<keyof FeedbackMessage, string>> {
  const errors: Partial<Record<keyof FeedbackMessage, string>> = {};
  if (m.kind === 'contact' && !m.email)
    errors.email = 'Enter your email address, to get an answer.';
  else if (m.email && emailError(m.email)) errors.email = emailError(m.email)!;
  if (!m.subject) {
    errors.subject = m.kind === 'bug' ? 'Say in a few words what went wrong.' : 'Enter a subject.';
  }
  if (m.message.length < MESSAGE_MIN_LENGTH) {
    errors.message = `Write at least ${MESSAGE_MIN_LENGTH} characters.`;
  }
  return errors;
}
