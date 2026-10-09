import { Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from './core/auth.service';
import { CharactersService } from './core/characters.service';
import { TranslatePipe } from './core/i18n';
import { LanguagePicker } from './shared/language-picker/language-picker';
import { NotificationBell } from './shared/notification-bell/notification-bell';
import { SlidingThumb } from './shared/directives/sliding-thumb';
import { ThemeToggle } from './shared/theme-toggle/theme-toggle';

@Component({
  selector: 'app-root',
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    NotificationBell,
    SlidingThumb,
    ThemeToggle,
    LanguagePicker,
    TranslatePipe,
  ],
  templateUrl: './app.html',
})
export class App {
  protected readonly auth = inject(AuthService);
  protected readonly characters = inject(CharactersService);
}
