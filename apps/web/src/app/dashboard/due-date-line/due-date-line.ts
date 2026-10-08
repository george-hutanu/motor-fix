import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  daysUntil,
  formatDay,
  formatMonthYear,
  I18n,
  TranslatePipe,
} from '@motor-fix/i18n';
import { Lamp, type LampState } from '@motor-fix/ui-cockpit';

interface DueDateStatus {
  state: LampState;
  days: number | null;
  passed: boolean;
}

interface DueDateLink {
  label: string;
  // The accessible name, when the visible label alone would read the same on
  // every card; it starts with the label so voice control still finds it.
  name?: string;
  params?: Record<string, string>;
  path: string[];
  query: Record<string, string>;
}

function dueDateStatus(expiry: string | null, now: Date): DueDateStatus {
  const days = daysUntil(expiry, now);
  if (days === null) return { days, passed: false, state: 'grey' };
  if (days < 0) return { days, passed: true, state: 'red' };
  if (days <= 7) return { days, passed: false, state: 'red' };
  if (days <= 60) return { days, passed: false, state: 'amber' };
  return { days, passed: false, state: 'green' };
}

// A lamp and a sentence for a date that runs out, such as the ITP. It reads
// the clock on every check rather than once, so a screen left open overnight
// shows the new day the next time anything redraws it. Eager, because the
// default (on push) would skip that check while the inputs stay the same.
@Component({
  changeDetection: ChangeDetectionStrategy.Eager,
  imports: [Lamp, RouterLink, TranslatePipe],
  selector: 'mf-due-date-line',
  styleUrl: './due-date-line.css',
  templateUrl: './due-date-line.html',
})
export class DueDateLine {
  private readonly i18n = inject(I18n);
  readonly expiry = input.required<string | null>();
  readonly keyPrefix = input.required<string>();
  readonly link = input<DueDateLink | null>(null);

  protected status(): DueDateStatus {
    return dueDateStatus(this.expiry(), new Date());
  }

  protected sentence({ days, state }: DueDateStatus): string {
    const key = this.keyPrefix();
    const language = this.i18n.language();
    if (days === null) return this.i18n.t(`${key}.missing`);
    if (days < 0)
      return this.i18n.t(`${key}.expired`, {
        day: formatDay(this.expiry(), language),
      });
    if (days === 0) return this.i18n.t(`${key}.today`);
    if (state === 'green')
      return this.i18n.t(`${key}.valid`, {
        month: formatMonthYear(this.expiry(), language),
      });
    return this.i18n.t(`${key}.days`, { count: days });
  }
}
