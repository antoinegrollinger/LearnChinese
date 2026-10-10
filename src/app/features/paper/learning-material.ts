/* Layout of the learning material (Train on paper, Export tab): your characters and words with
 * their pinyin, meaning, components, words and notes, as A4 pages of drawing operations (shown
 * as SVG, turned into a PDF by pdf.ts). Without answers, the pinyin and meaning are blank lines
 * to fill in, and the notes are left out (they often give the answer away). */
import { CharacterEntry } from '../../core/character.model';
import { typeOf } from '../../core/config';
import { t, tn } from '../../core/i18n';
import { toPinyin } from '../../core/pinyin';
import { WordEntry } from '../../core/word.model';
import { PAGE, SHEET_FONT, SheetOp, SheetPage } from './worksheet';

export interface MaterialOptions {
  /** '' = the default title (DEFAULT_MATERIAL_TITLE, in the app's language). */
  title: string;
  /** With the answers (pinyin, meaning, components…), or blank lines to fill in. */
  answers: boolean;
  /** With the answers only: the notes often give the answer away. */
  notes: boolean;
  /**
   * detailed: each entry with its components, example words and notes; compact: a table of the
   * character or word, its pinyin and meaning (characters in two columns).
   */
  layout: 'detailed' | 'compact';
}

/** Translated when shown (t()). */
export const DEFAULT_MATERIAL_TITLE = 'My learning material';

export interface MaterialCharacter {
  entry: CharacterEntry;
  /** Stroke paths (Hanzi Writer), or undefined: the character is then written with a font. */
  strokes?: string[];
}

export interface MaterialWord {
  entry: WordEntry;
  /** Each character of the word, with your entry for it when you have one. */
  characters: { ch: string; known?: CharacterEntry }[];
}

const MARGIN = { x: 15, top: 12, bottom: 14 };
const WIDTH = PAGE.width - 2 * MARGIN.x;
const INK = '#111111';
const MUTED = '#666666';
const RULE = '#cfcfcf';
const ANSWER_LINE = '#9a9a9a';
const BOX = 24;
const WORD_COLUMN = 42;

// ---------- Measuring and wrapping text (same font as the PDF) ----------
let context: CanvasRenderingContext2D | null = null;

/** Width of the text in millimetres. */
function measure(text: string, size: number, bold = false): number {
  context ??= document.createElement('canvas').getContext('2d')!;
  context.font = `${bold ? 'bold ' : ''}${size * 10}px ${SHEET_FONT}`;
  return context.measureText(text).width / 10;
}

/** The text cut into lines no wider than width (words kept whole; Chinese can break anywhere). */
function wrap(text: string, size: number, width: number, bold = false): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split(/\n/)) {
    // Words with their following space, and each Chinese character on its own.
    const tokens = paragraph.match(
      /[\p{Script=Han}，。、；：！？]|[^\s\p{Script=Han}]+\s*|\s+/gu,
    ) ?? [''];
    let line = '';
    for (const token of tokens) {
      if (measure(line + token, size, bold) <= width || !line.trim()) {
        line += token;
        // A single token wider than the line: cut it.
        while (measure(line.trimEnd(), size, bold) > width && line.length > 1) {
          let cut = line.length - 1;
          while (cut > 1 && measure(line.slice(0, cut), size, bold) > width) cut--;
          lines.push(line.slice(0, cut));
          line = line.slice(cut);
        }
      } else {
        lines.push(line.trimEnd());
        line = token.trimStart();
      }
    }
    lines.push(line.trimEnd());
  }
  return lines;
}

/** Operations of one entry, laid out from y = 0, and its height. */
interface Block {
  ops: SheetOp[];
  height: number;
}

/** Text lines from (x, y): returns the operations and the y after them. */
function paragraph(
  text: string,
  x: number,
  y: number,
  width: number,
  options: { size?: number; bold?: boolean; color?: string; maxLines?: number } = {},
): { ops: SheetOp[]; y: number } {
  const size = options.size ?? 3.6;
  const lineHeight = size * 1.38;
  let lines = wrap(text, size, width, options.bold);
  if (options.maxLines && lines.length > options.maxLines) {
    lines = [...lines.slice(0, options.maxLines - 1), lines[options.maxLines - 1] + ' …'];
  }
  const ops: SheetOp[] = lines.map((line, i) => ({
    kind: 'text',
    text: line,
    x,
    y: y + size + i * lineHeight,
    size,
    color: options.color ?? INK,
    anchor: 'start',
    bold: options.bold,
  }));
  return { ops, y: y + size + (lines.length - 1) * lineHeight + size * 0.5 };
}

