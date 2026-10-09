import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, input, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import {
  PASSWORD_MIN_LENGTH,
  emailError,
  passwordError,
  usernameError,
} from '../../core/auth.model';
import { AuthService } from '../../core/auth.service';
import { MessagePipe, TranslatePipe } from '../../core/i18n';

type Mode = 'login' | 'register';
type Field = 'email' | 'username' | 'password' | 'confirm';

/** Log in, or create an account (/login). */
@Component({
  selector: 'app-login',
  imports: [ReactiveFormsModule, TranslatePipe, MessagePipe],
  templateUrl: './login.html',
})
export class Login {
  /** Query parameters: where to go after logging in, and whether the session had expired. */
  readonly returnUrl = input<string>();
  readonly expired = input<string>();

  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly fb = inject(NonNullableFormBuilder);

  protected readonly mode = signal<Mode>('login');
  protected readonly submitted = signal(false);
  protected readonly busy = signal(false);
  protected readonly serverError = signal<string | null>(null);
  protected readonly passwordMin = PASSWORD_MIN_LENGTH;

  /** email: the email address when registering, the email or the username when logging in. */
  protected readonly form = this.fb.group({
    email: [''],
    username: [''],
    password: [''],
    confirm: [''],
  });

  protected readonly title = computed(() =>
    this.mode() === 'login' ? 'Log in' : 'Create an account',
  );

  /** Error to show under a field (after a first submit, or once the field was left). Same checks as the server (core/auth.model.ts). */
  protected fieldError(name: Field): string | null {
    const control = this.form.controls[name];
    if (!this.submitted() && !control.touched) return null;
    return this.errors()[name] ?? null;
  }

  private errors(): Partial<Record<Field, string>> {
    const { email, username, password, confirm } = this.form.getRawValue();
    const result: Partial<Record<Field, string>> = {};
    if (this.mode() === 'login') {
      if (!email.trim()) result.email = 'Enter your email address or username.';
      else if (email.includes('@') && emailError(email)) result.email = emailError(email)!;
      else if (!email.includes('@') && usernameError(email)) result.email = usernameError(email)!;
      if (!password) result.password = 'Enter your password.';
    } else {
      const e = emailError(email);
      if (e) result.email = e;
      const u = usernameError(username);
      if (u) result.username = u;
      const p = passwordError(password);
      if (p) result.password = p;
      if (confirm !== password) result.confirm = 'The two passwords are different.';
    }
    return result;
  }

  protected switchMode(mode: Mode): void {
    this.mode.set(mode);
    this.submitted.set(false);
    this.serverError.set(null);
    this.form.controls.password.reset();
    this.form.controls.confirm.reset();
  }

  protected async submit(): Promise<void> {
    this.submitted.set(true);
    this.serverError.set(null);
    if (Object.keys(this.errors()).length) return;
    const { email, username, password } = this.form.getRawValue();
    this.busy.set(true);
    try {
      if (this.mode() === 'login') await this.auth.login(email, password);
      else await this.auth.register(email, username, password);
      this.form.reset();
      const target = this.returnUrl();
      // Only paths inside the app.
      this.router.navigateByUrl(
        target?.startsWith('/') && !target.startsWith('//') ? target : '/study',
      );
    } catch (err) {
      this.form.controls.password.reset();
      this.form.controls.confirm.reset();
      this.serverError.set(
        err instanceof HttpErrorResponse && err.error?.error
          ? err.error.error
          : 'Could not reach the server. Check your connection and try again.',
      );
    } finally {
      this.busy.set(false);
    }
  }
}
