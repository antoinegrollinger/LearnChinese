import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { cleanReview } from './review.model';
import { AuthService } from './auth.service';
import {
  CommunityDetail,
  CommunityRole,
  CommunitySettings,
  CommunitySummary,
  JoinPolicy,
  FriendProfile,
  FriendsOverview,
  Relation,
  SocialSettings,
} from './social.model';

const EMPTY: FriendsOverview = { friends: [], incoming: [], outgoing: [] };

/** Friends, friend requests, review sharing and communities (server/social.ts). */
@Injectable({ providedIn: 'root' })
export class SocialService {
  private readonly http = inject(HttpClient);

  readonly overview = signal<FriendsOverview>(EMPTY);
  readonly settings = signal<SocialSettings>({ shareReviews: false });
  readonly loaded = signal(false);
  /** Friend requests waiting for your answer. */
  readonly incomingCount = computed(() => this.overview().incoming.length);
  /**
   * Goes up after each change (friend, request, community), so the notification menu and open
   * pages reload.
   */
  readonly changes = signal(0);

  constructor() {
    // Load on login, empty on logout.
    const auth = inject(AuthService);
    effect(() => {
      const user = auth.user();
      untracked(() => {
        if (user) this.reload().catch(() => {});
        else {
          this.overview.set(EMPTY);
          this.loaded.set(false);
        }
      });
    });
  }

  async reload(): Promise<void> {
    try {
      const [overview, settings] = await Promise.all([
        firstValueFrom(this.http.get<FriendsOverview>('/api/friends')),
        firstValueFrom(this.http.get<SocialSettings>('/api/social/settings')),
      ]);
      this.overview.set(overview);
      this.settings.set(settings);
    } finally {
      this.loaded.set(true);
    }
  }

  async setShareReviews(shareReviews: boolean): Promise<void> {
    this.settings.set(
      await firstValueFrom(
        this.http.patch<SocialSettings>('/api/social/settings', { shareReviews }),
      ),
    );
  }

  /** Sends a friend request (or accepts theirs). */
  async addFriend(username: string): Promise<Relation> {
    const { relation } = await firstValueFrom(
      this.http.post<{ relation: Relation }>('/api/friends', { username }),
    );
    await this.changed();
    return relation;
  }

  async accept(username: string): Promise<void> {
    await firstValueFrom(this.http.post(`/api/friends/${encodeURIComponent(username)}/accept`, {}));
    await this.changed();
  }

  /** Removes a friend, declines their request or cancels yours. */
  async removeFriend(username: string): Promise<void> {
    await firstValueFrom(this.http.delete(`/api/friends/${encodeURIComponent(username)}`));
    await this.changed();
  }

  /** Reloads your friends and tells the others (notification menu, open pages). */
  private async changed(): Promise<void> {
    this.changes.update((n) => n + 1);
    await this.reload().catch(() => {});
  }

  async profile(username: string): Promise<FriendProfile> {
    const profile = await firstValueFrom(
      this.http.get<FriendProfile>(`/api/friends/${encodeURIComponent(username)}`),
    );
    return { ...profile, sessions: profile.sessions.map(cleanReview) };
  }

  /** Communities whose name contains the query, or yours when it's empty. */
  searchCommunities(query: string): Promise<CommunitySummary[]> {
    return firstValueFrom(
      this.http.get<CommunitySummary[]>('/api/communities', { params: { q: query.trim() } }),
    );
  }

  createCommunity(
    name: string,
    description: string,
    joinPolicy: JoinPolicy,
  ): Promise<CommunityDetail> {
    return firstValueFrom(
      this.http.post<CommunityDetail>('/api/communities', { name, description, joinPolicy }),
    );
  }

  community(name: string): Promise<CommunityDetail> {
    return firstValueFrom(
      this.http.get<CommunityDetail>(`/api/communities/${encodeURIComponent(name)}`),
    );
  }

  /** Joins (open community) or asks to join (approval needed). */
  join(name: string): Promise<CommunityDetail> {
    return this.communityAction(name, 'join', {});
  }

  /** Withdraws your join request. */
  cancelJoinRequest(name: string): Promise<CommunityDetail> {
    return this.communityAction(name, 'cancel', {});
  }

  async leave(name: string): Promise<void> {
    await firstValueFrom(this.http.post(`/api/communities/${encodeURIComponent(name)}/leave`, {}));
    this.changes.update((n) => n + 1);
  }

  /** Owner or admin: approves or rejects a join request. */
  answerJoinRequest(name: string, username: string, approve: boolean): Promise<CommunityDetail> {
    return this.communityAction(name, approve ? 'approve' : 'reject', { username });
  }

  /** Owner: changes the settings. */
  async updateCommunity(
    name: string,
    settings: Partial<CommunitySettings>,
  ): Promise<CommunityDetail> {
    const detail = await firstValueFrom(
      this.http.patch<CommunityDetail>(`/api/communities/${encodeURIComponent(name)}`, settings),
    );
    this.changes.update((n) => n + 1);
    return detail;
  }

  /** Owner: makes a member an admin, a regular member, or the owner. */
  setRole(name: string, username: string, role: CommunityRole): Promise<CommunityDetail> {
    return this.communityAction(name, 'role', { username, role });
  }

  /** Owner, or admin for regular members: removes a member. */
  removeMember(name: string, username: string): Promise<CommunityDetail> {
    return this.communityAction(name, 'remove', { username });
  }

  private async communityAction(
    name: string,
    action: string,
    body: object,
  ): Promise<CommunityDetail> {
    const detail = await firstValueFrom(
      this.http.post<CommunityDetail>(
        `/api/communities/${encodeURIComponent(name)}/${action}`,
        body,
      ),
    );
    this.changes.update((n) => n + 1);
    return detail;
  }
}

/** True when the server said "not found" (e.g. not your friend, or the community was deleted). */
export const isNotFound = (err: unknown): boolean =>
  err instanceof HttpErrorResponse && err.status === 404;
