import {
  Component,
  ElementRef,
  afterNextRender,
  effect,
  inject,
  input,
  output,
  untracked,
} from '@angular/core';
import HanziWriter, { QuizOptions } from 'hanzi-writer';

const cssVar = (name: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/**
 * Wraps Hanzi Writer: animation and drawing practice on a 米字格 grid.
 * Use a template reference (or viewChild) to call animate(), quiz(), etc.
 */
@Component({
  selector: 'app-hanzi-writer',
  template: '',
  host: { class: 'mi-grid', '[style.width.px]': 'size()', '[style.height.px]': 'size()' },
})
export class HanziWriterView {
  readonly character = input.required<string>();
  readonly size = input(300);
  readonly showOutline = input(true);
  /** Hides the character itself (used in Review). */
  readonly hideCharacter = input(false);
  readonly loadError = output<void>();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private writer?: HanziWriter;

  constructor() {
    afterNextRender(() => this.create(this.character()));

    // Character changed → a new writer. With setCharacter(), drawing on a phone only worked for
    // the first character.
    effect(() => {
      const character = this.character();
      if (!this.writer) return;
      untracked(() => this.create(character));
    });

    effect(() => {
      const show = this.showOutline();
      if (show) this.writer?.showOutline();
      else this.writer?.hideOutline();
    });
  }

  animate(): void {
    this.writer?.cancelQuiz();
    if (this.hideCharacter()) this.writer?.hideCharacter();
    this.writer?.animateCharacter();
  }

  quiz(options: Partial<QuizOptions>): void {
    this.writer?.quiz(options);
  }

  cancelQuiz(): void {
    this.writer?.cancelQuiz();
    this.applyDisplay();
  }

  revealOutline(): void {
    this.writer?.showOutline();
  }

  private create(character: string): void {
    this.writer?.cancelQuiz();
    this.host.nativeElement.replaceChildren();
    this.writer = HanziWriter.create(this.host.nativeElement, character, {
      width: this.size(),
      height: this.size(),
      padding: 14,
      strokeColor: cssVar('--ink'),
      outlineColor: cssVar('--outline'),
      drawingColor: cssVar('--drawing'),
      highlightColor: cssVar('--tone4'),
      strokeAnimationSpeed: 1,
      delayBetweenStrokes: 250,
      drawingWidth: 6,
      showOutline: this.showOutline(),
      showCharacter: !this.hideCharacter(),
      onLoadCharDataError: () => this.loadError.emit(),
    });
  }

  private applyDisplay(): void {
    const w = this.writer;
    if (!w) return;
    if (this.showOutline()) w.showOutline();
    else w.hideOutline();
    if (this.hideCharacter()) w.hideCharacter();
    else w.showCharacter();
  }
}
