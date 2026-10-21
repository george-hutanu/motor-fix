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
import { Overlays } from '@motor-fix/overlays';
import { HlmButton } from '@motor-fix/ui-cockpit';

import { garageOf, Session } from '../../session';
import { GarageRequestsFeed } from '../garage-requests-feed';
import { confirmBooking } from '../request-actions';

// A request the garage answered: who, the car, the jobs the quote includes,
// the range, the proposed start in Bucharest time and the driver's answer.
// Once the driver accepts, the row waits for the garage's confirmation, with
// the time left, the driver's phone when the reader may call and, for an
// owner or a receptionist, the button that confirms it. A confirmed row
// names its slot, mechanic, lift, the phone and the car's plate; a quote the
// driver declined says so until it would have expired.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.accepted]': 'accepted() || booked()',
    '[class.declined]': 'declined()',
  },
  imports: [HlmButton, TranslatePipe],
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
  private readonly session = inject(Session);
  private readonly overlays = inject(Overlays);
  private readonly feed = inject(GarageRequestsFeed, { optional: true });

  protected readonly accepted = computed(() => {
    const { booking, quote } = this.row();
    return (
      quote?.status === 'accepted' &&
      booking?.status === 'awaiting_confirmation'
    );
  });
  protected readonly declined = computed(
    () => this.row().quote?.status === 'declined_by_driver',
  );
  protected readonly booked = computed(
    () => this.row().booking?.status === 'confirmed',
  );
  protected readonly canConfirm = computed(() => {
    const me = this.session.shown();
    const role = me?.garageAccess ? garageOf(me)?.role : null;
    return this.accepted() && (role === 'owner' || role === 'receptionist');
  });
  protected readonly bookedSlot = computed(() =>
    formatSlot(
      this.row().booking?.startsAt,
      this.language(),
      this.now() ?? new Date(),
    ),
  );
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

  protected confirm() {
    void confirmBooking(this.overlays, this.feed, this.row());
  }
}
