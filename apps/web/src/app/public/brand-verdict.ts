import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import type { GarageBrandAnswerDto } from '@motor-fix/data-access';
import { AsWritten, I18n, TranslatePipe } from '@motor-fix/i18n';
import { Lamp, type LampState } from '@motor-fix/ui-cockpit';

export type Verdict = 'works_on' | 'refused';

// A garage works on a brand only when it said so; a refusal, or no answer at
// all for that brand, reads as "does not take". Works-on wins a tie.
export function verdict(
  answer: GarageBrandAnswerDto,
  brandId: string,
): Verdict {
  return answer.worksOn.some((brand) => brand.id === brandId)
    ? 'works_on'
    : 'refused';
}

const names = (brands: { name: string }[]) =>
  brands.map((brand) => brand.name).join(', ');

const written = (value: string | null | undefined) =>
  value?.trim() ? value.trim() : null;

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AsWritten, Lamp, TranslatePipe],
  selector: 'mf-brand-verdict',
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--mf-space-2);
      min-width: 0;
      color: var(--mf-text);
      font-family: var(--mf-font-body);
    }
    .line,
    .note {
      margin: 0;
      font-size: var(--mf-size-small);
      overflow-wrap: anywhere;
    }
    .line {
      color: var(--mf-text);
    }
    .label {
      font-weight: 600;
    }
    .note {
      color: var(--mf-text-secondary);
    }
    .note.card {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  `,
  template: `
    @if (lamp(); as lamp) {
      <mf-lamp [state]="lamp.state" [label]="lamp.label" />
    }
    @if (answer(); as answer) {
      @if (worksOn() || nothing()) {
        <p class="line">
          <span class="label">{{ 'public.verdict.worksOnList' | t }}</span>
          @if (worksOn(); as list) {
            <mf-as-written [text]="list" />
          } @else {
            {{ 'public.verdict.none' | t }}
          }
        </p>
      }
      @if (refused() || nothing()) {
        <p class="line">
          <span class="label">{{ 'public.verdict.refusedList' | t }}</span>
          @if (refused(); as list) {
            <mf-as-written [text]="list" />
          } @else {
            {{ 'public.verdict.none' | t }}
          }
        </p>
      }
      @if (note(); as note) {
        <p class="note" [class.card]="mode() === 'card'" [attr.title]="mode() === 'card' ? note : null">
          <mf-as-written [text]="note" />
        </p>
      }
    }
  `,
})
export class BrandVerdict {
  readonly answer = input<GarageBrandAnswerDto | null>(null);
  readonly brand = input<{ id: string; name: string } | null>(null);
  readonly mode = input<'card' | 'profile'>('profile');

  private readonly i18n = inject(I18n);

  constructor() {
    void this.i18n.enter('public');
  }

  protected readonly lamp = computed<{
    label: string;
    state: LampState;
  } | null>(() => {
    const answer = this.answer();
    const brand = this.brand();
    if (!answer) {
      return { label: this.i18n.t('public.verdict.loading'), state: 'grey' };
    }
    if (!brand) return null;
    return verdict(answer, brand.id) === 'works_on'
      ? {
          label: this.i18n.t('public.verdict.worksOn', { brand: brand.name }),
          state: 'green',
        }
      : {
          label: this.i18n.t('public.verdict.refused', { brand: brand.name }),
          state: 'red',
        };
  });

  protected readonly worksOn = computed(() => {
    const answer = this.answer();
    return answer?.worksOn.length ? names(answer.worksOn) : null;
  });

  protected readonly refused = computed(() => {
    const answer = this.answer();
    if (!answer) return null;
    return (
      written(answer.refusalPhrase) ??
      (answer.doesNotTake.length ? names(answer.doesNotTake) : null)
    );
  });

  // Nothing marked at all: both lines stay, each saying so.
  protected readonly nothing = computed(
    () => !!this.answer() && !this.worksOn() && !this.refused(),
  );

  protected readonly note = computed(() => written(this.answer()?.brandNote));
}
