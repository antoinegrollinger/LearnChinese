import { DestroyRef, Directive, ElementRef, inject, output } from '@angular/core';

/** The row whose action is shown (one at a time, as on iOS). */
let openRow: SwipeActions | null = null;

/**
 * iOS-style swipe to reveal an action (touch screens): swipe the row to the left to show the
 * button behind it, tap it, or swipe all the way to run it at once. A tap elsewhere closes it.
 *
 * <li appSwipeActions (fullSwipe)="…">
 *   <div class="swipe-content">…the row…</div>
 *   <button class="swipe-action" (click)="…">Delete</button>
 * </li>
 *
 * The content follows the finger (--swipe-offset); the action fills the space it leaves. See
 * .swipe-row in styles.css.
 */
@Directive({
  selector: '[appSwipeActions]',
  exportAs: 'appSwipeActions',
  host: {
    class: 'swipe-row',
    '(touchstart)': 'start($event)',
    '(touchmove)': 'move($event)',
    '(touchend)': 'end()',
    '(touchcancel)': 'end()',
    '(document:touchstart)': 'onDocumentTouch($event)',
  },
})
export class SwipeActions {
  /** Swiped all the way: run the action straight away. */
  readonly fullSwipe = output<void>();

  private readonly host: HTMLElement = inject(ElementRef).nativeElement;
  /** Width of the revealed action when the row stays open. */
  private readonly openWidth = 92;
  private x0 = 0;
  private y0 = 0;
  /** Offset when the touch started (0, or -openWidth when open). */
  private base = 0;
  private offset = 0;
  /** null until the finger has moved enough to tell a swipe from a scroll. */
  private horizontal: boolean | null = null;
  private tracking = false;

  constructor() {
    // A tap on an open row closes it instead of clicking what's under the finger.
    const onClick = (event: MouseEvent) => {
      if (this.offset === 0 || (event.target as Element).closest('.swipe-action')) return;
      event.stopPropagation();
      event.preventDefault();
      this.close();
    };
    this.host.addEventListener('click', onClick, true);
    inject(DestroyRef).onDestroy(() => {
      this.host.removeEventListener('click', onClick, true);
      if (openRow === this) openRow = null;
    });
  }

  protected start(event: TouchEvent): void {
    if (event.touches.length !== 1) return;
    if (openRow && openRow !== this) openRow.close();
    this.x0 = event.touches[0].clientX;
    this.y0 = event.touches[0].clientY;
    this.base = this.offset;
    this.horizontal = null;
    this.tracking = true;
  }

  protected move(event: TouchEvent): void {
    if (!this.tracking) return;
    const dx = event.touches[0].clientX - this.x0;
    const dy = event.touches[0].clientY - this.y0;
    if (this.horizontal === null) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      this.horizontal = Math.abs(dx) > Math.abs(dy);
      if (!this.horizontal) return; // a scroll: leave it to the page
      this.host.classList.add('swipe-active', 'swiping');
    }
    if (!this.horizontal) return;
    // No further right than closed; to the left, up to the whole width.
    this.set(Math.min(0, Math.max(-this.host.offsetWidth, this.base + dx)));
  }

  protected end(): void {
    if (!this.tracking) return;
    this.tracking = false;
    this.host.classList.remove('swiping');
    if (!this.horizontal) return;
    const width = this.host.offsetWidth;
    if (this.offset < -width * 0.6) {
      // All the way: the content leaves, then the action runs.
      this.set(-width);
      this.fullSwipe.emit();
    } else if (this.offset < -this.openWidth / 2) {
      this.set(-this.openWidth);
      openRow = this;
    } else {
      this.close();
    }
  }

  protected onDocumentTouch(event: TouchEvent): void {
    if (this.offset !== 0 && !this.host.contains(event.target as Node)) this.close();
  }

  /** Slides the row back (also after the action, if the row is still there). */
  close(): void {
    this.set(0);
    if (openRow === this) openRow = null;
    // Clip the content only while it is moved (the row's shadow shows otherwise).
    setTimeout(() => this.offset === 0 && this.host.classList.remove('swipe-active'), 300);
  }

  private set(offset: number): void {
    this.offset = offset;
    this.host.style.setProperty('--swipe-offset', `${offset}px`);
  }
}
