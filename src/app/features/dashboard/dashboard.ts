import { Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { CharactersService, errorMessage } from '../../core/characters.service';
import { LabelsService, sortLabels } from '../../core/labels.service';
import { toPinyin } from '../../core/pinyin';
import {
  REVIEW_MODES,
  ReviewMode,
  ReviewSession,
  formatDuration,
  reviewStats,
} from '../../core/review.model';
import { ReviewsService } from '../../core/reviews.service';

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
  imports: [RouterLink],
  templateUrl: './dashboard.html',
})
export class Dashboard {
  private readonly router = inject(Router);
  private readonly characters = inject(CharactersService);
  protected readonly labels = inject(LabelsService);
  protected readonly reviews = inject(ReviewsService);

  protected readonly formatDuration = formatDuration;
  protected readonly modes = Object.entries(REVIEW_MODES) as [
    ReviewMode,
    (typeof REVIEW_MODES)[ReviewMode],
  ][];
  protected readonly modeInfo = REVIEW_MODES;
  /** Show the sessions of every mode, or of one. */
  protected readonly modeFilter = signal<ReviewMode | 'all'>('all');

  private readonly sessions = computed(() => {
    const filter = this.modeFilter();
    const sessions = this.reviews.sessions();
    return filter === 'all' ? sessions : sessions.filter((s) => s.mode === filter);
  });
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
        entry: this.characters.find(r.character),
      }));
      return {
        session,
        stats,
        date: DATE_FORMAT.format(new Date(session.finishedAt)),
        firstTryRate: stats.count ? Math.round((100 * stats.firstTry) / stats.count) : 0,
        /** Labels of its characters (as they are labelled now). */
        labels: sortLabels(entries.map((e) => e.entry?.label)),
        results: entries,
        /** Characters still in your list, which "Review again" uses. */
        available: entries.filter((e) => e.entry).length,
      };
    }),
  );

  /** The last review of any mode, with how many of its characters are still in your list. */
  protected readonly lastReview = computed(() => {
    const session = this.reviews.last();
    if (!session) return null;
    const available = session.results.filter((r) => this.characters.find(r.character)).length;
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

  /** The characters that needed the most extra tries, over all sessions (still in your list). */
  protected readonly hardest = computed(() => {
    const extra = new Map<string, number>();
    for (const session of this.sessions()) {
      for (const r of session.results) {
        if (r.tries > 1) extra.set(r.character, (extra.get(r.character) ?? 0) + r.tries - 1);
      }
    }
    return [...extra]
      .map(([character, extraTries]) => ({ entry: this.characters.find(character), extraTries }))
      .filter((h) => h.entry)
      .sort((a, b) => b.extraTries - a.extraTries)
      .slice(0, 12);
  });

  /** Opens the Review page and starts a session with these characters, in this mode. */
  protected review(characters: string[], mode: ReviewMode): void {
    this.router.navigate(['/review'], { state: { replay: characters, mode } });
  }

  protected reviewSession(session: ReviewSession): void {
    this.review(
      session.results.map((r) => r.character),
      session.mode,
    );
  }

  protected reviewHardest(mode: ReviewMode): void {
    this.review(
      this.hardest().map((h) => h.entry!.character),
      mode,
    );
  }

  protected toggle(id: number | undefined): void {
    this.expanded.update((current) => (current === id ? null : (id ?? null)));
  }

  protected async remove(session: ReviewSession): Promise<void> {
    if (!session.id || !confirm('Delete this review from your history?')) return;
    try {
      await this.reviews.remove(String(session.id));
      this.message.set({ text: '' });
    } catch (err) {
      this.message.set({ text: `Delete failed: ${errorMessage(err)}`, kind: 'error' });
    }
  }
}
