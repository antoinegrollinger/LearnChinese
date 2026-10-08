import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiListStore } from './api-list.store';
import { WordEntry, cleanWord } from './word.model';

/** One CC-CEDICT entry, as returned by GET /api/lookup/:word (see server/cedict.ts). */
export interface CedictEntry {
  traditional: string;
  simplified: string;
  /** Numbered pinyin with spaces, e.g. "ma1 ma5" */
  pinyin: string;
  definitions: string[];
}

export interface LookupResult {
  exact: CedictEntry[];
  parts: { text: string; entries: CedictEntry[] }[];
}

/** "ma1 ma5" → "ma1ma5" (the format used in your lists). */
export const joinPinyin = (pinyin: string): string => pinyin.replace(/\s+/g, '');

/** Definitions without the "CL:" (classifier) notes, joined with "; ". */
export const meaningOf = (entry: CedictEntry): string =>
  entry.definitions.filter((d) => !d.startsWith('CL:')).join('; ');

/** Your words (through the API) and the CC-CEDICT word lookup. */
@Injectable({ providedIn: 'root' })
export class WordsService extends ApiListStore<WordEntry> {
  private readonly httpClient = inject(HttpClient);

  constructor() {
    super('/api/words', (w) => w.word, cleanWord);
  }

  lookup(word: string): Promise<LookupResult> {
    return firstValueFrom(
      this.httpClient.get<LookupResult>(`/api/lookup/${encodeURIComponent(word)}`),
    );
  }

  /** Your words that contain the character. */
  containing(character: string): WordEntry[] {
    return this.list().filter((w) => w.word.includes(character));
  }
}
