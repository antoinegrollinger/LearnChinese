import { Component, computed, inject, input, resource, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { errorMessage } from '../../core/characters.service';
import { REVIEW_MODES, formatDuration, reviewStats } from '../../core/review.model';
import { SocialService, isNotFound } from '../../core/social.service';

const DATE_FORMAT = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

const DAY_FORMAT = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

/** A friend's counts, and their reviews (read only) when they share them (/friends/:username). */
@Component({
  selector: 'app-friend-profile',
  imports: [RouterLink],
  templateUrl: './friend-profile.html',
})
export class FriendProfilePage {
  /** Route parameter */
  readonly username = input.required<string>();

  private readonly social = inject(SocialService);
  protected readonly modeInfo = REVIEW_MODES;
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
      ? `${this.username()} is not your friend (or no longer).`
      : `Could not load ${this.username()}: ${errorMessage(err)}`;
  });

  protected readonly friendsSince = computed(() => {
    const since = this.profile.value()?.since;
    return since ? DAY_FORMAT.format(new Date(since)) : '';
  });

  /** One row per shared session, newest first. */
  protected readonly rows = computed(() =>
    (this.profile.value()?.sessions ?? []).map((session) => {
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
      characters: count,
      firstTryRate: count ? Math.round((100 * firstTry) / count) : 0,
      time: formatDuration(all.reduce((s, x) => s + x.seconds, 0)),
    };
  });

  protected toggle(id: number | undefined): void {
    this.expanded.update((current) => (current === id ? null : (id ?? null)));
  }
}
