import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { usernameError } from '../../core/auth.model';
import { AuthService } from '../../core/auth.service';
import { MessagePipe, TranslatePipe, t } from '../../core/i18n';

/** Your account: email and username (/account). */
@Component({
  selector: 'app-account',
  imports: [ReactiveFormsModule, TranslatePipe, MessagePipe],
  templateUrl: './account.html',
})
export class Account {
  protected readonly auth = inject(AuthService);
  private readonly fb = inject(NonNullableFormBuilder);

  protected readonly form = this.fb.group({ username: [this.auth.user()?.username ?? ''] });
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly status = signal<{ text: string; kind?: 'ok' | 'error' }>({ text: '' });

  protected async save(): Promise<void> {
    const username = this.form.controls.username.value;
    this.status.set({ text: '' });
    this.error.set(usernameError(username));
    if (this.error()) return;
    this.busy.set(true);
    try {
      const user = await this.auth.setUsername(username);
      this.form.setValue({ username: user.username ?? '' });
      this.status.set({
        text: t('Saved: you can now log in as {name}.', { name: user.username ?? '' }),
        kind: 'ok',
      });
    } catch (err) {
      const message = err instanceof HttpErrorResponse ? err.error?.error : null;
      if (message) this.error.set(message);
      else this.status.set({ text: 'Could not reach the server. Try again.', kind: 'error' });
    } finally {
      this.busy.set(false);
    }
  }
}
