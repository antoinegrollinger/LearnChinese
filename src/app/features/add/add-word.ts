import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { CharactersService, errorMessage } from '../../core/characters.service';
import { stripTones, toPinyin } from '../../core/pinyin';
import { speak } from '../../core/speech';
import { WordEntry, cleanWord } from '../../core/word.model';
import {
  CedictEntry,
  LookupResult,
  WordsService,
  joinPinyin,
  meaningOf,
} from '../../core/words.service';
import { LabelPicker } from '../../shared/label-picker';
import { SpeakerIcon } from '../../shared/speaker-icon';
import { Pinyin } from '../../shared/pinyin';

/**
 * Add a word, or edit one of yours (route /add/word/:word): compose it from your characters, look
 * it up in CC-CEDICT, save it.
 */
@Component({
  selector: 'app-add-word',
  imports: [ReactiveFormsModule, Pinyin, RouterLink, LabelPicker, SpeakerIcon],
  templateUrl: './add-word.html',
})
export class AddWord {
  /** Route parameter: /add/word/:word */
  readonly word = input<string>();

  private readonly fb = inject(NonNullableFormBuilder);
  private readonly router = inject(Router);
  protected readonly words = inject(WordsService);
  protected readonly characters = inject(CharactersService);

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
      this.lookupError.set(`Lookup failed: ${errorMessage(err)}`);
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
    try {
      const { entry: saved, created } = await this.words.save(entry);
      // To the Words tab of Study, showing the saved word.
      this.router.navigate(['/study/words', saved.word], {
        state: { saved: `${created ? 'Added' : 'Updated'} ${saved.word} ✓` },
      });
    } catch (err) {
      this.status.set({ text: `Save failed: ${errorMessage(err)}`, kind: 'error' });
    } finally {
      this.saving.set(false);
    }
  }

  protected async remove(): Promise<void> {
    const word = this.editing();
    if (!word || !confirm(`Delete ${word} from your words?`)) return;
    try {
      await this.words.remove(word);
      this.clear();
      this.status.set({ text: `Deleted ${word}.`, kind: 'ok' });
    } catch (err) {
      this.status.set({ text: `Delete failed: ${errorMessage(err)}`, kind: 'error' });
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
