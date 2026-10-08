import { isPlatformServer } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  model,
  PLATFORM_ID,
  signal,
} from '@angular/core';
import {
  CLOSED_NOTE_MAX,
  DEFAULT_HOURS,
  FACILITIES,
  type Facility,
  type HoursSection,
  type Interval,
  intervalsError,
  TIMES,
  todayInBucharest,
  WEEKDAYS,
  type Weekday,
  type WeeklyHours,
} from '@motor-fix/contracts/garage-hours';
import {
  type PublicHolidayDto,
  PublicHolidaysService,
} from '@motor-fix/data-access';
import { I18n, TranslatePipe } from '@motor-fix/i18n';
import { HlmInput, HlmLabel, Lamp } from '@motor-fix/ui-cockpit';

import { cut, letters } from '../brands-section';
import {
  addBreak,
  addClosedDay,
  removeBreak,
  removeClosedDay,
  setDay,
  setWeekdays,
  simpleRows,
  toggleClosed,
  toggleFacility,
} from '../hours-section';

// The break a day gets first, moved to the middle of a day it does not fit.
const LUNCH: Interval = ['12:00', '13:00'];
const NEXT_HOLIDAYS = 6;

type RowKey = 'weekdays' | Weekday;
type RowError = 'order' | 'breakOutside';
type Calendar =
  | { state: 'loading' | 'down' }
  | { state: 'ready'; days: PublicHolidayDto[] };

// Step 5 of listing a garage: the weekly hours, the closed days and the
// facilities. It holds the draft's section and saves nothing; nothing is kept
// until the owner changes something.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HlmInput, HlmLabel, Lamp, TranslatePipe],
  selector: 'mf-hours-step',
  styleUrl: './hours-step.css',
  templateUrl: './hours-step.html',
})
export class HoursStep {
  private readonly i18n = inject(I18n);
  private readonly calendarApi = inject(PublicHolidaysService);

  readonly value = model<HoursSection>({});

  protected readonly times = TIMES;
  protected readonly days = WEEKDAYS;
  protected readonly facilities = FACILITIES;

  private readonly opened = signal(false);
  // The days show by themselves when the simple rows cannot tell the week.
  protected readonly open = computed(
    () => this.opened() || this.simple().weekdays === 'differs',
  );
  protected readonly errors = signal<Partial<Record<RowKey, RowError>>>({});
  protected readonly closedDay = signal('');
  protected readonly closedNote = signal('');
  protected readonly closedError = signal<string | null>(null);
  protected readonly calendar = signal<Calendar>({ state: 'loading' });
  protected readonly today = signal(todayInBucharest());
  protected readonly language = this.i18n.language;
  private readonly dates = computed(
    () =>
      new Intl.DateTimeFormat(this.language() === 'en' ? 'en-GB' : 'ro-RO', {
        day: 'numeric',
        month: 'long',
        timeZone: 'UTC',
        year: 'numeric',
      }),
  );

  protected readonly hours = computed(
    () => this.value().hours ?? DEFAULT_HOURS,
  );
  protected readonly simple = computed(() => simpleRows(this.hours()));
  protected readonly ticks = computed(() => this.value().facilities ?? []);

  protected readonly nextHolidays = computed(() => {
    const calendar = this.calendar();
    if (calendar.state !== 'ready') return [];
    return calendar.days
      .filter((h) => h.day >= this.today())
      .slice(0, NEXT_HOLIDAYS);
  });

  constructor() {
    // The calendar comes with the client: a server render would drop it.
    if (isPlatformServer(inject(PLATFORM_ID))) return;
    const year = Number(this.today().slice(0, 4));
    Promise.all([
      this.calendarApi.publicHolidaysControllerList({ year }),
      this.calendarApi.publicHolidaysControllerList({ year: year + 1 }),
    ]).then(
      ([now, next]) =>
        this.calendar.set({ days: [...now, ...next], state: 'ready' }),
      () => this.calendar.set({ state: 'down' }),
    );
  }

  protected field(event: Event) {
    return event.target as HTMLInputElement;
  }

  // A text of this step whose key is known only at run time.
  protected key(name: string) {
    return `public.listing.hours.${name}`;
  }

  protected dayKey(day: Weekday) {
    return this.key(`days.${day}`);
  }

  protected facilityKey(facility: Facility) {
    return this.key(`facility.${facility}`);
  }

  protected holidayName(holiday: PublicHolidayDto) {
    return this.language() === 'en' ? holiday.nameEn : holiday.nameRo;
  }

