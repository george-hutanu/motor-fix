import { Component, computed, inject, signal, viewChild } from '@angular/core';
import type { Period } from '@motor-fix/contracts/figure-choices';
import { formatNum, formatPct, I18n } from '@motor-fix/i18n';

import { AdminDemand } from '../admin-demand/admin-demand';
import { AdminGrowth } from '../admin-growth/admin-growth';
import { AdminLog } from '../admin-log/admin-log';
import { AdminOverview } from '../admin-overview';
import { AdminQueue } from '../admin-queue/admin-queue';
import { AdminReviews } from '../admin-reviews/admin-reviews';

type Figures = NonNullable<ReturnType<AdminOverview['figures']>>;
type Figure = Exclude<keyof Figures, 'observabilityUrl'>;

interface Tile {
  label: string;
  state: 'loading' | 'value' | 'failed';
  number?: string;
  line?: string;
  name: string;
}

// In a chosen period the lines count from its start; `today`
// has no active-drivers line, its start row being the same day.
const inPeriod = (f: Figures) => f.period !== 'default';
const sinceStart = (now: number, start: number | undefined) =>
  start === undefined ? null : now - start;
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
  { key: 'requestsSent' },
  { key: 'answerRate', none: 'answerRateNone', percent: true },
  { key: 'bookings' },
  {
    key: 'activeDrivers',
    line: (f) => {
      if (!inPeriod(f))
        return sinceStart(f.activeDrivers, f.activeDriversMonthStart);
      if (f.period === 'today') return null;
      return sinceStart(f.activeDrivers, f.activeDriversPeriodStart);
    },
  },
];

const MISSING = '—';

@Component({
  host: { '[attr.aria-busy]': "regionBusy() ? 'true' : null" },
  imports: [AdminDemand, AdminGrowth, AdminLog, AdminQueue, AdminReviews],
  selector: 'mf-admin-panel',
  styleUrl: './admin-panel.css',
  templateUrl: './admin-panel.html',
})
export class AdminPanel {
  private readonly overview = inject(AdminOverview);
  private readonly i18n = inject(I18n);
  // The label of the failed tile whose reason shows: one at a time, opened
  // and closed by a press, never by focus alone.
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
    return TILES.map((tile): Tile => {
      const label = this.t(tile.key);
      if (figures) return this.shown(label, tile, figures);
      if (loading) return { label, name: label, state: 'loading' };
      return this.failed(label);
    }).concat(this.reported(loading));
  });

  // The reported reviews: the platform's count, whatever the choice, with
  // the ones past 48 hours as its line.
  private reported(loading: boolean): Tile {
    const label = this.t('reportedReviews');
    const pending = this.overview.pending();
    if (pending === undefined) {
      if (loading) return { label, name: label, state: 'loading' };
      return this.failed(label);
    }
    const language = this.i18n.language();
    const number = formatNum(pending, language);
    const overdue = this.overview.overdue() ?? 0;
    const line =
      overdue > 0
        ? this.i18n.t('admin.panel.overdue', {
            count: overdue,
            n: formatNum(overdue, language),
          })
        : undefined;
    return {
      label,
      line,
      name: [label, number, line].filter(Boolean).join(', '),
      number,
      state: 'value',
    };
  }

  protected readonly why = computed(() => this.t('why'));

  protected toggle(label: string) {
    this.tip.update((open) => (open === label ? null : label));
  }

  // A failed tile's reason joins its name only while its tip shows.
  protected nameOf(tile: Tile) {
    return tile.state === 'failed' && this.tip() === tile.label
      ? `${tile.name}, ${tile.line}`
      : tile.name;
  }

  private t(key: string, params?: Record<string, string>) {
    return this.i18n.t(`admin.panel.${key}`, params);
  }

  // A released figure, or its line when the answer leaves the figure out.
  private shown(
    label: string,
    { key, line, none, percent }: (typeof TILES)[number],
    figures: Figures,
  ): Tile {
    const figure = figures[key as Figure] as number | undefined;
    if (figure === undefined && none) {
      const text = this.t(none);
      const name = `${label}, ${MISSING}, ${text}`;
      return { label, line: text, name, number: MISSING, state: 'value' };
    }
    const change = line ? line(figures) : null;
    return this.value(label, figure, change, figures.period, percent);
  }

  private failed(label: string): Tile {
    const line = this.t('unavailable');
    return {
      label,
      line,
      name: `${label}, ${MISSING}`,
      number: MISSING,
      state: 'failed',
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
