/** Shared by the Angular app and server/auth.ts. */

export interface User {
  id: number;
  email: string;
}

/** Returned by POST /api/auth/login and /api/auth/register. */
export interface Session {
  /** Sent back as "Authorization: Bearer <token>". Only its hash is stored on the server. */
  token: string;
  user: User;
  /** ISO date */
  expiresAt: string;
}

export const PASSWORD_MIN_LENGTH = 8;
/** Long enough for any passphrase, short enough to keep hashing fast. */
export const PASSWORD_MAX_LENGTH = 128;

/** Trims and lower-cases, so "Me@Example.com " and "me@example.com" are the same account. */
export const normalizeEmail = (email: string): string => email.trim().toLowerCase();

/**
 * Practical email check: one @, no spaces, a dot in the domain, and the lengths allowed by the
 * standard (64 before the @, 254 in total). Returns an error message, or null when it is valid.
 */
export function emailError(email: string): string | null {
  const value = normalizeEmail(email);
  if (!value) return 'Enter your email address.';
  if (value.length > 254) return 'This email address is too long.';
  const match = /^([^\s@]+)@([^\s@]+)$/.exec(value);
  if (!match) return 'Enter a valid email address, e.g. name@example.com.';
  const [, local, domain] = match;
  if (local.length > 64) return 'This email address is too long.';
  if (local.startsWith('.') || local.endsWith('.') || local.includes('..')) {
    return 'Enter a valid email address, e.g. name@example.com.';
  }
  const labels = domain.split('.');
  const validLabel = (label: string) => /^[a-z0-9¡-￿](?:[a-z0-9¡-￿-]*[a-z0-9¡-￿])?$/.test(label);
  if (labels.length < 2 || !labels.every(validLabel) || labels.at(-1)!.length < 2) {
    return 'Enter a valid email address, e.g. name@example.com.';
  }
  return null;
}

/** Returns an error message, or null when the password is acceptable. */
export function passwordError(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Use at least ${PASSWORD_MIN_LENGTH} characters.`;
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return `Use at most ${PASSWORD_MAX_LENGTH} characters.`;
  }
  if (!/[a-zA-Z]/.test(password) || !/[^a-zA-Z]/.test(password)) {
    return 'Use letters and at least one digit or symbol.';
  }
  return null;
}
