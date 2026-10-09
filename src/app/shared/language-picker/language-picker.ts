import { Component } from '@angular/core';
import { LANGUAGES, Lang, TranslatePipe, lang, setLang } from '../../core/i18n';

/** EN / FR / NL in the header: the language of the app (the page reloads in it). */
@Component({
  selector: 'app-language-picker',
  imports: [TranslatePipe],
  templateUrl: './language-picker.html',
})
export class LanguagePicker {
  protected readonly languages = LANGUAGES;
  protected readonly current = lang;

  protected choose(code: Lang): void {
    setLang(code);
  }
}
