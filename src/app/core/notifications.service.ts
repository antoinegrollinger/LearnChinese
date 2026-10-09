import { HttpClient } from '@angular/common/http';
import { DestroyRef, Injectable, effect, inject, signal, untracked } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AuthService } from './auth.service';
import { NotificationsResponse } from './social.model';
import { SocialService } from './social.service';

/** Checked this often while you're logged in (and when you come back to the tab). */
const POLL_MS = 60_000;

/** The notification menu (the bell): requests waiting for you and updates (/api/notifications). */
@Injectable({ providedIn: 'root' })
export class NotificationsService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly social = inject(SocialService);

  readonly data = signal<NotificationsResponse>({ items: [], unread: 0 });
  readonly loaded = signal(false);

  constructor() {
    // On login and after every change made in the app; emptied on logout.
    effect(() => {
      const user = this.auth.user();
      this.social.changes();
      untracked(() => {
        if (user) this.reload();
        else {
          this.data.set({ items: [], unread: 0 });
          this.loaded.set(false);
        }
      });
    });
    const timer = setInterval(() => this.auth.user() && this.reload(), POLL_MS);
    const onVisible = () =>
      document.visibilityState === 'visible' && this.auth.user() && this.reload();
    document.addEventListener('visibilitychange', onVisible);
    inject(DestroyRef).onDestroy(() => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    });
  }

  async reload(): Promise<void> {
    try {
      this.data.set(
        await firstValueFrom(this.http.get<NotificationsResponse>('/api/notifications')),
      );
    } catch {
      // Keep what we have; the next check will try again.
    } finally {
      this.loaded.set(true);
    }
  }

  /** The updates have been seen (the requests stay until you answer them). */
  async markRead(): Promise<void> {
    if (!this.data().items.some((n) => n.kind === 'info' && !n.read)) return;
    await firstValueFrom(this.http.post('/api/notifications/read', {}));
    await this.reload();
  }

  async dismiss(id: number): Promise<void> {
    await firstValueFrom(this.http.delete(`/api/notifications/${id}`));
    this.data.update((d) => ({
      ...d,
      items: d.items.filter((n) => n.kind !== 'info' || n.id !== id),
    }));
  }
}
