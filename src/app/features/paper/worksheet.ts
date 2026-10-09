/* Layout of the practice sheets (Train on paper): A4 pages, in millimetres, as a list of simple
 * drawing operations. The page shows them as SVG (preview) and pdf.ts turns them into a PDF. */
import { t } from '../../core/i18n';

/** Lines inside each box: 米 (cross and diagonals), 田 (cross) or none. */
export type GridStyle = 'mi' | 'tian' | 'none';

export interface SheetOptions {
  /** '' = the default title (DEFAULT_SHEET_TITLE, in the app's language). */
  title: string;
  /** Boxes in a row (their size follows). */
  boxesPerRow: number;
  /** Boxes after the model with the character in grey, to trace over (0 = none). */
  shadows: number;
  /** Rows per character: the first with the shadows, the others with the model only. */
  rowsPerCharacter: number;
  /** The character drawn stroke by stroke above its row. */
  strokeOrder: boolean;
  pinyin: boolean;
  grid: GridStyle;
}

/** Translated when shown (t()). */
export const DEFAULT_SHEET_TITLE = 'My Chinese character worksheet';

export const DEFAULT_SHEET_OPTIONS: SheetOptions = {
  title: '',
  boxesPerRow: 11,
  shadows: 4,
  rowsPerCharacter: 1,
  strokeOrder: true,
  pinyin: true,
  grid: 'mi',
};

/** A character to practise: its stroke paths (Hanzi Writer data) and pinyin (tone marks). */
export interface SheetCharacter {
  character: string;
  pinyin?: string;
  strokes: string[];
}

export type SheetOp =
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number; width: number; color: string }
  | {
      kind: 'glyph';
      character: string;
      strokes: string[];
      /** Colour of each stroke. */
      colors: string[];
      /** The square of the character's 1024 × 1024 design box (top left corner). */
      x: number;
      y: number;
      size: number;
    }
  | {
      kind: 'text';
      text: string;
      /** Baseline position. */
      x: number;
      y: number;
      /** Font size. */
      size: number;
      color: string;
      anchor: 'start' | 'middle' | 'end';
    };

export interface SheetPage {
  ops: SheetOp[];
}

/** A4 portrait. */
export const PAGE = { width: 210, height: 297 };
export const SHEET_FONT =
  '"Helvetica Neue", Helvetica, Arial, "PingFang SC", "Noto Sans SC", sans-serif';

const MARGIN = { x: 15, top: 12, bottom: 12 };
const INK = '#111111';
const SHADOW = '#bdbdbd';
const CURRENT_STROKE = '#d1495b';
const NEXT_STROKES = '#dcdcdc';
const BORDER = '#555555';
const GUIDE = '#cfcfcf';

