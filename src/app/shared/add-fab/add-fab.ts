import { Component, ElementRef, Injector, afterNextRender, inject, signal } from '@angular/core';
import { NavigationStart, Router, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { filter } from 'rxjs';
import { TranslatePipe } from '../../core/i18n';

/**
 * Floating "+" (Study page): unfolds into a menu to add a character (/add) or a word (/add/word).
 * Closes on a choice, a click elsewhere, Escape or a navigation.
 */
@Component({
  selector: 'app-add-fab',
  imports: [RouterLink, TranslatePipe],
  host: {
    class: 'add-fab',
    '[class.open]': 'open()',
    '(document:click)': 'onDocumentClick($event)',
    '(document:keydown.escape)': 'close(true)',
  },
  templateUrl: './add-fab.html',
})
export class AddFab {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  protected readonly open = signal(false);

  constructor() {
    inject(Router)
      .events.pipe(
        filter((e) => e instanceof NavigationStart),
        takeUntilDestroyed(),
      )
      .subscribe(() => this.open.set(false));
  }

  protected toggleMenu(): void {
    if (this.open()) return this.close(true);
    this.open.set(true);
    // Keyboard: straight to the first choice.
    afterNextRender(
      () => this.host.nativeElement.querySelector<HTMLElement>('.add-fab-item')?.focus(),
      { injector: this.injector },
    );
  }

  /** Closes the menu; refocus: give the focus back to the "+" (Escape, or closing with it). */
  protected close(refocus = false): void {
    if (!this.open()) return;
    this.open.set(false);
    if (refocus) this.host.nativeElement.querySelector<HTMLElement>('.add-fab-button')?.focus();
  }

  protected onDocumentClick(event: MouseEvent): void {
    if (!this.host.nativeElement.contains(event.target as Node)) this.close();
  }
}
