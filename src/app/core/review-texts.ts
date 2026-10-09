/* Texts about training sessions in the app's language (review.model.ts is shared with the
 * server, so it stays in English). */
import { t, tn } from './i18n';
import { REVIEW_MODES, ReviewKind, ReviewMode } from './review.model';

/** "Write the character", "Write the word" or "Give the pinyin". */
export function modeName(mode: ReviewMode, kind: ReviewKind): string {
  if (mode === 'write') return t(kind === 'words' ? 'Write the word' : 'Write the character');
  return t(REVIEW_MODES[mode].name);
}

/** "3 characters", "1 word"… */
export function countOf(count: number, kind: ReviewKind): string {
  return kind === 'words'
    ? tn(count, '{n} word', '{n} words')
    : tn(count, '{n} character', '{n} characters');
}
