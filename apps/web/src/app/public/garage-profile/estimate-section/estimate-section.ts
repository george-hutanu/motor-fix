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
  formatNum,
  formatWholeLeiRange,
  I18n,
  TranslatePipe,
} from '@motor-fix/i18n';
import { Odometer } from '@motor-fix/ui-cockpit';

import { PriceSelection } from '../price-selection/price-selection';
import { estimateTotals } from '../price-selection/totals';
import { RequestQuoteButton } from '../request-quote-button/request-quote-button';

// "Estimarea ta": the jobs switched on in the price list, added up into a
// range in digit cells, and a request button that takes them to the dialog.
// The ranges already carry the brand in context. One polite live region says
// what changed: nothing on load, the totals or the empty text after a switch,
// a job the latest read no longer lists until the next switch, and where a
// request went until the next switch.
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
  private readonly totals = computed(() =>
    estimateTotals(this.garage().prices, this.selection.on()),
  );
  private readonly chosen = computed(() => this.totals().chosen);
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
  protected readonly from = computed(() => this.totals().fromLei);
  protected readonly to = computed(() => this.totals().toLei);
  protected readonly spoken = computed(() => {
    const language = this.i18n.language();
    return this.i18n.t('public.garageProfile.estimate.spoken', {
      from: formatNum(this.from(), language),
      to: formatNum(this.to(), language),
    });
  });
  // The request button's sent line, cleared by the next switch change.
  protected readonly sentSaid = linkedSignal({
    computation: () => '',
    source: this.selection.on,
  });
  protected readonly said = computed(() => {
    if (this.sentSaid()) return this.sentSaid();
    if (this.selection.dropped())
      return this.i18n.t('public.garageProfile.estimate.dropped');
    if (!this.selection.touched()) return '';
    return this.chosen().length
      ? this.spoken()
      : this.i18n.t('public.garageProfile.estimate.empty');
  });
}
