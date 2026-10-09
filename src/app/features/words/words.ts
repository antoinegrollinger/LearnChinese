import { Component, afterNextRender, computed, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { CharactersService, errorMessage } from '../../core/characters.service';
import { stripTones, toPinyin } from '../../core/pinyin';
import { speak } from '../../core/speech';
import { WordEntry } from '../../core/word.model';
import { WordsService } from '../../core/words.service';
import { Pinyin } from '../../shared/pinyin';

/** The Words tab of Study: your words, and the card of the one selected (/study/words/:word). */
@Component({
  selector: 'app-words',
  imports: [Pinyin, RouterLink],
  templateUrl: './words.html',
  host: { '(document:keydown)': 'onKey($event)' },
})
export class Words {
  /** Route parameter: /study/words/:word */
  readonly word = input<string>();

  private readonly router = inject(Router);
  protected readonly words = inject(WordsService);
  private readonly characters = inject(CharactersService);

  protected readonly query = signal('');
  protected readonly toPinyin = toPinyin;

  /** Short message at the bottom of the page ("Added 妈妈 ✓", "Deleted 妈妈"). */
  protected readonly toast = signal<{ text: string; kind?: 'error' } | null>(null);
  private toastTimer?: ReturnType<typeof setTimeout>;

  /** Word just saved on the Add page (passed in the navigation state), highlighted in the list. */
  private readonly savedMessage = this.router.currentNavigation()?.extras.state?.['saved'] as
    string | undefined;
  protected readonly justSaved = computed(() => (this.savedMessage ? this.word() : undefined));

  protected readonly visible = computed(() => {
    const q = stripTones(this.query().trim()).toLowerCase();
    return this.words.list().filter((w) => {
      if (!q) return true;
      return stripTones([w.word, w.pinyin, toPinyin(w.pinyin), w.meaning].join(' '))
        .toLowerCase()
        .includes(q);
    });
  });

  /** The word from the URL, or the first one. */
  protected readonly current = computed<WordEntry | undefined>(
    () => this.words.find(this.word()) ?? this.words.list()[0],
  );

  /** Each character of the word, with your data when it's one of your characters. */
  protected readonly composition = computed(() =>
    [...(this.current()?.word ?? '')].map((ch) => ({ ch, known: this.characters.find(ch) })),
  );

  constructor() {
    if (this.savedMessage) this.showToast(this.savedMessage);
    // Bring the selected (e.g. newly added) word into view in the list.
    afterNextRender(() =>
      document.querySelector('.word-tile.active')?.scrollIntoView({ block: 'nearest' }),
    );
  }

  private showToast(text: string, kind?: 'error'): void {
    clearTimeout(this.toastTimer);
    this.toast.set({ text, kind });
    this.toastTimer = setTimeout(() => this.toast.set(null), 4000);
  }

  protected select(w: WordEntry): void {
    this.router.navigate(['/study/words', w.word], { replaceUrl: true });
  }

  protected speak(): void {
    const w = this.current();
    if (w) speak(w.word);
  }

  /** Deletes the selected word after confirmation, then selects its neighbour. */
  protected async deleteCurrent(): Promise<void> {
    const entry = this.current();
    if (!entry || !confirm(`Delete ${entry.word} from your words?`)) return;
    const list = this.visible();
    const i = list.findIndex((w) => w.word === entry.word);
    const next = list[i + 1] ?? list[i - 1];
    try {
      await this.words.remove(entry.word);
      this.showToast(`Deleted ${entry.word}`);
      if (next) this.select(next);
      else this.router.navigate(['/study/words'], { replaceUrl: true });
    } catch (err) {
      this.showToast(`Delete failed: ${errorMessage(err)}`, 'error');
    }
  }

  /** ← → move between the words shown. */
  protected onKey(event: KeyboardEvent): void {
    if ((event.target as HTMLElement).matches('input, textarea, select')) return;
    const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    const list = this.visible();
    if (!delta || !list.length) return;
    const i = list.findIndex((w) => w.word === this.current()?.word);
    this.select(list[(i + delta + list.length) % list.length]);
  }
}
