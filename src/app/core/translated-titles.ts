import { Injectable, inject } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { RouterStateSnapshot, TitleStrategy } from '@angular/router';
import { t } from './i18n';

/** Page titles in the app's language: each part of "Words · My 汉字 and words · Hanzi Workshop". */
@Injectable({ providedIn: 'root' })
export class TranslatedTitles extends TitleStrategy {
  private readonly title = inject(Title);

  override updateTitle(snapshot: RouterStateSnapshot): void {
    const title = this.buildTitle(snapshot);
    if (title) {
      this.title.setTitle(
        title
          .split(' · ')
          .map((part) => t(part))
          .join(' · '),
      );
    }
  }
}
