import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import type { GarageRequestSummaryDto } from '@motor-fix/data-access';
import {
  formatLeiRange,
  formatSlot,
  I18n,
  TranslatePipe,
} from '@motor-fix/i18n';

// A request the garage answered: who, the car, the jobs the quote includes,
// the range, the proposed start in Bucharest time and the driver's answer.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe],
  selector: 'li[mfQuoteSentRow]',
  styleUrl: './quote-sent-row.css',
  templateUrl: './quote-sent-row.html',
})
export class QuoteSentRow {
  readonly row = input.required<GarageRequestSummaryDto>({
    alias: 'mfQuoteSentRow',
  });
  // "azi" and "mâine" move with the clock.
  readonly now = input<Date>();
  private readonly language = inject(I18n).language;

  protected readonly jobs = computed(() => {
    const { jobs, quote } = this.row();
    const included = new Set(
      quote?.jobs.filter((job) => job.included).map((job) => job.requestJobId),
    );
    const english = this.language() === 'en';
    return jobs
      .filter((job) => included.has(job.id))
      .map((job) => (english ? job.nameEn : job.nameRo));
  });
  protected readonly range = computed(() => {
    const quote = this.row().quote;
    return formatLeiRange(quote?.fromBani, quote?.toBani, this.language());
  });
  protected readonly slot = computed(() =>
    formatSlot(
      this.row().quote?.slot,
      this.language(),
      this.now() ?? new Date(),
    ),
  );
}
