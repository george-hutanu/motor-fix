import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
} from '@angular/core';
import type {
  CompareBookingDto,
  CompareQuoteDto,
} from '@motor-fix/data-access';
import {
  formatDuration,
  formatLeiRange,
  formatRating,
  formatSlot,
  I18n,
  relativeTime,
  TranslatePipe,
  timeLeft,
} from '@motor-fix/i18n';
import { HlmButton, Lamp, RatingDial } from '@motor-fix/ui-cockpit';

import type { RowState } from '../compare-rules/compare-rules';

const STATE_TEXTS: Record<Exclude<RowState, 'open'>, string> = {
  accepted: 'driver.quotes.state.accepted',
  booked: 'driver.quotes.state.accepted',
  closed: 'driver.quotes.state.closed',
  declined: 'driver.quotes.state.declined',
  expired: 'driver.quotes.state.expired',
  lapsed: 'driver.quotes.state.lapsed',
  on_hold: 'driver.quotes.state.on_hold',
};

const GREYED: readonly RowState[] = ['expired', 'declined', 'closed', 'lapsed'];

// One garage's answer, read the same way in every row: who, where and when it
// is free, its rating, the price, then Acceptă and Refuză or what became of
// the quote; an accepted quote follows its booking, with a green lamp.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.greyed]': 'greyed()' },
  imports: [HlmButton, Lamp, RatingDial, TranslatePipe],
  selector: 'li[mfQuoteRow]',
  styleUrl: './quote-row.css',
  templateUrl: './quote-row.html',
})
export class QuoteRow {
  readonly quote = input.required<CompareQuoteDto>({ alias: 'mfQuoteRow' });
  readonly state = input<RowState>('open');
  // "azi", "mâine" and "acum 5 minute" move with the clock.
  readonly now = input<Date>();
  // The request's newest booking, read for an accepted quote's line.
  readonly booking = input<CompareBookingDto | null>(null);
  readonly locked = input(false);
  readonly accept = output<string>();
  readonly decline = output<string>();

  private readonly language = inject(I18n).language;
  private readonly clock = computed(() => this.now() ?? new Date());

  protected readonly stateText = computed(() => {
    const state = this.state();
    return state === 'open' ? '' : STATE_TEXTS[state];
  });
  protected readonly greyed = computed(() => GREYED.includes(this.state()));
  protected readonly lit = computed(() =>
    ['accepted', 'booked'].includes(this.state()),
  );
  protected readonly declinable = computed(() =>
    ['open', 'on_hold'].includes(this.state()),
  );
  // Under an accepted quote: the time the garage has left to confirm, or the
  // booked day and hour with the mechanic once it did.
  protected readonly bookingLine = computed(() => {
    const booking = this.booking();
    const state = this.state();
    if (!booking || (state !== 'accepted' && state !== 'booked')) return null;
    const language = this.language();
    const params: Record<string, string> =
      state === 'accepted'
        ? { left: timeLeft(booking.confirmBy, language, this.clock()) }
        : { slot: formatSlot(booking.startsAt, language, this.clock()) };
    if (state === 'accepted')
      return { key: 'driver.quotes.line.waiting', params };
    if (!booking.mechanicName)
      return { key: 'driver.quotes.line.booked', params };
    params['mechanic'] = booking.mechanicName;
    return { key: 'driver.quotes.line.bookedWith', params };
  });
  protected readonly slot = computed(() =>
    formatSlot(this.quote().slot, this.language(), this.clock()),
  );
  protected readonly rating = computed(() =>
    formatRating(this.quote().garage.rating, this.language()),
  );
  protected readonly price = computed(() =>
    formatLeiRange(this.quote().fromBani, this.quote().toBani, this.language()),
  );
  protected readonly duration = computed(() =>
    formatDuration(this.quote().durationMinutes, this.language()),
  );
  protected readonly changed = computed(() => {
    const at = this.quote().changedAt;
    return at ? relativeTime(at, this.language(), this.clock()) : null;
  });
  protected readonly missing = computed(() => {
    const english = this.language() === 'en';
    return this.quote()
      .jobs.filter((job) => !job.included)
      .map((job) => (english ? job.nameEn : job.nameRo))
      .join(', ');
  });

  protected take() {
    if (!this.locked()) this.accept.emit(this.quote().id);
  }

  protected refuse() {
    if (!this.locked()) this.decline.emit(this.quote().id);
  }
}
