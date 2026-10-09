import { DestroyRef, Directive, ElementRef, afterNextRender, inject } from '@angular/core';

/**
 * iOS-style segmented control: a glass "thumb" that slides to the item with the class "active"
 * (set by routerLinkActive or [class.active]). Put it on the container of the items:
 * <nav class="tabs" appSlidingThumb>. See .has-thumb and .thumb in styles.css.
 */
@Directive({
  selector: '[appSlidingThumb]',
  host: { class: 'has-thumb' },
})
export class SlidingThumb {
  private readonly host: HTMLElement = inject(ElementRef).nativeElement;
  private thumb?: HTMLElement;
  private placed = false;

  constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      this.thumb = document.createElement('span');
      this.thumb.className = 'thumb';
      this.thumb.setAttribute('aria-hidden', 'true');
      this.host.prepend(this.thumb);
      this.update();

      // A new active item (navigation), or items added or removed; not the thumb's own changes.
      const mutations = new MutationObserver((records) => {
        if (records.some((r) => r.target !== this.thumb)) this.update();
      });
      mutations.observe(this.host, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['class'],
      });
      // Sizes changed (window, fonts, counts in the tabs): follow without animating.
      const resizes = new ResizeObserver(() => this.update(false));
      resizes.observe(this.host);
      destroyRef.onDestroy(() => {
        mutations.disconnect();
        resizes.disconnect();
      });
    });
  }

  private update(animate = true): void {
    const thumb = this.thumb;
    if (!thumb) return;
    const active = this.host.querySelector<HTMLElement>(':scope > .active');
    if (!active) {
      thumb.style.opacity = '0';
      this.placed = false;
      return;
    }
    // The first time (or after none was active), appear in place instead of sliding in.
    const instant = !animate || !this.placed;
    thumb.classList.toggle('instant', instant);
    thumb.style.opacity = '1';
    thumb.style.width = `${active.offsetWidth}px`;
    thumb.style.height = `${active.offsetHeight}px`;
    thumb.style.transform = `translate(${active.offsetLeft}px, ${active.offsetTop}px)`;
    if (instant) {
      // Back to sliding once this position is drawn.
      requestAnimationFrame(() => requestAnimationFrame(() => thumb.classList.remove('instant')));
    }
    if (animate && this.placed) {
      // In a menu that scrolls sideways (phones): bring the new item into view.
      active.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    }
    this.placed = true;
  }
}