/** "Pinyin ________": a label and a line to write on. */
function answerLine(
  label: string,
  x: number,
  y: number,
  width: number,
): { ops: SheetOp[]; y: number } {
  const base = y + 6;
  const labelWidth = Math.max(18, measure(label, 3.3) + 3);
  return {
    ops: [
      { kind: 'text', text: label, x, y: base, size: 3.3, color: MUTED, anchor: 'start' },
      {
        kind: 'line',
        x1: x + labelWidth,
        y1: base + 0.6,
        x2: x + width,
        y2: base + 0.6,
        width: 0.2,
        color: ANSWER_LINE,
      },
    ],
    y: base + 2.5,
  };
}

/** A blank line under the previous one (longer answers). */
function extraLine(x: number, y: number, width: number): { ops: SheetOp[]; y: number } {
  const base = y + 6;
  return {
    ops: [
      {
        kind: 'line',
        x1: x,
        y1: base + 0.6,
        x2: x + width,
        y2: base + 0.6,
        width: 0.2,
        color: ANSWER_LINE,
      },
    ],
    y: base + 2.5,
  };
}

/** The character in its box: its strokes, or the font when there is no stroke data. */
function characterBox(c: MaterialCharacter, x: number, y: number): SheetOp[] {
  const ops: SheetOp[] = [];
  const line = (x1: number, y1: number, x2: number, y2: number, color: string, width: number) =>
    ops.push({ kind: 'line', x1, y1, x2, y2, width, color });
  // 米 guide lines, then the frame.
  line(x + BOX / 2, y, x + BOX / 2, y + BOX, RULE, 0.15);
  line(x, y + BOX / 2, x + BOX, y + BOX / 2, RULE, 0.15);
  line(x, y, x + BOX, y + BOX, RULE, 0.15);
  line(x + BOX, y, x, y + BOX, RULE, 0.15);
  for (const [x1, y1, x2, y2] of [
    [x, y, x + BOX, y],
    [x, y + BOX, x + BOX, y + BOX],
    [x, y, x, y + BOX],
    [x + BOX, y, x + BOX, y + BOX],
  ]) {
    line(x1, y1, x2, y2, '#555555', 0.3);
  }
  if (c.strokes) {
    const pad = 1.6;
    ops.push({
      kind: 'glyph',
      character: c.entry.character,
      strokes: c.strokes,
      colors: c.strokes.map(() => INK),
      x: x + pad,
      y: y + pad,
      size: BOX - 2 * pad,
    });
  } else {
    ops.push({
      kind: 'text',
      text: c.entry.character,
      x: x + BOX / 2,
      y: y + BOX * 0.78,
      size: BOX * 0.72,
      color: INK,
      anchor: 'middle',
    });
  }
  return ops;
}

