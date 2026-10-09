import { Component, computed, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { CharactersService, errorMessage } from '../../core/characters.service';
import { LabelsService, sortLabels } from '../../core/labels.service';
import { toPinyin } from '../../core/pinyin';
import {
  REVIEW_KINDS,
  REVIEW_MODES,
  ReviewKind,
  ReviewMode,
  ReviewSession,
  formatDuration,
  reviewStats,
} from '../../core/review.model';
import { ReviewsService } from '../../core/reviews.service';
import { WordsService } from '../../core/words.service';
import { SlidingThumb } from '../../shared/sliding-thumb';
import { SwipeActions } from '../../shared/swipe-actions';

/** A character or word of your lists, as the dashboard shows it. */
interface Known {
  text: string;
  pinyin?: string;
  meaning?: string;
  label?: string;
}

const DATE_FORMAT = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

/** Your past reviews with their results; start one of them again. */
@Component({
  selector: 'app-dashboard',
  imports: [RouterLink, SlidingThumb, SwipeActions],
  templateUrl: './dashboard.html',
})
export class Dashboard {
  private readonly router = inject(Router);
  private readonly characters = inject(CharactersService);
  private readonly words = inject(WordsService);
  protected readonly labels = inject(LabelsService);
  protected readonly reviews = inject(ReviewsService);

  protected readonly formatDuration = formatDuration;
  protected readonly modes = Object.entries(REVIEW_MODES) as [
    ReviewMode,
    (typeof REVIEW_MODES)[ReviewMode],
  ][];
  protected readonly modeInfo = REVIEW_MODES;
  protected readonly kindInfo = REVIEW_KINDS;
  /** The reviews of your characters, or of your words: the tab of the page (route data). */
  readonly kind = input<ReviewKind>('characters');
  /** Show the sessions of every mode, or of one. */
  protected readonly modeFilter = signal<ReviewMode | 'all'>('all');

  /** The reviews of this tab's kind, in every mode. */
  protected readonly kindSessions = computed(() =>
    this.reviews.sessions().filter((s) => s.kind === this.kind()),
  );

  /** Those of the mode chosen. */
  private readonly sessions = computed(() => {
    const mode = this.modeFilter();
    return this.kindSessions().filter((s) => mode === 'all' || s.mode === mode);
  });

  /** The Review tab of this kind. */
  protected readonly reviewLink = computed(() =>
    this.kind() === 'words' ? '/training/words' : '/training',
  );

  /** The character or word, if it's still in your lists. */
  private find(kind: ReviewKind, text: string): Known | undefined {
    if (kind === 'words') {
      const w = this.words.find(text);
      return w && { text: w.word, pinyin: w.pinyin, meaning: w.meaning };
    }
    const c = this.characters.find(text);
    return c && { text: c.character, pinyin: c.pinyin, meaning: c.meaning, label: c.label };
  }
  protected readonly toPinyin = toPinyin;
  /** Id of the session whose characters are shown. */
  protected readonly expanded = signal<number | null>(null);
  protected readonly message = signal<{ text: string; kind?: 'error' }>({ text: '' });

  /** One row per session, newest first. */
  protected readonly rows = computed(() =>
    this.sessions().map((session) => {
      const stats = reviewStats(session);
      const entries = session.results.map((r) => ({
        ...r,
        entry: this.find(session.kind, r.character),
      }));
      return {
        session,
        stats,
        date: DATE_FORMAT.format(new Date(session.finishedAt)),
        firstTryRate: stats.count ? Math.round((100 * stats.firstTry) / stats.count) : 0,
        /** Labels of its characters (as they are labelled now). */
        labels: sortLabels(entries.map((e) => e.entry?.label)),
        results: entries,
        /** Characters still in your list, which "Train again" uses. */
        available: entries.filter((e) => e.entry).length,
      };
    }),
  );

  /** The last review of any kind and mode, with how many of its items are still in your lists. */
  protected readonly lastReview = computed(() => {
    const session = this.reviews.last();
    if (!session) return null;
    const available = session.results.filter((r) => this.find(session.kind, r.character)).length;
    return { session, available };
  });

  /** Totals over the sessions shown. */
  protected readonly totals = computed(() => {
    const all = this.rows().map((r) => r.stats);
    const sum = (key: keyof (typeof all)[number]) => all.reduce((s, x) => s + x[key], 0);
    const count = sum('count');
    return {
      sessions: all.length,
      characters: count,
      firstTryRate: count ? Math.round((100 * sum('firstTry')) / count) : 0,
      time: formatDuration(sum('seconds')),
    };
  });

  /** The characters (or words) that needed the most extra tries in the sessions shown. */
  protected readonly hardest = computed(() => {
    const kind = this.kind();
    const extra = new Map<string, number>();
    for (const session of this.sessions()) {
      for (const r of session.results) {
        if (r.tries > 1) extra.set(r.character, (extra.get(r.character) ?? 0) + r.tries - 1);
      }
    }
    return [...extra]
      .map(([text, extraTries]) => ({ entry: this.find(kind, text), extraTries }))
      .filter((h): h is { entry: Known; extraTries: number } => !!h.entry)
      .sort((a, b) => b.extraTries - a.extraTries)
      .slice(0, 12);
  });

  /** Opens the Review page and starts a session with these characters or words, in this mode. */
  protected review(texts: string[], mode: ReviewMode, kind: ReviewKind): void {
    this.router.navigate([kind === 'words' ? '/training/words' : '/training'], {
      state: { replay: texts, mode, kind },
    });
  }

  protected reviewSession(session: ReviewSession): void {
    this.review(
      session.results.map((r) => r.character),
      session.mode,
      session.kind,
    );
  }

  protected reviewHardest(mode: ReviewMode): void {
    this.review(
      this.hardest().map((h) => h.entry.text),
      mode,
      this.kind(),
    );
  }

  /** Where a character or word of your lists is shown. */
  protected linkOf(text: string): string[] {
    return [this.kind() === 'words' ? '/study/words' : '/study', text];
  }

  protected toggle(id: number | undefined): void {
    this.expanded.update((current) => (current === id ? null : (id ?? null)));
  }

  /** Deletes the session from your history (after confirmation, unless swiped). True if done. */
  protected async remove(session: ReviewSession, confirmFirst = true): Promise<boolean> {
    if (!session.id) return false;
    if (confirmFirst && !confirm('Delete this training session from your history?')) return false;
    try {
      await this.reviews.remove(String(session.id));
      this.message.set({ text: '' });
      return true;
    } catch (err) {
      this.message.set({ text: `Delete failed: ${errorMessage(err)}`, kind: 'error' });
      return false;
    }
  }

  /** Touch screens: the row was swiped to Delete (the swipe is the confirmation, as on iOS). */
  protected async removeSwiped(session: ReviewSession, swipe: SwipeActions): Promise<void> {
    if (!(await this.remove(session, false))) swipe.close();
  }
}
