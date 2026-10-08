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

type Verdict = 'works_on' | 'refused';

type Named = { id: string; name: string };

// What the lamp and the lists read of a garage's answer about its brands.
export type BrandAnswer = Pick<
  GarageBrandAnswerDto,
  'brandNote' | 'refusalPhrase'
> & { worksOn: Named[]; doesNotTake: Named[] };

// A garage works on a brand only when it said so; a refusal, or no answer at
// all for that brand, reads as "does not take". Works-on wins a tie.
export function verdict(answer: BrandAnswer, brandId: string): Verdict {
  return answer.worksOn.some((brand) => brand.id === brandId)
    ? 'works_on'
    : 'refused';
}

const names = (brands: { name: string }[]) =>
  brands.map((brand) => brand.name).join(', ');

export const written = (value: string | null | undefined) =>
  value?.trim() ? value.trim() : null;

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AsWritten, Lamp, TranslatePipe],
  selector: 'mf-brand-verdict',
  styleUrl: './brand-verdict.css',
  templateUrl: './brand-verdict.html',
})
export class BrandVerdict {
  readonly answer = input<BrandAnswer | null>(null);
  readonly brand = input<{ id: string; name: string } | null>(null);
  readonly mode = input<'card' | 'profile'>('card');

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

  protected readonly nothing = computed(
    () => !!this.answer() && !this.worksOn() && !this.refused(),
  );

  protected readonly note = computed(() => written(this.answer()?.brandNote));
}
