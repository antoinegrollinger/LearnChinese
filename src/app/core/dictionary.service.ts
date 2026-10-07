import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { CharacterEntry } from './character.model';
import {
  DICTIONARY_URL,
  Dictionary,
  DictionaryEntry,
  FREQUENCY_URL,
  HskWord,
  WORDS_URL,
  buildDictionary,
  entryFromDictionary,
  searchDictionary,
} from './dictionary';

export { shortDefinition } from './dictionary';
export type { Dictionary, DictionaryEntry } from './dictionary';

/** Downloads the dictionary once (on first use) and exposes it as a signal. */
@Injectable({ providedIn: 'root' })
export class DictionaryService {
  private readonly http = inject(HttpClient);
  private promise: Promise<Dictionary> | null = null;

  /** Set once everything is downloaded. */
  readonly dictionary = signal<Dictionary | null>(null);
  readonly loading = signal(false);
  readonly error = signal(false);

  load(): Promise<Dictionary> {
    if (!this.promise) {
      this.loading.set(true);
      this.error.set(false);
      const text = (url: string) => firstValueFrom(this.http.get(url, { responseType: 'text' }));
      this.promise = Promise.all([
        text(DICTIONARY_URL),
        text(FREQUENCY_URL).catch(() => ''),
        firstValueFrom(this.http.get<HskWord[]>(WORDS_URL)).catch(() => [] as HskWord[]),
      ]).then(([dict, freq, hsk]) => buildDictionary(dict, freq, hsk));
      this.promise.then(
        (d) => {
          this.dictionary.set(d);
          this.loading.set(false);
        },
        () => {
          this.promise = null; // allows retrying
          this.loading.set(false);
          this.error.set(true);
        },
      );
    }
    return this.promise;
  }

  /** Exact syllable matches first, then syllables starting with the input; most frequent first. */
  search(dict: Dictionary, input: string, limit = 60): DictionaryEntry[] {
    return searchDictionary(dict, input, limit);
  }

  /** Builds an entry in the data/characters.json format from a dictionary entry. */
  toEntry(dict: Dictionary, entry: DictionaryEntry, query = ''): CharacterEntry {
    return entryFromDictionary(dict, entry, query);
  }
}
