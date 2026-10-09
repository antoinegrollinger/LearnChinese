import { Component, ElementRef, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { errorMessage } from '../core/characters.service';
import { NotificationsService } from '../core/notifications.service';
import { InfoType, NotificationItem } from '../core/social.model';
import { SocialService } from '../core/social.service';

/** What an update says, around the community name: [before, after]. */
const INFO_TEXT: Record<InfoType, (who: string) => [string, string]> = {
  'friend-accepted': (who) => [`${who} accepted your friend request`, ''],
  'join-approved': () => ['Your request to join ', ' was approved'],
  'join-rejected': () => ['Your request to join ', ' was declined'],
  'made-admin': (who) => [`${who} made you an admin of `, ''],
  'removed-admin': (who) => [`${who} made you a regular member of `, ''],
  'removed-from-community': (who) => [`${who} removed you from `, ''],
  'made-owner': () => ['You are now the owner of ', ''],
};

const RELATIVE = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

/** "just now", "5 minutes ago", "yesterday"… */
function ago(iso: string): string {
  const seconds = (Date.parse(iso) - Date.now()) / 1000;
  const steps: [Intl.RelativeTimeFormatUnit, number][] = [
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60],
  ];
  for (const [unit, size] of steps) {
    if (Math.abs(seconds) >= size) return RELATIVE.format(Math.round(seconds / size), unit);
  }
  return 'just now';
}

