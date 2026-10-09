import { Component, ElementRef, Injector, afterNextRender, inject, signal } from '@angular/core';
import { NavigationStart, Router, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { filter } from 'rxjs';

/**
 * Floating "+" (Study page): unfolds into a menu to add a character (/add) or a word (/add/word).
 * Closes on a choice, a click elsewhere, Escape or a navigation.
 */
@Component({
  selector: 'app-add-fab',
  imports: [RouterLink],
  host: {
    class: 'add-fab',
    '[class.open]': 'open()',
    '(document:click)': 'onDocumentClick($event)',
    '(document:keydown.escape)': 'close(true)',
  },
  template: `
    <div
      class="add-fab-menu"
      role="menu"
      id="add-fab-menu"
      aria-label="Add"
      [attr.inert]="open() ? null : ''"
    >
      <a class="add-fab-item" role="menuitem" routerLink="/add" (click)="close()">
        <span class="add-fab-icon" lang="zh" aria-hidden="true">字</span> Add a character
      </a>
      <a class="add-fab-item" role="menuitem" routerLink="/add/word" (click)="close()">
        <span class="add-fab-icon" lang="zh" aria-hidden="true">词</span> Add a word
      </a>
    </div>
    <button
      type="button"
      class="add-fab-button"
      aria-haspopup="menu"
      aria-controls="add-fab-menu"
      [attr.aria-expanded]="open()"
      [attr.aria-label]="open() ? 'Close' : 'Add a character or a word'"
      [title]="open() ? 'Close' : 'Add a character or a word'"
      (click)="toggleMenu()"
    >
      <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
        <path
          d="M12 5v14M5 12h14"
          stroke="currentColor"
          stroke-width="2.4"
          stroke-linecap="round"
        />
      </svg>
    </button>
  `,
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
