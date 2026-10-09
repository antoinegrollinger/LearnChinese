import {
  Component,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { CharactersService, errorMessage } from '../../core/characters.service';
import { stripTones, toPinyin } from '../../core/pinyin';
import { speak } from '../../core/speech';
import { WordEntry } from '../../core/word.model';
import { LabelsService } from '../../core/labels.service';
import { WordsService } from '../../core/words.service';
import { readSetting, writeSetting } from '../../core/settings';
import { LabelPicker } from '../../shared/label-picker';
import { SpeakerIcon } from '../../shared/speaker-icon';
import { Pinyin } from '../../shared/pinyin';
import { SlidingThumb } from '../../shared/sliding-thumb';

const LAYOUT_KEY = 'hanzi-workshop-words-layout';

/** The Words tab of Study: your words, and the card of the one selected (/study/words/:word). */
@Component({
  selector: 'app-words',
  imports: [Pinyin, RouterLink, SlidingThumb, LabelPicker, SpeakerIcon],
  templateUrl: './words.html',
  host: { '(document:keydown)': 'onKey($event)' },
})
export class Words {
  /** Route parameter: /study/words/:word */
  readonly word = input<string>();

  private readonly router = inject(Router);
  protected readonly words = inject(WordsService);
  private readonly characters = inject(CharactersService);
  protected readonly labels = inject(LabelsService);

  protected readonly query = signal('');
  /** null: all words, '': those without a label, otherwise that label. */
  protected readonly labelFilter = signal<string | null>(null);
  protected readonly savingLabel = signal(false);
  /** The word list as tiles or as rows (like the Characters tab); remembered in this browser. */
  protected readonly layout = signal<'grid' | 'list'>(
    readSetting(LAYOUT_KEY) === 'grid' ? 'grid' : 'list',
  );
  protected readonly toPinyin = toPinyin;

  /** Short message at the bottom of the page ("Added 妈妈 ✓", "Deleted 妈妈"). */
  protected readonly toast = signal<{ text: string; kind?: 'error' } | null>(null);
  private toastTimer?: ReturnType<typeof setTimeout>;

  /** Word just saved on the Add page (passed in the navigation state), highlighted in the list. */
  private readonly savedMessage = this.router.currentNavigation()?.extras.state?.['saved'] as
    string | undefined;
  protected readonly justSaved = computed(() => (this.savedMessage ? this.word() : undefined));

  /** The label dropdown: each label with its number of words. */
  protected readonly labelFilters = computed(() => {
    const list = this.words.list();
    const count = (label: string) => list.filter((w) => (w.label ?? '') === label).length;
    return {
      all: list.length,
      none: count(''),
      labels: this.labels.names().map((name) => ({ name, count: count(name) })),
    };
  });

  /** Option of the label dropdown: "all", "none" or "=<label>". */
  protected setLabelFilter(value: string): void {
    this.labelFilter.set(value === 'all' ? null : value === 'none' ? '' : value.slice(1));
  }

  protected readonly visible = computed(() => {
    const q = stripTones(this.query().trim()).toLowerCase();
    const label = this.labelFilter();
    return this.words.list().filter((w) => {
      if (label !== null && (w.label ?? '') !== label) return false;
      if (!q) return true;
      return stripTones([w.word, w.pinyin, toPinyin(w.pinyin), w.meaning, w.label].join(' '))
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
    // The selected word stays in view in the (scrolling) list, e.g. with ← →.
    const injector = inject(Injector);
    effect(() => {
      this.current();
      afterNextRender(
        () => document.querySelector('.word-tile.active')?.scrollIntoView({ block: 'nearest' }),
        { injector },
      );
    });
  }

  protected setLayout(layout: 'grid' | 'list'): void {
    this.layout.set(layout);
    writeSetting(LAYOUT_KEY, layout);
  }

  private showToast(text: string, kind?: 'error'): void {
    clearTimeout(this.toastTimer);
    this.toast.set({ text, kind });
    this.toastTimer = setTimeout(() => this.toast.set(null), 4000);
  }

  protected select(w: WordEntry): void {
    this.router.navigate(['/study/words', w.word], { replaceUrl: true });
  }

  /** Saves the selected word with this label ('' = none). */
  protected async setLabel(label: string): Promise<void> {
    const entry = this.current();
    if (!entry || (entry.label ?? '') === label) return;
    this.savingLabel.set(true);
    try {
      await this.words.save({ ...entry, label: label || undefined });
      this.showToast(label ? `Label: ${label} ✓` : 'Label removed ✓');
    } catch (err) {
      this.showToast(`Could not save the label: ${errorMessage(err)}`, 'error');
    } finally {
      this.savingLabel.set(false);
    }
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
