import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { CharactersService, errorMessage } from '../../../core/characters.service';
import { DictionaryService } from '../../../core/dictionary.service';
import { stripTones, toPinyin } from '../../../core/pinyin';
import { speak } from '../../../core/speech';
import { WordEntry, cleanWord } from '../../../core/word.model';
import {
  CedictEntry,
  LookupResult,
  WordsService,
  joinPinyin,
  meaningOf,
} from '../../../core/words.service';
import { MessagePipe, PluralPipe, TranslatePipe, t, tn } from '../../../core/i18n';
import { LabelPicker } from '../../../shared/label-picker/label-picker';
import { SpeakerIcon } from '../../../shared/speaker-icon/speaker-icon';
import { Pinyin } from '../../../shared/pinyin/pinyin';

/** Chinese characters only. */
const isHan = (ch: string) => /\p{Script=Han}/u.test(ch);

/**
 * Add a word, or edit one of yours (route /add/word/:word): find it by pinyin or compose it from
 * your characters, look it up in CC-CEDICT, save it (and, if you like, its characters that are
 * not in your list yet, with the dictionary's data).
 */
@Component({
  selector: 'app-add-word',
  imports: [
    ReactiveFormsModule,
    Pinyin,
    RouterLink,
    LabelPicker,
    SpeakerIcon,
    TranslatePipe,
    PluralPipe,
    MessagePipe,
  ],
  templateUrl: './add-word.html',
})
export class AddWord {
  /** Route parameter: /add/word/:word */
  readonly word = input<string>();

  private readonly fb = inject(NonNullableFormBuilder);
  private readonly router = inject(Router);
  protected readonly words = inject(WordsService);
  protected readonly characters = inject(CharactersService);
  protected readonly dictionary = inject(DictionaryService);

  protected readonly toPinyin = toPinyin;
  protected readonly meaningOf = meaningOf;

  protected readonly form = this.fb.group({
    word: '',
    pinyin: '',
    meaning: '',
    label: '',
    notes: '',
  });
  protected readonly value = toSignal(this.form.valueChanges, { initialValue: this.form.value });

  /** Word being edited (already saved). */
  protected readonly editing = signal<string | null>(null);
  protected readonly status = signal<{ text: string; kind?: 'ok' | 'error' }>({ text: '' });
  protected readonly saving = signal(false);
  protected readonly pickerQuery = signal('');

  protected readonly lookupResult = signal<{ word: string; result: LookupResult } | null>(null);
  protected readonly lookupLoading = signal(false);
  protected readonly lookupError = signal<string | null>(null);

  private handledRoute: string | undefined | null = null;

  // ---------- Find a word by pinyin ----------
  protected readonly pinyinQuery = signal('');
  protected readonly pinyinLoading = signal(false);
  protected readonly pinyinError = signal('');
  private readonly pinyinFound = signal<CedictEntry[]>([]);
  private pinyinTimer?: ReturnType<typeof setTimeout>;
  private pinyinToken = 0;

  /** The results, common words first (HSK vocabulary and character frequency, when loaded). */
  protected readonly pinyinResults = computed(() => {
    const found = this.pinyinFound();
    const dict = this.dictionary.dictionary();
    if (!dict) return found;
    const hsk = new Map(dict.words.map((w) => [w.hanzi, w.rank]));
    const rank = (e: CedictEntry) =>
      [...e.simplified].length === 1
        ? (dict.byCharacter.get(e.simplified)?.rank ?? 1e9)
        : (hsk.get(e.simplified) ?? 1e9);
    // Stable: words of the same rank keep the server's order (exact pinyin first).
    return found
      .map((e, i) => ({ e, i, r: rank(e) }))
      .sort((a, b) => a.r - b.r || a.i - b.i)
      .map(({ e }) => e);
  });

  // ---------- Its characters, added with the word ----------
  /** Add the characters of the word that are not in your list yet, when saving. */
  protected readonly addCharacters = signal(false);

  /** The word currently typed (no spaces). */
  protected readonly currentWord = computed(() => (this.value().word ?? '').replace(/\s+/g, ''));

