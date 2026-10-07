import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { CharacterEntry, cleanEntry } from './character.model';

export interface SaveResult {
  entry: CharacterEntry;
  created: boolean;
}

/** Your characters, read from and written to data/characters.json by server/server.ts. */
@Injectable({ providedIn: 'root' })
export class CharactersService {
  private readonly http = inject(HttpClient);

  readonly list = signal<CharacterEntry[]>([]);
  readonly loaded = signal(false);
  readonly error = signal<string | null>(null);

  constructor() {
    this.reload();
  }

  async reload(): Promise<void> {
    try {
      const list = await firstValueFrom(this.http.get<unknown[]>('/api/characters'));
      this.list.set(list.map(cleanEntry));
      this.error.set(null);
    } catch {
      this.error.set('Could not reach the local server. Start the app with "npm start".');
    } finally {
      this.loaded.set(true);
    }
  }

  find(character: string | undefined): CharacterEntry | undefined {
    return this.list().find((c) => c.character === character);
  }

  async save(entry: CharacterEntry): Promise<SaveResult> {
    const result = await firstValueFrom(this.http.post<SaveResult>('/api/characters', entry));
    this.list.update((list) => {
      const i = list.findIndex((c) => c.character === result.entry.character);
      return i >= 0 ? list.map((c, k) => (k === i ? result.entry : c)) : [...list, result.entry];
    });
    return result;
  }

  async remove(character: string): Promise<void> {
    await firstValueFrom(this.http.delete(`/api/characters/${encodeURIComponent(character)}`));
    this.list.update((list) => list.filter((c) => c.character !== character));
  }
}

/** Readable message for a failed API call. */
export function errorMessage(err: unknown): string {
  if (err instanceof HttpErrorResponse) return err.error?.error ?? err.message;
  return err instanceof Error ? err.message : String(err);
}
