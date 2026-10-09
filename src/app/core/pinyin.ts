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

/**
 * One way of writing pinyin, for comparing answers: tone marks, lower case, no spaces.
 * "ma1ma5", "ma1 ma5", "māma", "Mā ma" → "māma"; "nv3", "nu:3", "nü3" → "nǚ"; "ma0" → "ma".
 * The tone stays on its syllable, so "ma1ma" and "mama1" differ.
 */
export function normalizePinyin(text: string): string {
  return toPinyin(text.trim().toLowerCase().replace(/u:/g, 'ü'))
    .normalize('NFC')
    .replace(/v/g, 'ü')
    .replace(/[^\p{L}]/gu, '');
}

/** The readings of a character's or word's pinyin ("hao3, hao4" or "hǎo / hào"), normalized. */
export function pinyinReadings(text: string | undefined): string[] {
  return String(text ?? '')
    .split(/[,/;]|\bor\b/)
    .map(normalizePinyin)
    .filter(Boolean);
}

/** right: one of the readings; tone: right syllable(s) with a wrong tone; wrong: anything else. */
export function checkPinyin(
  answer: string,
  expected: string | undefined,
): 'right' | 'tone' | 'wrong' {
  const given = normalizePinyin(answer);
  const readings = pinyinReadings(expected);
  if (!given) return 'wrong';
  if (readings.includes(given)) return 'right';
  // Without tone marks; ü kept apart from u ("nu" is not "nü" with another tone).
  const noTone = (s: string) =>
    s
      .replace(/[ǖǘǚǜü]/g, 'v')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  return readings.some((r) => noTone(r) === noTone(given)) ? 'tone' : 'wrong';
}

/** For sorting: the first reading without tones ("hǎo / hào" → "hao"), and the tones of its marks. */
function pinyinSortKey(text: string | undefined): { letters: string; tones: string } | null {
  const reading = toPinyin(String(text ?? '').split(/[,/;]/)[0])
    .trim()
    .toLowerCase();
  if (!reading) return null;
  // ü sorts right after u (lu, lü, luan), as in dictionaries: u + a character before "a".
  const letters = stripTones(reading.replace(/[ǖǘǚǜü]/g, 'u\u0001')).replace(/[^a-z\u0001]/g, '');
  let tones = '';
  for (const ch of reading) {
    const tone = toneOf(ch);
    if (tone < 5) tones += tone;
  }
  return { letters, tones };
}

/**
 * Alphabetical order of pinyin: the letters first (a → z, ü after u), then the tones (mā, má, mǎ,
 * mà, ma). Entries without pinyin go last. Use as a sort comparator on pinyin texts.
 */
export function comparePinyin(a: string | undefined, b: string | undefined): number {
  const ka = pinyinSortKey(a);
  const kb = pinyinSortKey(b);
  if (!ka || !kb) return ka ? -1 : kb ? 1 : 0;
  if (ka.letters !== kb.letters) return ka.letters < kb.letters ? -1 : 1;
  // Tone by tone; a syllable without a mark (neutral tone, 5) comes after the marked ones.
  for (let i = 0; i < Math.max(ka.tones.length, kb.tones.length); i++) {
    const ta = ka.tones[i] ?? '5';
    const tb = kb.tones[i] ?? '5';
    if (ta !== tb) return ta < tb ? -1 : 1;
  }
  return 0;
}
