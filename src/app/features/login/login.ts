import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, input, signal } from '@angular/core';
import { AbstractControl, NonNullableFormBuilder, ReactiveFormsModule, ValidationErrors } from '@angular/forms';
import { Router } from '@angular/router';
import { PASSWORD_MIN_LENGTH, emailError, passwordError } from '../../core/auth.model';
import { AuthService } from '../../core/auth.service';

type Mode = 'login' | 'register';

/** Same checks as the server (core/auth.model.ts), shown under the field. */
const emailValidator = (c: AbstractControl): ValidationErrors | null => {
  const error = emailError(c.value ?? '');
  return error ? { email: error } : null;
};

/** Log in, or create an account (/login). */
@Component({
  selector: 'app-login',
  imports: [ReactiveFormsModule],
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

  protected readonly form = this.fb.group({
    email: ['', [emailValidator]],
    password: [''],
    confirm: [''],
  });

  protected readonly title = computed(() =>
    this.mode() === 'login' ? 'Log in' : 'Create an account',
  );

  /** Error to show under a field (after a first submit, or once the field was left). */
  protected fieldError(name: 'email' | 'password' | 'confirm'): string | null {
    const control = this.form.controls[name];
    if (!this.submitted() && !control.touched) return null;
    return this.errors()[name] ?? null;
  }

  private errors(): Partial<Record<'email' | 'password' | 'confirm', string>> {
    const { email, password, confirm } = this.form.getRawValue();
    const result: Partial<Record<'email' | 'password' | 'confirm', string>> = {};
    const e = emailError(email);
    if (e) result.email = e;
    if (this.mode() === 'login') {
      if (!password) result.password = 'Enter your password.';
    } else {
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
    const { email, password } = this.form.getRawValue();
    this.busy.set(true);
    try {
      if (this.mode() === 'login') await this.auth.login(email, password);
      else await this.auth.register(email, password);
      this.form.reset();
      const target = this.returnUrl();
      // Only paths inside the app.
      this.router.navigateByUrl(target?.startsWith('/') && !target.startsWith('//') ? target : '/study');
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
