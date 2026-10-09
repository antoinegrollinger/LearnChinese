import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { errorMessage } from '../../core/characters.service';
import { SocialService } from '../../core/social.service';

const DATE_FORMAT = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

/** Your friends, friend requests and whether your friends see your reviews (/friends). */
@Component({
  selector: 'app-friends',
  imports: [RouterLink],
  templateUrl: './friends.html',
})
export class Friends {
  protected readonly auth = inject(AuthService);
  protected readonly social = inject(SocialService);

  protected readonly username = signal('');
  protected readonly busy = signal(false);
  protected readonly status = signal<{ text: string; kind?: 'ok' | 'error' }>({ text: '' });

  constructor() {
    this.social
      .reload()
      .catch((err) =>
        this.status.set({
          text: `Could not load your friends: ${errorMessage(err)}`,
          kind: 'error',
        }),
      );
  }

  protected date(iso: string): string {
    return iso ? DATE_FORMAT.format(new Date(iso)) : '';
  }

  /** Runs an action, showing its result (or error) below the form. */
  private async run(action: () => Promise<string>): Promise<void> {
    this.busy.set(true);
    try {
      this.status.set({ text: await action(), kind: 'ok' });
    } catch (err) {
      this.status.set({ text: errorMessage(err), kind: 'error' });
    } finally {
      this.busy.set(false);
    }
  }

  protected addFriend(): void {
    const name = this.username().trim();
    if (!name) return;
    this.run(async () => {
      const relation = await this.social.addFriend(name);
      this.username.set('');
      return relation === 'friend'
        ? `${name} had already sent you a request: you are now friends ✓`
        : `Request sent to ${name} ✓ They will see it on their Friends page.`;
    });
  }

  protected accept(name: string): void {
    this.run(async () => {
      await this.social.accept(name);
      return `You and ${name} are now friends ✓`;
    });
  }

  protected remove(name: string, question: string, done: string): void {
    if (!confirm(question)) return;
    this.run(async () => {
      await this.social.removeFriend(name);
      return done;
    });
  }

  protected setShare(share: boolean): void {
    this.run(async () => {
      await this.social.setShareReviews(share);
      return share ? 'Your friends can now see your reviews ✓' : 'Your reviews are now private ✓';
    });
  }
}
