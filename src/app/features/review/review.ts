import {
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { CharacterEntry } from '../../core/character.model';
import { CharactersService, errorMessage } from '../../core/characters.service';
import { typeOf } from '../../core/config';
import { LabelsService } from '../../core/labels.service';
import { checkPinyin, toPinyin } from '../../core/pinyin';
import {
  REVIEW_KINDS,
  REVIEW_MODES,
  ReviewKind,
  ReviewMode,
  ReviewSession,
  formatDuration,
  reviewKind,
  reviewMode,
} from '../../core/review.model';
import { ReviewsService } from '../../core/reviews.service';
import { readSetting, writeSetting } from '../../core/settings';
import { speak } from '../../core/speech';
import { StatsService } from '../../core/stats.service';
import { WordsService } from '../../core/words.service';
import { HanziWriterView } from '../../shared/hanzi-writer';
import { Pinyin } from '../../shared/pinyin';
import { PartsSummary } from '../study/parts-summary';

/** Fisher–Yates shuffle (returns a new array). */
function shuffle<T>(items: T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/** The first characters (or words) of a session: "妈 爸 人 …" */
export const previewOf = (session: ReviewSession, max = 8): string =>
  session.results
    .slice(0, max)
    .map((r) => r.character)
    .join(' ') + (session.results.length > max ? ' …' : '');

/** Chinese characters (Han script): the ones written in a words review. */
const isHan = (ch: string): boolean => /\p{Script=Han}/u.test(ch);

/** Items chosen for the last review of each kind, in this browser (JSON arrays). */
const SELECTION_KEYS: Record<ReviewKind, string> = {
  characters: 'hanzi-workshop-review-selection',
  words: 'hanzi-workshop-review-selection-words',
};
/** The last review mode, in this browser. */
const MODE_KEY = 'hanzi-workshop-review-mode';

/** The Review tab of each kind. */
export const reviewUrl = (kind: ReviewKind): string =>
  kind === 'words' ? '/review/words' : '/review';

/** A character or a word, as the review shows it. */
interface ReviewItem {
  /** The character or the word: what you write, and its key. */
  text: string;
  pinyin?: string;
  meaning?: string;
  label?: string;
  /** For characters: the whole entry (type, components). */
  character?: CharacterEntry;
}

/** The characters of one label ('' = without a label), for selecting them all at once. */
interface LabelGroup {
  key: string;
  name: string;
  color: string;
  characters: string[];
  /** How many of them are selected. */
  selected: number;
}

/** How an item went in the current session. */
interface Attempts {
  tries: number;
  mistakes: number;
}

/**
 * Pick what to review (characters or words; all, some, or the characters of some labels) and the
 * mode, then for each one, in random order: write it from its pinyin and meaning (a word character
 * by character), or give its pinyin. Missed ones come back soon. The session is complete when
 * each one has been done without a mistake.
 */
@Component({
  selector: 'app-review',
  imports: [HanziWriterView, Pinyin, PartsSummary, RouterLink],
  templateUrl: './review.html',
})
export class Review {
  protected readonly characters = inject(CharactersService);
  protected readonly words = inject(WordsService);
  protected readonly labels = inject(LabelsService);
  protected readonly reviews = inject(ReviewsService);
  private readonly router = inject(Router);
  private readonly statsService = inject(StatsService);
  private readonly writer = viewChild(HanziWriterView);
  private readonly answerInput = viewChild<ElementRef<HTMLInputElement>>('answerInput');
  private readonly injector = inject(Injector);

  protected readonly modes = Object.entries(REVIEW_MODES) as [
    ReviewMode,
    (typeof REVIEW_MODES)[ReviewMode],
  ][];
  protected readonly modeInfo = REVIEW_MODES;
  protected readonly kindInfo = REVIEW_KINDS;
  /** Characters to review straight away, and how, from the dashboard ("Review again"). */
  private replay = this.router.currentNavigation()?.extras.state as
    { replay?: string[]; mode?: ReviewMode; kind?: ReviewKind } | undefined;

  /** Characters or words: the tab of the page (route data). */
  readonly kind = input<ReviewKind>('characters');
  /** Write it, or give its pinyin; chosen before the session starts. */
  protected readonly mode = signal<ReviewMode>(reviewMode(readSetting(MODE_KEY)));
  /** Pinyin mode: what you typed. */
  protected readonly answer = signal('');
  /** Pinyin mode: the meaning is shown (Hint). */
  protected readonly meaningShown = signal(false);
  /** Mistakes on the current card so far (pinyin answers, or the characters of a word). */
  private cardMistakes = 0;

  /** Items chosen for the review (characters or words, by text). */
  protected readonly selected = signal<ReadonlySet<string>>(new Set());
  /** The kind whose selection has been loaded. */
  private selectionLoadedFor: ReviewKind | null = null;
  /** false: choosing what to review; true: reviewing. */
  protected readonly started = signal(false);
  /** Every item of the session has been done without a mistake. */
  protected readonly complete = signal(false);
  /** Items done without a mistake in this session. */
  protected readonly validated = signal<ReadonlySet<string>>(new Set());
  /** Tries and mistakes per item in this session. */
  private readonly attempts = signal<ReadonlyMap<string, Attempts>>(new Map());
  private sessionStart = 0;
  /** Saving the completed session to your history. */
  protected readonly saveStatus = signal<{ text: string; kind?: 'ok' | 'error' }>({ text: '' });
  private readonly sessionEnd = signal(0);
  protected readonly toPinyin = toPinyin;

  protected readonly card = signal<ReviewItem | null>(null);
  /** Write mode, words: which of the word's characters is being written. */
  protected readonly writeIndex = signal(0);
  protected readonly done = signal(false);
  protected readonly message = signal<{ text: string; kind?: 'ok' | 'error' }>({ text: '' });
  protected readonly typeOf = typeOf;
  /** Items still to come in this round. */
  private deck: string[] = [];

  /** Your characters or your words, in list order. */
  protected readonly items = computed<ReviewItem[]>(() =>
    this.kind() === 'words'
      ? this.words.list().map((w) => ({ text: w.word, pinyin: w.pinyin, meaning: w.meaning }))
      : this.characters.list().map((c) => ({
          text: c.character,
          pinyin: c.pinyin,
          meaning: c.meaning,
          label: c.label,
          character: c,
        })),
  );

  protected readonly itemsLoaded = computed(() =>
    this.kind() === 'words' ? this.words.loaded() : this.characters.loaded(),
  );

  /** The dashboard tab of this kind. */
  protected readonly dashboardLink = computed(() =>
    this.kind() === 'words' ? '/dashboard/words' : '/dashboard',
  );

  /** "character" or "word", for the texts. */
  protected readonly one = computed(() => REVIEW_KINDS[this.kind()].one);

  /** The selected items, in list order. */
  protected readonly reviewList = computed(() => {
    const selected = this.selected();
    return this.items().filter((item) => selected.has(item.text));
  });

  /** Characters: one group per label, then those without a label (only when some have one). */
  protected readonly groups = computed<LabelGroup[]>(() => {
    if (this.kind() !== 'characters') return [];
    const list = this.characters.list();
    const selected = this.selected();
    const group = (key: string, name: string, color: string): LabelGroup => {
      const characters = list.filter((c) => (c.label ?? '') === key).map((c) => c.character);
      return {
        key,
        name,
        color,
        characters,
        selected: characters.filter((c) => selected.has(c)).length,
      };
    };
    const groups = this.labels.names().map((name) => group(name, name, this.labels.colorOf(name)));
    const labelled = groups.filter((g) => g.characters.length);
    if (!labelled.length) return [];
    const unlabelled = group('', 'No label', 'var(--muted)');
    return unlabelled.characters.length ? [...labelled, unlabelled] : labelled;
  });

  protected readonly allValidated = computed(
    () =>
      this.reviewList().length > 0 &&
      this.reviewList().every((item) => this.validated().has(item.text)),
  );

  /** Write mode: the Chinese characters of the card, written one after the other. */
  protected readonly cardChars = computed(() => [...(this.card()?.text ?? '')].filter(isHan));
  /** Write mode: the character being written. */
  protected readonly currentChar = computed(() => this.cardChars()[this.writeIndex()] ?? '');
  /** A new writer for each character written (the same character can come twice: 妈妈). */
  protected readonly writerKey = computed(() => `${this.card()?.text}#${this.writeIndex()}`);
  /** Write mode, words: each character of the word, shown once written (non-Chinese ones always). */
  protected readonly wordSlots = computed(() => {
    let han = -1;
    return [...(this.card()?.text ?? '')].map((ch) => {
      if (!isHan(ch)) return { ch, state: 'shown' as const };
      han++;
      const state =
        this.done() || han < this.writeIndex()
          ? ('shown' as const)
          : han === this.writeIndex()
            ? ('current' as const)
            : ('hidden' as const);
      return { ch, state };
    });
  });

  /** For the success screen. */
  protected readonly summary = computed(() => {
    const attempts = this.attempts();
    const list = this.reviewList();
    const of = (item: ReviewItem) => attempts.get(item.text) ?? { tries: 0, mistakes: 0 };
    const seconds = Math.round((this.sessionEnd() - this.sessionStart) / 1000);
    return {
      count: list.length,
      tries: list.reduce((sum, item) => sum + of(item).tries, 0),
      mistakes: list.reduce((sum, item) => sum + of(item).mistakes, 0),
      firstTry: list.filter((item) => of(item).tries === 1).length,
      time: formatDuration(seconds),
      /** Needed more than one try, hardest first. */
      missed: list
        .filter((item) => of(item).tries > 1)
        .map((item) => ({ item, tries: of(item).tries }))
        .sort((a, b) => b.tries - a.tries),
    };
  });

  /** The last completed review (any kind), with how many of its items are still in your lists. */
  protected readonly lastReview = computed(() => {
    const session = this.reviews.last();
    if (!session) return null;
    const available = session.results.filter((r) => this.exists(session.kind, r.character)).length;
    return { session, available, preview: previewOf(session) };
  });

  /** Writing stats of the Study page (characters only). */
  protected readonly score = computed(() => {
    const stats = this.statsService.stats();
    const list = this.reviewList();
    const seen = list.filter((item) => stats[item.text]);
    const perfect = seen.filter((item) => stats[item.text].perfect > 0).length;
    return `${seen.length}/${list.length} characters reviewed · ${perfect} written without mistakes at least once`;
  });

  constructor() {
    // Once the list of the current kind is loaded: the dashboard's replay, else the last
    // selection of this kind, else everything.
    effect(() => {
      const kind = this.kind();
      const items = this.items();
      if (!items.length || this.selectionLoadedFor === kind) return;
      this.selectionLoadedFor = kind;
      untracked(() => {
        const replay = this.replay;
        this.replay = undefined;
        if (replay?.replay && this.reviewItems(replay.replay, replay.mode, kind)) return;
        const known = new Set(items.map((item) => item.text));
        const previous = this.savedSelection(kind).filter((t) => known.has(t));
        this.selected.set(new Set(previous.length ? previous : known));
      });
    });
    // Start the quiz whenever a new card, or the next character of a word, is shown.
    effect(() => {
      const card = this.card();
      this.writeIndex();
      const writer = this.writer();
      if (card && writer && !untracked(this.done)) {
        untracked(() => setTimeout(() => this.startQuiz(writer)));
      }
    });
  }

  private exists(kind: ReviewKind, text: string): boolean {
    return kind === 'words' ? !!this.words.find(text) : !!this.characters.find(text);
  }

  private savedSelection(kind: ReviewKind): string[] {
    try {
      const saved: unknown = JSON.parse(readSetting(SELECTION_KEYS[kind]) ?? '[]');
      return Array.isArray(saved) ? saved.map(String) : [];
    } catch {
      return [];
    }
  }

  // ---------- Choosing what to review ----------
  protected toggle(text: string): void {
    const selected = new Set(this.selected());
    if (!selected.delete(text)) selected.add(text);
    this.selected.set(selected);
  }

  protected selectAll(): void {
    this.selected.set(new Set(this.items().map((item) => item.text)));
  }

  protected selectNone(): void {
    this.selected.set(new Set());
  }

  /** Adds the label's characters, or removes them when they are all selected already. */
  protected toggleGroup(group: LabelGroup): void {
    const selected = new Set(this.selected());
    const all = group.selected === group.characters.length;
    for (const c of group.characters) {
      if (all) selected.delete(c);
      else selected.add(c);
    }
    this.selected.set(selected);
  }

  protected start(): void {
    if (!this.reviewList().length) return;
    writeSetting(SELECTION_KEYS[this.kind()], JSON.stringify([...this.selected()]));
    this.deck = [];
    this.validated.set(new Set());
    this.attempts.set(new Map());
    this.sessionStart = Date.now();
    this.complete.set(false);
    this.started.set(true);
    this.next();
  }

  protected setMode(mode: ReviewMode): void {
    this.mode.set(mode);
    writeSetting(MODE_KEY, mode);
  }

  /**
   * Starts a session with these characters or words (those still in your lists), in this mode
   * and kind (default: the current ones). Returns false when none of them is in your lists.
   */
  protected reviewItems(texts: string[], mode?: ReviewMode, kind?: ReviewKind): boolean {
    const target = kind ? reviewKind(kind) : this.kind();
    const known = texts.filter((t) => this.exists(target, t));
    if (!known.length) return false;
    if (target !== this.kind()) {
      // A review of the other kind: in its tab.
      this.router.navigate([reviewUrl(target)], { state: { replay: known, mode, kind: target } });
      return true;
    }
    this.selectionLoadedFor = target;
    if (mode) this.setMode(reviewMode(mode));
    this.selected.set(new Set(known));
    this.start();
    return true;
  }

  protected repeatLast(): void {
    const session = this.reviews.last();
    if (session) {
      this.reviewItems(
        session.results.map((r) => r.character),
        session.mode,
        session.kind,
      );
    }
  }

  /** A new session with only the items that needed more than one try. */
  protected reviewMissed(): void {
    this.selected.set(new Set(this.summary().missed.map((m) => m.item.text)));
    this.start();
  }

  protected changeSelection(): void {
    this.started.set(false);
    this.complete.set(false);
    this.card.set(null);
  }

  // ---------- Reviewing ----------
  protected next(): void {
    if (this.allValidated()) {
      this.sessionEnd.set(Date.now());
      this.card.set(null);
      this.complete.set(true);
      this.saveSession();
      return;
    }
    this.done.set(false);
    this.writeIndex.set(0);
    this.card.set(this.pick());
    this.message.set({ text: '' });
    this.answer.set('');
    this.meaningShown.set(false);
    this.cardMistakes = 0;
    if (this.mode() === 'pinyin') this.focusAnswer();
    // A "word" without Chinese characters: nothing to write.
    else if (this.card() && !this.cardChars().length) this.finish(0);
  }

  /** Adds the completed session to your history (the dashboard). */
  private async saveSession(): Promise<void> {
    const attempts = this.attempts();
    const session: ReviewSession = {
      kind: this.kind(),
      mode: this.mode(),
      startedAt: new Date(this.sessionStart).toISOString(),
      finishedAt: new Date(this.sessionEnd()).toISOString(),
      results: this.reviewList().map((item) => ({
        character: item.text,
        ...(attempts.get(item.text) ?? { tries: 0, mistakes: 0 }),
      })),
    };
    this.saveStatus.set({ text: 'Saving to your history…' });
    try {
      await this.reviews.save(session);
      this.saveStatus.set({ text: 'Saved to your history ✓', kind: 'ok' });
    } catch (err) {
      this.saveStatus.set({ text: `Could not save it: ${errorMessage(err)}`, kind: 'error' });
    }
  }

  protected hint(): void {
    if (this.mode() === 'pinyin') this.meaningShown.set(true);
    else this.writer()?.revealOutline();
  }

  /** Shows the answer; counts as a miss, so it comes back soon. */
  protected solution(): void {
    if (this.mode() === 'write') this.writer()?.animate();
    this.finish(this.cardMistakes + 1, true);
  }

  // ---------- Pinyin mode ----------
  private focusAnswer(): void {
    afterNextRender(() => this.answerInput()?.nativeElement.focus(), { injector: this.injector });
  }

  /** Enter: checks the answer, or goes to the next card once this one is done. */
  protected submitAnswer(): void {
    const card = this.card();
    if (!card) return;
    if (this.done()) return this.next();
    if (!this.answer().trim()) return;
    const result = checkPinyin(this.answer(), card.pinyin);
    if (result === 'right') return this.finish(this.cardMistakes);
    this.cardMistakes++;
    this.message.set({
      text:
        result === 'tone'
          ? `Right ${this.kind() === 'words' ? 'syllables' : 'syllable'}, wrong tone. Try again…`
          : 'Not quite… Try again.',
      kind: 'error',
    });
    this.focusAnswer();
  }

  protected speak(): void {
    const card = this.card();
    if (card) speak(card.text);
  }

  // ---------- Write mode ----------
  private startQuiz(writer: HanziWriterView): void {
    const index = this.writeIndex();
    writer.quiz({
      showHintAfterMisses: 3,
      onMistake: () => this.message.set({ text: 'Not quite…', kind: 'error' }),
      onCorrectStroke: (s) =>
        this.message.set({ text: `✓ ${s.strokesRemaining} stroke(s) left`, kind: 'ok' }),
      onComplete: ({ totalMistakes }) => {
        if (index === this.writeIndex()) this.charWritten(totalMistakes);
      },
    });
  }

  /** One character of the card is written: the next one, or the card is done. */
  private charWritten(mistakes: number): void {
    this.cardMistakes += mistakes;
    if (this.writeIndex() < this.cardChars().length - 1) {
      this.writeIndex.update((i) => i + 1);
      this.message.set({
        text: mistakes ? `${mistakes} mistake(s). Next character…` : '✓ Next character…',
        kind: mistakes ? undefined : 'ok',
      });
    } else {
      this.finish(this.cardMistakes);
    }
  }

  /** No stroke data for this character: show it and go on with the next one. */
  protected onWriterError(): void {
    if (!this.card() || this.done()) return;
    const ch = this.currentChar();
    if (this.writeIndex() < this.cardChars().length - 1) {
      this.message.set({ text: `No stroke data for ${ch}: skipped.` });
      this.writeIndex.update((i) => i + 1);
    } else {
      this.message.set({ text: `No stroke data for ${ch}.` });
      this.finish(this.cardMistakes);
    }
  }

  private finish(mistakes: number, solutionShown = false): void {
    const card = this.card();
    if (this.done() || !card) return;
    this.done.set(true);
    // The practice stats (Study page) are about writing characters.
    if (this.mode() === 'write' && this.kind() === 'characters') {
      this.statsService.record(card.text, mistakes);
    }
    if (this.mode() === 'pinyin') this.focusAnswer(); // Enter goes on to the next card
    this.attempts.update((all) => {
      const previous = all.get(card.text) ?? { tries: 0, mistakes: 0 };
      const next = { tries: previous.tries + 1, mistakes: previous.mistakes + mistakes };
      return new Map(all).set(card.text, next);
    });
    if (mistakes) this.comeBackSoon(card.text);
    else this.validated.update((v) => new Set(v).add(card.text));
    this.message.set(
      solutionShown
        ? {
            text:
              this.mode() === 'pinyin'
                ? 'Say it out loud a few times, it will come back soon.'
                : 'Watch the stroke order carefully, it will come back soon.',
          }
        : mistakes
          ? { text: `Done with ${mistakes} mistake(s).` }
          : { text: 'Perfect! 🎉', kind: 'ok' },
    );
  }

  /**
   * Every item not yet validated, once per round, in a new random order each round. A missed one
   * is put back a few cards later, so it comes back soon.
   */
  private pick(): ReviewItem | null {
    const validated = this.validated();
    const list = this.reviewList().filter((item) => !validated.has(item.text));
    if (!list.length) return null;
    const known = new Set(list.map((item) => item.text));
    this.deck = this.deck.filter((text) => known.has(text));
    if (!this.deck.length) {
      this.deck = shuffle(list.map((item) => item.text));
      // Not the same one twice in a row when a new round starts.
      if (this.deck.length > 1 && this.deck[0] === this.card()?.text) {
        this.deck.push(this.deck.shift()!);
      }
    }
    const text = this.deck.shift()!;
    return list.find((item) => item.text === text) ?? null;
  }

  private comeBackSoon(text: string): void {
    this.deck = this.deck.filter((t) => t !== text);
    const position = Math.min(this.deck.length, 3 + Math.floor(Math.random() * 4));
    this.deck.splice(position, 0, text);
  }
}