function characterBlock(c: MaterialCharacter, options: MaterialOptions): Block {
  const e = c.entry;
  const x = MARGIN.x + BOX + 5;
  const width = WIDTH - BOX - 5;
  const ops: SheetOp[] = [...characterBox(c, MARGIN.x, 0)];
  let y = -1;
  const add = (part: { ops: SheetOp[]; y: number }) => {
    ops.push(...part.ops);
    y = part.y;
  };

  if (options.answers) {
    add(paragraph(toPinyin(e.pinyin) || '—', x, y, width, { size: 5, bold: true }));
    if (e.meaning) add(paragraph(e.meaning, x, y + 0.6, width, { size: 3.8 }));
    const type = typeOf(e.type);
    const strokes = c.strokes ? ' · ' + tn(c.strokes.length, '{n} stroke', '{n} strokes') : '';
    add(paragraph(t(type.name) + strokes, x, y + 0.6, width, { size: 3.2, color: MUTED }));
    if (e.components?.length) {
      const parts = e.components
        .map((p) =>
          [
            p.character,
            toPinyin(p.pinyin),
            p.meaning ? `“${p.meaning}”` : '',
            p.role === 'other' ? '' : `(${t(p.role === 'meaning' ? 'meaning' : 'sound')})`,
          ]
            .filter(Boolean)
            .join(' '),
        )
        .join(' + ');
      add(paragraph(`${t('Components:')} ${parts}`, x, y + 0.8, width, { size: 3.4 }));
    }
    if (e.words?.length) {
      const words = e.words
        .slice(0, 6)
        .map(([w, p, m]) => [w, toPinyin(p), m].filter(Boolean).join(' '))
        .join(' · ');
      add(paragraph(`${t('Words:')} ${words}`, x, y + 0.8, width, { size: 3.4 }));
    }
  } else {
    add(answerLine(t('Pinyin'), x, y, width));
    add(answerLine(t('Meaning'), x, y, width));
    add(extraLine(x, y, width));
  }
  if (options.answers && options.notes && e.notes) {
    add(
      paragraph(`${t('Notes:')} ${e.notes}`, x, y + 1, width, {
        size: 3.4,
        color: MUTED,
        maxLines: 12,
      }),
    );
  }
  return { ops, height: Math.max(BOX, y) };
}

function wordBlock(w: MaterialWord, options: MaterialOptions): Block {
  const e = w.entry;
  const x = MARGIN.x + WORD_COLUMN;
  const width = WIDTH - WORD_COLUMN;
  // The word as large as its column allows.
  const size = Math.min(10, (WORD_COLUMN - 4) / Math.max(1, measure(e.word, 1)));
  const ops: SheetOp[] = [
    { kind: 'text', text: e.word, x: MARGIN.x, y: size * 0.95, size, color: INK, anchor: 'start' },
  ];
  let y = -1;
  const add = (part: { ops: SheetOp[]; y: number }) => {
    ops.push(...part.ops);
    y = part.y;
  };

  if (options.answers) {
    add(paragraph(toPinyin(e.pinyin) || '—', x, y, width, { size: 5, bold: true }));
    if (e.meaning) add(paragraph(e.meaning, x, y + 0.6, width, { size: 3.8 }));
    const parts = w.characters
      .map(({ ch, known }) =>
        known
          ? [ch, toPinyin(known.pinyin), known.meaning ? `“${known.meaning}”` : '']
              .filter(Boolean)
              .join(' ')
          : ch,
      )
      .join(' + ');
    if (w.characters.length > 1) {
      add(paragraph(`${t('Characters:')} ${parts}`, x, y + 0.8, width, { size: 3.4 }));
    }
  } else {
    add(answerLine(t('Pinyin'), x, y, width));
    add(answerLine(t('Meaning'), x, y, width));
    add(extraLine(x, y, width));
  }
  if (options.answers && options.notes && e.notes) {
    add(
      paragraph(`${t('Notes:')} ${e.notes}`, x, y + 1, width, {
        size: 3.4,
        color: MUTED,
        maxLines: 12,
      }),
    );
  }
  return { ops, height: Math.max(size * 1.2, y) };
}

// ---------- Compact layout: a table of the entry, its pinyin and meaning ----------
const COMPACT_GLYPH = 10;
/** Characters: two columns of this width, with a gap between them. */
const COMPACT_GAP = 8;
const COMPACT_COLUMN = (WIDTH - COMPACT_GAP) / 2;
/** Where the pinyin and the meaning start, from the start of a character cell. */
const CELL = { pinyin: 13, meaning: 35 };
/** Words: where the pinyin and the meaning start, from the left margin. */
const WORD_ROW = { pinyin: 36, meaning: 78 };

/** A line to write on, from x1 to x2, under the first text line of a row. */
function writeLine(x1: number, x2: number, y = 7): SheetOp {
  return { kind: 'line', x1, y1: y, x2, y2: y, width: 0.2, color: ANSWER_LINE };
}

