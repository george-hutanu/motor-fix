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
  timeLeft,
} from '@motor-fix/i18n';

// A request the garage answered: who, the car, the jobs the quote includes,
// the range, the proposed start in Bucharest time and the driver's answer.
// Once the driver accepts, the row waits for the garage's confirmation, with
// the time left and the driver's phone when the reader may call.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.accepted]': 'accepted()' },
  imports: [TranslatePipe],
  selector: 'li[mfQuoteSentRow]',
  styleUrl: './quote-sent-row.css',
  templateUrl: './quote-sent-row.html',
})
export class QuoteSentRow {
  readonly row = input.required<GarageRequestSummaryDto>({
    alias: 'mfQuoteSentRow',
  });
  // "azi" and "mâine" and the time left move with the clock.
  readonly now = input<Date>();
  private readonly language = inject(I18n).language;

  protected readonly accepted = computed(() => {
    const { booking, quote } = this.row();
    return (
      quote?.status === 'accepted' &&
      booking?.status === 'awaiting_confirmation'
    );
  });
  protected readonly left = computed(() =>
    timeLeft(
      this.row().booking?.confirmBy,
      this.language(),
      this.now() ?? new Date(),
    ),
  );

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
