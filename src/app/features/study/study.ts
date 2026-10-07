import { Component, afterNextRender, computed, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';
import { CharacterEntry } from '../../core/character.model';
import { CharactersService, errorMessage } from '../../core/characters.service';
import { DEFAULT_TYPE, TYPES, typeOf } from '../../core/config';
import { stripTones, toPinyin } from '../../core/pinyin';
import { CharacterCard } from './character-card';

@Component({
  selector: 'app-study',
  imports: [CharacterCard],
  templateUrl: './study.html',
  host: { '(document:keydown)': 'onKey($event)' },
})
export class Study {
  /** Route parameter: /study/:character */
  readonly character = input<string>();

  private readonly router = inject(Router);
  protected readonly characters = inject(CharactersService);

  protected readonly query = signal('');
  protected readonly typeFilter = signal('all');
  protected readonly toPinyin = toPinyin;
  protected readonly typeOf = typeOf;

  /** Short message at the bottom of the page ("Added 姐 ✓", "Deleted 姐"). */
  protected readonly toast = signal<{ text: string; kind?: 'error' } | null>(null);
  private toastTimer?: ReturnType<typeof setTimeout>;

  /** Character just saved on the Add page (passed in the navigation state), highlighted in the list. */
  private readonly savedMessage = this.router.currentNavigation()?.extras.state?.['saved'] as
    string | undefined;
  protected readonly justSaved = computed(() => (this.savedMessage ? this.character() : undefined));

  constructor() {
    if (this.savedMessage) this.showToast(this.savedMessage);
    // Bring the selected (e.g. newly added) character into view in the list.
    afterNextRender(() =>
      document.querySelector('.tile.active')?.scrollIntoView({ block: 'nearest' }),
    );
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

  protected readonly visible = computed(() => {
    const q = stripTones(this.query().trim()).toLowerCase();
    const filter = this.typeFilter();
    return this.characters.list().filter((c) => {
      if (filter !== 'all' && (c.type ?? DEFAULT_TYPE) !== filter) return false;
      if (!q) return true;
      const haystack = stripTones(
        [c.character, c.pinyin, toPinyin(c.pinyin), c.meaning].join(' '),
      ).toLowerCase();
      return haystack.includes(q);
    });
  });

  /** The character from the URL, or the first one. */
  protected readonly current = computed<CharacterEntry | undefined>(
    () => this.characters.find(this.character()) ?? this.characters.list()[0],
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
      ? `\n\nIt is a component of ${usedBy.join(' ')}: they will keep it listed as a component.`
      : '';
    if (!confirm(`Delete ${entry.character} from data/characters.json?${note}`)) return;

    const list = this.visible();
    const i = list.findIndex((c) => c.character === entry.character);
    const next = list[i + 1] ?? list[i - 1];
    try {
      await this.characters.remove(entry.character);
      this.showToast(`Deleted ${entry.character}`);
      if (next) this.select(next);
      else this.router.navigate(['/study'], { replaceUrl: true });
    } catch (err) {
      this.showToast(`Delete failed: ${errorMessage(err)}`, 'error');
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
