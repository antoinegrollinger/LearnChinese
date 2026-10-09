import { Component, DestroyRef, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { errorMessage } from '../../core/characters.service';
import {
  COMMUNITY_DESCRIPTION_MAX_LENGTH,
  COMMUNITY_NAME_MAX_LENGTH,
  CommunitySummary,
  ROLE_NAMES,
  communityNameError,
} from '../../core/social.model';
import { SocialService } from '../../core/social.service';
import { MessagePipe, PluralPipe, TranslatePipe, t } from '../../core/i18n';
import { SlidingThumb } from '../../shared/sliding-thumb';

/**
 * Your communities or all of them (/communities?show=all), searching and joining them, creating
 * one (/communities).
 */
@Component({
  selector: 'app-communities',
  imports: [RouterLink, SlidingThumb, TranslatePipe, PluralPipe, MessagePipe],
  templateUrl: './communities.html',
})
export class Communities {
  protected readonly auth = inject(AuthService);
  private readonly social = inject(SocialService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly nameMax = COMMUNITY_NAME_MAX_LENGTH;
  protected readonly descriptionMax = COMMUNITY_DESCRIPTION_MAX_LENGTH;
  protected readonly query = signal('');
  /** Your communities, or all of them; the search looks in the ones shown. */
  protected readonly scope = signal<'mine' | 'all'>(
    this.route.snapshot.queryParamMap.get('show') === 'all' ? 'all' : 'mine',
  );
  /** The communities shown (matching the search, if any). */
  protected readonly results = signal<CommunitySummary[]>([]);
  protected readonly loading = signal(true);
  protected readonly newName = signal('');
  protected readonly newDescription = signal('');
  protected readonly newNeedsApproval = signal(false);
  protected readonly roleNames = ROLE_NAMES;
  protected readonly busy = signal(false);
  protected readonly status = signal<{ text: string; kind?: 'ok' | 'error' }>({ text: '' });

  private searchTimer?: ReturnType<typeof setTimeout>;
  /** Ignores the answers of older searches. */
  private searchToken = 0;

  constructor() {
    this.search('');
    inject(DestroyRef).onDestroy(() => clearTimeout(this.searchTimer));
  }

  protected setScope(scope: 'mine' | 'all'): void {
    if (scope === this.scope()) return;
    this.scope.set(scope);
    // In the address too, so Back and a reload keep the list.
    this.router.navigate([], {
      queryParams: { show: scope === 'all' ? 'all' : null },
      replaceUrl: true,
    });
    clearTimeout(this.searchTimer);
    this.search(this.query());
  }

  protected onQuery(query: string): void {
    this.query.set(query);
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.search(query), 250);
  }

  private async search(query: string): Promise<void> {
    const token = ++this.searchToken;
    this.loading.set(true);
    try {
      const results = await this.social.searchCommunities(query, this.scope() === 'all');
      if (token === this.searchToken) this.results.set(results);
    } catch (err) {
      if (token === this.searchToken) {
        this.status.set({
          text: t('Search failed: {error}', { error: errorMessage(err) }),
          kind: 'error',
        });
      }
    } finally {
      if (token === this.searchToken) this.loading.set(false);
    }
  }

  protected async join(community: CommunitySummary): Promise<void> {
    this.busy.set(true);
    try {
      const detail = await this.social.join(community.name);
      if (detail.joined) this.router.navigate(['/communities', community.name]);
      else {
        this.results.update((list) =>
          list.map((c) => (c.name === community.name ? { ...c, pending: true } : c)),
        );
        this.status.set({
          text: t('Request sent: an owner or admin of {community} will answer it.', {
            community: community.name,
          }),
          kind: 'ok',
        });
      }
    } catch (err) {
      this.status.set({ text: t('Could not join: {error}', { error: errorMessage(err) }), kind: 'error' });
    } finally {
      this.busy.set(false);
    }
  }

  protected async create(): Promise<void> {
    const invalid = communityNameError(this.newName());
    if (invalid) return this.status.set({ text: invalid, kind: 'error' });
    this.busy.set(true);
    try {
      const community = await this.social.createCommunity(
        this.newName(),
        this.newDescription(),
        this.newNeedsApproval() ? 'approval' : 'open',
      );
      this.router.navigate(['/communities', community.name]);
    } catch (err) {
      this.status.set({ text: errorMessage(err), kind: 'error' });
    } finally {
      this.busy.set(false);
    }
  }
}
