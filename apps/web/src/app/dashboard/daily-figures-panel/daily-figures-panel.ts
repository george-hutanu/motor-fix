import { _IdGenerator } from '@angular/cdk/a11y';
import { isPlatformBrowser } from '@angular/common';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  Injector,
  inject,
  input,
  PLATFORM_ID,
} from '@angular/core';
import type { EventKind } from '@motor-fix/contracts';
import { GaragesService, type TodayFiguresDto } from '@motor-fix/data-access';
import {
  bucharestDayStart,
  calendarNames,
  formatNum,
  formatRating,
  I18n,
  type Language,
  TranslatePipe,
} from '@motor-fix/i18n';
import { HlmButton } from '@motor-fix/ui-cockpit';
import { asyncScheduler, EMPTY, merge, Observable, throttleTime } from 'rxjs';

import { liveView } from '../../live/view';
import { Live } from '../live';
import { SectionTitle } from '../section-title/section-title';
import { garageOf, Session } from '../session';

// The events that can move one of the four numbers (FR-004).
const KINDS: readonly EventKind[] = [
  'request.created',
  'quote.accepted',
  'booking.confirmed',
  'booking.moved',
  'booking.cancelled',
  'booking.lapsed',
  'booking.no_show_recorded',
  'booking.no_show_withdrawn',
  'booking.completed',
  'job.handed_over',
  'job.final_price_corrected',
  'rating.updated',
  'garage.slots_changed',
  'time_block.created',
  'time_block.updated',
  'time_block.deleted',
  'garage.features_changed',
];
const DAY_MS = 86_400_000;
// A number there is none of, as every format of @motor-fix/i18n writes it.
const MISSING = '—';
// The month of a moment, 1 to 12, on Bucharest's calendar.
const bucharestMonth = new Intl.DateTimeFormat('en', {
  month: 'numeric',
  timeZone: 'Europe/Bucharest',
});
const KEYS = ['requests', 'bookings', 'rating', 'work'] as const;
type Key = (typeof KEYS)[number];

interface Card {
  key: Key;
  label: string;
  value: string;
  note: string | null;
}

// Emits at every midnight in Bucharest, the timer re-armed for each day so a
// clock change still lands on midnight.
function midnights(): Observable<void> {
  return new Observable<void>((subscriber) => {
    let timer: ReturnType<typeof setTimeout>;
    const arm = () => {
      const now = new Date();
      const next = bucharestDayStart(
        new Date(bucharestDayStart(now).getTime() + DAY_MS + 3 * 3_600_000),
      );
      timer = setTimeout(() => {
        subscriber.next();
        arm();
      }, next.getTime() - now.getTime());
    };
    arm();
    return () => clearTimeout(timer);
  });
}

// "Cifrele zilei": requests today against yesterday, bookings this week with
// the next free starts, the rating and the month's estimated work.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HlmButton, SectionTitle, TranslatePipe],
  selector: 'mf-daily-figures-panel',
  styleUrl: './daily-figures-panel.css',
  templateUrl: './daily-figures-panel.html',
})
export class DailyFiguresPanel {
  // The full view the heading links to.
  readonly view = input<string>();
  private readonly api = inject(GaragesService);
  private readonly i18n = inject(I18n);
  private readonly live = inject(Live);
  private readonly session = inject(Session);
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly injector = inject(Injector);
  protected readonly id = inject(_IdGenerator).getId('mf-daily-');
  protected readonly skeletons = [0, 1, 2, 3];

  // Read in the browser only: the server render shows the skeletons. Every
  // change, resync and midnight is one stream, at most one read per 2 s.
  protected readonly figures = isPlatformBrowser(inject(PLATFORM_ID))
    ? liveView(
        () =>
          this.api.garageTodayFigures({
            garageId: garageOf(this.session.shown())?.garageId ?? '',
          }),
        {
          changes: merge(
            this.live.on(KINDS),
            this.live.resync,
            midnights(),
          ).pipe(
            throttleTime(2_000, asyncScheduler, {
              leading: true,
              trailing: true,
            }),
          ),
          goneOn: [],
          resync: EMPTY,
        },
      )
    : undefined;

