import { Component, computed, input } from '@angular/core';
import { CharacterPart } from '../../core/character.model';
import { Pinyin } from '../../shared/pinyin';

/** "Meaning from 女 nǚ “woman”. Sound from 马 mǎ “horse”." */
@Component({
  selector: 'app-parts-summary',
  imports: [Pinyin],
  template: `
    @for (group of groups(); track group.label) {
      {{ group.label }}
      @for (part of group.parts; track $index) {
        @if (!$first) {
          +
        }
        <b>{{ part.character }}</b> <app-pinyin [text]="part.pinyin" />
        @if (part.meaning) {
          “{{ part.meaning }}”
        }
      }
      .
    }
  `,
})
export class PartsSummary {
  readonly parts = input<CharacterPart[]>([]);

  protected readonly groups = computed(() =>
    [
      { label: 'Meaning from', parts: this.parts().filter((k) => k.role === 'meaning') },
      { label: 'Sound from', parts: this.parts().filter((k) => k.role === 'sound') },
    ].filter((g) => g.parts.length),
  );
}
