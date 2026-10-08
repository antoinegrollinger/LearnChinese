import { Component, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { CharacterEntry } from '../../core/character.model';
import { CharactersService } from '../../core/characters.service';
import { typeOf } from '../../core/config';
import { speak } from '../../core/speech';
import { StatsService } from '../../core/stats.service';
import { HanziWriterView } from '../../shared/hanzi-writer';
import { Pinyin } from '../../shared/pinyin';
import { PartsSummary } from '../study/parts-summary';

/** Fisher–Yates shuffle (returns a new array). */
function shuffle<T>(items: T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/** Write the character from its pinyin and meaning, in random order; missed characters come back soon. */
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
  /** Characters still to come in this round. */
  private deck: string[] = [];

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
    if (mistakes) this.comeBackSoon(card.character);
    this.message.set(
      solutionShown
        ? { text: 'Watch the stroke order carefully, it will come back soon.' }
        : mistakes
          ? { text: `Done with ${mistakes} mistake(s).` }
          : { text: 'Perfect! 🎉', kind: 'ok' },
    );
  }

  /**
   * Every character once per round, in a new random order each round. A missed character is put
   * back a few cards later, so it comes back soon.
   */
  private pick(): CharacterEntry | null {
    const list = this.characters.list();
    if (!list.length) return null;
    const known = new Set(list.map((c) => c.character));
    this.deck = this.deck.filter((character) => known.has(character));
    if (!this.deck.length) {
      this.deck = shuffle(list.map((c) => c.character));
      // Not the same character twice in a row when a new round starts.
      if (this.deck.length > 1 && this.deck[0] === this.card()?.character) {
        this.deck.push(this.deck.shift()!);
      }
    }
    const character = this.deck.shift()!;
    return list.find((c) => c.character === character) ?? null;
  }

  private comeBackSoon(character: string): void {
    this.deck = this.deck.filter((c) => c !== character);
    const position = Math.min(this.deck.length, 3 + Math.floor(Math.random() * 4));
    this.deck.splice(position, 0, character);
  }
}