  protected readonly loading = computed(
    () => this.figures?.isLoading() ?? true,
  );
  protected readonly failed = computed(
    () => this.figures?.error() !== undefined,
  );

  protected readonly cards = computed((): Card[] => {
    const language = this.i18n.language();
    const figures = this.figures?.value();
    if (!figures)
      return KEYS.map((key) => ({
        key,
        label: this.label(key, undefined, language),
        note: null,
        value: MISSING,
      }));
    return KEYS.map((key) => ({
      key,
      label: this.label(key, figures, language),
      ...this.figure(key, figures, language),
    }));
  });

  constructor() {
    void this.i18n.enter('garage');
  }

  protected async retry() {
    await this.figures?.reload();
    afterNextRender(
      () =>
        (this.host.nativeElement as HTMLElement)
          .querySelector<HTMLElement>('[data-card]')
          ?.focus(),
      { injector: this.injector },
    );
  }

  private label(
    key: Key,
    figures: TodayFiguresDto | undefined,
    language: Language,
  ): string {
    if (key !== 'work') return this.i18n.t(`garage.daily.label.${key}`);
    // The read's own month; with no read, this month in Bucharest.
    const index = figures
      ? Number(figures.month.slice(5, 7))
      : Number(bucharestMonth.format(new Date()));
    const month = calendarNames(language).months[index - 1] ?? '';
    return this.i18n.t('garage.daily.label.work', { month });
  }

  private figure(
    key: Key,
    figures: TodayFiguresDto,
    language: Language,
  ): Pick<Card, 'value' | 'note'> {
    const num = (value: number) => formatNum(value, language);
    switch (key) {
      case 'requests':
        return {
          note: this.difference(figures, language),
          value: num(figures.requestsToday),
        };
      case 'bookings':
        return {
          note: this.slots(figures, language),
          value: num(figures.bookingsThisWeek),
        };
      case 'rating':
        return this.rating(figures, language);
      case 'work':
        return {
          note: this.note('work'),
          value: num(Math.round(figures.estimatedWorkBani / 100)),
        };
    }
  }

  private note(name: string, params?: Record<string, string>): string {
    return this.i18n.t(`garage.daily.note.${name}`, params);
  }

  private difference(figures: TodayFiguresDto, language: Language): string {
    const diff = figures.requestsToday - figures.requestsYesterday;
    const n = formatNum(Math.abs(diff), language);
    if (diff > 0) return this.note('more', { n });
    if (diff < 0) return this.note('fewer', { n });
    return this.note('same');
  }

  private rating(
    figures: TodayFiguresDto,
    language: Language,
  ): Pick<Card, 'value' | 'note'> {
    if (figures.rating === null || figures.reviewCount === 0)
      return { note: this.note('noReviews'), value: MISSING };
    return {
      note:
        figures.reviewCount === 1
          ? this.note('review')
          : this.note('reviews', {
              n: formatNum(figures.reviewCount, language),
            }),
      value: formatRating(figures.rating, language),
    };
  }

  private slots(figures: TodayFiguresDto, language: Language): string {
    const t = (name: string, params?: Record<string, string>) =>
      this.note(name, params);
    if (figures.freeSlotsUnavailable)
      return t('today', { n: formatNum(figures.bookingsToday, language) });
    const next = figures.nextFreeSlots;
    if (!next) return t('noSlots');
    const weekday = (new Date(`${next.day}T00:00:00Z`).getUTCDay() + 6) % 7;
    const day = calendarNames(language).days[weekday] ?? '';
    return next.count === 1
      ? t('slot', { day })
      : t('slots', { day, n: formatNum(next.count, language) });
  }
}