/** The bell in the header and its menu: answer requests directly, see what happened. */
@Component({
  selector: 'app-notification-bell',
  imports: [RouterLink],
  host: {
    class: 'notification-bell',
    '(document:click)': 'onDocumentClick($event)',
    '(document:keydown.escape)': 'close()',
  },
  template: `
    <button
      type="button"
      class="bell-button"
      [class.active]="open()"
      [attr.aria-expanded]="open()"
      aria-haspopup="true"
      [attr.aria-label]="
        'Notifications' +
        (notifications.data().unread ? ' (' + notifications.data().unread + ' new)' : '')
      "
      (click)="toggle()"
    >
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
        <path
          d="M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22Zm7-6V11a7 7 0 0 0-5.5-6.84V3.5a1.5 1.5 0 0 0-3 0v.66A7 7 0 0 0 5 11v5l-2 2v1h18v-1l-2-2Z"
          fill="currentColor"
        />
      </svg>
      @if (notifications.data().unread; as n) {
        <span class="nav-badge bell-badge">{{ n > 99 ? '99+' : n }}</span>
      }
    </button>

    @if (open()) {
      <div class="bell-panel" role="dialog" aria-label="Notifications">
        <div class="bell-header">
          <strong>Notifications</strong>
          <span class="bell-links">
            <a routerLink="/friends" (click)="close()">Friends</a> ·
            <a routerLink="/communities" (click)="close()">Communities</a>
          </span>
        </div>
        @if (status().text) {
          <p class="message bell-status" [class]="status().kind" role="status">
            {{ status().text }}
          </p>
        }

        @if (!items().length) {
          <p class="muted bell-empty">
            {{ notifications.loaded() ? 'No notifications.' : 'Loading…' }}
          </p>
        } @else {
          <ul class="bell-list">
            @for (n of items(); track key(n)) {
              <li [class.unread]="isNew(n)" [class.request]="n.kind !== 'info'">
                @switch (n.kind) {
                  @case ('friend-request') {
                    <span class="bell-icon" aria-hidden="true">👤</span>
                    <div class="bell-body">
                      <span
                        ><strong>{{ n.username }}</strong> wants to be your friend</span
                      >
                      <small class="muted">{{ ago(n.at) }}</small>
                      <div class="buttons">
                        <button
                          type="button"
                          class="primary"
                          [disabled]="busy()"
                          (click)="acceptFriend(n.username)"
                        >
                          Accept
                        </button>
                        <button
                          type="button"
                          [disabled]="busy()"
                          (click)="declineFriend(n.username)"
                        >
                          Decline
                        </button>
                      </div>
                    </div>
                  }
                  @case ('join-request') {
                    <span class="bell-icon" aria-hidden="true">🏘</span>
                    <div class="bell-body">
                      <span
                        ><strong>{{ n.username }}</strong> asks to join
                        <a [routerLink]="['/communities', n.community]" (click)="close()">{{
                          n.community
                        }}</a></span
                      >
                      <small class="muted">{{ ago(n.at) }}</small>
                      <div class="buttons">
                        <button
                          type="button"
                          class="primary"
                          [disabled]="busy()"
                          (click)="answerJoin(n.community, n.username, true)"
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          [disabled]="busy()"
                          (click)="answerJoin(n.community, n.username, false)"
                        >
                          Reject
                        </button>
                      </div>
                    </div>
                  }
                  @case ('info') {
                    <span class="bell-icon" aria-hidden="true">{{ icon(n.type) }}</span>
                    <div class="bell-body">
                      <span>
                        {{ text(n)[0] }}
                        @if (n.community) {
                          <a [routerLink]="['/communities', n.community]" (click)="close()">{{
                            n.community
                          }}</a>
                        } @else if (n.type === 'friend-accepted' && n.username) {
                          · <a [routerLink]="['/friends', n.username]" (click)="close()">View</a>
                        }
                        {{ text(n)[1] }}
                      </span>
                      <small class="muted">{{ ago(n.at) }}</small>
                    </div>
                    <button
                      type="button"
                      class="link bell-dismiss"
                      title="Dismiss"
                      aria-label="Dismiss"
                      (click)="dismiss(n.id)"
                    >
                      ×
                    </button>
                  }
                }
              </li>
            }
          </ul>
        }
      </div>
    }
  `,
})
export class NotificationBell {
  protected readonly notifications = inject(NotificationsService);
  private readonly social = inject(SocialService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly open = signal(false);
  protected readonly busy = signal(false);
  protected readonly status = signal<{ text: string; kind?: 'ok' | 'error' }>({ text: '' });
  /** Updates that were unread when the menu was opened: still highlighted while it's open. */
  private readonly newIds = signal<ReadonlySet<number>>(new Set());
  protected readonly items = computed(() => this.notifications.data().items);
  protected readonly ago = ago;

  protected toggle(): void {
    if (this.open()) return this.close();
    this.open.set(true);
    this.status.set({ text: '' });
    this.newIds.set(
      new Set(
        this.items()
          .filter((n) => n.kind === 'info' && !n.read)
          .map((n) => (n.kind === 'info' ? n.id : 0)),
      ),
    );
    this.notifications.reload().then(() => this.notifications.markRead().catch(() => {}));
  }

  protected close(): void {
    this.open.set(false);
  }

  protected onDocumentClick(event: MouseEvent): void {
    if (this.open() && !this.host.nativeElement.contains(event.target as Node)) this.close();
  }

  protected key(n: NotificationItem): string {
    return n.kind === 'info'
      ? `info-${n.id}`
      : `${n.kind}-${n.username}-${'community' in n ? n.community : ''}`;
  }

  protected isNew(n: NotificationItem): boolean {
    return n.kind !== 'info' || this.newIds().has(n.id) || !n.read;
  }

  protected icon(type: InfoType): string {
    return type === 'friend-accepted'
      ? '🤝'
      : type === 'join-rejected'
        ? '🚫'
        : type === 'removed-from-community'
          ? '👋'
          : '🏘';
  }

  protected text(n: Extract<NotificationItem, { kind: 'info' }>): [string, string] {
    return INFO_TEXT[n.type]?.(n.username ?? 'Someone') ?? ['', ''];
  }

  /** Runs an action from the menu, then shows what happened at its top. */
  private async run(action: () => Promise<unknown>, done: string): Promise<void> {
    this.busy.set(true);
    try {
      await action();
      this.status.set({ text: done, kind: 'ok' });
    } catch (err) {
      this.status.set({ text: errorMessage(err), kind: 'error' });
      await this.notifications.reload();
    } finally {
      this.busy.set(false);
    }
  }

  protected acceptFriend(username: string): void {
    this.run(() => this.social.accept(username), `You and ${username} are now friends ✓`);
  }

  protected declineFriend(username: string): void {
    this.run(() => this.social.removeFriend(username), `Declined ${username}'s request.`);
  }

  protected answerJoin(community: string, username: string, approve: boolean): void {
    this.run(
      () => this.social.answerJoinRequest(community, username, approve),
      approve ? `${username} joined ${community} ✓` : `Rejected ${username}'s request.`,
    );
  }

  protected dismiss(id: number): void {
    this.notifications
      .dismiss(id)
      .catch((err) => this.status.set({ text: errorMessage(err), kind: 'error' }));
  }
}
