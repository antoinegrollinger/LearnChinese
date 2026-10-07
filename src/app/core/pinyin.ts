/* Converts numbered pinyin (ma1, nü3, lv4) to tone-marked pinyin (mā, nǚ, lǜ). */

const TONE_MARKS: Record<string, string> = {
  a: 'āáǎà',
  e: 'ēéěè',
  i: 'īíǐì',
  o: 'ōóǒò',
  u: 'ūúǔù',
  ü: 'ǖǘǚǜ',
};

function accentSyllable(base: string, tone: number): string {
  base = base.replace(/u:|v/g, 'ü').replace(/U:|V/g, 'Ü');
  if (tone < 1 || tone > 4) return base;
  const b = base.toLowerCase();
  // Rule: a or e takes the mark; otherwise the o of "ou"; otherwise the last vowel.
  let i = b.search(/[ae]/);
  if (i < 0) i = b.indexOf('ou');
  if (i < 0) {
    for (let k = b.length - 1; k >= 0; k--) {
      if ('iouü'.includes(b[k])) {
        i = k;
        break;
      }
    }
  }
  if (i < 0) return base;
  let c = TONE_MARKS[b[i]][tone - 1];
  if (base[i] !== b[i]) c = c.toUpperCase();
  return base.slice(0, i) + c + base.slice(i + 1);
}

/** "Zhong1guo2ren2" → "Zhōngguórén", "ni3 hao3" → "nǐ hǎo". Tone-marked pinyin is left as is. */
export function toPinyin(text: string | undefined): string {
  return String(text ?? '').replace(/([a-zü:]+)([0-5])/gi, (_, base: string, tone: string) =>
    accentSyllable(base, Number(tone)),
  );
}

/** Tone (1 to 4, 5 = neutral) of a tone-marked syllable. */
export function toneOf(syllable: string): number {
  const s = syllable.toLowerCase();
  for (const marks of Object.values(TONE_MARKS)) {
    for (let t = 0; t < 4; t++) if (s.includes(marks[t])) return t + 1;
  }
  return 5;
}

/** Removes tone marks and numbers (for searching). */
export function stripTones(text: string | undefined): string {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[0-5]/g, '');
}

/** Splits pinyin into pieces, each with its tone (0 = separator), for colouring. */
export function pinyinSegments(text: string | undefined): { text: string; tone: number }[] {
  return toPinyin(text)
    .split(/(\s+|,|\/)/)
    .filter((piece) => piece !== '')
    .map((piece) => ({
      text: piece,
      tone: !piece.trim() || /^[,/]$/.test(piece) ? 0 : toneOf(piece),
    }));
}
