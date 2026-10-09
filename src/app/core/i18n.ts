/* Translations of the app (English, French, Dutch), in the browser.
 *
 * The English text is the key: t('Save') gives "Enregistrer" in French, and any text without a
 * translation stays in English (so nothing is ever blank). The dictionaries are in i18n/fr.ts and
 * i18n/nl.ts; only the one of the chosen language is downloaded (main.ts loads it before the app
 * starts). Changing the language reloads the page.
 *
 *   t('Deleted {word}', { word })                          → "{word} supprimé"
 *   tn(count, '{n} character', '{n} characters')          → singular or plural, {n} = count
 *   In templates: {{ 'Save' | t }}, {{ count | tn: '{n} character' : '{n} characters' }}
 */
import { Pipe, PipeTransform } from '@angular/core';
import { readSetting, writeSetting } from './settings';

export type Lang = 'en' | 'fr' | 'nl';

export const LANGUAGES: { code: Lang; name: string; short: string }[] = [
  { code: 'en', name: 'English', short: 'EN' },
  { code: 'fr', name: 'Français', short: 'FR' },
  { code: 'nl', name: 'Nederlands', short: 'NL' },
];

const LANG_KEY = 'hanzi-workshop-lang';

/** The chosen language, or the browser's when it is one of ours (English otherwise). */
function detectLang(): Lang {
  const saved = readSetting(LANG_KEY);
  if (saved === 'en' || saved === 'fr' || saved === 'nl') return saved;
  const browser = typeof navigator === 'undefined' ? [] : (navigator.languages ?? []);
  for (const l of browser) {
    const code = l.slice(0, 2).toLowerCase();
    if (code === 'fr' || code === 'nl' || code === 'en') return code;
  }
  return 'en';
}

/** The language of the app (fixed until the page reloads). */
export const lang: Lang = detectLang();

/** For dates and numbers (Intl): Belgian French and Dutch, international English. */
export const locale = { en: 'en-GB', fr: 'fr-BE', nl: 'nl-BE' }[lang];

let dictionary: Record<string, string> = {};

/** Loads the dictionary of the language (before the app starts: see main.ts). */
export async function loadTranslations(): Promise<void> {
  if (typeof document !== 'undefined') document.documentElement.lang = lang;
  if (lang === 'fr') dictionary = (await import('./i18n/fr')).FR;
  else if (lang === 'nl') dictionary = (await import('./i18n/nl')).NL;
}

/** Saves the language and reloads the page in it. */
export function setLang(code: Lang): void {
  if (code === lang) return;
  writeSetting(LANG_KEY, code);
  location.reload();
}

/** The text in the app's language, with {name} placeholders filled from params. */
export function t(text: string, params?: Record<string, string | number>): string {
  const translated = dictionary[text] ?? text;
  if (!params) return translated;
  return translated.replace(/\{(\w+)\}/g, (all, key: string) =>
    key in params ? String(params[key]) : all,
  );
}

/** Patterns of the dictionary's texts with placeholders, to recognise filled-in messages. */
let patterns: { regex: RegExp; names: string[]; key: string }[] | null = null;

/**
 * A message that was written with the values already in (from the server: 'There is no user
 * "lea".'): translated by matching it against the dictionary's texts with placeholders.
 */
export function translateMessage(message: string): string {
  if (dictionary[message]) return dictionary[message];
  patterns ??= Object.keys(dictionary)
    .filter((key) => /\{\w+\}/.test(key))
    .map((key) => {
      const names: string[] = [];
      const source = key
        .split(/(\{\w+\})/)
        .map((part) => {
          const name = /^\{(\w+)\}$/.exec(part)?.[1];
          if (!name) return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          names.push(name);
          return '(.+?)';
        })
        .join('');
      return { regex: new RegExp(`^${source}$`), names, key };
    });
  for (const p of patterns) {
    const match = p.regex.exec(message);
    if (match) return t(p.key, Object.fromEntries(p.names.map((n, i) => [n, match[i + 1]])));
  }
  return message;
}

/** Singular or plural (French: 0 and 1 take the singular), with {n} = count. */
export function tn(
  count: number,
  one: string,
  other: string,
  params?: Record<string, string | number>,
): string {
  const singular = lang === 'fr' ? Math.abs(count) < 2 : count === 1;
  return t(singular ? one : other, { n: count, ...params });
}

/** {{ 'Save' | t }}, {{ 'Hello {name}' | t: { name } }} */
@Pipe({ name: 't' })
export class TranslatePipe implements PipeTransform {
  transform(text: string | null | undefined, params?: Record<string, string | number>): string {
    return text == null ? '' : t(text, params);
  }
}

/** {{ count | tn: '{n} character' : '{n} characters' }} */
@Pipe({ name: 'tn' })
export class PluralPipe implements PipeTransform {
  transform(
    count: number,
    one: string,
    other: string,
    params?: Record<string, string | number>,
  ): string {
    return tn(count, one, other, params);
  }
}

/** A message already filled in (validation, server): {{ error | tm }} */
@Pipe({ name: 'tm' })
export class MessagePipe implements PipeTransform {
  transform(message: string | null | undefined): string {
    return message == null ? '' : translateMessage(message);
  }
}
