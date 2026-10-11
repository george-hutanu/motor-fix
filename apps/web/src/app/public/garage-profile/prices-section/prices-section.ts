import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  linkedSignal,
} from '@angular/core';
import type { PublicGarageDto } from '@motor-fix/data-access';
import {
  formatDuration,
  formatLeiRange,
  I18n,
  type Language,
  TranslatePipe,
} from '@motor-fix/i18n';
import { HlmSwitch } from '@motor-fix/ui-cockpit';

// Ranges read in whole lei: an amount in bani is rounded to the nearest leu
// before it is written.
const leiRange = (fromBani: number, toBani: number, language: Language) =>
  formatLeiRange(
    Math.round(fromBani / 100) * 100,
    Math.round(toBani / 100) * 100,
    language,
  );

// The garage's price list on its profile. A switch marks a job the driver
// needs; its state lives only in the open page, keyed by job, so a re-read
// keeps the jobs still listed and forgets the ones that left.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.aria-label]': 'label()' },
  imports: [HlmSwitch, TranslatePipe],
  selector: 'section[mf-prices-section]',
  styleUrl: './prices-section.css',
  templateUrl: './prices-section.html',
})
export class PricesSection {
  readonly garage = input.required<PublicGarageDto>();

  private readonly i18n = inject(I18n);

  protected readonly label = computed(() =>
    this.i18n.t('public.garageProfile.prices.label'),
  );
  protected readonly labour = computed(() => {
    const labour = this.garage().labour;
    return labour
      ? this.i18n.t('public.garageProfile.prices.labour', {
          range: leiRange(labour.fromBani, labour.toBani, this.i18n.language()),
        })
      : '';
  });
  protected readonly rows = computed(() => {
    const language = this.i18n.language();
    return this.garage().prices.map((row) => ({
      duration: formatDuration(row.durationMinutes, language),
      id: row.jobTypeId,
      name: language === 'en' ? row.nameEn : row.nameRo,
      range: leiRange(row.fromBani, row.toBani, language),
    }));
  });
  protected readonly on = linkedSignal<string[], Set<string>>({
    computation: (ids, previous) =>
      new Set(ids.filter((id) => previous?.value.has(id))),
    source: () => this.garage().prices.map((row) => row.jobTypeId),
  });

  protected toggle(id: string, checked: boolean) {
    this.on.update((on) => {
      const next = new Set(on);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }
}
