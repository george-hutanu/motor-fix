import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import type { GarageRequestSummaryDto } from '@motor-fix/data-access';
import {
  formatDeadline,
  formatLeiRange,
  formatSlot,
  I18n,
  quoteExpiry,
  requestAge,
  TranslatePipe,
} from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';
import { HlmButton } from '@motor-fix/ui-cockpit';

import { garageOf, Session } from '../../session';
import { GarageRequestsFeed } from '../garage-requests-feed';
import { confirmBooking } from '../request-actions';

type Outcome = NonNullable<GarageRequestSummaryDto['outcome']>;

// A quote that still waits or waits for the garage is amber, a booked one
// green, every ending grey.
const TONES: Partial<Record<Outcome, 'amber' | 'green'>> = {
  accepted: 'amber',
  booked: 'green',
  waiting: 'amber',
};

interface OutcomeTag {
  label: string;
  // The deadline or the slot the tag ends on, as written and as the instant.
  when?: string;
  at?: string;
}

// The tag of a sent quote, read from the outcome the server computed and
// nothing else: the confirm-by time of an accepted quote, the slot of a
// booked one.
export function outcomeTag(
  row: GarageRequestSummaryDto,
  i18n: I18n,
  now: Date,
): OutcomeTag | null {
  const { booking, outcome } = row;
  if (!outcome) return null;
  const label = i18n.t(`garage.quotes.sentList.outcome.${outcome}`);
  const language = i18n.language();
  if (outcome === 'accepted') {
    const at = booking?.confirmBy;
    return { at, label, when: formatDeadline(at, language, now) };
  }
  if (outcome === 'booked') {
    const at = booking?.startsAt;
    return { at, label, when: formatSlot(at, language, now) };
  }
  return { label };
}

export const spokenTag = (tag: OutcomeTag | null) =>
  tag && (tag.when ? `${tag.label} ${tag.when}` : tag.label);

// A request the garage answered: who, the car, when the quote was sent, the
// jobs it includes, the range, the proposed start in Bucharest time and what
// became of it, as a tag with a lamp. A waiting quote says when it expires;
// an accepted one carries the driver's phone when the reader may call and,
// for an owner or a receptionist, the button that confirms it; a booked one
// names its mechanic, lift, the phone and the car's plate. An ending carries
// neither button nor phone.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-tone]': 'tone()' },
  imports: [HlmButton, TranslatePipe],
  selector: 'li[mfQuoteSentRow]',
  styleUrl: './quote-sent-row.css',
  templateUrl: './quote-sent-row.html',
})
export class QuoteSentRow {
  readonly row = input.required<GarageRequestSummaryDto>({
    alias: 'mfQuoteSentRow',
  });
  // "azi" and "mâine", the age and the expiry move with the clock.
  readonly now = input<Date>();
  private readonly i18n = inject(I18n);
  private readonly language = this.i18n.language;
  private readonly session = inject(Session);
  private readonly overlays = inject(Overlays);
  private readonly feed = inject(GarageRequestsFeed, { optional: true });
  private readonly clock = computed(() => this.now() ?? new Date());

  protected readonly outcome = computed(() => this.row().outcome);
  protected readonly tone = computed(() => {
    const outcome = this.outcome();
    return outcome ? (TONES[outcome] ?? 'grey') : null;
  });
  protected readonly tag = computed(() =>
    outcomeTag(this.row(), this.i18n, this.clock()),
  );
  protected readonly sent = computed(() =>
    requestAge(this.row().quote?.sentAt, this.language(), this.clock()),
  );
  protected readonly expires = computed(() =>
    quoteExpiry(this.row().quote?.expiresAt, this.language(), this.clock()),
  );
  protected readonly callable = computed(
    () => this.outcome() === 'accepted' || this.outcome() === 'booked',
  );
  protected readonly canConfirm = computed(() => {
    const me = this.session.shown();
    const role = me?.garageAccess ? garageOf(me)?.role : null;
    return (
      this.outcome() === 'accepted' &&
      (role === 'owner' || role === 'receptionist')
    );
  });
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
    formatSlot(this.row().quote?.slot, this.language(), this.clock()),
  );

  protected confirm() {
    void confirmBooking(this.overlays, this.feed, this.row());
  }
}
