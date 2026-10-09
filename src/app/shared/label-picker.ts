import {
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { LABEL_COLORS, LABEL_MAX_LENGTH } from '../core/character.model';
import { errorMessage } from '../core/characters.service';
import { LabelsService, sortLabels } from '../core/labels.service';

/**
 * Dropdown of your labels, with "+ New label…" and the label's colour:
 * <app-label-picker [value]="…" (changed)="…" />
 */
@Component({
  selector: 'app-label-picker',
  host: { class: 'label-picker' },
  template: `
    @if (adding()) {
      <input
        type="color"
        title="Colour of the label"
        [value]="newColor()"
        (input)="newColor.set($any($event.target).value)"
      />
      <input
        #name
        placeholder="New label (HSK 1, food…)"
        [maxLength]="maxLength"
        (keydown.enter)="$event.preventDefault(); create(name.value)"
        (keydown.escape)="adding.set(false)"
      />
      <button type="button" (click)="create(name.value)">OK</button>
      <button type="button" (click)="adding.set(false)">Cancel</button>
    } @else {
      @if (value(); as label) {
        <input
          type="color"
          title="Colour of {{ label }} (for all its characters)"
          [value]="labels.colorOf(label)"
          [disabled]="disabled()"
          (change)="setColor(label, $any($event.target).value)"
        />
      }
      <select [disabled]="disabled()" (change)="pick($any($event.target))">
        <option value="" [selected]="!value()">— no label —</option>
        @for (l of options(); track l) {
          <option [value]="'=' + l" [selected]="l === value()">{{ l }}</option>
        }
        <option value="new">+ New label…</option>
      </select>
    }
    @if (error(); as e) {
      <span class="error">{{ e }}</span>
    }
  `,
})
export class LabelPicker {
  readonly value = input<string | undefined>();
  readonly disabled = input(false);
  /** The chosen label, '' for none. */
  readonly changed = output<string>();

  protected readonly labels = inject(LabelsService);
  private readonly injector = inject(Injector);
  private readonly nameInput = viewChild<ElementRef<HTMLInputElement>>('name');

  protected readonly maxLength = LABEL_MAX_LENGTH;
  protected readonly adding = signal(false);
  protected readonly newColor = signal(LABEL_COLORS[0]);
  protected readonly error = signal('');
  /** Your labels, plus the current one if it's new (not saved yet). */
  protected readonly options = computed(() => sortLabels([...this.labels.names(), this.value()]));

  protected pick(select: HTMLSelectElement): void {
    this.error.set('');
    if (select.value !== 'new') return this.changed.emit(select.value.slice(1));
    // A colour no label has yet, if there is one.
    const used = new Set(this.labels.names().map((name) => this.labels.colorOf(name)));
    const count = this.labels.names().length;
    this.newColor.set(
      LABEL_COLORS.find((c) => !used.has(c)) ?? LABEL_COLORS[count % LABEL_COLORS.length],
    );
    this.adding.set(true);
    afterNextRender(() => this.nameInput()?.nativeElement.focus(), { injector: this.injector });
  }

  /** Stores the new label with its colour, then selects it. */
  protected async create(name: string): Promise<void> {
    const label = name.trim();
    this.adding.set(false);
    if (!label) return;
    await this.setColor(label, this.newColor());
    this.changed.emit(label);
  }

  protected async setColor(name: string, color: string): Promise<void> {
    this.error.set('');
    try {
      await this.labels.save({ name, color });
    } catch (err) {
      this.error.set(`Could not save the colour: ${errorMessage(err)}`);
    }
  }
}
