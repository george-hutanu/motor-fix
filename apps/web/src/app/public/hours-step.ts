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

import {
  addBreak,
  addClosedDay,
  cut,
  letters,
  removeBreak,
  removeClosedDay,
  setDay,
  setWeekdays,
  simpleRows,
  toggleClosed,
  toggleFacility,
} from './hours-section';

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
  styles: `
    :host { display: grid; gap: var(--mf-space-3); margin-top: var(--mf-space-3); min-width: 0; }
    h3 { margin: var(--mf-space-2) 0 0; font-size: var(--mf-size-body); }
    p { margin: 0; overflow-wrap: anywhere; }
    .hint, .holidays { color: var(--mf-text-secondary); }
    .row { display: flex; flex-wrap: wrap; align-items: center; gap: var(--mf-space-2) var(--mf-space-3); min-width: 0; }
    .row > .name { flex: 1 0 8rem; font-weight: 600; }
    .times { display: flex; flex-wrap: wrap; align-items: center; gap: var(--mf-space-2); }
    select, input:not([type='checkbox']) {
      min-height: var(--mf-tap); box-sizing: border-box; font: inherit; font-size: max(16px, 1rem);
      color: var(--mf-text); background: var(--mf-bg); border: 1px solid var(--mf-line);
      border-radius: var(--mf-radius-control); padding: 0 var(--mf-space-2); max-width: 100%;
    }
    select:focus-visible, button:focus-visible, input:focus-visible { outline: 2px solid var(--mf-focus); outline-offset: 2px; }
    .tick { display: inline-flex; align-items: center; gap: var(--mf-space-2); min-height: var(--mf-tap); cursor: pointer; }
    .tick input { width: 1.25rem; height: 1.25rem; margin: 0; }
    button {
      display: inline-flex; align-items: center; justify-content: center; gap: var(--mf-space-2); max-width: 100%;
      min-height: var(--mf-tap); min-width: var(--mf-tap); padding: 0 var(--mf-space-3); border: 1px solid var(--mf-line);
      border-radius: var(--mf-radius-control); background: var(--mf-bg); color: var(--mf-text); font: inherit;
      text-align: start; overflow-wrap: anywhere; cursor: pointer;
    }
    .error { flex-basis: 100%; color: var(--mf-red); }
    details { display: grid; gap: var(--mf-space-2); }
    summary { min-height: var(--mf-tap); display: flex; align-items: center; cursor: pointer; }
    .days { display: grid; gap: var(--mf-space-3); }
    .field { display: grid; gap: var(--mf-space-1); }
    .field input { width: 100%; }
    ul { margin: 0; padding: 0; list-style: none; }
    .closed-days, .facilities { display: flex; flex-wrap: wrap; gap: var(--mf-space-2); }
    .closed-days li { display: inline-flex; align-items: center; gap: var(--mf-space-2); max-width: 100%; overflow-wrap: anywhere; }
    .holidays ul { display: grid; gap: var(--mf-space-1); margin-top: var(--mf-space-1); font-size: var(--mf-size-small); }
    .facilities button[aria-pressed='true'] { border-color: var(--mf-text-secondary); font-weight: 600; }
    mf-lamp { font-size: var(--mf-size-small); }
  `,
  template: `
    <h3>{{ 'public.listing.hours.heading' | t }}</h3>
    @let rows = simple();
    <div class="row" data-row="weekdays">
      <span class="name">{{ 'public.listing.hours.weekdays' | t }}</span>
      @if (rows.weekdays === 'differs') {
        <span class="hint">{{ 'public.listing.hours.differs' | t }}</span>
      } @else {
        <span class="times">
          <select name="weekdays-open" [attr.aria-label]="('public.listing.hours.weekdays' | t) + ', ' + ('public.listing.hours.open' | t)" [attr.aria-describedby]="errorId('weekdays')" (change)="weekdays(0, $event)">
            @for (time of times; track time) { <option [value]="time" [selected]="time === rows.weekdays[0]">{{ time }}</option> }
          </select>
          –
          <select name="weekdays-close" [attr.aria-label]="('public.listing.hours.weekdays' | t) + ', ' + ('public.listing.hours.close' | t)" [attr.aria-describedby]="errorId('weekdays')" (change)="weekdays(1, $event)">
            @for (time of times; track time) { <option [value]="time" [selected]="time === rows.weekdays[1]">{{ time }}</option> }
          </select>
        </span>
      }
      @if (errors()['weekdays']; as error) {
        <p class="error" id="hours-weekdays-error" role="status">{{ key(error) | t }}</p>
      }
    </div>
    <div class="row" data-row="sat">
      <span class="name">{{ 'public.listing.hours.saturday' | t }}</span>
      <label class="tick">
        <input type="checkbox" name="sat-closed" [checked]="rows.saturday === null" (change)="close('sat')" />
        {{ 'public.listing.hours.closed' | t }}
      </label>
      @if (rows.saturday === 'differs') {
        <span class="hint">{{ 'public.listing.hours.differs' | t }}</span>
      } @else if (rows.saturday) {
        <span class="times">
          <select name="sat-open" [attr.aria-label]="('public.listing.hours.saturday' | t) + ', ' + ('public.listing.hours.open' | t)" [attr.aria-describedby]="errorId('sat')" (change)="saturday(0, $event)">
            @for (time of times; track time) { <option [value]="time" [selected]="time === rows.saturday[0]">{{ time }}</option> }
          </select>
          –
          <select name="sat-close" [attr.aria-label]="('public.listing.hours.saturday' | t) + ', ' + ('public.listing.hours.close' | t)" [attr.aria-describedby]="errorId('sat')" (change)="saturday(1, $event)">
            @for (time of times; track time) { <option [value]="time" [selected]="time === rows.saturday[1]">{{ time }}</option> }
          </select>
        </span>
      }
      @if (!open() && errors()['sat']; as error) {
        <p class="error" id="hours-sat-error" role="status">{{ key(error) | t }}</p>
      }
    </div>
    <details [open]="open()" (toggle)="toggled($event)">
      <summary>{{ 'public.listing.hours.byDay' | t }}</summary>
      @if (open()) {
        <div class="days">
          @for (day of days; track day) {
            @let intervals = hours()[day];
            <div class="row" [attr.data-day]="day">
              <span class="name">{{ dayKey(day) | t }}</span>
              <label class="tick">
                <input type="checkbox" [name]="day + '-closed'" [checked]="intervals.length === 0" (change)="close(day)" />
                {{ 'public.listing.hours.closed' | t }}
              </label>
              @for (interval of intervals; track $index; let i = $index) {
                <span class="times">
                  <select [name]="day + '-' + i + '-open'" [attr.aria-label]="(dayKey(day) | t) + ', ' + ('public.listing.hours.open' | t)" [attr.aria-describedby]="errorId(day)" (change)="time(day, i, 0, $event)">
                    @for (time of times; track time) { <option [value]="time" [selected]="time === interval[0]">{{ time }}</option> }
                  </select>
                  –
                  <select [name]="day + '-' + i + '-close'" [attr.aria-label]="(dayKey(day) | t) + ', ' + ('public.listing.hours.close' | t)" [attr.aria-describedby]="errorId(day)" (change)="time(day, i, 1, $event)">
                    @for (time of times; track time) { <option [value]="time" [selected]="time === interval[1]">{{ time }}</option> }
                  </select>
                </span>
              }
              @if (intervals.length === 1) {
                <button type="button" (click)="split(day)">{{ 'public.listing.hours.addBreak' | t }}</button>
              } @else if (intervals.length === 2) {
                <button type="button" (click)="join(day)">{{ 'public.listing.hours.removeBreak' | t }}</button>
              }
              @if (errors()[day]; as error) {
                <p class="error" [id]="'hours-' + day + '-error'" role="status">{{ key(error) | t }}</p>
              }
            </div>
          }
        </div>
      }
    </details>

    <h3>{{ 'public.listing.hours.closedDays' | t }}</h3>
    <div class="holidays">
      @switch (calendar().state) {
        @case ('down') { <p>{{ 'public.listing.hours.holidaysDown' | t }}</p> }
        @default {
          <p>{{ 'public.listing.hours.holidays' | t }}</p>
          @if (nextHolidays().length) {
            <ul [attr.aria-label]="'public.listing.hours.holidaysNext' | t">
              @for (holiday of nextHolidays(); track holiday.day) {
                <li>{{ date(holiday.day) }} · {{ holidayName(holiday) }}</li>
              }
            </ul>
          }
        }
      }
    </div>
    <label hlmLabel class="field">
      {{ 'public.listing.hours.closedDay' | t }}
      <input hlmInput type="date" name="closedDay" [min]="today()" [value]="closedDay()" (input)="closedDay.set(field($event).value)" (change)="closedDay.set(field($event).value)" />
    </label>
    <label hlmLabel class="field">
      {{ 'public.listing.hours.closedNote' | t }}
      <input hlmInput name="closedNote" autocomplete="off" [value]="closedNote()" (input)="note(field($event))" />
    </label>
    <div class="row">
      <button type="button" class="add-closed" (click)="addClosed()">{{ 'public.listing.hours.add' | t }}</button>
      @if (closedError(); as error) {
        <p class="closed-error error" role="status">{{ key(error) | t }}</p>
      }
    </div>
    @if (value().closedDays?.length) {
      <ul class="closed-days">
        @for (entry of value().closedDays; track entry.day) {
          <li>
            <span>{{ date(entry.day) }}@if (entry.note) { · {{ entry.note }} }</span>
            <button type="button" [attr.aria-label]="'public.listing.hours.remove' | t: { day: date(entry.day) }" (click)="removeClosed(entry.day)"><span aria-hidden="true">✕</span></button>
          </li>
        }
      </ul>
    }

    <h3>{{ 'public.listing.hours.facilities' | t }}</h3>
    <ul class="facilities">
      @for (facility of facilities; track facility) {
        @let ticked = ticks().includes(facility);
        <li>
          <button type="button" [attr.aria-pressed]="ticked" (click)="tick(facility)">
            {{ facilityKey(facility) | t }}
            @if (ticked) {
              <mf-lamp state="green" [label]="'public.listing.hours.offered' | t" />
            }
          </button>
        </li>
      }
    </ul>
    <p class="facilities-hint hint">{{ 'public.listing.hours.facilitiesHint' | t }}</p>
  `,
})
export class HoursStep {
  private readonly i18n = inject(I18n);
  private readonly calendarApi = inject(PublicHolidaysService);

  readonly value = model<HoursSection>({});

  protected readonly times = TIMES;
  protected readonly days = WEEKDAYS;
  protected readonly facilities = FACILITIES;

  protected readonly open = signal(false);
  protected readonly errors = signal<Partial<Record<RowKey, RowError>>>({});
  protected readonly closedDay = signal('');
  protected readonly closedNote = signal('');
  protected readonly closedError = signal<string | null>(null);
  protected readonly calendar = signal<Calendar>({ state: 'loading' });
  protected readonly today = signal(todayInBucharest());
  protected readonly language = this.i18n.language;

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
    const locale = this.language() === 'en' ? 'en-GB' : 'ro-RO';
    return new Intl.DateTimeFormat(locale, {
      day: 'numeric',
      month: 'long',
      timeZone: 'UTC',
      year: 'numeric',
    }).format(new Date(`${day}T00:00:00Z`));
  }

  protected toggled(event: Event) {
    this.open.set((event.target as HTMLDetailsElement).open);
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