/** The pages for these characters (in this order; repeats are kept). */
export function layoutSheet(characters: SheetCharacter[], options: SheetOptions): SheetPage[] {
  const width = PAGE.width - 2 * MARGIN.x;
  const box = width / options.boxesPerRow;
  const bottom = PAGE.height - MARGIN.bottom;
  const top = MARGIN.top + 13; // below the page header
  const pinyinSize = Math.min(5, Math.max(3.2, box * 0.24));
  const rowGap = 2.5;

  const pages: SheetOp[][] = [];
  let ops: SheetOp[] = [];
  let y = Infinity;
  const fit = (height: number) => {
    if (y + height <= bottom) return;
    ops = [];
    pages.push(ops);
    y = top;
  };

  for (const c of characters) {
    const steps = options.strokeOrder ? c.strokes.length : 0;
    const showPinyin = options.pinyin && !!c.pinyin;
    // Stroke order after the pinyin (above the second box), or from the left without pinyin.
    const orderX = MARGIN.x + (options.pinyin ? box : 0);
    const orderSize = steps ? Math.min(box * 0.45, (MARGIN.x + width - orderX) / steps) : 0;
    const head = steps || showPinyin ? Math.max(orderSize, pinyinSize * 1.25) + 1.5 : 0;

    for (let row = 0; row < options.rowsPerCharacter; row++) {
      const first = row === 0;
      fit((first ? head : 0) + box);
      if (first && head) {
        const base = y + head - 1;
        if (showPinyin) {
          ops.push({
            kind: 'text',
            text: c.pinyin!,
            x: MARGIN.x,
            y: base - 0.6,
            size: pinyinSize,
            color: INK,
            anchor: 'start',
          });
        }
        for (let k = 0; k < steps; k++) {
          ops.push({
            kind: 'glyph',
            character: c.character,
            strokes: c.strokes,
            colors: c.strokes.map((_, i) =>
              i < k ? INK : i === k ? CURRENT_STROKE : NEXT_STROKES,
            ),
            x: orderX + k * orderSize,
            y: base - orderSize,
            size: orderSize,
          });
        }
        y += head;
      }
      boxRow(ops, MARGIN.x, y, box, options);
      const pad = box * 0.08;
      const shadows = first ? Math.min(options.shadows, options.boxesPerRow - 1) : 0;
      for (let i = 0; i <= shadows; i++) {
        ops.push({
          kind: 'glyph',
          character: c.character,
          strokes: c.strokes,
          colors: c.strokes.map(() => (i === 0 ? INK : SHADOW)),
          x: MARGIN.x + i * box + pad,
          y: y + pad,
          size: box - 2 * pad,
        });
      }
      y += box + rowGap;
    }
  }

  const title = options.title.trim() || t(DEFAULT_SHEET_TITLE);
  return pages.map((ops, i) => ({ ops: [...header(title, i + 1, pages.length), ...ops] }));
}

/** "Name: ____", the title and the page number, over a line. */
function header(title: string, page: number, pages: number): SheetOp[] {
  const base = MARGIN.top + 6;
  const right = PAGE.width - MARGIN.x;
  const text = (text: string, x: number, anchor: 'start' | 'middle' | 'end', size = 4) =>
    ({ kind: 'text', text, x, y: base, size, color: INK, anchor }) as const;
  const line = (x1: number, y1: number, x2: number, width: number) =>
    ({ kind: 'line', x1, y1, x2, y2: y1, width, color: INK }) as const;
  return [
    text(t('Name:'), MARGIN.x, 'start', 3.6),
    line(MARGIN.x + 14, base + 0.8, MARGIN.x + 48, 0.2),
    text(title, PAGE.width / 2, 'middle', 4.6),
    text(pages > 1 ? t('Page {page} / {pages}', { page, pages }) : '', right, 'end', 3.6),
    line(MARGIN.x, base + 3, right, 0.35),
  ].filter((op) => op.kind !== 'text' || op.text);
}

/** One row of boxes with their guide lines. */
function boxRow(ops: SheetOp[], x: number, y: number, box: number, options: SheetOptions): void {
  const n = options.boxesPerRow;
  const line = (x1: number, y1: number, x2: number, y2: number, width: number, color: string) =>
    ops.push({ kind: 'line', x1, y1, x2, y2, width, color });
  if (options.grid !== 'none') {
    for (let i = 0; i < n; i++) {
      const left = x + i * box;
      line(left + box / 2, y, left + box / 2, y + box, 0.15, GUIDE);
      line(left, y + box / 2, left + box, y + box / 2, 0.15, GUIDE);
      if (options.grid === 'mi') {
        line(left, y, left + box, y + box, 0.15, GUIDE);
        line(left + box, y, left, y + box, 0.15, GUIDE);
      }
    }
  }
  line(x, y, x + n * box, y, 0.3, BORDER);
  line(x, y + box, x + n * box, y + box, 0.3, BORDER);
  for (let i = 0; i <= n; i++) line(x + i * box, y, x + i * box, y + box, 0.3, BORDER);
}

/** SVG transform drawing a character's strokes (1024 units, y up, from -124 to 900) in its square. */
export function glyphTransform(op: { x: number; y: number; size: number }): string {
  const s = op.size / 1024;
  return `translate(${op.x} ${op.y + 900 * s}) scale(${s} ${-s})`;
}
