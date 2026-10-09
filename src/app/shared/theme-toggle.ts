import { Component, computed, inject } from '@angular/core';
import { t } from '../core/i18n';
import { ThemeService } from '../core/theme.service';

/** Sun / moon button in the header: switches between light and dark. */
@Component({
  selector: 'app-theme-toggle',
  template: `
    <button
      type="button"
      class="theme-toggle"
      [attr.aria-label]="label()"
      [title]="label()"
      [attr.aria-pressed]="dark()"
      (click)="themes.toggle()"
    >
      @if (dark()) {
        <!-- Moon: dark is on -->
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path
            fill="currentColor"
            d="M21 14.5A8.5 8.5 0 0 1 9.5 3a.6.6 0 0 0-.8-.7A10 10 0 1 0 21.7 15.3a.6.6 0 0 0-.7-.8Z"
          />
        </svg>
      } @else {
        <!-- Sun: light is on -->
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <circle cx="12" cy="12" r="4.5" fill="currentColor" />
          <g stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22" />
            <path d="M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8" />
          </g>
        </svg>
      }
    </button>
  `,
})
export class ThemeToggle {
  protected readonly themes = inject(ThemeService);
  protected readonly dark = computed(() => this.themes.theme() === 'dark');
  protected readonly label = computed(() =>
    t(this.dark() ? 'Switch to light mode' : 'Switch to dark mode'),
  );
}
