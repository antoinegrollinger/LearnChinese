import { Component, computed, input } from '@angular/core';
import { CharacterPart } from '../../../core/character.model';
import { TranslatePipe } from '../../../core/i18n';
import { Pinyin } from '../../../shared/pinyin/pinyin';

/** "Meaning from 女 nǚ “woman”. Sound from 马 mǎ “horse”." */
@Component({
  selector: 'app-parts-summary',
  imports: [Pinyin, TranslatePipe],
  templateUrl: './parts-summary.html',
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
