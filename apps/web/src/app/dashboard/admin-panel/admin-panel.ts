import { Component, computed, inject, signal } from '@angular/core';
import { formatNum, I18n } from '@motor-fix/i18n';

import { AdminGrowth } from '../admin-growth/admin-growth';
import { AdminOverview } from '../admin-overview';

type Figures = NonNullable<ReturnType<AdminOverview['figures']>>;

interface Tile {
  label: string;
  state: 'loading' | 'value' | 'failed' | 'soon';
  number?: string;
  line?: string;
  name: string;
}

// The figures with no data behind them yet show "în curând" until their
// stories ship them.
const TILES: readonly { key: string; line?: (f: Figures) => number | null }[] =
  [
    { key: 'garagesListed', line: (f) => f.garagesApprovedThisMonth },
    { key: 'requestsToday' },
    { key: 'answerRate' },
    { key: 'bookings' },
    {
      key: 'activeDrivers',
      line: (f) =>
        f.activeDriversMonthStart === undefined
          ? null
          : f.activeDrivers - f.activeDriversMonthStart,
    },
    { key: 'reportedReviews' },
  ];

const MISSING = '—';

@Component({
  imports: [AdminGrowth],
  selector: 'mf-admin-panel',
  styleUrl: './admin-panel.css',
  templateUrl: './admin-panel.html',
})
export class AdminPanel {
  private readonly overview = inject(AdminOverview);
  private readonly i18n = inject(I18n);
  protected readonly tip = signal<string | null>(null);

  protected readonly tiles = computed(() => {
    const figures = this.overview.figures();
    const loading = this.overview.loading() && !this.overview.failed();
    return TILES.map(({ key, line }): Tile => {
      const label = this.t(key);
      if (!line) return this.missing(label, 'soon', this.t('soon'));
      if (figures)
        return this.value(label, figures[key as keyof Figures], line(figures));
      if (loading) return { label, name: label, state: 'loading' };
      return this.missing(label, 'failed', this.t('unavailable'));
    });
  });

  private t(key: string, params?: Record<string, string>) {
    return this.i18n.t(`admin.panel.${key}`, params);
  }

  private missing(label: string, state: 'soon' | 'failed', line: string): Tile {
    const name =
      state === 'soon' ? `${label}, ${line}` : `${label}, ${MISSING}, ${line}`;
    return { label, line, name, number: MISSING, state };
  }

  private value(
    label: string,
    figure: number | undefined,
    change: number | null,
  ): Tile {
    const language = this.i18n.language();
    const number = formatNum(figure, language);
    const line =
      change === null
        ? undefined
        : this.t('thisMonth', {
            n: formatNum(Math.abs(change), language),
            sign: change < 0 ? '−' : '+',
          });
    return {
      label,
      line,
      name: [label, number, line].filter(Boolean).join(', '),
      number,
      state: 'value',
    };
  }

  constructor() {
    void this.i18n.enter('admin');
  }
}
