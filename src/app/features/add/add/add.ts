import {
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import {
  FormControl,
  FormGroup,
  NonNullableFormBuilder,
  ReactiveFormsModule,
} from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { debounceTime } from 'rxjs';
import { CharacterEntry, CharacterPart, Role, cleanEntry } from '../../../core/character.model';
import { CharactersService, errorMessage } from '../../../core/characters.service';
import { ROLES, TYPES } from '../../../core/config';
import {
  Dictionary,
  DictionaryEntry,
  DictionaryService,
  shortDefinition,
} from '../../../core/dictionary.service';
import { StrokeDataService } from '../../../core/stroke-data.service';
import { toPinyin } from '../../../core/pinyin';
import { MessagePipe, TranslatePipe, t } from '../../../core/i18n';
import { LabelPicker } from '../../../shared/label-picker/label-picker';
import { Pinyin } from '../../../shared/pinyin/pinyin';

type PartForm = FormGroup<{
  character: FormControl<string>;
  role: FormControl<Role>;
  pinyin: FormControl<string>;
  meaning: FormControl<string>;
  strokes: FormControl<string>;
}>;

/** Add a character, or edit one already in your list (route /add/:character). */
@Component({
  selector: 'app-add',
  imports: [ReactiveFormsModule, Pinyin, RouterLink, LabelPicker, TranslatePipe, MessagePipe],
  templateUrl: './add.html',
})
export class Add {
  /** Route parameter: /add/:character */
  readonly character = input<string>();

  private readonly fb = inject(NonNullableFormBuilder);
  private readonly router = inject(Router);
  private readonly strokeData = inject(StrokeDataService);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly characters = inject(CharactersService);
  protected readonly dictionary = inject(DictionaryService);

  protected readonly types = Object.entries(TYPES);
  protected readonly roles = Object.entries(ROLES) as [Role, (typeof ROLES)[Role]][];
  protected readonly shortDefinition = shortDefinition;
  protected readonly toPinyin = toPinyin;

  protected readonly form = this.fb.group({
    character: '',
    pinyin: '',
    meaning: '',
    type: '',
    label: '',
    components: this.fb.array<PartForm>([]),
    words: '',
    notes: '',
  });

  /** Character being edited (already in your list). */
  protected readonly editing = signal<string | null>(null);
  protected readonly status = signal<{ text: string; kind?: 'ok' | 'error' }>({ text: '' });
  protected readonly check = signal('');
  protected readonly saving = signal(false);
  protected readonly searchQuery = signal('');

  protected readonly value = toSignal(this.form.valueChanges, { initialValue: this.form.value });
  protected readonly pinyinPreview = computed(() => this.value().pinyin ?? '');

  protected readonly results = computed(() => {
    const dict = this.dictionary.dictionary();
    const query = this.searchQuery();
    return dict && query.trim() ? this.dictionary.search(dict, query) : [];
  });

  private checkToken = 0;
  private handledRoute: string | undefined | null = null;

  constructor() {
    this.addPart();
    this.addPart();

    this.form.controls.character.valueChanges
      .pipe(debounceTime(300), takeUntilDestroyed(this.destroyRef))
      .subscribe((ch) => this.onCharacterTyped(ch));

    // /add/:character → load that character, once the list has loaded and only when the URL changes.
    effect(() => {
      const ch = this.character();
      const loaded = this.characters.loaded();
      untracked(() => {
        if (!loaded || ch === this.handledRoute) return;
        this.handledRoute = ch;
        if (!ch || this.editing() === ch) return;
        const entry = this.characters.find(ch);
        if (entry) this.fill(entry);
        else if (this.form.controls.character.value !== ch)
          this.form.controls.character.setValue(ch);
      });
    });
  }

  // ---------- Form helpers ----------
  protected get parts() {
    return this.form.controls.components;
  }

  protected addPart(part: Partial<CharacterPart> = {}): void {
    const group: PartForm = this.fb.group({
      character: part.character ?? '',
      role: (part.role ?? 'meaning') as Role,
      pinyin: part.pinyin ?? '',
      meaning: part.meaning ?? '',
      strokes: part.strokes ?? '',
    });
    group.controls.character.valueChanges
      .pipe(debounceTime(250), takeUntilDestroyed(this.destroyRef))
      .subscribe((ch) => this.fillPart(group, ch));
    this.parts.push(group);
  }

  /** Base character (人, 木, 口…): the character is its own component. Empty rows are removed. */
  protected useSelfAsComponent(): void {
    const { character, pinyin, meaning } = this.form.getRawValue();
    const ch = character.trim();
    if (!ch) return this.status.set({ text: 'Type a character first.', kind: 'error' });
    for (let i = this.parts.length - 1; i >= 0; i--) {
      if (!this.parts.at(i).controls.character.value.trim()) this.parts.removeAt(i);
    }
    if (this.parts.controls.some((p) => p.controls.character.value.trim() === ch)) return;
    this.addPart({
      character: ch,
      role: 'meaning',
      pinyin: pinyin.trim(),
      meaning: meaning.trim(),
    });
  }

  // ---------- Components: reuse what you already know ----------
  /** Values auto-filled in each component row, so they can be replaced but your own typing is kept. */
  private readonly autoFilled = new WeakMap<PartForm, { pinyin: string; meaning: string }>();

  /** Pinyin and meaning of a component, from your characters first, then from the dictionary. */
  protected partData(
    character: string,
  ): { pinyin: string; meaning: string; known: boolean } | null {
    const ch = character.trim();
    if (!ch) return null;
    const known = this.characters.find(ch);
    if (known) return { pinyin: known.pinyin ?? '', meaning: known.meaning ?? '', known: true };
    const e = this.dictionary.dictionary()?.byCharacter.get(ch);
    if (e)
      return { pinyin: e.pinyin[0] ?? '', meaning: shortDefinition(e.definition), known: false };
    return null;
  }

  /** A component character was typed: fill its pinyin and meaning. */
  private fillPart(group: PartForm, character: string): void {
    const data = this.partData(character);
    if (!data) {
      // Not in your list: try again once the dictionary is loaded.
      if (character.trim() && !this.dictionary.dictionary()) {
        this.dictionary.load().then(
          () => group.controls.character.value === character && this.fillPart(group, character),
          () => {},
        );
      }
      return;
    }
    const previous = this.autoFilled.get(group);
    const { pinyin, meaning } = group.controls;
    if (!pinyin.value || pinyin.value === previous?.pinyin) pinyin.setValue(data.pinyin);
    if (!meaning.value || meaning.value === previous?.meaning) meaning.setValue(data.meaning);
    this.autoFilled.set(group, { pinyin: data.pinyin, meaning: data.meaning });
  }

  /** Dictionary entry → form data, with components you already know taken from your list. */
  private fromDictionary(dict: Dictionary, e: DictionaryEntry, query = ''): CharacterEntry {
    const entry = this.dictionary.toEntry(dict, e, query);
    entry.components = entry.components?.map((part) => {
      const known = this.characters.find(part.character);
      return known
        ? { ...part, pinyin: known.pinyin ?? part.pinyin, meaning: known.meaning ?? part.meaning }
        : part;
    });
    return entry;
  }

  private readForm(): CharacterEntry {
    const v = this.form.getRawValue();
    return cleanEntry({ ...v, words: v.words.split('\n').map((line) => line.split('|')) });
  }

  /** True when nothing but the character (and maybe a label) has been typed. */
  private isBlank(): boolean {
    const e = this.readForm();
    return !e.pinyin && !e.meaning && !e.type && !e.components && !e.words && !e.notes;
  }

  /** Fills the whole form (from your list or from the dictionary, which keeps the chosen label). */
  private fill(entry: CharacterEntry): void {
    const known = !!this.characters.find(entry.character);
    this.editing.set(known ? entry.character : null);
    this.parts.clear();
    for (const part of entry.components ?? []) this.addPart(part);
    if (!this.parts.length) this.addPart();
    this.form.patchValue({
      character: entry.character,
      pinyin: entry.pinyin ?? '',
      meaning: entry.meaning ?? '',
      type: TYPES[entry.type ?? ''] ? entry.type : '',
      label: known ? (entry.label ?? '') : this.form.controls.label.value,
      words: (entry.words ?? []).map((w) => w.filter((x) => x != null).join(' | ')).join('\n'),
      notes: entry.notes ?? '',
    });
    this.status.set({ text: '' });
  }

  // ---------- Character field: stroke check + auto-fill ----------
  private async onCharacterTyped(value: string): Promise<void> {
    const ch = value.trim();
    const token = ++this.checkToken;
    if (this.editing() && ch !== this.editing()) this.editing.set(null);
    this.check.set(ch ? t('Checking…') : '');
    if (!ch) return;

    const known = this.characters.find(ch);
    if (this.isBlank()) {
      // Already in your list → load it for editing; otherwise fill from the dictionary.
      if (known) return this.fill(known);
      const dict = await this.dictionary.load().catch(() => null);
      const e = dict?.byCharacter.get(ch);
      if (token !== this.checkToken) return;
      if (dict && e && this.isBlank()) return this.fill(this.fromDictionary(dict, e));
    }

    const data = await this.strokeData.load(ch);
    if (token !== this.checkToken) return;
    const note =
      known && this.editing() !== ch ? t(' — already in your list (saving will update it)') : '';
    this.check.set(
      data
        ? '✓ ' + t('{n} strokes', { n: data.strokes.length }) + note
        : t('✗ Not found in Hanzi Writer'),
    );
  }

  // ---------- Actions ----------
  protected search(query: string): void {
    this.searchQuery.set(query);
    if (query.trim()) this.dictionary.load().catch(() => {});
  }

  protected isKnown(character: string): boolean {
    return !!this.characters.find(character);
  }

  protected pick(e: DictionaryEntry): void {
    const dict = this.dictionary.dictionary();
    if (this.isKnown(e.character)) this.router.navigate(['/add', e.character]);
    else if (dict) this.fill(this.fromDictionary(dict, e, this.searchQuery()));
  }

  protected async fillFromDictionary(): Promise<void> {
    const ch = this.form.controls.character.value.trim();
    if (!ch) return this.status.set({ text: 'Type a character first.', kind: 'error' });
    try {
      const dict = await this.dictionary.load();
      const e = dict.byCharacter.get(ch);
      if (e) this.fill(this.fromDictionary(dict, e));
      else
        this.status.set({
          text: t('{char} is not in the dictionary.', { char: ch }),
          kind: 'error',
        });
    } catch {
      this.status.set({
        text: 'Could not load the dictionary (internet connection?).',
        kind: 'error',
      });
    }
  }

  protected async save(): Promise<void> {
    const entry = this.readForm();
    if (!entry.character)
      return this.status.set({ text: 'Type a character first.', kind: 'error' });
    this.saving.set(true);
    try {
      const { entry: saved, created } = await this.characters.save(entry);
      // Back to the list, showing the saved character.
      this.router.navigate(['/study', saved.character], {
        state: {
          saved: t(created ? 'Added {item} ✓' : 'Updated {item} ✓', { item: saved.character }),
        },
      });
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
    const ch = this.editing();
    if (!ch || !confirm(t('Delete {char} from your list?', { char: ch }))) return;
    try {
      await this.characters.remove(ch);
      this.clear();
      this.status.set({ text: t('Deleted {item}.', { item: ch }), kind: 'ok' });
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
    this.parts.clear();
    this.addPart();
    this.addPart();
    this.status.set({ text: '' });
    this.router.navigate(['/add']);
  }
}