  protected errorId(row: RowKey) {
    return this.errors()[row] ? `hours-${row}-error` : null;
  }

  // A calendar day in the page's language, read as a date with no time zone.
  protected date(day: string) {
    return this.dates().format(new Date(`${day}T00:00:00Z`));
  }

  protected toggled(event: Event) {
    this.opened.set((event.target as HTMLDetailsElement).open);
  }

  protected weekdays(side: 0 | 1, event: Event) {
    const rows = this.simple();
    if (rows.weekdays === 'differs') return;
    const interval = this.changed(rows.weekdays, side, event);
    this.keep('weekdays', [interval], setWeekdays(this.hours(), interval));
  }

  protected saturday(side: 0 | 1, event: Event) {
    const { saturday } = this.simple();
    if (!saturday || saturday === 'differs') return;
    const interval = this.changed(saturday, side, event);
    this.keep('sat', [interval], setDay(this.hours(), 'sat', [interval]));
  }

  protected time(day: Weekday, index: number, side: 0 | 1, event: Event) {
    const intervals = this.hours()[day].map((interval, i) =>
      i === index ? this.changed(interval, side, event) : interval,
    );
    this.keep(day, intervals, setDay(this.hours(), day, intervals));
  }

  protected close(day: Weekday) {
    this.clearError(day);
    this.setHours(toggleClosed(this.hours(), day));
  }

  protected split(day: Weekday) {
    const [interval] = this.hours()[day];
    const split = addBreak(interval, ...LUNCH);
    const parts = split === 'breakOutside' ? this.middleBreak(interval) : split;
    if (parts === 'breakOutside') {
      this.errors.update((e) => ({ ...e, [day]: 'breakOutside' }));
      return;
    }
    this.clearError(day);
    this.setHours(setDay(this.hours(), day, parts));
  }

  protected join(day: Weekday) {
    this.clearError(day);
    this.setHours(setDay(this.hours(), day, removeBreak(this.hours()[day])));
  }

  protected note(field: HTMLInputElement) {
    if (letters(field.value) > CLOSED_NOTE_MAX)
      field.value = cut(field.value, CLOSED_NOTE_MAX);
    this.closedNote.set(field.value);
  }

  protected addClosed() {
    const day = this.closedDay();
    if (!day) return;
    this.today.set(todayInBucharest());
    const calendar = this.calendar();
    const holidays =
      calendar.state === 'ready' ? calendar.days.map((h) => h.day) : [];
    const list = addClosedDay(
      this.value().closedDays ?? [],
      day,
      this.closedNote(),
      this.today(),
      holidays,
    );
    if (typeof list === 'string') {
      this.closedError.set(list === 'note' ? 'closedNote' : list);
      return;
    }
    this.closedError.set(null);
    this.closedDay.set('');
    this.closedNote.set('');
    this.value.update((v) => ({ ...v, closedDays: list }));
  }

  protected removeClosed(day: string) {
    const list = removeClosedDay(this.value().closedDays ?? [], day);
    this.value.update(({ closedDays: _, ...rest }) =>
      list.length ? { ...rest, closedDays: list } : rest,
    );
  }

  protected tick(facility: Facility) {
    const list = toggleFacility(this.ticks(), facility);
    this.value.update(({ facilities: _, ...rest }) =>
      list.length ? { ...rest, facilities: list } : rest,
    );
  }

  private changed(interval: Interval, side: 0 | 1, event: Event): Interval {
    const picked = (event.target as HTMLSelectElement).value;
    return side === 0 ? [picked, interval[1]] : [interval[0], picked];
  }

  // The new week is kept only when the changed row still holds; otherwise
  // the last valid one stays and the row says why.
  private keep(row: RowKey, intervals: Interval[], hours: WeeklyHours) {
    const error = intervalsError(intervals);
    if (error) {
      const reason: RowError = error === 'order' ? 'order' : 'breakOutside';
      this.errors.update((e) => ({ ...e, [row]: reason }));
      return;
    }
    this.clearError(row);
    this.setHours(hours);
  }

  private middleBreak(interval: Interval): Interval[] | 'breakOutside' {
    const open = TIMES.indexOf(interval[0]);
    const close = TIMES.indexOf(interval[1]);
    const middle = Math.floor((open + close) / 2);
    return addBreak(interval, TIMES[middle], TIMES[middle + 1] ?? '');
  }

  private clearError(row: RowKey) {
    this.errors.update(({ [row]: _, ...rest }) => rest);
  }

  private setHours(hours: WeeklyHours) {
    this.value.update((v) => ({ ...v, hours }));
  }
}
