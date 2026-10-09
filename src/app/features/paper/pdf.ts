/* Turns the sheet pages (worksheet.ts) into a PDF, in the browser and without a library:
 * - each stroke of a character is a vector form (drawn many times, stored once), in the colour set
 *   before drawing it;
 * - text (pinyin with tone marks, the title in any language) is drawn on a canvas at print
 *   resolution and embedded as an image with a soft mask, so no font has to be embedded.
 * Streams are compressed with the browser's CompressionStream ("deflate" = zlib = FlateDecode). */
import { PAGE, SHEET_FONT, SheetOp, SheetPage } from './worksheet';

/** Points per millimetre. */
const K = 72 / 25.4;
/** Text resolution: pixels per millimetre (≈ 500 dpi). */
const TEXT_PX_PER_MM = 20;

const encoder = new TextEncoder();

async function deflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart])
    .stream()
    .pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const num = (n: number): string => {
  const s = n.toFixed(3).replace(/\.?0+$/, '');
  return s === '-0' ? '0' : s;
};

function rgb(hex: string): string {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255].map((c) => num(c / 255)).join(' ');
}

/** SVG path data (absolute M, L, Q, C, Z, as in Hanzi Writer's data) as PDF path operators. */
export function pdfPath(d: string): string {
  const tokens = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) ?? [];
  const out: string[] = [];
  let i = 0;
  let command = '';
  let x = 0;
  let y = 0;
  const next = () => parseFloat(tokens[i++]);
  while (i < tokens.length) {
    if (/[a-zA-Z]/.test(tokens[i])) command = tokens[i++].toUpperCase();
    switch (command) {
      case 'M':
      case 'L': {
        x = next();
        y = next();
        out.push(`${num(x)} ${num(y)} ${command === 'M' ? 'm' : 'l'}`);
        if (command === 'M') command = 'L'; // more pairs after M are lines
        break;
      }
      case 'Q': {
        // A quadratic curve as a cubic one.
        const qx = next();
        const qy = next();
        const ex = next();
        const ey = next();
        const c1 = [x + (2 / 3) * (qx - x), y + (2 / 3) * (qy - y)];
        const c2 = [ex + (2 / 3) * (qx - ex), ey + (2 / 3) * (qy - ey)];
        out.push(`${[...c1, ...c2, ex, ey].map(num).join(' ')} c`);
        x = ex;
        y = ey;
        break;
      }
      case 'C': {
        const p = [next(), next(), next(), next(), next(), next()];
        out.push(`${p.map(num).join(' ')} c`);
        x = p[4];
        y = p[5];
        break;
      }
      case 'Z':
        out.push('h');
        break;
      default:
        i++; // unknown command: skip its number
    }
  }
  return out.join('\n');
}

interface TextImage {
  name: string;
  /** Size and position of the image, in millimetres (top left). */
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Draws the text on a canvas: the image's alpha channel (the colour is set by the caller). */
function renderText(op: Extract<SheetOp, { kind: 'text' }>) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  const font = `${op.size * TEXT_PX_PER_MM}px ${SHEET_FONT}`;
  ctx.font = font;
  const m = ctx.measureText(op.text);
  const pad = 4;
  const left = Math.ceil(m.actualBoundingBoxLeft) + pad;
  const ascent = Math.ceil(m.actualBoundingBoxAscent) + pad;
  canvas.width = Math.max(1, left + Math.ceil(m.actualBoundingBoxRight) + pad);
  canvas.height = Math.max(1, ascent + Math.ceil(m.actualBoundingBoxDescent) + pad);
  ctx.font = font; // resizing the canvas resets it
  ctx.fillStyle = '#000';
  ctx.fillText(op.text, left, ascent);
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const alpha = new Uint8Array(canvas.width * canvas.height);
  for (let p = 0; p < alpha.length; p++) alpha[p] = pixels[p * 4 + 3];

  const advance = m.width / TEXT_PX_PER_MM;
  const start =
    op.anchor === 'middle' ? op.x - advance / 2 : op.anchor === 'end' ? op.x - advance : op.x;
  return {
    alpha,
    pixelWidth: canvas.width,
    pixelHeight: canvas.height,
    x: start - left / TEXT_PX_PER_MM,
    y: op.y - ascent / TEXT_PX_PER_MM,
    width: canvas.width / TEXT_PX_PER_MM,
    height: canvas.height / TEXT_PX_PER_MM,
  };
}

