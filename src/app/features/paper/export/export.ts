import { Component, computed, inject, resource, signal } from '@angular/core';
import { CharactersService, errorMessage } from '../../../core/characters.service';
import { MessagePipe, PluralPipe, TranslatePipe, t } from '../../../core/i18n';
import { comparePinyin, toPinyin } from '../../../core/pinyin';
import { readSetting, writeSetting } from '../../../core/settings';
import { StrokeDataService } from '../../../core/stroke-data.service';
import { WordsService } from '../../../core/words.service';
import { SlidingThumb } from '../../../shared/directives/sliding-thumb';
import { DEFAULT_MATERIAL_TITLE, MaterialOptions, layoutMaterial } from '../learning-material';
import { sheetPdf } from '../pdf';
import { SheetPreview } from '../sheet-preview/sheet-preview';

const OPTIONS_KEY = 'hanzi-workshop-material-options';

/**
 * Train on paper, Export tab (/paper/export): your characters and words (all, or the ones you
 * pick) as a PDF to print, with the answers or with blank lines to fill in. Characters and words
 * each get their section, in the alphabetical order of their pinyin.
 */
@Component({
  selector: 'app-learning-export',
  imports: [SlidingThumb, TranslatePipe, PluralPipe, MessagePipe, SheetPreview],
  templateUrl: './export.html',
})
export class LearningExport {
  protected readonly characters = inject(CharactersService);
  protected readonly words = inject(WordsService);
  private readonly strokeData = inject(StrokeDataService);

  protected readonly toPinyin = toPinyin;
  protected readonly defaultTitle = DEFAULT_MATERIAL_TITLE;
  protected readonly options = signal<MaterialOptions>(readOptions());
  protected readonly downloading = signal(false);
  protected readonly error = signal('');

  /** Left out of the export (everything else is in, also what you add later). */
  private readonly excludedCharacters = signal<ReadonlySet<string>>(new Set());
  private readonly excludedWords = signal<ReadonlySet<string>>(new Set());

  /** Your lists in the alphabetical order of the pinyin. */
  protected readonly allCharacters = computed(() =>
    [...this.characters.list()].sort(
      (a, b) => comparePinyin(a.pinyin, b.pinyin) || a.character.localeCompare(b.character),
    ),
  );
  protected readonly allWords = computed(() =>
    [...this.words.list()].sort(
      (a, b) => comparePinyin(a.pinyin, b.pinyin) || a.word.localeCompare(b.word),
    ),
  );
  protected readonly chosenCharacters = computed(() =>
    this.allCharacters().filter((c) => !this.excludedCharacters().has(c.character)),
  );
  protected readonly chosenWords = computed(() =>
    this.allWords().filter((w) => !this.excludedWords().has(w.word)),
  );

  /** Stroke paths of the chosen characters (drawn in their boxes). */
  private readonly strokes = resource({
    params: () => this.chosenCharacters().map((c) => c.character),
    loader: async ({ params: chars }) => {
      const data = await Promise.all(chars.map((ch) => this.strokeData.load(ch)));
      return new Map(chars.map((ch, i) => [ch, data[i]?.strokes]));
    },
  });
  protected readonly loading = computed(() => this.strokes.isLoading());

  protected readonly pages = computed(() => {
    const strokes = this.strokes.value() ?? new Map<string, string[] | undefined>();
    return layoutMaterial(
      this.chosenCharacters().map((entry) => ({ entry, strokes: strokes.get(entry.character) })),
      this.chosenWords().map((entry) => ({
        entry,
        characters: [...entry.word].map((ch) => ({ ch, known: this.characters.find(ch) })),
      })),
      this.options(),
    );
  });

  protected set<K extends keyof MaterialOptions>(key: K, value: MaterialOptions[K]): void {
    this.options.update((o) => ({ ...o, [key]: value }));
    writeSetting(OPTIONS_KEY, JSON.stringify(this.options()));
  }

  protected isCharacterChosen(ch: string): boolean {
    return !this.excludedCharacters().has(ch);
  }

  protected isWordChosen(word: string): boolean {
    return !this.excludedWords().has(word);
  }

  protected toggleCharacter(ch: string): void {
    this.excludedCharacters.update((set) => toggled(set, ch));
  }

  protected toggleWord(word: string): void {
    this.excludedWords.update((set) => toggled(set, word));
  }

  /** All the characters (true) or none (false). */
  protected chooseAllCharacters(all: boolean): void {
    this.excludedCharacters.set(
      all ? new Set() : new Set(this.allCharacters().map((c) => c.character)),
    );
  }

  protected chooseAllWords(all: boolean): void {
    this.excludedWords.set(all ? new Set() : new Set(this.allWords().map((w) => w.word)));
  }

  protected async download(): Promise<void> {
    const pages = this.pages();
    if (!pages.length) return;
    this.downloading.set(true);
    this.error.set('');
    try {
      const options = this.options();
      const title = options.title.trim() || t(DEFAULT_MATERIAL_TITLE);
      const name = options.answers ? title : `${title} (${t('exercise')})`;
      const blob = await sheetPdf(pages, name);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${name.replace(/[\\/:*?"<>|]+/g, '-')}.pdf`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      this.error.set(t('Could not make the PDF: {error}', { error: errorMessage(err) }));
    } finally {
      this.downloading.set(false);
    }
  }
}

/** The set with the item added, or removed if it was in. */
function toggled(set: ReadonlySet<string>, item: string): ReadonlySet<string> {
  const next = new Set(set);
  if (!next.delete(item)) next.add(item);
  return next;
}

/** The saved options, completed with the defaults. */
function readOptions(): MaterialOptions {
  const defaults: MaterialOptions = { title: '', answers: true, notes: true, layout: 'detailed' };
  try {
    return { ...defaults, ...JSON.parse(readSetting(OPTIONS_KEY) ?? '{}') };
  } catch {
    return defaults;
  }
}
