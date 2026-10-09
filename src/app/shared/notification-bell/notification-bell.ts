import { Component, ElementRef, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { errorMessage } from '../../core/characters.service';
import { TranslatePipe, locale, t } from '../../core/i18n';
import { NotificationsService } from '../../core/notifications.service';
import { InfoType, NotificationItem } from '../../core/social.model';
import { SocialService } from '../../core/social.service';

/** What an update says, around the community name: [before, after]. */
const INFO_TEXT: Record<InfoType, (who: string) => [string, string]> = {
  'friend-accepted': (who) => [t('{who} accepted your friend request', { who }), ''],
  'join-approved': () => [t('Your request to join '), t(' was approved')],
  'join-rejected': () => [t('Your request to join '), t(' was declined')],
  'made-admin': (who) => [t('{who} made you an admin of ', { who }), ''],
  'removed-admin': (who) => [t('{who} made you a regular member of ', { who }), ''],
  'removed-from-community': (who) => [t('{who} removed you from ', { who }), ''],
  'made-owner': () => [t('You are now the owner of '), ''],
};

const RELATIVE = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });

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
  return t('just now');
}

/** The bell in the header and its menu: answer requests directly, see what happened. */
@Component({
  selector: 'app-notification-bell',
  imports: [RouterLink, TranslatePipe],
  host: {
    class: 'notification-bell',
    '(document:click)': 'onDocumentClick($event)',
    '(document:keydown.escape)': 'close()',
  },
  templateUrl: './notification-bell.html',
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
    // 友: friends, 群: communities.
    return type === 'friend-accepted' ? '友' : '群';
  }

  protected text(n: Extract<NotificationItem, { kind: 'info' }>): [string, string] {
    return INFO_TEXT[n.type]?.(n.username ?? t('Someone')) ?? ['', ''];
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
    this.run(
      () => this.social.accept(username),
      t('You and {name} are now friends ✓', { name: username }),
    );
  }

  protected declineFriend(username: string): void {
    this.run(
      () => this.social.removeFriend(username),
      t("Declined {name}'s request.", { name: username }),
    );
  }

  protected answerJoin(community: string, username: string, approve: boolean): void {
    this.run(
      () => this.social.answerJoinRequest(community, username, approve),
      approve
        ? t('{name} joined {community} ✓', { name: username, community })
        : t("Rejected {name}'s request.", { name: username }),
    );
  }

  protected dismiss(id: number): void {
    this.notifications
      .dismiss(id)
      .catch((err) => this.status.set({ text: errorMessage(err), kind: 'error' }));
  }
}
