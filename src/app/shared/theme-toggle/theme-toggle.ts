import { Component, computed, inject } from '@angular/core';
import { t } from '../../core/i18n';
import { ThemeService } from '../../core/theme.service';

/** Sun / moon button in the header: switches between light and dark. */
@Component({
  selector: 'app-theme-toggle',
  templateUrl: './theme-toggle.html',
})
export class ThemeToggle {
  protected readonly themes = inject(ThemeService);
  protected readonly dark = computed(() => this.themes.theme() === 'dark');
  protected readonly label = computed(() =>
    t(this.dark() ? 'Switch to light mode' : 'Switch to dark mode'),
  );
}
