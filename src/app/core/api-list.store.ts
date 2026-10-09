import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { effect, inject, signal, untracked } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AuthService } from './auth.service';
import { t, translateMessage } from './i18n';

export interface SaveResult<T> {
  entry: T;
  created: boolean;
}

/** The logged-in user's list, read and written through server/server.ts (/api/<name>). */
export abstract class ApiListStore<T> {
  private readonly http = inject(HttpClient);

  readonly list = signal<T[]>([]);
  readonly loaded = signal(false);
  readonly error = signal<string | null>(null);

  constructor(
    private readonly url: string,
    private readonly keyOf: (item: T) => string,
    private readonly clean: (raw: unknown) => T,
  ) {
    // Each user has their own list: load it on login, empty it on logout.
    const auth = inject(AuthService);
    effect(() => {
      const user = auth.user();
      untracked(() => (user ? this.reload() : this.clear()));
    });
  }

  private clear(): void {
    this.list.set([]);
    this.loaded.set(false);
    this.error.set(null);
  }

  async reload(): Promise<void> {
    try {
      const list = await firstValueFrom(this.http.get<unknown[]>(this.url));
      this.list.set(list.map(this.clean));
      this.error.set(null);
    } catch (err) {
      if (err instanceof HttpErrorResponse && err.status === 401) return; // back to the login screen
      const url = err instanceof HttpErrorResponse && err.url ? err.url : this.url;
      this.error.set(
        t(
          'Could not reach the server ({url}): {error}. On your computer, start the app with "npm start"; online, check apiUrl in config.json.',
          { url, error: errorMessage(err) },
        ),
      );
    } finally {
      this.loaded.set(true);
    }
  }

  find(key: string | undefined): T | undefined {
    return this.list().find((item) => this.keyOf(item) === key);
  }

  /** Adds the item, or replaces the one with the same key. */
  async save(item: T): Promise<SaveResult<T>> {
    const result = await firstValueFrom(this.http.post<SaveResult<T>>(this.url, item));
    const key = this.keyOf(result.entry);
    this.list.update((list) => {
      const i = list.findIndex((x) => this.keyOf(x) === key);
      return i >= 0 ? list.map((x, k) => (k === i ? result.entry : x)) : [...list, result.entry];
    });
    return result;
  }

  async remove(key: string): Promise<void> {
    await firstValueFrom(this.http.delete(`${this.url}/${encodeURIComponent(key)}`));
    this.list.update((list) => list.filter((x) => this.keyOf(x) !== key));
  }
}

/** Readable message for a failed API call (translated when it is one of the known messages). */
export function errorMessage(err: unknown): string {
  if (err instanceof HttpErrorResponse) return translateMessage(err.error?.error ?? err.message);
  return translateMessage(err instanceof Error ? err.message : String(err));
}
