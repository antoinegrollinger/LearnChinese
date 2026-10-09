import {
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
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
  REVIEW_MODES,
  ReviewMode,
  ReviewSession,
  formatDuration,
  reviewMode,
} from '../../core/review.model';
import { ReviewsService } from '../../core/reviews.service';
import { readSetting, writeSetting } from '../../core/settings';
import { speak } from '../../core/speech';
import { StatsService } from '../../core/stats.service';
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

/** The first characters of a session: "妈 爸 人 …" */
export const previewOf = (session: ReviewSession, max = 8): string =>
  session.results
    .slice(0, max)
    .map((r) => r.character)
    .join(' ') + (session.results.length > max ? ' …' : '');

/** Characters chosen for the last review, in this browser (JSON array). */
const SELECTION_KEY = 'hanzi-workshop-review-selection';
/** The last review mode, in this browser. */
const MODE_KEY = 'hanzi-workshop-review-mode';

/** The characters of one label ('' = without a label), for selecting them all at once. */
interface LabelGroup {
  key: string;
  name: string;
  color: string;
  characters: string[];
  /** How many of them are selected. */
  selected: number;
}

/** How a character went in the current session. */
interface Attempts {
  tries: number;
  mistakes: number;
}

/**
 * Pick the characters to review (all, some, or those of some labels) and the mode, then for each
 * one, in random order: write it from its pinyin and meaning, or give its pinyin. Missed characters
 * come back soon. The session is complete when each one has been done without a mistake.
 */
@Component({
  selector: 'app-review',
  imports: [HanziWriterView, Pinyin, PartsSummary, RouterLink],
  templateUrl: './review.html',
})
export class Review {
  protected readonly characters = inject(CharactersService);
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
  /** Write the character, or give its pinyin; chosen before the session starts. */
  protected readonly mode = signal<ReviewMode>(reviewMode(readSetting(MODE_KEY)));
  /** Pinyin mode: what you typed. */
  protected readonly answer = signal('');
  /** Pinyin mode: the meaning is shown (Hint). */
  protected readonly meaningShown = signal(false);
  /** Pinyin mode: wrong answers for the current card. */
  private pinyinMistakes = 0;

  /** Characters chosen for the review. */
  protected readonly selected = signal<ReadonlySet<string>>(new Set());
  /** false: choosing the characters; true: reviewing them. */
  protected readonly started = signal(false);
  /** Every character of the session has been written without a mistake. */
  protected readonly complete = signal(false);
  /** Characters written without a mistake in this session. */
  protected readonly validated = signal<ReadonlySet<string>>(new Set());
  /** Tries and mistakes per character in this session. */
  private readonly attempts = signal<ReadonlyMap<string, Attempts>>(new Map());
  private sessionStart = 0;
  /** Saving the completed session to your history. */
  protected readonly saveStatus = signal<{ text: string; kind?: 'ok' | 'error' }>({ text: '' });
  /** Characters to review straight away, and in which mode, from the dashboard ("Review again"). */
  private readonly replay = this.router.currentNavigation()?.extras.state as
    { replay?: string[]; mode?: ReviewMode } | undefined;
  private readonly sessionEnd = signal(0);
  protected readonly toPinyin = toPinyin;

  protected readonly card = signal<CharacterEntry | null>(null);
  protected readonly done = signal(false);
  protected readonly outline = signal(false);
  protected readonly message = signal<{ text: string; kind?: 'ok' | 'error' }>({ text: '' });
  protected readonly typeOf = typeOf;
  /** Characters still to come in this round. */
  private deck: string[] = [];
  private selectionLoaded = false;

  /** The selected characters, in list order. */
  protected readonly reviewList = computed(() => {
    const selected = this.selected();
    return this.characters.list().filter((c) => selected.has(c.character));
  });

