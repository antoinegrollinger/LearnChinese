import {
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  resource,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { CharacterEntry, CharacterPart } from '../../core/character.model';
import { ROLES, typeOf } from '../../core/config';
import { speak } from '../../core/speech';
import { StatsService } from '../../core/stats.service';
import { WordsService } from '../../core/words.service';
import { StrokeDataService, partColors } from '../../core/stroke-data.service';
import { HanziWriterView } from '../../shared/hanzi-writer';
import { Pinyin } from '../../shared/pinyin';
import { StrokeSvg } from '../../shared/stroke-svg';
import { PartsSummary } from './parts-summary';

@Component({
  selector: 'app-character-card',
  imports: [HanziWriterView, Pinyin, StrokeSvg, RouterLink, PartsSummary],
  templateUrl: './character-card.html',
})
export class CharacterCard {
  readonly entry = input.required<CharacterEntry>();
  /** The Delete button was clicked (the Study page confirms and deletes). */
  readonly deleteRequested = output<void>();

  private readonly strokeData = inject(StrokeDataService);
  private readonly statsService = inject(StatsService);
  private readonly words = inject(WordsService);
  private readonly writer = viewChild.required(HanziWriterView);

  protected readonly roles = ROLES;
  protected readonly showOutline = signal(true);
  /** Practice mode stays on when you move to another character (← → or the list). */
  protected readonly practicing = signal(false);
  protected readonly message = signal<{ text: string; kind?: 'ok' | 'error' }>({ text: '' });

  protected readonly type = computed(() => typeOf(this.entry().type));
  protected readonly parts = computed<CharacterPart[]>(() => this.entry().components ?? []);
  protected readonly colors = computed(() => partColors(this.parts()));
  /** Saved words (data/words.json) containing this character. */
  protected readonly savedWords = computed(() => this.words.containing(this.entry().character));

  /** Stroke paths + which component each stroke belongs to. */
  protected readonly strokeInfo = resource({
    params: () => this.entry(),
    loader: async ({ params: entry }) => {
      const data = await this.strokeData.load(entry.character);
      if (!data) return null;
      return { strokes: data.strokes, ...(await this.strokeData.assign(entry, data)) };
    },
  });

  /** Colour of each stroke in the decomposition drawing. */
  protected readonly strokeColors = computed(() => {
    const info = this.strokeInfo.value();
    const colors = this.colors();
    return (info?.strokes ?? []).map((_, i) => {
      const part = info?.indices?.[i];
      return part != null ? colors[part] : null;
    });
  });

  /** One drawing per step: strokes done in ink, current stroke coloured, the rest faint. */
  protected readonly steps = computed(() => {
    const strokes = this.strokeInfo.value()?.strokes ?? [];
    const colors = this.strokeColors();
    return strokes.map((_, k) =>
      strokes.map((__, i) =>
        i < k ? 'var(--ink)' : i === k ? colors[i] || 'var(--accent)' : 'var(--outline)',
      ),
    );
  });

  constructor() {
    effect(() => {
      this.entry();
      if (untracked(this.practicing)) untracked(() => setTimeout(() => this.practice()));
    });
  }

  protected animate(): void {
    this.practicing.set(false);
    this.message.set({ text: '' });
    this.writer().animate();
  }

  protected practice(): void {
    const character = this.entry().character;
    this.practicing.set(true);
    this.message.set({ text: 'Draw the first stroke…' });
    this.writer().quiz({
      showHintAfterMisses: 2,
      highlightOnComplete: true,
      onMistake: (s) =>
        this.message.set({
          text: `Missed stroke ${s.strokeNum + 1}${s.mistakesOnStroke >= 2 ? ' — follow the hint' : ''}`,
          kind: 'error',
        }),
      onCorrectStroke: (s) =>
        this.message.set({
          text: `Stroke ${s.strokeNum + 1} ✓ (${s.strokesRemaining} left)`,
          kind: 'ok',
        }),
      onComplete: ({ totalMistakes }) => {
        this.message.set({
          text: totalMistakes
            ? `Done with ${totalMistakes} mistake(s).`
            : 'Perfect, no mistakes! 🎉',
          kind: 'ok',
        });
        this.statsService.record(character, totalMistakes);
      },
    });
  }

  protected speak(): void {
    speak(this.entry().character);
  }
}
