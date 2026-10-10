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
import { Router } from '@angular/router';
import { CharacterEntry } from '../../../core/character.model';
import { CharactersService, errorMessage } from '../../../core/characters.service';
import { DEFAULT_TYPE, TYPES, typeOf } from '../../../core/config';
import { LabelsService } from '../../../core/labels.service';
import { comparePinyin, stripTones, toPinyin } from '../../../core/pinyin';
import { TranslatePipe, t } from '../../../core/i18n';
import { readSetting, writeSetting } from '../../../core/settings';
import { SlidingThumb } from '../../../shared/directives/sliding-thumb';
import { CharacterCard } from '../character-card/character-card';

const LAYOUT_KEY = 'hanzi-workshop-study-layout';

@Component({
  selector: 'app-study',
  imports: [CharacterCard, SlidingThumb, TranslatePipe],
  templateUrl: './study.html',
  host: { '(document:keydown)': 'onKey($event)' },
})
export class Study {
  /** Route parameter: /study/:character */
  readonly character = input<string>();

  private readonly router = inject(Router);
  protected readonly characters = inject(CharactersService);
  protected readonly labels = inject(LabelsService);

  protected readonly query = signal('');
  protected readonly typeFilter = signal('all');
  /** null: all characters, '': those without a label, otherwise that label. */
  protected readonly labelFilter = signal<string | null>(null);
  /** The character list as tiles or as rows; remembered in this browser. */
  protected readonly layout = signal<'grid' | 'list'>(
    readSetting(LAYOUT_KEY) === 'list' ? 'list' : 'grid',
  );
  protected readonly toPinyin = toPinyin;
  protected readonly typeOf = typeOf;

  /** Short message at the bottom of the page ("Added 姐 ✓", "Deleted 姐"). */
  protected readonly toast = signal<{ text: string; kind?: 'error' } | null>(null);
  private toastTimer?: ReturnType<typeof setTimeout>;

  /** Character just saved on the Add page (passed in the navigation state), highlighted in the list. */
  // Inside the tabbed page, this page is created after the navigation when you come from another
  // page (Add): the state is then on the navigation that just ended.
  private readonly savedMessage = (
    this.router.currentNavigation() ?? this.router.lastSuccessfulNavigation()
  )?.extras.state?.['saved'] as string | undefined;
  protected readonly justSaved = computed(() => (this.savedMessage ? this.character() : undefined));

  constructor() {
    if (this.savedMessage) this.showToast(this.savedMessage);
    // The selected character stays in view in the (scrolling) list, e.g. with ← →.
    const injector = inject(Injector);
    effect(() => {
      this.current();
      afterNextRender(
        () => document.querySelector('.tile.active')?.scrollIntoView({ block: 'nearest' }),
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

  protected readonly filters = computed(() => {
    const list = this.characters.list();
    return [
      { key: 'all', name: 'All', count: list.length },
      ...Object.entries(TYPES).map(([key, t]) => ({
        key,
        name: t.name,
        count: list.filter((c) => (c.type ?? DEFAULT_TYPE) === key).length,
      })),
    ];
  });

  /** The label dropdown: each label with its number of characters. */
  protected readonly labelFilters = computed(() => {
    const list = this.characters.list();
    const count = (label: string) => list.filter((c) => (c.label ?? '') === label).length;
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

  /** Your characters in the alphabetical order of their pinyin (then by character). */
  private readonly sorted = computed(() =>
    [...this.characters.list()].sort(
      (a, b) => comparePinyin(a.pinyin, b.pinyin) || a.character.localeCompare(b.character),
    ),
  );

  protected readonly visible = computed(() => {
    const q = stripTones(this.query().trim()).toLowerCase();
    const filter = this.typeFilter();
    const label = this.labelFilter();
    return this.sorted().filter((c) => {
      if (filter !== 'all' && (c.type ?? DEFAULT_TYPE) !== filter) return false;
      if (label !== null && (c.label ?? '') !== label) return false;
      if (!q) return true;
      const haystack = stripTones(
        [c.character, c.pinyin, toPinyin(c.pinyin), c.meaning, c.label].join(' '),
      ).toLowerCase();
      return haystack.includes(q);
    });
  });

  /** The character from the URL, or the first one. */
  protected readonly current = computed<CharacterEntry | undefined>(
    () => this.characters.find(this.character()) ?? this.sorted()[0],
  );

  protected select(c: CharacterEntry): void {
    this.router.navigate(['/study', c.character], { replaceUrl: true });
  }

  /** Deletes the selected character after confirmation, then selects its neighbour. */
  protected async deleteCurrent(): Promise<void> {
    const entry = this.current();
    if (!entry) return;
    const usedBy = this.characters
      .list()
      .filter(
        (c) =>
          c.character !== entry.character &&
          c.components?.some((p) => p.character === entry.character),
      )
      .map((c) => c.character);
    const note = usedBy.length
      ? '\n\n' +
        t('It is a component of {chars}: they will keep it listed as a component.', {
          chars: usedBy.join(' '),
        })
      : '';
    if (!confirm(t('Delete {char} from your list?', { char: entry.character }) + note)) return;

    const list = this.visible();
    const i = list.findIndex((c) => c.character === entry.character);
    const next = list[i + 1] ?? list[i - 1];
    try {
      await this.characters.remove(entry.character);
      this.showToast(t('Deleted {item}', { item: entry.character }));
      if (next) this.select(next);
      else this.router.navigate(['/study'], { replaceUrl: true });
    } catch (err) {
      this.showToast(t('Delete failed: {error}', { error: errorMessage(err) }), 'error');
    }
  }

  protected onKey(event: KeyboardEvent): void {
    if ((event.target as HTMLElement).matches('input, textarea, select')) return;
    const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    const list = this.visible();
    if (!delta || !list.length) return;
    const i = list.findIndex((c) => c.character === this.current()?.character);
    this.select(list[(i + delta + list.length) % list.length]);
  }
}