/** Builds the PDF file. */
export async function sheetPdf(pages: SheetPage[], title: string): Promise<Blob> {
  const objects: (Uint8Array | null)[] = [];
  const reserve = () => objects.push(null);
  const set = async (id: number, dict: string, stream?: Uint8Array) => {
    if (!stream) {
      objects[id - 1] = encoder.encode(`${id} 0 obj\n${dict}\nendobj\n`);
      return;
    }
    const packed = await deflate(stream);
    const head = encoder.encode(
      `${id} 0 obj\n<< ${dict} /Filter /FlateDecode /Length ${packed.length} >>\nstream\n`,
    );
    objects[id - 1] = concat([head, packed, encoder.encode('\nendstream\nendobj\n')]);
  };
  const add = async (dict: string, stream?: Uint8Array) => {
    const id = reserve();
    await set(id, dict, stream);
    return id;
  };

  const catalog = reserve();
  const pagesId = reserve();
  const info = await add(`<< /Title ${pdfString(title)} /Producer (Hanzi Workshop) >>`);

  /** Form XObject of each stroke: "<character>|<index>" → name. */
  const strokeForms = new Map<string, string>();
  const xobjects: string[] = [];
  const strokeForm = async (character: string, index: number, d: string) => {
    const key = `${character}|${index}`;
    let name = strokeForms.get(key);
    if (!name) {
      name = `S${strokeForms.size + 1}`;
      strokeForms.set(key, name);
      const id = await add(
        `/Type /XObject /Subtype /Form /BBox [-200 -300 1224 1100]`,
        encoder.encode(`${pdfPath(d)}\nf`),
      );
      xobjects.push(`/${name} ${id} 0 R`);
    }
    return name;
  };
  let images = 0;
  const textImage = async (op: Extract<SheetOp, { kind: 'text' }>): Promise<TextImage> => {
    const t = renderText(op);
    const size = `/Width ${t.pixelWidth} /Height ${t.pixelHeight} /BitsPerComponent 8`;
    const mask = await add(
      `/Type /XObject /Subtype /Image ${size} /ColorSpace /DeviceGray`,
      t.alpha,
    );
    // The colour: a plain image of the text colour, shown through the mask.
    const [r, g, b] = rgb(op.color)
      .split(' ')
      .map((c) => Math.round(Number(c) * 255));
    const color = new Uint8Array(t.pixelWidth * t.pixelHeight * 3);
    for (let p = 0; p < color.length; p += 3) color.set([r, g, b], p);
    const id = await add(
      `/Type /XObject /Subtype /Image ${size} /ColorSpace /DeviceRGB /SMask ${mask} 0 R`,
      color,
    );
    const name = `T${++images}`;
    xobjects.push(`/${name} ${id} 0 R`);
    return { name, x: t.x, y: t.y, width: t.width, height: t.height };
  };

  const resources = reserve();
  const pageIds: number[] = [];
  for (const page of pages) {
    const content: string[] = [];
    for (const op of page.ops) {
      if (op.kind === 'line') {
        content.push(
          `${num(op.width * K)} w ${rgb(op.color)} RG ` +
            `${num(op.x1 * K)} ${num((PAGE.height - op.y1) * K)} m ` +
            `${num(op.x2 * K)} ${num((PAGE.height - op.y2) * K)} l S`,
        );
      } else if (op.kind === 'glyph') {
        // 1024 units → the square; the strokes go from y = -124 (bottom) to 900 (top).
        const s = (op.size / 1024) * K;
        const bottom = (PAGE.height - op.y - op.size) * K + 124 * s;
        content.push(`q ${num(s)} 0 0 ${num(s)} ${num(op.x * K)} ${num(bottom)} cm`);
        for (const [i, d] of op.strokes.entries()) {
          content.push(`${rgb(op.colors[i])} rg /${await strokeForm(op.character, i, d)} Do`);
        }
        content.push('Q');
      } else {
        const t = await textImage(op);
        content.push(
          `q ${num(t.width * K)} 0 0 ${num(t.height * K)} ` +
            `${num(t.x * K)} ${num((PAGE.height - t.y - t.height) * K)} cm /${t.name} Do Q`,
        );
      }
    }
    const contentId = await add('', encoder.encode(content.join('\n')));
    pageIds.push(
      await add(
        `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${num(PAGE.width * K)} ${num(PAGE.height * K)}] ` +
          `/Resources ${resources} 0 R /Contents ${contentId} 0 R >>`,
      ),
    );
  }
  await set(resources, `<< /XObject << ${xobjects.join(' ')} >> >>`);
  await set(
    pagesId,
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`,
  );
  await set(catalog, `<< /Type /Catalog /Pages ${pagesId} 0 R >>`);

  // Header, objects, then the cross-reference table with each object's byte offset.
  const parts: Uint8Array[] = [encoder.encode('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n')];
  let offset = parts[0].length;
  const offsets: number[] = [];
  for (const obj of objects) {
    offsets.push(offset);
    parts.push(obj!);
    offset += obj!.length;
  }
  parts.push(
    encoder.encode(
      `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
        offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('') +
        `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\n` +
        `startxref\n${offset}\n%%EOF\n`,
    ),
  );
  return new Blob(parts as BlobPart[], { type: 'application/pdf' });
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** A PDF text string: UTF-16 (big endian, with its byte order mark) in hexadecimal. */
function pdfString(text: string): string {
  let hex = 'FEFF';
  for (let i = 0; i < text.length; i++) hex += text.charCodeAt(i).toString(16).padStart(4, '0');
  return `<${hex}>`;
}
