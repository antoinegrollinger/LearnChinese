import { Component, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { CharacterEntry } from '../../core/character.model';
import { CharactersService } from '../../core/characters.service';
import { typeOf } from '../../core/config';
import { speak } from '../../core/speech';
import { StatsService } from '../../core/stats.service';
import { HanziWriterView } from '../../shared/hanzi-writer';
import { Pinyin } from '../../shared/pinyin';
import { PartsSummary } from '../study/parts-summary';

/** Write the character from its pinyin and meaning; missed characters come back more often. */
@Component({
  selector: 'app-review',
  imports: [HanziWriterView, Pinyin, PartsSummary],
  templateUrl: './review.html',
})
export class Review {
  private readonly characters = inject(CharactersService);
  private readonly statsService = inject(StatsService);
  private readonly writer = viewChild(HanziWriterView);

  protected readonly card = signal<CharacterEntry | null>(null);
  protected readonly done = signal(false);
  protected readonly outline = signal(false);
  protected readonly message = signal<{ text: string; kind?: 'ok' | 'error' }>({ text: '' });
  protected readonly typeOf = typeOf;

  protected readonly score = computed(() => {
    const stats = this.statsService.stats();
    const list = this.characters.list();
    const seen = list.filter((c) => stats[c.character]);
    const perfect = seen.filter((c) => stats[c.character].perfect > 0).length;
    return `${seen.length}/${list.length} characters reviewed · ${perfect} written without mistakes at least once`;
  });

  constructor() {
    // First card once the list is loaded.
    effect(() => {
      if (this.characters.list().length && !untracked(this.card)) untracked(() => this.next());
    });
    // Start the quiz whenever a new card is shown.
    effect(() => {
      const card = this.card();
      const writer = this.writer();
      if (card && writer) untracked(() => setTimeout(() => this.startQuiz(writer)));
    });
  }

  protected next(): void {
    this.card.set(this.pick());
    this.done.set(false);
    this.outline.set(false);
    this.message.set({ text: '' });
  }

  protected hint(): void {
    this.writer()?.revealOutline();
  }

  protected solution(): void {
    this.writer()?.animate();
    this.finish(1, true); // counts as a miss
  }

  protected speak(): void {
    const card = this.card();
    if (card) speak(card.character);
  }

  private startQuiz(writer: HanziWriterView): void {
    writer.quiz({
      showHintAfterMisses: 3,
      onMistake: () => this.message.set({ text: 'Not quite…', kind: 'error' }),
      onCorrectStroke: (s) =>
        this.message.set({ text: `✓ ${s.strokesRemaining} stroke(s) left`, kind: 'ok' }),
      onComplete: ({ totalMistakes }) => this.finish(totalMistakes),
    });
  }

  private finish(mistakes: number, solutionShown = false): void {
    const card = this.card();
    if (this.done() || !card) return;
    this.done.set(true);
    this.statsService.record(card.character, mistakes);
    this.message.set(
      solutionShown
        ? { text: 'Watch the stroke order carefully, it will come back soon.' }
        : mistakes
          ? { text: `Done with ${mistakes} mistake(s).` }
          : { text: 'Perfect! 🎉', kind: 'ok' },
    );
  }

  /** Characters never reviewed or often missed come first. */
  private pick(): CharacterEntry | null {
    const list = this.characters.list();
    const stats = this.statsService.stats();
    const previous = this.card();
    let best: CharacterEntry | null = null;
    let max = -Infinity;
    for (const c of list) {
      if (previous && c.character === previous.character && list.length > 1) continue;
      const s = stats[c.character];
      const priority =
        (s ? s.mistakes / s.attempts + (s.attempts - s.perfect) / s.attempts : 2) + Math.random();
      if (priority > max) {
        max = priority;
        best = c;
      }
    }
    return best;
  }
}
