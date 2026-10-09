import { Component, computed, effect, inject, resource, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CharactersService, errorMessage } from '../../core/characters.service';
import { LabelsService } from '../../core/labels.service';
import { toPinyin } from '../../core/pinyin';
import { readSetting, writeSetting } from '../../core/settings';
import { StrokeDataService } from '../../core/stroke-data.service';
import { WordsService } from '../../core/words.service';
import { SlidingThumb } from '../../shared/sliding-thumb';
import { sheetPdf } from './pdf';
import {
  DEFAULT_SHEET_OPTIONS,
  GridStyle,
  PAGE,
  SHEET_FONT,
  SheetCharacter,
  SheetOptions,
  glyphTransform,
  layoutSheet,
} from './worksheet';

const TEXT_KEY = 'hanzi-workshop-paper-text';
const OPTIONS_KEY = 'hanzi-workshop-paper-options';

/** Chinese characters only (no spaces, punctuation or Latin letters). */
const isHan = (ch: string) => /\p{Script=Han}/u.test(ch);

/**
 * Train on paper: pick characters (typed, or from your lists), choose the layout, and download a
 * PDF of practice sheets: the model, grey shadows to trace, empty boxes, the stroke order and
 * the pinyin. The preview is drawn from the same layout as the PDF.
 */
@Component({
  selector: 'app-paper',
  imports: [RouterLink, SlidingThumb],
  templateUrl: './paper.html',
})
export class Paper {
  protected readonly characters = inject(CharactersService);
  protected readonly words = inject(WordsService);
  protected readonly labels = inject(LabelsService);
  private readonly strokeData = inject(StrokeDataService);

  protected readonly page = PAGE;
  protected readonly font = SHEET_FONT;
  protected readonly glyphTransform = glyphTransform;
  protected readonly grids: [GridStyle, string][] = [
    ['mi', '米 Cross and diagonals'],
    ['tian', '田 Cross'],
    ['none', 'Empty boxes'],
  ];
  protected readonly sizes = [
    { boxes: 8, name: 'Large' },
    { boxes: 11, name: 'Medium' },
    { boxes: 14, name: 'Small' },
  ];

  /** The characters of the sheets, in order (repeats allowed); remembered in this browser. */
  protected readonly text = signal(readSetting(TEXT_KEY) ?? '');
  protected readonly options = signal<SheetOptions>(readOptions());
  protected readonly downloading = signal(false);
  protected readonly error = signal('');

  /** The Chinese characters of the text, in order. */
  protected readonly sequence = computed(() => [...this.text()].filter(isHan));

  /** Pinyin found in CC-CEDICT for characters that aren't in your list. */
  private readonly lookedUp = new Map<string, Promise<string | undefined>>();

  /** Stroke data and pinyin of each different character. */
  private readonly data = resource({
    params: () => [...new Set(this.sequence())],
    loader: async ({ params: chars }) => {
      const entries = await Promise.all(
        chars.map(async (character) => {
          const [strokes, pinyin] = await Promise.all([
            this.strokeData.load(character),
            this.pinyinOf(character),
          ]);
          return [character, { strokes: strokes?.strokes, pinyin }] as const;
        }),
      );
      return new Map(entries);
    },
  });

  protected readonly loading = computed(() => this.data.isLoading());

  /** Characters without stroke data (not drawable). */
  protected readonly missing = computed(() => {
    const data = this.data.value();
    if (!data) return [];
    return [...new Set(this.sequence())].filter((c) => !data.get(c)?.strokes);
  });

  protected readonly sheetCharacters = computed<SheetCharacter[]>(() => {
    const data = this.data.value();
    if (!data) return [];
    return this.sequence().flatMap((character) => {
      const d = data.get(character);
      return d?.strokes ? [{ character, pinyin: d.pinyin, strokes: d.strokes }] : [];
    });
  });

  protected readonly pages = computed(() => layoutSheet(this.sheetCharacters(), this.options()));

  /** Label buttons: the characters of your characters and words with that label. */
  protected readonly labelGroups = computed(() =>
    this.labels
      .names()
      .map((name) => ({
        name,
        color: this.labels.colorOf(name),
        text:
          this.characters
            .list()
            .filter((c) => c.label === name)
            .map((c) => c.character)
            .join('') +
          this.words
            .list()
            .filter((w) => w.label === name)
            .map((w) => w.word)
            .join(''),
      }))
      .filter((g) => g.text),
  );

  constructor() {
    effect(() => writeSetting(TEXT_KEY, this.text()));
    effect(() => writeSetting(OPTIONS_KEY, JSON.stringify(this.options())));
  }

  /** Your pinyin for the character, or CC-CEDICT's first common reading. */
  private pinyinOf(character: string): Promise<string | undefined> {
    const yours = this.characters.find(character)?.pinyin;
    if (yours) return Promise.resolve(toPinyin(yours));
    let promise = this.lookedUp.get(character);
    if (!promise) {
      promise = this.words.lookup(character).then(
        (r) => {
          // A common reading rather than a name's (高: gāo, not the surname Gāo).
          const entry = r.exact.find((e) => /^[a-z]/.test(e.pinyin)) ?? r.exact[0];
          return entry ? toPinyin(entry.pinyin.toLowerCase()) : undefined;
        },
        () => undefined,
      );
      this.lookedUp.set(character, promise);
    }
    return promise;
  }

  protected set<K extends keyof SheetOptions>(key: K, value: SheetOptions[K]): void {
    this.options.update((o) => ({ ...o, [key]: value }));
  }

  /** Shadow counts offered: up to the boxes after the model. */
  protected readonly shadowCounts = computed(() =>
    Array.from({ length: this.options().boxesPerRow - 1 }, (_, i) => i + 1),
  );
  /** The number of shadows to restore when they are turned back on. */
  private lastShadows = this.options().shadows || DEFAULT_SHEET_OPTIONS.shadows;

  protected setShadows(on: boolean): void {
    if (!on) this.lastShadows = this.options().shadows || this.lastShadows;
    this.set('shadows', on ? Math.min(this.lastShadows, this.options().boxesPerRow - 1) : 0);
  }

  protected setBoxes(boxes: number): void {
    this.options.update((o) => ({
      ...o,
      boxesPerRow: boxes,
      shadows: Math.min(o.shadows, boxes - 1),
    }));
  }

  /** Adds characters at the end of the text. */
  protected append(text: string): void {
    this.text.update((t) => t + text);
  }

  protected appendAllCharacters(): void {
    this.append(
      this.characters
        .list()
        .map((c) => c.character)
        .join(''),
    );
  }

  protected async download(): Promise<void> {
    const pages = this.pages();
    if (!pages.length) return;
    this.downloading.set(true);
    this.error.set('');
    try {
      const title = this.options().title.trim() || 'Practice sheet';
      const blob = await sheetPdf(pages, title);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${title.replace(/[\\/:*?"<>|]+/g, '-')}.pdf`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      this.error.set(`Could not make the PDF: ${errorMessage(err)}`);
    } finally {
      this.downloading.set(false);
    }
  }
}

/** The saved options, completed with the defaults (and kept within their limits). */
function readOptions(): SheetOptions {
  try {
    const saved = JSON.parse(readSetting(OPTIONS_KEY) ?? '{}') as Partial<SheetOptions>;
    return { ...DEFAULT_SHEET_OPTIONS, ...saved };
  } catch {
    return DEFAULT_SHEET_OPTIONS;
  }
}
