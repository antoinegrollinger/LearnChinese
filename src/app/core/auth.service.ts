import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { Session, User } from './auth.model';

const TOKEN_KEY = 'hanzi-workshop-session';

/** The session token of this browser (never the password). */
export function storedToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function storeToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {}
}

/** Login, registration and the current user (server/auth.ts). */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);

  /** The logged-in user, or null. */
  readonly user = signal<User | null>(null);
  private restoring: Promise<User | null> | null = null;

  constructor() {
    // The previous version kept the API password here: remove it.
    try {
      localStorage.removeItem('hanzi-workshop-password');
    } catch {}
  }

  /** On page load: checks the saved session with the server (once). */
  restore(): Promise<User | null> {
    this.restoring ??= (async () => {
      if (!storedToken()) return null;
      try {
        const { user } = await firstValueFrom(this.http.get<{ user: User }>('/api/auth/me'));
        this.user.set(user);
        return user;
      } catch {
        storeToken(null);
        return null;
      }
    })();
    return this.restoring;
  }

  login(email: string, password: string): Promise<User> {
    return this.start('/api/auth/login', email, password);
  }

  register(email: string, password: string): Promise<User> {
    return this.start('/api/auth/register', email, password);
  }

  async logout(): Promise<void> {
    try {
      await firstValueFrom(this.http.post('/api/auth/logout', {}));
    } catch {
      // Ended locally anyway; it expires on the server.
    }
    this.end();
  }

  /** The session is no longer valid (expired or logged out elsewhere): back to the login screen. */
  expired(): void {
    if (!this.user()) return;
    this.end({ expired: '1', returnUrl: this.router.url });
  }

  private async start(url: string, email: string, password: string): Promise<User> {
    const session = await firstValueFrom(this.http.post<Session>(url, { email, password }));
    storeToken(session.token);
    this.restoring = Promise.resolve(session.user);
    this.user.set(session.user);
    return session.user;
  }

  private end(queryParams: Record<string, string> = {}): void {
    storeToken(null);
    this.restoring = Promise.resolve(null);
    this.user.set(null);
    this.router.navigate(['/login'], { queryParams });
  }
}
