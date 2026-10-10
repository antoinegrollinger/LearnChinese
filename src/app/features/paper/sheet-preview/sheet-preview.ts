import { Component, input } from '@angular/core';
import { TranslatePipe, t } from '../../../core/i18n';
import { PAGE, SHEET_FONT, SheetPage, glyphTransform } from '../worksheet';

/**
 * The pages of a PDF (practice sheets, learning material) drawn as SVG, from the same operations
 * as the PDF. With no page, shows its content (the empty-state message).
 */
@Component({
  selector: 'app-sheet-preview',
  imports: [TranslatePipe],
  templateUrl: './sheet-preview.html',
  host: { class: 'paper-preview', '[attr.aria-label]': 'label' },
})
export class SheetPreview {
  readonly pages = input.required<SheetPage[]>();

  protected readonly label = t('Preview');
  protected readonly page = PAGE;
  protected readonly font = SHEET_FONT;
  protected readonly glyphTransform = glyphTransform;
}
