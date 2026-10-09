import { Component, computed, inject, input, resource, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { map } from 'rxjs';
import { errorMessage } from '../../core/characters.service';
import {
  REVIEW_KINDS,
  REVIEW_MODES,
  ReviewKind,
  formatDuration,
  reviewStats,
} from '../../core/review.model';
import { SocialService, isNotFound } from '../../core/social.service';
import { MessagePipe, PluralPipe, TranslatePipe, locale, t } from '../../core/i18n';
import { countOf, modeName } from '../../core/review-texts';

const DATE_FORMAT = new Intl.DateTimeFormat(locale, {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

const DAY_FORMAT = new Intl.DateTimeFormat(locale, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

/**
 * A friend's counts, and their reviews (read only) when they share them: all of them
 * (/friends/:username), or those of their characters or words (…/characters, …/words).
 */
@Component({
  selector: 'app-friend-profile',
  imports: [RouterLink, TranslatePipe, PluralPipe, MessagePipe],
  templateUrl: './friend-profile.html',
})
export class FriendProfilePage {
  /** Which reviews: the tab of the page (route data). */
  readonly kind = input<ReviewKind | 'all'>('all');

  private readonly route = inject(ActivatedRoute);
  /** From the page's route (/friends/:username), above this tab's. */
  protected readonly username = toSignal(
    this.route.parent!.params.pipe(map((p) => String(p['username'] ?? ''))),
    { initialValue: String(this.route.parent?.snapshot.params['username'] ?? '') },
  );

  private readonly social = inject(SocialService);
  protected readonly modeInfo = REVIEW_MODES;
  protected readonly kindInfo = REVIEW_KINDS;
  protected readonly formatDuration = formatDuration;
  /** Id of the session whose characters are shown. */
  protected readonly expanded = signal<number | null>(null);

  protected readonly profile = resource({
    params: () => this.username(),
    loader: ({ params: username }) => this.social.profile(username),
  });

  protected readonly error = computed(() => {
    const err = this.profile.error();
    if (!err) return null;
    return isNotFound(err)
      ? t('{name} is not your friend (or no longer).', { name: this.username() })
      : t('Could not load {name}: {error}', { name: this.username(), error: errorMessage(err) });
  });

  protected readonly friendsSince = computed(() => {
    const since = this.profile.value()?.since;
    return since ? DAY_FORMAT.format(new Date(since)) : '';
  });

  protected readonly modeName = modeName;
  protected readonly countOf = countOf;

  /** One row per shared session of this tab, newest first. */
  protected readonly rows = computed(() =>
    (this.profile.value()?.sessions ?? [])
      .filter((session) => this.kind() === 'all' || session.kind === this.kind())
      .map((session) => {
        const stats = reviewStats(session);
        return {
          session,
          stats,
          date: DATE_FORMAT.format(new Date(session.finishedAt)),
          firstTryRate: stats.count ? Math.round((100 * stats.firstTry) / stats.count) : 0,
        };
      }),
  );

  protected readonly totals = computed(() => {
    const all = this.rows().map((r) => r.stats);
    const count = all.reduce((s, x) => s + x.count, 0);
    const firstTry = all.reduce((s, x) => s + x.firstTry, 0);
    return {
      items: count,
      firstTryRate: count ? Math.round((100 * firstTry) / count) : 0,
      time: formatDuration(all.reduce((s, x) => s + x.seconds, 0)),
    };
  });

  protected toggle(id: number | undefined): void {
    this.expanded.update((current) => (current === id ? null : (id ?? null)));
  }
}
