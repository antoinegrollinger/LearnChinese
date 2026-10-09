import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../../core/auth.service';
import { errorMessage } from '../../../core/characters.service';
import { MessagePipe, PluralPipe, TranslatePipe, locale, t } from '../../../core/i18n';
import { SocialService } from '../../../core/social.service';

const DATE_FORMAT = new Intl.DateTimeFormat(locale, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

/** Your friends, friend requests and whether your friends see your reviews (/friends). */
@Component({
  selector: 'app-friends',
  imports: [RouterLink, TranslatePipe, PluralPipe, MessagePipe],
  templateUrl: './friends.html',
})
export class Friends {
  protected readonly auth = inject(AuthService);
  protected readonly social = inject(SocialService);

  protected readonly username = signal('');
  protected readonly busy = signal(false);
  protected readonly status = signal<{ text: string; kind?: 'ok' | 'error' }>({ text: '' });

  constructor() {
    this.social.reload().catch((err) =>
      this.status.set({
        text: t('Could not load your friends: {error}', { error: errorMessage(err) }),
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
        ? t('{name} had already sent you a request: you are now friends ✓', { name })
        : t('Request sent to {name} ✓ They will see it on their Friends page.', { name });
    });
  }

  protected accept(name: string): void {
    this.run(async () => {
      await this.social.accept(name);
      return t('You and {name} are now friends ✓', { name });
    });
  }

  /** question and done: texts to translate, with {name}. */
  protected remove(name: string, question: string, done: string): void {
    if (!confirm(t(question, { name }))) return;
    this.run(async () => {
      await this.social.removeFriend(name);
      return t(done, { name });
    });
  }

  protected setShare(share: boolean): void {
    this.run(async () => {
      await this.social.setShareReviews(share);
      return share
        ? t('Your friends can now see your training sessions ✓')
        : t('Your training sessions are now private ✓');
    });
  }
}
