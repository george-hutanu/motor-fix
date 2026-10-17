import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import type { PublicGarageDto } from '@motor-fix/data-access';
import {
  formatNum,
  formatWholeLeiRange,
  I18n,
  TranslatePipe,
} from '@motor-fix/i18n';
import { Odometer } from '@motor-fix/ui-cockpit';

import { PriceSelection } from '../price-selection/price-selection';
import { RequestQuoteButton } from '../request-quote-button/request-quote-button';

// "Estimarea ta": the jobs switched on in the price list, added up into a
// range in digit cells, and a request button that takes them to the dialog.
// The ranges already carry the brand in context. One polite live region says
// what changed: nothing on load, the totals or the empty text after a switch,
// and a job the latest read no longer lists until the next switch.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.aria-label]': 'title()' },
  imports: [Odometer, RequestQuoteButton, TranslatePipe],
  selector: 'section[mf-estimate-section]',
  styleUrl: './estimate-section.css',
  templateUrl: './estimate-section.html',
})
export class EstimateSection {
  readonly garage = input.required<PublicGarageDto>();

  private readonly i18n = inject(I18n);
  protected readonly selection = inject(PriceSelection);

  protected readonly title = computed(() =>
    this.i18n.t('public.garageProfile.estimate.title'),
  );
  private readonly chosen = computed(() => {
    const on = this.selection.on();
    return this.garage().prices.filter((row) => on.has(row.jobTypeId));
  });
  protected readonly jobs = computed(() =>
    this.chosen().map((row) => row.jobTypeId),
  );
  protected readonly rows = computed(() => {
    const language = this.i18n.language();
    return this.chosen().map((row) => ({
      id: row.jobTypeId,
      name: language === 'en' ? row.nameEn : row.nameRo,
      range: formatWholeLeiRange(row.fromBani, row.toBani, language),
    }));
  });
  // Summed in bani, then rounded once to whole lei.
  protected readonly from = computed(() =>
    Math.round(this.chosen().reduce((sum, row) => sum + row.fromBani, 0) / 100),
  );
  protected readonly to = computed(() =>
    Math.round(this.chosen().reduce((sum, row) => sum + row.toBani, 0) / 100),
  );
  protected readonly spoken = computed(() => {
    const language = this.i18n.language();
    return this.i18n.t('public.garageProfile.estimate.spoken', {
      from: formatNum(this.from(), language),
      to: formatNum(this.to(), language),
    });
  });
  protected readonly said = computed(() => {
    if (this.selection.dropped())
      return this.i18n.t('public.garageProfile.estimate.dropped');
    if (this.selection.changes() === 0) return '';
    return this.chosen().length
      ? this.spoken()
      : this.i18n.t('public.garageProfile.estimate.empty');
  });
}
