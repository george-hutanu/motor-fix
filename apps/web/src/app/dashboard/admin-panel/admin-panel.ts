import { Component, computed, inject, signal, viewChild } from '@angular/core';
import type { Period } from '@motor-fix/contracts/figure-choices';
import { formatNum, formatPct, I18n } from '@motor-fix/i18n';

import { AdminGrowth } from '../admin-growth/admin-growth';
import { AdminOverview } from '../admin-overview';

type Figures = NonNullable<ReturnType<AdminOverview['figures']>>;
type Figure = Exclude<keyof Figures, 'observabilityUrl'>;

interface Tile {
  label: string;
  state: 'loading' | 'value' | 'failed' | 'soon';
  number?: string;
  line?: string;
  name: string;
}

// The figures with no data behind them yet show "în curând" until their
// stories ship them.
// In a chosen period the lines count from its start; `today`
// has no active-drivers line, its start row being the same day.
const inPeriod = (f: Figures) => f.period !== 'default';
const sinceStart = (now: number, start: number | undefined) =>
  start === undefined ? null : now - start;
const NO_LINE = () => null;
const TILES: readonly {
  key: string;
  line?: (f: Figures) => number | null;
  percent?: true;
  // The line in place of a figure the answer leaves out.
  none?: string;
}[] = [
  {
    key: 'garagesListed',
    line: (f) =>
      inPeriod(f)
        ? (f.garagesApprovedInPeriod ?? null)
        : f.garagesApprovedThisMonth,
  },
  { key: 'requestsSent', line: NO_LINE },
  { key: 'answerRate', line: NO_LINE, none: 'answerRateNone', percent: true },
  { key: 'bookings', line: NO_LINE },
  {
    key: 'activeDrivers',
    line: (f) => {
      if (!inPeriod(f))
        return sinceStart(f.activeDrivers, f.activeDriversMonthStart);
      if (f.period === 'today') return null;
      return sinceStart(f.activeDrivers, f.activeDriversPeriodStart);
    },
  },
  { key: 'reportedReviews' },
];

const MISSING = '—';

@Component({
  host: { '[attr.aria-busy]': "regionBusy() ? 'true' : null" },
  imports: [AdminGrowth],
  selector: 'mf-admin-panel',
  styleUrl: './admin-panel.css',
  templateUrl: './admin-panel.html',
})
export class AdminPanel {
  private readonly overview = inject(AdminOverview);
  private readonly i18n = inject(I18n);
  protected readonly tip = signal<string | null>(null);

  // The figures are on their way: the first read or a new choice's.
  protected readonly busy = computed(
    () =>
      (this.overview.loading() || this.overview.figuresLoading()) &&
      !this.overview.failed(),
  );

  // The region is busy until every read in it has answered, the growth's too.
  private readonly growth = viewChild(AdminGrowth);
  protected readonly regionBusy = computed(
    () => this.busy() || (this.growth()?.loading() ?? false),
  );

  protected readonly observability = computed(() => {
    const url = this.overview.figures()?.observabilityUrl;
    if (!url) return undefined;
    const name = this.t('observability');
    return { label: this.t('observabilityNewTab', { name }), name, url };
  });

  protected readonly tiles = computed(() => {
    const figures = this.overview.figures();
    const loading = this.busy();
    return TILES.map(({ key, line, none, percent }): Tile => {
      const label = this.t(key);
      if (!line) return this.missing(label, 'soon', this.t('soon'));
      if (figures) {
        const figure = figures[key as Figure] as number | undefined;
        if (figure === undefined && none)
          return this.missing(label, 'none', this.t(none));
        return this.value(
          label,
          figure,
          line(figures),
          figures.period,
          percent,
        );
      }
      if (loading) return { label, name: label, state: 'loading' };
      return this.missing(label, 'failed', this.t('unavailable'));
    });
  });

  private t(key: string, params?: Record<string, string>) {
    return this.i18n.t(`admin.panel.${key}`, params);
  }

  private missing(
    label: string,
    state: 'soon' | 'failed' | 'none',
    line: string,
  ): Tile {
    const name =
      state === 'soon' ? `${label}, ${line}` : `${label}, ${MISSING}, ${line}`;
    return {
      label,
      line,
      name,
      number: MISSING,
      state: state === 'none' ? 'value' : state,
    };
  }

  private value(
    label: string,
    figure: number | undefined,
    change: number | null,
    period: Period,
    percent?: true,
  ): Tile {
    const language = this.i18n.language();
    const number = (percent ? formatPct : formatNum)(figure, language);
    const line = change === null ? undefined : this.line(change, period);
    return {
      label,
      line,
      name: [label, number, line].filter(Boolean).join(', '),
      number,
      state: 'value',
    };
  }

  // "+3 luna asta" by default, "+3 în ultimele 7 zile" in a chosen period.
  private line(change: number, period: Period) {
    const params = {
      n: formatNum(Math.abs(change), this.i18n.language()),
      sign: change < 0 ? '−' : '+',
    };
    if (period === 'default') return this.t('thisMonth', params);
    return this.t('inPeriod', {
      ...params,
      period: this.i18n.t(`shell.frame.admin.period.line.${period}`),
    });
  }

  constructor() {
    void this.i18n.enter('admin');
  }
}