  /** One group per label, then the characters without a label (only when some have one). */
  protected readonly groups = computed<LabelGroup[]>(() => {
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
      this.reviewList().every((c) => this.validated().has(c.character)),
  );

  /** For the success screen. */
  protected readonly summary = computed(() => {
    const attempts = this.attempts();
    const list = this.reviewList();
    const of = (c: CharacterEntry) => attempts.get(c.character) ?? { tries: 0, mistakes: 0 };
    const seconds = Math.round((this.sessionEnd() - this.sessionStart) / 1000);
    return {
      count: list.length,
      tries: list.reduce((sum, c) => sum + of(c).tries, 0),
      mistakes: list.reduce((sum, c) => sum + of(c).mistakes, 0),
      firstTry: list.filter((c) => of(c).tries === 1).length,
      time: formatDuration(seconds),
      /** Needed more than one try, hardest first. */
      missed: list
        .filter((c) => of(c).tries > 1)
        .map((c) => ({ entry: c, tries: of(c).tries }))
        .sort((a, b) => b.tries - a.tries),
    };
  });

  /** The last completed review, with how many of its characters are still in your list. */
  protected readonly lastReview = computed(() => {
    const session = this.reviews.last();
    if (!session) return null;
    const available = session.results.filter((r) => this.characters.find(r.character)).length;
    return { session, available, preview: previewOf(session) };
  });

  protected readonly score = computed(() => {
    const stats = this.statsService.stats();
    const list = this.reviewList();
    const seen = list.filter((c) => stats[c.character]);
    const perfect = seen.filter((c) => stats[c.character].perfect > 0).length;
    return `${seen.length}/${list.length} characters reviewed · ${perfect} written without mistakes at least once`;
  });

  constructor() {
    // Once the list is loaded: select the characters of the last review, or all of them.
    effect(() => {
      const list = this.characters.list();
      if (!list.length || this.selectionLoaded) return;
      this.selectionLoaded = true;
      untracked(() => {
        const replay = this.replay;
        if (replay?.replay && this.reviewCharacters(replay.replay, replay.mode)) return;
        const known = new Set(list.map((c) => c.character));
        const previous = this.savedSelection().filter((c) => known.has(c));
        this.selected.set(new Set(previous.length ? previous : known));
      });
    });
    // Start the quiz whenever a new card is shown.
    effect(() => {
      const card = this.card();
      const writer = this.writer();
      if (card && writer) untracked(() => setTimeout(() => this.startQuiz(writer)));
    });
  }

  private savedSelection(): string[] {
    try {
      const saved: unknown = JSON.parse(readSetting(SELECTION_KEY) ?? '[]');
      return Array.isArray(saved) ? saved.map(String) : [];
    } catch {
      return [];
    }
  }

  // ---------- Choosing the characters ----------
  protected toggle(character: string): void {
    const selected = new Set(this.selected());
    if (!selected.delete(character)) selected.add(character);
    this.selected.set(selected);
  }

  protected selectAll(): void {
    this.selected.set(new Set(this.characters.list().map((c) => c.character)));
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
    writeSetting(SELECTION_KEY, JSON.stringify([...this.selected()]));
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
   * Starts a session with these characters (those still in your list), in this mode (default: the
   * current one). Returns false when none of them is in your list.
   */
  protected reviewCharacters(characters: string[], mode?: ReviewMode): boolean {
    const known = characters.filter((c) => this.characters.find(c));
    if (!known.length) return false;
    if (mode) this.setMode(reviewMode(mode));
    this.selected.set(new Set(known));
    this.start();
    return true;
  }

  protected repeatLast(): void {
    const session = this.reviews.last();
    if (session)
      this.reviewCharacters(
        session.results.map((r) => r.character),
        session.mode,
      );
  }

  /** A new session with only the characters that needed more than one try. */
  protected reviewMissed(): void {
    this.selected.set(new Set(this.summary().missed.map((m) => m.entry.character)));
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
    this.card.set(this.pick());
    this.done.set(false);
    this.outline.set(false);
    this.message.set({ text: '' });
    this.answer.set('');
    this.meaningShown.set(false);
    this.pinyinMistakes = 0;
    if (this.mode() === 'pinyin') this.focusAnswer();
  }

  /** Adds the completed session to your history (the dashboard). */
  private async saveSession(): Promise<void> {
    const attempts = this.attempts();
    const session: ReviewSession = {
      mode: this.mode(),
      startedAt: new Date(this.sessionStart).toISOString(),
      finishedAt: new Date(this.sessionEnd()).toISOString(),
      results: this.reviewList().map((c) => ({
        character: c.character,
        ...(attempts.get(c.character) ?? { tries: 0, mistakes: 0 }),
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

  protected solution(): void {
    if (this.mode() === 'pinyin') return this.finish(this.pinyinMistakes + 1, true);
    this.writer()?.animate();
    this.finish(1, true); // counts as a miss
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
    if (result === 'right') return this.finish(this.pinyinMistakes);
    this.pinyinMistakes++;
    this.message.set({
      text: result === 'tone' ? 'Right syllable, wrong tone. Try again…' : 'Not quite… Try again.',
      kind: 'error',
    });
    this.focusAnswer();
  }

  protected speak(): void {
    const card = this.card();
    if (card) speak(card.character);
  }

  private startQuiz(writer: HanziWriterView): void {
    writer.quiz({
      showHintAfterMisses: 3,
      onMistake: () => this.message.set({ text: 'Not quite…', kind: 'error' }),
      onCorrectStroke: (s) =>
        this.message.set({ text: `✓ ${s.strokesRemaining} stroke(s) left`, kind: 'ok' }),
      onComplete: ({ totalMistakes }) => this.finish(totalMistakes),
    });
  }

  private finish(mistakes: number, solutionShown = false): void {
    const card = this.card();
    if (this.done() || !card) return;
    this.done.set(true);
    // The practice stats (Study page) are about writing.
    if (this.mode() === 'write') this.statsService.record(card.character, mistakes);
    else this.focusAnswer(); // Enter goes on to the next card
    this.attempts.update((all) => {
      const previous = all.get(card.character) ?? { tries: 0, mistakes: 0 };
      const next = { tries: previous.tries + 1, mistakes: previous.mistakes + mistakes };
      return new Map(all).set(card.character, next);
    });
    if (mistakes) this.comeBackSoon(card.character);
    else this.validated.update((v) => new Set(v).add(card.character));
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
   * Every character not yet validated, once per round, in a new random order each round. A missed
   * character is put back a few cards later, so it comes back soon.
   */
  private pick(): CharacterEntry | null {
    const validated = this.validated();
    const list = this.reviewList().filter((c) => !validated.has(c.character));
    if (!list.length) return null;
    const known = new Set(list.map((c) => c.character));
    this.deck = this.deck.filter((character) => known.has(character));
    if (!this.deck.length) {
      this.deck = shuffle(list.map((c) => c.character));
      // Not the same character twice in a row when a new round starts.
      if (this.deck.length > 1 && this.deck[0] === this.card()?.character) {
        this.deck.push(this.deck.shift()!);
      }
    }
    const character = this.deck.shift()!;
    return list.find((c) => c.character === character) ?? null;
  }

  private comeBackSoon(character: string): void {
    this.deck = this.deck.filter((c) => c !== character);
    const position = Math.min(this.deck.length, 3 + Math.floor(Math.random() * 4));
    this.deck.splice(position, 0, character);
  }
}
