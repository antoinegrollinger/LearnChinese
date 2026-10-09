/** Shared by the Angular app and server/server.ts. */

/** How one character went in a review session. */
export interface ReviewResult {
  character: string;
  /** Times it was written (or its solution shown); the last one was without a mistake. */
  tries: number;
  mistakes: number;
}

/** A completed review session (the review_sessions table). */
export interface ReviewSession {
  /** Set by the server. */
  id?: number;
  /** ISO dates */
  startedAt: string;
  finishedAt: string;
  /** The characters reviewed, in list order. */
  results: ReviewResult[];
}

const count = (v: unknown): number => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? n : 0;
};

const isoDate = (v: unknown): string => {
  const date = new Date(v instanceof Date ? v : String(v ?? ''));
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
};

/** Keeps known fields, valid dates (finishedAt not before startedAt) and each character once. */
export function cleanReview(raw: unknown): ReviewSession {
  const r = (raw ?? {}) as Record<string, unknown>;
  const finishedAt = isoDate(r['finishedAt']);
  const startedAt = isoDate(r['startedAt']);
  const seen = new Set<string>();
  const results = (Array.isArray(r['results']) ? r['results'] : [])
    .map((x: Record<string, unknown>) => ({
      character: String(x?.['character'] ?? '').trim(),
      tries: count(x?.['tries']),
      mistakes: count(x?.['mistakes']),
    }))
    .filter((x) => x.character && !seen.has(x.character) && seen.add(x.character));
  const session: ReviewSession = {
    startedAt: startedAt && startedAt <= finishedAt ? startedAt : finishedAt,
    finishedAt,
    results,
  };
  const id = count(r['id']);
  return id ? { id, ...session } : session;
}

/** Numbers shown for a session. */
export function reviewStats(session: ReviewSession) {
  const { results } = session;
  const seconds = Math.max(
    0,
    Math.round((Date.parse(session.finishedAt) - Date.parse(session.startedAt)) / 1000),
  );
  return {
    count: results.length,
    tries: results.reduce((sum, r) => sum + r.tries, 0),
    mistakes: results.reduce((sum, r) => sum + r.mistakes, 0),
    firstTry: results.filter((r) => r.tries === 1).length,
    seconds,
  };
}

/** 75 → "1:15", 3725 → "1:02:05" */
export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = String(seconds % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}
