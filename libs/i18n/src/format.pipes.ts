import { inject, Pipe, PipeTransform } from '@angular/core';

import {
  formatClock,
  formatDay,
  formatKm,
  formatLei,
  formatLeiRange,
  formatNum,
  formatPct,
  formatRating,
} from './formats';
import { I18n } from './i18n';

// Impure, like the t pipe, so a language switch re-formats in place.

@Pipe({ name: 'lei', pure: false })
export class LeiPipe implements PipeTransform {
  private readonly i18n = inject(I18n);

  // `{{ from | lei: to }}` is a range even when `to` is missing.
  transform(bani: unknown, ...to: unknown[]): string {
    const language = this.i18n.language();
    return to.length === 0
      ? formatLei(bani, language)
      : formatLeiRange(bani, to[0], language);
  }
}

@Pipe({ name: 'rating', pure: false })
export class RatingPipe implements PipeTransform {
  private readonly i18n = inject(I18n);

  transform(value: unknown): string {
    return formatRating(value, this.i18n.language());
  }
}

@Pipe({ name: 'num', pure: false })
export class NumPipe implements PipeTransform {
  private readonly i18n = inject(I18n);

  transform(value: unknown): string {
    return formatNum(value, this.i18n.language());
  }
}

@Pipe({ name: 'km', pure: false })
export class KmPipe implements PipeTransform {
  private readonly i18n = inject(I18n);

  transform(value: unknown): string {
    return formatKm(value, this.i18n.language());
  }
}

@Pipe({ name: 'pct', pure: false })
export class PctPipe implements PipeTransform {
  private readonly i18n = inject(I18n);

  transform(value: unknown): string {
    return formatPct(value, this.i18n.language());
  }
}

@Pipe({ name: 'day', pure: false })
export class DayPipe implements PipeTransform {
  private readonly i18n = inject(I18n);

  transform(value: unknown): string {
    return formatDay(value, this.i18n.language());
  }
}

// Pure: the clock reads the same in both languages.
@Pipe({ name: 'clock' })
export class ClockPipe implements PipeTransform {
  transform(value: unknown): string {
    return formatClock(value);
  }
}
