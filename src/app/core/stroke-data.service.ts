import { Injectable } from '@angular/core';
import HanziWriter, { CharacterJson } from 'hanzi-writer';
import { CharacterEntry, CharacterPart } from './character.model';
import { ROLES } from './config';

export interface StrokeAssignment {
  /** Index of the component each stroke belongs to (null = unknown). */
  indices: (number | null)[] | null;
  warning?: string;
}

/** "1-3, 5" → 0-based indices [0, 1, 2, 4]. */
export function parseStrokes(strokes: string): number[] {
  const res: number[] = [];
  for (const part of strokes.split(',')) {
    const [a, b] = part.split('-').map((x) => parseInt(x, 10));
    if (isNaN(a)) continue;
    for (let n = a; n <= (isNaN(b) ? a : b); n++) res.push(n - 1);
  }
  return res;
}

/** One colour per component, from its role's palette. */
export function partColors(parts: CharacterPart[] = []): string[] {
  const seen: Record<string, number> = {};
  return parts.map((k) => {
    const palette = (ROLES[k.role] ?? ROLES.other).colors;
    const n = seen[k.role] ?? 0;
    seen[k.role] = n + 1;
    return palette[n % palette.length];
  });
}

/** Loads Hanzi Writer stroke data (from its CDN) and caches it. */
@Injectable({ providedIn: 'root' })
export class StrokeDataService {
  private readonly cache = new Map<string, Promise<CharacterJson | null>>();

  load(character: string): Promise<CharacterJson | null> {
    let promise = this.cache.get(character);
    if (!promise) {
      const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000));
      promise = Promise.race([HanziWriter.loadCharacterData(character), timeout]).then(
        (d) => (d && d.strokes ? d : null),
        () => null,
      );
      this.cache.set(character, promise);
    }
    return promise;
  }

  /** Maps each stroke of the character to one of its components. */
  async assign(entry: CharacterEntry, data: CharacterJson): Promise<StrokeAssignment> {
    const n = data.strokes.length;
    const parts = entry.components ?? [];
    const indices: (number | null)[] = new Array(n).fill(null);
    if (!parts.length) return { indices };

    // 1) Strokes given by hand
    if (parts.some((k) => k.strokes)) {
      parts.forEach((k, j) => {
        for (const t of parseStrokes(k.strokes ?? '')) if (t >= 0 && t < n) indices[t] = j;
      });
      return { indices };
    }

    // 2) Automatic: components are written one after the other
    const counts = await Promise.all(
      parts.map((k) => this.load(k.character).then((d) => d?.strokes.length ?? null)),
    );
    const unknown = counts.filter((x) => x == null).length;
    if (unknown === 1) {
      counts[counts.indexOf(null)] = n - counts.reduce<number>((s, x) => s + (x ?? 0), 0);
    }
    const total = counts.reduce<number>((s, x) => s + (x ?? 0), 0);
    if (unknown > 1 || total !== n || counts.some((x) => x == null || x <= 0)) {
      return {
        indices: null,
        warning:
          'Strokes could not be assigned automatically: give each component its stroke numbers (Edit).',
      };
    }
    let t = 0;
    counts.forEach((x, j) => {
      for (let i = 0; i < (x ?? 0); i++) indices[t++] = j;
    });
    return { indices };
  }
}
