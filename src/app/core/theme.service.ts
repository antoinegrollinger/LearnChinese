import { DestroyRef, Injectable, computed, effect, inject, signal } from '@angular/core';
import { readSetting, writeSetting } from './settings';

export type Theme = 'light' | 'dark';

/** Your choice, in this browser (also read by index.html before the app starts: no flash). */
export const THEME_KEY = 'hanzi-workshop-theme';

const readTheme = (value: string | null): Theme | null =>
  value === 'light' || value === 'dark' ? value : null;

/**
 * Light or dark: the system's, unless you chose the other one with the toggle. Sets
 * data-theme="light" / "dark" on <html> (see the theme in styles.css).
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly media = matchMedia('(prefers-color-scheme: dark)');
  private readonly system = signal<Theme>(this.media.matches ? 'dark' : 'light');
  /** Your choice, or null to follow the system. */
  private readonly choice = signal<Theme | null>(readTheme(readSetting(THEME_KEY)));

  /** The theme shown. */
  readonly theme = computed<Theme>(() => this.choice() ?? this.system());

  constructor() {
    const onChange = (e: MediaQueryListEvent) => this.system.set(e.matches ? 'dark' : 'light');
    this.media.addEventListener('change', onChange);
    inject(DestroyRef).onDestroy(() => this.media.removeEventListener('change', onChange));

    effect(() => {
      const choice = this.choice();
      if (choice) document.documentElement.dataset['theme'] = choice;
      else delete document.documentElement.dataset['theme'];
    });
  }

  /** Switches to the other theme. Back to the system's one: follows the system again. */
  toggle(): void {
    const next: Theme = this.theme() === 'dark' ? 'light' : 'dark';
    const choice = next === this.system() ? null : next;
    this.choice.set(choice);
    writeSetting(THEME_KEY, choice ?? '');
  }
}
