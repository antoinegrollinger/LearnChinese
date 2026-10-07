import { Component, computed, input } from '@angular/core';
import HanziWriter from 'hanzi-writer';

/** Static drawing of a character with one colour per stroke. */
@Component({
  selector: 'app-stroke-svg',
  template: `
    <svg [attr.width]="size()" [attr.height]="size()">
      <g [attr.transform]="transform()">
        @for (d of strokes(); track $index) {
          <path [attr.d]="d" [style.fill]="colors()[$index] || 'var(--ink)'" />
        }
      </g>
    </svg>
  `,
  host: { '[style.width.px]': 'size()', '[style.height.px]': 'size()', class: 'mi-cell' },
})
export class StrokeSvg {
  readonly strokes = input.required<string[]>();
  /** Colour of each stroke (CSS colour); missing entries use the ink colour. */
  readonly colors = input<(string | null)[]>([]);
  readonly size = input(64);

  protected readonly transform = computed(
    () => HanziWriter.getScalingTransform(this.size(), this.size(), this.size() * 0.07).transform,
  );
}