  /** Each character of the word, with your data when you know it. */
  protected readonly composition = computed(() =>
    [...this.currentWord()].map((ch) => ({ ch, known: this.characters.find(ch) })),
  );

  /** Lookup results, only while they match the word in the form. */
  protected readonly lookup = computed(() => {
    const r = this.lookupResult();
    return r && r.word === this.currentWord() ? r.result : null;
  });

  protected readonly pickerCharacters = computed(() => {
    const q = stripTones(this.pickerQuery().trim()).toLowerCase();
    return this.characters.list().filter((c) => {
      if (!q) return true;
      return stripTones([c.character, c.pinyin, toPinyin(c.pinyin), c.meaning].join(' '))
        .toLowerCase()
        .includes(q);
    });
  });

  /** The word's characters that are not in your list yet (each once). */
  protected readonly missingCharacters = computed(() => [
    ...new Set([...this.currentWord()].filter((ch) => isHan(ch) && !this.characters.find(ch))),
  ]);

  /** Typed a word that is already saved, without having opened it. */
  protected readonly alreadySaved = computed(() => {
    const w = this.currentWord();
    return !!w && w !== this.editing() && !!this.words.find(w);
  });

  constructor() {
    // Typing a different word stops editing the saved one.
    this.form.controls.word.valueChanges.subscribe((w) => {
      const editing = this.editing();
      if (editing && w.replace(/\s+/g, '') !== editing) this.editing.set(null);
    });

    // /add/word/:word → edit that word (or start a new one with it), once the list has loaded and only when the URL changes.
    effect(() => {
      const w = this.word();
      const loaded = this.words.loaded();
      untracked(() => {
        if (!loaded || w === this.handledRoute) return;
        this.handledRoute = w;
        if (!w || this.editing() === w) return;
        const entry = this.words.find(w);
        if (entry) this.fill(entry);
        else this.form.controls.word.setValue(w);
      });
    });
  }

  // ---------- Composing ----------
  protected append(character: string): void {
    this.form.controls.word.setValue(this.currentWord() + character);
  }

  protected removeAt(index: number): void {
    const chars = [...this.currentWord()];
    chars.splice(index, 1);
    this.form.controls.word.setValue(chars.join(''));
  }

  protected speak(): void {
    if (this.currentWord()) speak(this.currentWord());
  }

  // ---------- Find a word by pinyin ----------
  protected searchPinyin(query: string): void {
    this.pinyinQuery.set(query);
    clearTimeout(this.pinyinTimer);
    const token = ++this.pinyinToken;
    if (!query.trim()) {
      this.pinyinFound.set([]);
      this.pinyinLoading.set(false);
      return;
    }
    this.pinyinLoading.set(true);
    // The HSK list ranks the results by how common the words are (loaded once, in the background).
    this.dictionary.load().catch(() => {});
    this.pinyinTimer = setTimeout(async () => {
      try {
        const found = await this.words.searchPinyin(query);
        if (token !== this.pinyinToken) return;
        this.pinyinFound.set(found);
        this.pinyinError.set('');
      } catch (err) {
        if (token === this.pinyinToken) {
          this.pinyinError.set(t('Search failed: {error}', { error: errorMessage(err) }));
        }
      } finally {
        if (token === this.pinyinToken) this.pinyinLoading.set(false);
      }
    }, 300);
  }

  /** Fills the form with a word found by pinyin. */
  protected pickWord(entry: CedictEntry): void {
    this.form.patchValue({
      word: entry.simplified,
      pinyin: joinPinyin(entry.pinyin),
      meaning: meaningOf(entry),
    });
    this.lookupResult.set(null);
    this.status.set({ text: '' });
  }

  protected setAddCharacters(on: boolean): void {
    this.addCharacters.set(on);
    if (on) this.dictionary.load().catch(() => {});
  }

