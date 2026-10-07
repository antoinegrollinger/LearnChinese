import { Injectable, signal } from '@angular/core';

export interface CharacterStats {
  attempts: number;
  mistakes: number;
  perfect: number;
}

const STORAGE_KEY = 'hanzi-workshop-stats';

/** Practice results, kept in this browser's localStorage. */
@Injectable({ providedIn: 'root' })
export class StatsService {
  readonly stats = signal<Record<string, CharacterStats>>(this.read());

  record(character: string, mistakes: number): void {
    this.stats.update((all) => {
      const s = all[character] ?? { attempts: 0, mistakes: 0, perfect: 0 };
      return {
        ...all,
        [character]: {
          attempts: s.attempts + 1,
          mistakes: s.mistakes + mistakes,
          perfect: s.perfect + (mistakes ? 0 : 1),
        },
      };
    });
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.stats()));
    } catch {
      /* storage unavailable */
    }
  }

  private read(): Record<string, CharacterStats> {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') ?? {};
    } catch {
      return {};
    }
  }
}
