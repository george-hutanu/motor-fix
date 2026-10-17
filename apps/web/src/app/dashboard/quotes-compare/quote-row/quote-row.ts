import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
} from '@angular/core';
import type { CompareQuoteDto } from '@motor-fix/data-access';
import {
  formatDuration,
  formatLeiRange,
  formatRating,
  formatSlot,
  I18n,
  relativeTime,
  TranslatePipe,
} from '@motor-fix/i18n';
import { HlmButton } from '@motor-fix/ui-cockpit';

import type { RowState } from '../compare-rules/compare-rules';

const STATE_TEXTS: Record<Exclude<RowState, 'open'>, string> = {
  accepted: 'driver.quotes.state.accepted',
  closed: 'driver.quotes.state.closed',
  declined: 'driver.quotes.state.declined',
  expired: 'driver.quotes.state.expired',
  on_hold: 'driver.quotes.state.on_hold',
};

// One garage's answer, read the same way in every row: who, where and when it
// is free, its rating, the price, then Acceptă or what became of the quote.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.greyed]': 'greyed()' },
  imports: [HlmButton, TranslatePipe],
  selector: 'li[mfQuoteRow]',
  styleUrl: './quote-row.css',
  templateUrl: './quote-row.html',
})
export class QuoteRow {
  readonly quote = input.required<CompareQuoteDto>({ alias: 'mfQuoteRow' });
  readonly state = input<RowState>('open');
  // "azi", "mâine" and "acum 5 minute" move with the clock.
  readonly now = input<Date>();
  readonly busy = input(false);
  readonly locked = input(false);
  readonly problem = input<string | null>(null);
  readonly accept = output<string>();

  private readonly language = inject(I18n).language;
  private readonly clock = computed(() => this.now() ?? new Date());

  protected readonly stateText = computed(() => {
    const state = this.state();
    return state === 'open' ? '' : STATE_TEXTS[state];
  });
  protected readonly greyed = computed(() =>
    ['expired', 'declined', 'closed'].includes(this.state()),
  );
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

  protected send() {
    if (!this.busy() && !this.locked()) this.accept.emit(this.quote().id);
  }
}
