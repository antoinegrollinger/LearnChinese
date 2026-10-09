import { Component } from '@angular/core';
import { LANGUAGES, Lang, TranslatePipe, lang, setLang } from '../core/i18n';

/** EN / FR / NL in the header: the language of the app (the page reloads in it). */
@Component({
  selector: 'app-language-picker',
  imports: [TranslatePipe],
  template: `
    <select
      class="language-picker"
      [attr.aria-label]="'Language' | t"
      [title]="'Language' | t"
      (change)="choose($any($event.target).value)"
    >
      @for (l of languages; track l.code) {
        <option [value]="l.code" [selected]="l.code === current" [title]="l.name">
          {{ l.short }}
        </option>
      }
    </select>
  `,
})
export class LanguagePicker {
  protected readonly languages = LANGUAGES;
  protected readonly current = lang;

  protected choose(code: Lang): void {
    setLang(code);
  }
}