  /**
   * Adds the characters with the dictionary's data (pinyin, meaning, type, components; your own
   * pinyin and meaning for components you already have). Returns what was added and what wasn't.
   */
  private async saveCharacters(chars: string[]): Promise<{ added: string[]; missing: string[] }> {
    const dict = await this.dictionary.load();
    const added: string[] = [];
    const missing: string[] = [];
    for (const ch of chars) {
      const e = dict.byCharacter.get(ch);
      if (!e) {
        missing.push(ch);
        continue;
      }
      const entry = this.dictionary.toEntry(dict, e);
      entry.components = entry.components?.map((part) => {
        const known = this.characters.find(part.character);
        return known
          ? { ...part, pinyin: known.pinyin ?? part.pinyin, meaning: known.meaning ?? part.meaning }
          : part;
      });
      await this.characters.save(entry);
      added.push(ch);
    }
    return { added, missing };
  }

  // ---------- Dictionary ----------
  protected async lookUp(): Promise<void> {
    const word = this.currentWord();
    if (!word) return this.status.set({ text: 'Type or pick a word first.', kind: 'error' });
    this.lookupLoading.set(true);
    this.lookupError.set(null);
    try {
      const result = await this.words.lookup(word);
      this.lookupResult.set({ word, result });
      // A single meaning and nothing typed yet: use it straight away.
      const { pinyin, meaning } = this.form.getRawValue();
      if (result.exact.length === 1 && !pinyin && !meaning) this.useEntry(result.exact[0]);
    } catch (err) {
      this.lookupError.set(t('Lookup failed: {error}', { error: errorMessage(err) }));
    } finally {
      this.lookupLoading.set(false);
    }
  }

  protected useEntry(entry: CedictEntry): void {
    this.form.patchValue({ pinyin: joinPinyin(entry.pinyin), meaning: meaningOf(entry) });
  }

  /** Not in the dictionary as a whole: build the pinyin from its parts. */
  protected usePartsPinyin(parts: LookupResult['parts']): void {
    const pinyin = parts
      .map((p) => (p.entries[0] ? joinPinyin(p.entries[0].pinyin) : p.text))
      .join('');
    this.form.patchValue({ pinyin });
  }

  // ---------- Saved words ----------
  private fill(entry: WordEntry): void {
    this.editing.set(entry.word);
    this.form.setValue({
      word: entry.word,
      pinyin: entry.pinyin ?? '',
      meaning: entry.meaning ?? '',
      label: entry.label ?? '',
      notes: entry.notes ?? '',
    });
    this.status.set({ text: '' });
  }

  protected async save(): Promise<void> {
    const entry = cleanWord(this.form.getRawValue());
    if (!entry.word) return this.status.set({ text: 'Type or pick a word first.', kind: 'error' });
    this.saving.set(true);
    const chars = this.addCharacters() ? this.missingCharacters() : [];
    try {
      const { entry: saved, created } = await this.words.save(entry);
      let message = t(created ? 'Added {item} ✓' : 'Updated {item} ✓', { item: saved.word });
      if (chars.length) {
        try {
          const { added, missing } = await this.saveCharacters(chars);
          if (added.length) {
            message +=
              ' · ' +
              tn(added.length, '{n} character added: {chars}', '{n} characters added: {chars}', {
                chars: added.join(' '),
              });
          }
          if (missing.length) {
            message += ' · ' + t('Not in the dictionary: {chars}', { chars: missing.join(' ') });
          }
        } catch (err) {
          message +=
            ' · ' + t('Could not add the characters: {error}', { error: errorMessage(err) });
        }
      }
      // To the Words tab of Study, showing the saved word.
      this.router.navigate(['/study/words', saved.word], { state: { saved: message } });
    } catch (err) {
      this.status.set({
        text: t('Save failed: {error}', { error: errorMessage(err) }),
        kind: 'error',
      });
    } finally {
      this.saving.set(false);
    }
  }

  protected async remove(): Promise<void> {
    const word = this.editing();
    if (!word || !confirm(t('Delete {word} from your words?', { word }))) return;
    try {
      await this.words.remove(word);
      this.clear();
      this.status.set({ text: t('Deleted {item}.', { item: word }), kind: 'ok' });
    } catch (err) {
      this.status.set({
        text: t('Delete failed: {error}', { error: errorMessage(err) }),
        kind: 'error',
      });
    }
  }

  protected clear(): void {
    this.editing.set(null);
    this.form.reset();
    this.lookupResult.set(null);
    this.status.set({ text: '' });
    this.handledRoute = undefined;
    this.router.navigate(['/add/word']);
  }
}
