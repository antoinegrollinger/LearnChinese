import { Injectable, computed, inject } from '@angular/core';
import { ApiListStore } from './api-list.store';
import { Label, cleanLabel, labelColor } from './character.model';
import { CharactersService } from './characters.service';
import { WordsService } from './words.service';

/**
 * Your labels with their colours (/api/labels), shared by characters and words. A character's or
 * word's label is also stored when it is saved.
 */
@Injectable({ providedIn: 'root' })
export class LabelsService extends ApiListStore<Label> {
  private readonly characters = inject(CharactersService);
  private readonly words = inject(WordsService);

  constructor() {
    super('/api/labels', (label) => label.name, cleanLabel);
  }

  /** Every label name, sorted: the stored ones and those of your characters and words (including
   *  just saved). */
  readonly names = computed(() =>
    sortLabels([
      ...this.list().map((l) => l.name),
      ...this.characters.list().map((c) => c.label),
      ...this.words.list().map((w) => w.label),
    ]),
  );

  private readonly colors = computed(
    () => new Map(this.list().map((l) => [l.name, labelColor(l)])),
  );

  /** The label's colour (picked from its name until you choose one). */
  colorOf(name: string): string {
    return this.colors().get(name) ?? labelColor({ name });
  }
}

/** Each label once, without empty ones, sorted alphabetically (numbers in order: HSK 2 < HSK 10). */
export const sortLabels = (labels: (string | undefined)[]): string[] =>
  [...new Set(labels.filter((l): l is string => !!l))].sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }),
  );
