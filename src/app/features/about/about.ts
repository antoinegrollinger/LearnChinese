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
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { errorMessage } from '../../core/characters.service';
import {
  FEEDBACK_LIMITS,
  FeedbackKind,
  FeedbackMessage,
  cleanFeedback,
  feedbackErrors,
} from '../../core/feedback.model';
import { FeedbackService } from '../../core/feedback.service';
import { ThemeService } from '../../core/theme.service';
import { MessagePipe, TranslatePipe, t } from '../../core/i18n';
import { SlidingThumb } from '../../shared/directives/sliding-thumb';

export const CONTACT_EMAIL = 'contact@grolltech.be';

/** What the project is, who made it, and the contact and bug report forms (/about, /about?form=bug). */
@Component({
  selector: 'app-about',
  imports: [RouterLink, SlidingThumb, TranslatePipe, MessagePipe],
  templateUrl: './about.html',
})
export class About {
  /** Query parameter: "bug" opens the bug report form. */
  readonly form = input<string>();

  private readonly auth = inject(AuthService);
  private readonly feedback = inject(FeedbackService);
  private readonly theme = inject(ThemeService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  protected readonly email = CONTACT_EMAIL;
  protected readonly limits = FEEDBACK_LIMITS;
  protected readonly loggedIn = computed(() => !!this.auth.user());

  /** The page you came from (for a bug report). */
  private readonly fromPage =
    inject(Router).currentNavigation()?.previousNavigation?.finalUrl?.toString() ?? '';

  protected readonly kind = signal<FeedbackKind>('contact');
  protected readonly draft = signal<FeedbackMessage>(this.emptyDraft());
  protected readonly submitted = signal(false);
  protected readonly sending = signal(false);
  protected readonly status = signal<{ text: string; kind?: 'ok' | 'error' }>({ text: '' });

  protected readonly errors = computed(() =>
    this.submitted() ? feedbackErrors(this.message()) : {},
  );

  /** Bug report: what is added to it, shown to the person before sending. */
  protected readonly context = computed(() => [
    { name: 'Page', value: this.fromPage || '(you came straight to this page)' },
    { name: 'Browser', value: navigator.userAgent },
    {
      name: 'Screen',
      value: `${innerWidth}×${innerHeight}, ${devicePixelRatio}× pixels, ${this.theme.theme()} mode`,
    },
    { name: 'Language', value: navigator.language },
  ]);

  constructor() {
    // /about?form=bug: open the bug report form.
    effect(() => {
      if (this.form() === 'bug') untracked(() => this.kind.set('bug'));
    });
    // Logged in (also once the session is restored): your name and email, unless already typed.
    effect(() => {
      const user = this.auth.user();
      if (!user) return;
      untracked(() =>
        this.draft.update((d) => ({
          ...d,
          name: d.name || user.username || '',
          email: d.email || user.email,
        })),
      );
    });
  }

  private emptyDraft(): FeedbackMessage {
    const user = this.auth.user();
    return {
      kind: 'contact',
      name: user?.username ?? '',
      email: user?.email ?? '',
      subject: '',
      message: '',
      steps: '',
      website: '',
    };
  }

  /** The message as it will be sent. */
  private message(): FeedbackMessage {
    const kind = this.kind();
    const d = this.draft();
    return cleanFeedback({
      ...d,
      kind,
      ...(kind === 'bug'
        ? {
            page: this.fromPage,
            context: this.context()
              .filter((c) => c.name !== 'Page')
              .map((c) => `${c.name}: ${c.value}`)
              .join(' · '),
          }
        : { steps: '' }),
    });
  }

  protected update(field: keyof FeedbackMessage, value: string): void {
    this.draft.update((d) => ({ ...d, [field]: value }));
  }

  /** The buttons at the top: show that form and go to it. */
  protected open(kind: FeedbackKind): void {
    this.setKind(kind);
    afterNextRender(
      () => {
        const form = this.host.nativeElement.querySelector<HTMLElement>('#feedback');
        form?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        form
          ?.querySelector<HTMLElement>('input:not([type=hidden]):not([name=website]), textarea')
          ?.focus({
            preventScroll: true,
          });
      },
      { injector: this.injector },
    );
  }

  protected setKind(kind: FeedbackKind): void {
    this.kind.set(kind);
    this.submitted.set(false);
    this.status.set({ text: '' });
  }

  protected async send(): Promise<void> {
    this.submitted.set(true);
    this.status.set({ text: '' });
    if (Object.keys(feedbackErrors(this.message())).length) return;
    this.sending.set(true);
    try {
      await this.feedback.send(this.message());
      this.status.set({
        text:
          this.kind() === 'bug'
            ? t('Thank you! Your bug report was sent.')
            : t('Thank you! Your message was sent; you will get an answer by email.'),
        kind: 'ok',
      });
      this.draft.set(this.emptyDraft());
      this.submitted.set(false);
    } catch (err) {
      this.status.set({
        text: t('It could not be sent ({error}). You can also write to {email}.', {
          error: errorMessage(err),
          email: CONTACT_EMAIL,
        }),
        kind: 'error',
      });
    } finally {
      this.sending.set(false);
    }
  }
}