/** The pinyin and the meaning of a row (or lines to write them on), from y = 0. */
function compactAnswer(
  pinyin: string | undefined,
  meaning: string | undefined,
  at: { pinyin: number; meaning: number; end: number },
  answers: boolean,
): { ops: SheetOp[]; height: number } {
  if (!answers) {
    return {
      ops: [writeLine(at.pinyin, at.meaning - 4), writeLine(at.meaning, at.end)],
      height: 9,
    };
  }
  const ops: SheetOp[] = [];
  const py = paragraph(toPinyin(pinyin) || '—', at.pinyin, 0.6, at.meaning - at.pinyin - 3, {
    size: 3.7,
    bold: true,
    maxLines: 2,
  });
  const mean = paragraph(meaning || '', at.meaning, 0.8, at.end - at.meaning, {
    size: 3.3,
    maxLines: 3,
  });
  ops.push(...py.ops, ...mean.ops);
  return { ops, height: Math.max(py.y, mean.y) };
}

/** One character of the compact table, in the column starting at x. */
function compactCharacterCell(c: MaterialCharacter, x: number, options: MaterialOptions): Block {
  const ops: SheetOp[] = [];
  if (c.strokes) {
    ops.push({
      kind: 'glyph',
      character: c.entry.character,
      strokes: c.strokes,
      colors: c.strokes.map(() => INK),
      x,
      y: 0,
      size: COMPACT_GLYPH,
    });
  } else {
    ops.push({
      kind: 'text',
      text: c.entry.character,
      x: x + COMPACT_GLYPH / 2,
      y: COMPACT_GLYPH * 0.82,
      size: COMPACT_GLYPH * 0.8,
      color: INK,
      anchor: 'middle',
    });
  }
  const answer = compactAnswer(
    c.entry.pinyin,
    c.entry.meaning,
    { pinyin: x + CELL.pinyin, meaning: x + CELL.meaning, end: x + COMPACT_COLUMN },
    options.answers,
  );
  return { ops: [...ops, ...answer.ops], height: Math.max(COMPACT_GLYPH, answer.height) };
}

/** Two characters side by side: one row of the table. */
function compactCharacterRow(cells: MaterialCharacter[], options: MaterialOptions): Block {
  const blocks = cells.map((c, i) =>
    compactCharacterCell(c, MARGIN.x + i * (COMPACT_COLUMN + COMPACT_GAP), options),
  );
  return {
    ops: blocks.flatMap((b) => b.ops),
    height: Math.max(...blocks.map((b) => b.height)),
  };
}

function compactWordRow(w: MaterialWord, options: MaterialOptions): Block {
  const size = Math.min(6, (WORD_ROW.pinyin - 4) / Math.max(1, measure(w.entry.word, 1)));
  const answer = compactAnswer(
    w.entry.pinyin,
    w.entry.meaning,
    {
      pinyin: MARGIN.x + WORD_ROW.pinyin,
      meaning: MARGIN.x + WORD_ROW.meaning,
      end: MARGIN.x + WIDTH,
    },
    options.answers,
  );
  return {
    ops: [
      {
        kind: 'text',
        text: w.entry.word,
        x: MARGIN.x,
        y: size * 0.95 + 0.6,
        size,
        color: INK,
        anchor: 'start',
      },
      ...answer.ops,
    ],
    height: Math.max(size * 1.25, answer.height),
  };
}

/** Small grey column titles under a section heading (Pinyin, Meaning). */
function columnTitles(columns: { pinyin: number; meaning: number }[]): Block {
  const title = (text: string, x: number): SheetOp => ({
    kind: 'text',
    text,
    x,
    y: 3,
    size: 2.8,
    color: MUTED,
    anchor: 'start',
  });
  return {
    ops: columns.flatMap((c) => [title(t('Pinyin'), c.pinyin), title(t('Meaning'), c.meaning)]),
    height: 3,
  };
}

