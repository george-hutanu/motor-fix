import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import type { PublicGarageDto } from '@motor-fix/data-access';
import {
  formatDuration,
  formatWholeLeiRange,
  I18n,
  TranslatePipe,
} from '@motor-fix/i18n';
import { HlmSwitch } from '@motor-fix/ui-cockpit';

import { PriceSelection } from '../price-selection/price-selection';

// The garage's price list on its profile. A switch marks a job the driver
// needs; its state is the page's shared selection, which the estimate box
// adds up, keyed by job, so a re-read keeps the jobs still listed and forgets
// the ones that left.
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
    this.i18n.t('public.garageProfile.prices.title'),
  );
  protected readonly labour = computed(() => {
    const labour = this.garage().labour;
    return labour
      ? this.i18n.t('public.garageProfile.prices.labour', {
          range: formatWholeLeiRange(
            labour.fromBani,
            labour.toBani,
            this.i18n.language(),
          ),
        })
      : '';
  });
  protected readonly rows = computed(() => {
    const language = this.i18n.language();
    return this.garage().prices.map((row) => ({
      duration: formatDuration(row.durationMinutes, language),
      id: row.jobTypeId,
      name: language === 'en' ? row.nameEn : row.nameRo,
      range: formatWholeLeiRange(row.fromBani, row.toBani, language),
    }));
  });
  private readonly selection = inject(PriceSelection);
  protected readonly on = this.selection.on;

  protected toggle(id: string, checked: boolean) {
    this.selection.toggle(id, checked);
  }
}