/** The pages: a section for the characters, then one for the words (each only when chosen). */
export function layoutMaterial(
  characters: MaterialCharacter[],
  words: MaterialWord[],
  options: MaterialOptions,
): SheetPage[] {
  const top = MARGIN.top + 15;
  const bottom = PAGE.height - MARGIN.bottom;
  const pages: SheetOp[][] = [];
  let ops: SheetOp[] = [];
  let y = Infinity;
  const newPage = () => {
    ops = [];
    pages.push(ops);
    y = top;
  };
  /** Places the operations of a block at the current y (on a new page if it doesn't fit). */
  const place = (block: Block, gap: number) => {
    if (y + block.height > bottom && y > top) newPage();
    const dy = y;
    for (const op of block.ops) {
      if (op.kind === 'line') ops.push({ ...op, y1: op.y1 + dy, y2: op.y2 + dy });
      else ops.push({ ...op, y: op.y + dy });
    }
    y += block.height + gap;
  };
  const separator = (): Block => ({
    ops: [
      { kind: 'line', x1: MARGIN.x, y1: 0, x2: MARGIN.x + WIDTH, y2: 0, width: 0.2, color: RULE },
    ],
    height: 0,
  });
  const compact = options.layout === 'compact';
  /** Space around the line between two entries. */
  const gap = compact ? 2.2 : 4;
  const section = (title: string, blocks: Block[], columns?: Block) => {
    if (!blocks.length) return;
    if (y === Infinity || y > bottom - 40) newPage();
    else y += 4;
    const heading: Block = {
      ops: [
        {
          kind: 'text',
          text: title,
          x: MARGIN.x,
          y: 6,
          size: 6,
          color: INK,
          anchor: 'start',
          bold: true,
        },
        {
          kind: 'line',
          x1: MARGIN.x,
          y1: 8.5,
          x2: MARGIN.x + WIDTH,
          y2: 8.5,
          width: 0.4,
          color: INK,
        },
      ],
      height: 8.5,
    };
    // The heading stays with the first entry.
    if (y + heading.height + 5 + blocks[0].height > bottom && y > top) newPage();
    place(heading, columns ? 3 : 5);
    if (columns) place(columns, 2);
    blocks.forEach((block, i) => {
      if (i) place(separator(), gap);
      place(block, gap);
    });
  };

  if (compact) {
    const rows: MaterialCharacter[][] = [];
    for (let i = 0; i < characters.length; i += 2) rows.push(characters.slice(i, i + 2));
    const cellColumns = [0, 1].map((i) => {
      const x = MARGIN.x + i * (COMPACT_COLUMN + COMPACT_GAP);
      return { pinyin: x + CELL.pinyin, meaning: x + CELL.meaning };
    });
    section(
      `${t('Characters')} (${characters.length})`,
      rows.map((row) => compactCharacterRow(row, options)),
      columnTitles(characters.length > 1 ? cellColumns : cellColumns.slice(0, 1)),
    );
    section(
      `${t('Words')} (${words.length})`,
      words.map((w) => compactWordRow(w, options)),
      columnTitles([{ pinyin: MARGIN.x + WORD_ROW.pinyin, meaning: MARGIN.x + WORD_ROW.meaning }]),
    );
  } else {
    section(
      `${t('Characters')} (${characters.length})`,
      characters.map((c) => characterBlock(c, options)),
    );
    section(
      `${t('Words')} (${words.length})`,
      words.map((w) => wordBlock(w, options)),
    );
  }

  const title = options.title.trim() || t(DEFAULT_MATERIAL_TITLE);
  const subtitle = t(options.answers ? 'With answers' : 'Without answers (exercise)');
  return pages.map((pageOps, i) => ({
    ops: [...header(title, subtitle, i + 1, pages.length), ...pageOps],
  }));
}

/** Title, version (with or without answers) and page number, over a line. */
function header(title: string, subtitle: string, page: number, pages: number): SheetOp[] {
  const base = MARGIN.top + 6;
  const right = PAGE.width - MARGIN.x;
  const ops: SheetOp[] = [
    {
      kind: 'text',
      text: title,
      x: MARGIN.x,
      y: base,
      size: 5,
      color: INK,
      anchor: 'start',
      bold: true,
    },
    { kind: 'text', text: subtitle, x: right, y: base, size: 3.4, color: MUTED, anchor: 'end' },
    { kind: 'line', x1: MARGIN.x, y1: base + 3, x2: right, y2: base + 3, width: 0.35, color: INK },
  ];
  if (pages > 1) {
    ops.push({
      kind: 'text',
      text: t('Page {page} / {pages}', { page, pages }),
      x: right,
      y: PAGE.height - MARGIN.bottom + 8,
      size: 3,
      color: MUTED,
      anchor: 'end',
    });
  }
  return ops;
}
