import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { HttpErrorResponse } from '@angular/common/http';
import { PLATFORM_ID, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { EVENT_KINDS, type EventKind } from '@motor-fix/contracts';
import {
  GaragesService,
  type MeDto,
  type TodayFiguresDto,
} from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';

import { DailyFiguresPanel } from './daily-figures-panel';
import {
  fakeLive,
  todayFigures,
} from '../garage-requests/garage-requests.testing';
import { Live } from '../live';
import { Session } from '../session';

const GARAGE = 'garage-1';

const me = {
  capabilities: ['garage.profile'],
  garageAccess: [
    { features: {}, garageId: GARAGE, role: 'owner', status: 'approved' },
  ],
  garageId: GARAGE,
} as unknown as MeDto;

let live: ReturnType<typeof fakeLive>;
let reads: number;
let inFlight: number;
let maxInFlight: number;
let answer: () => Promise<TodayFiguresDto>;

const refuse = (status: number) => async (): Promise<TodayFiguresDto> => {
  throw new HttpErrorResponse({ status });
};

async function settle() {
  for (let i = 0; i < 6; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

async function open({
  language = 'ro',
  platform = 'browser',
}: {
  language?: 'ro' | 'en';
  platform?: 'browser' | 'server';
} = {}) {
  live = fakeLive();
  reads = 0;
  inFlight = 0;
  maxInFlight = 0;
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: PLATFORM_ID, useValue: platform },
      { provide: Live, useValue: live },
      { provide: Session, useValue: { shown: signal(me) } },
      {
        provide: GaragesService,
        useValue: {
          garageTodayFigures: () => {
            reads++;
            inFlight++;
            maxInFlight = Math.max(maxInFlight, inFlight);
            return answer().finally(() => inFlight--);
          },
        },
      },
    ],
  });
  const i18n = TestBed.inject(I18n);
  await i18n.enter('garage');
  if (language === 'en') await i18n.use('en');
  const fixture = TestBed.createComponent(DailyFiguresPanel);
  document.body.append(fixture.nativeElement);
  await settle();
  return { element: fixture.nativeElement as HTMLElement, fixture, i18n };
}

const fake = () => vi.useFakeTimers({ toNotFake: ['setImmediate'] });
const opened = async (options?: Parameters<typeof open>[0]) => {
  const opening = open(options);
  await vi.advanceTimersByTimeAsync(50);
  return opening;
};

const text = (node: Element | null | undefined) =>
  (node?.textContent ?? '').replace(/\s+/g, ' ').trim();
const card = (element: HTMLElement, key: string) => {
  const item = element.querySelector<HTMLElement>(`[data-card=${key}]`);
  return {
    label: text(item?.querySelector('.label')),
    note: item?.querySelector('[data-note]')
      ? text(item.querySelector('[data-note]'))
      : null,
    value: text(item?.querySelector('[data-value]')),
  };
};
const skeletons = (element: HTMLElement) =>
  element.querySelectorAll('.skeleton').length;

afterEach(() => {
  TestBed.resetTestingModule();
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('number formats at their edges', () => {
  // @traces 1431-FR-002
  it.each([
    [152_949, '1.529', '1,529'],
    [50, '1', '1'],
    [49, '0', '0'],
    [99_999_950, '1.000.000', '1,000,000'],
    [1_234_567_800, '12.345.678', '12,345,678'],
  ])('writes %i bani as whole lei', async (bani, ro, en) => {
    answer = async () => todayFigures({ estimatedWorkBani: bani });
    expect(card((await open()).element, 'work').value).toBe(ro);
    TestBed.resetTestingModule();
    expect(card((await open({ language: 'en' })).element, 'work').value).toBe(
      en,
    );
  });

  // @traces 1431-FR-002 1431-FR-001
  it('groups large counts and differences in the note and the value', async () => {
    answer = async () =>
      todayFigures({
        bookingsThisWeek: 12_345,
        requestsToday: 2_500,
        requestsYesterday: 1_000,
      });
    const { element } = await open();

    expect(card(element, 'requests')).toMatchObject({
      note: '+1.500 față de ieri',
      value: '2.500',
    });
    expect(card(element, 'bookings').value).toBe('12.345');
  });

  // @traces 1431-FR-002
  it.each([
    [0, '0,0', '0.0'],
    [3, '3,0', '3.0'],
    [4.04, '4,0', '4.0'],
    [4.5, '4,5', '4.5'],
  ])('writes a rating of %d with one decimal', async (rating, ro, en) => {
    answer = async () => todayFigures({ rating, reviewCount: 2 });
    expect(card((await open()).element, 'rating')).toEqual({
      label: 'Nota service‑ului',
      note: 'din 2 recenzii',
      value: ro,
    });
    TestBed.resetTestingModule();
    expect(card((await open({ language: 'en' })).element, 'rating')).toEqual({
      label: 'Garage rating',
      note: 'from 2 reviews',
      value: en,
    });
  });

  // @traces 1431-FR-001
  it('shows a perfect rating with no reviews as a dash', async () => {
    answer = async () => todayFigures({ rating: 5, reviewCount: 0 });
    expect(card((await open()).element, 'rating')).toMatchObject({
      note: 'încă nicio recenzie',
      value: '—',
    });
  });

  // @traces 1431-FR-001
  it('shows zero bookings today in the fallback note', async () => {
    answer = async () =>
      todayFigures({
        bookingsToday: 0,
        freeSlotsUnavailable: true,
        nextFreeSlots: null,
      });
    expect(card((await open()).element, 'bookings').note).toBe('0 azi');
  });

  // @traces 1431-FR-001 1431-FR-002
  it('groups the free slot count', async () => {
    answer = async () =>
      todayFigures({ nextFreeSlots: { count: 1_200, day: '2026-10-26' } });
    expect(card((await open()).element, 'bookings').note).toBe(
      '1.200 locuri libere luni',
    );
  });
});

describe('names taken from the read, not the clock', () => {
  // @traces 1431-FR-002
  it.each([
    ['2026-01-01', 'ianuarie', 'January'],
    ['2026-03-01', 'martie', 'March'],
    ['2026-12-01', 'decembrie', 'December'],
  ])('names the month of %s', async (month, ro, en) => {
    answer = async () => todayFigures({ month });
    expect(card((await open()).element, 'work').label).toBe(
      `Lucrări estimate, ${ro}`,
    );
    TestBed.resetTestingModule();
    expect(card((await open({ language: 'en' })).element, 'work').label).toBe(
      `Estimated work, ${en}`,
    );
  });

  // @traces 1431-FR-002
  it.each([
    ['2026-11-01', 'duminică', 'Sunday'],
    ['2026-11-02', 'luni', 'Monday'],
    ['2026-11-04', 'miercuri', 'Wednesday'],
    ['2026-03-01', 'duminică', 'Sunday'],
  ])('names the weekday of %s', async (day, ro, en) => {
    answer = async () => todayFigures({ nextFreeSlots: { count: 2, day } });
    expect(card((await open()).element, 'bookings').note).toBe(
      `2 locuri libere ${ro}`,
    );
    TestBed.resetTestingModule();
    expect(
      card((await open({ language: 'en' })).element, 'bookings').note,
    ).toBe(`2 free slots on ${en}`);
  });

  // @traces 1431-FR-002
  it('keeps the weekday of the read when the clock is a day later', async () => {
    vi.useFakeTimers({ toNotFake: ['setImmediate', 'setTimeout'] });
    vi.setSystemTime(new Date('2026-11-01T23:30:00Z'));
    answer = async () =>
      todayFigures({ nextFreeSlots: { count: 2, day: '2026-10-30' } });
    expect(card((await open()).element, 'bookings').note).toBe(
      '2 locuri libere vineri',
    );
  });

  // @traces 1431-FR-002
  it('follows a language change while the error state shows, with no new read', async () => {
    answer = refuse(500);
    const { element, i18n } = await open();
    await i18n.use('en');
    await settle();

    expect(text(element.querySelector('[role="alert"]'))).toBe(
      'Today’s numbers could not be loaded.'.replace('’', "'"),
    );
    expect(text(element.querySelector('[data-retry]'))).toBe('Try again');
    expect(reads).toBe(1);
  });
});

describe('loading and failure, harder', () => {
  // @traces 1431-FR-003
  it('shows the heading and no card text while the first read is out', async () => {
    answer = () => new Promise(() => undefined);
    const { element } = await open();

    expect(text(element.querySelector('h2'))).toBe('Cifrele zilei');
    expect(skeletons(element)).toBe(4);
    expect(text(element)).not.toContain('Cereri noi azi');
    expect(element.querySelector('[data-value]')).toBeNull();
    expect(element.querySelector('[data-note]')).toBeNull();
    expect(element.querySelector('[role="alert"]')).toBeNull();
  });

  // @traces 1431-FR-003
  it('shows exactly one alert and one retry button after a failure', async () => {
    answer = refuse(404);
    const { element } = await open();

    expect(element.querySelectorAll('[role="alert"]')).toHaveLength(1);
    expect(element.querySelectorAll('[data-retry]')).toHaveLength(1);
    expect(element.querySelector('[data-retry]')?.getAttribute('type')).toBe(
      'button',
    );
    expect(element.querySelectorAll('[data-card]')).toHaveLength(4);
    expect(element.querySelector('section')?.getAttribute('aria-busy')).toBe(
      null,
    );
  });

  // @traces 1431-FR-003
  it('reads once for two quick clicks on retry', async () => {
    answer = refuse(500);
    const { element } = await open();
    answer = () => new Promise(() => undefined);

    const retry = element.querySelector<HTMLButtonElement>('[data-retry]');
    retry?.click();
    retry?.click();
    await settle();

    expect(reads).toBe(2);
    expect(maxInFlight).toBe(1);
  });

  // @traces 1431-FR-003
  it('stays in the error state when the retry fails too, and reads again on the next retry', async () => {
    answer = refuse(403);
    const { element } = await open();

    element.querySelector<HTMLButtonElement>('[data-retry]')?.click();
    await settle();
    expect(reads).toBe(2);
    expect(element.querySelectorAll('[role="alert"]')).toHaveLength(1);
    expect(
      [...element.querySelectorAll('[data-value]')].map((v) => text(v)),
    ).toEqual(['—', '—', '—', '—']);

    answer = async () => todayFigures();
    element.querySelector<HTMLButtonElement>('[data-retry]')?.click();
    await settle();
    expect(reads).toBe(3);
    expect(card(element, 'requests').value).toBe('3');
    expect(element.querySelector('[role="alert"]')).toBeNull();
  });

  // @traces 1431-FR-003
  it('shows no skeletons and no busy mark while a re-read is out', async () => {
    fake();
    answer = async () => todayFigures();
    const { element } = await opened();
    answer = () => new Promise(() => undefined);

    live.emit('booking.confirmed');
    await vi.advanceTimersByTimeAsync(350);

    expect(reads).toBe(2);
    expect(skeletons(element)).toBe(0);
    expect(card(element, 'bookings').value).toBe('37');
    expect(element.querySelector('section')?.getAttribute('aria-busy')).toBe(
      null,
    );
  });

  // @traces 1431-FR-003
  it('shows the next answer after a failed re-read', async () => {
    fake();
    answer = async () => todayFigures();
    const { element } = await opened();
    answer = refuse(500);
    live.emit('booking.confirmed');
    await vi.advanceTimersByTimeAsync(2_500);
    answer = async () => todayFigures({ bookingsThisWeek: 41 });

    live.emit('booking.moved');
    await vi.advanceTimersByTimeAsync(2_500);

    expect(card(element, 'bookings').value).toBe('41');
    expect(element.querySelector('[role="alert"]')).toBeNull();
  });

  // @traces 1431-FR-003
  it('renders nothing from a read that settles after the section is destroyed', async () => {
    let answerNow: (value: TodayFiguresDto) => void = () => undefined;
    answer = () => new Promise((resolve) => (answerNow = resolve));
    const { element, fixture } = await open();

    fixture.destroy();
    answerNow(todayFigures());
    await settle();

    expect(element.querySelectorAll('[data-card]')).toHaveLength(0);
    expect(reads).toBe(1);
  });

  // @traces 1431-FR-003
  it('sends no read and takes no event on the server', async () => {
    fake();
    answer = async () => todayFigures();
    await opened({ platform: 'server' });

    live.emit('booking.confirmed');
    live.resync.next();
    await vi.advanceTimersByTimeAsync(5_000);

    expect(reads).toBe(0);
  });
});

describe('the read limit and the event list', () => {
  const listed: EventKind[] = [
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
  const others = EVENT_KINDS.filter((kind) => !listed.includes(kind));

  // @traces 1431-FR-004
  it.each(others)('does not read on %s', async (kind) => {
    fake();
    answer = async () => todayFigures();
    await opened();

    live.emit(kind);
    await vi.advanceTimersByTimeAsync(5_000);

    expect(reads).toBe(1);
  });

  // @traces 1431-FR-004
  it('reads the first event of a window within 300 ms', async () => {
    fake();
    answer = async () => todayFigures();
    await opened();

    live.emit('request.created');
    await vi.advanceTimersByTimeAsync(300);

    expect(reads).toBe(2);
  });

  // @traces 1431-FR-004
  it('makes one trailing read for a burst inside the window, at its end', async () => {
    fake();
    answer = async () => todayFigures();
    const { element } = await opened();

    live.emit('booking.confirmed');
    await vi.advanceTimersByTimeAsync(350);
    expect(reads).toBe(2);
    answer = async () => todayFigures({ bookingsThisWeek: 99 });
    live.emit('booking.moved');
    live.emit('booking.cancelled');
    live.emit('request.created');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(reads).toBe(2);
    await vi.advanceTimersByTimeAsync(1_500);

    expect(reads).toBe(3);
    expect(card(element, 'bookings').value).toBe('99');
  });

  // @traces 1431-FR-004
  it('reads at most once per 2 seconds under a steady stream of events', async () => {
    fake();
    answer = async () => todayFigures();
    await opened();

    for (let i = 0; i < 40; i++) {
      live.emit('booking.confirmed');
      await vi.advanceTimersByTimeAsync(250);
    }
    await vi.advanceTimersByTimeAsync(2_500);

    expect(reads - 1).toBeLessThanOrEqual(6);
    expect(reads - 1).toBeGreaterThanOrEqual(4);
    expect(maxInFlight).toBe(1);
  });

  // @traces 1431-FR-004
  it('reads at most twice for three events and a resync arriving together', async () => {
    fake();
    answer = async () => todayFigures();
    await opened();

    live.emit('booking.confirmed');
    live.emit('rating.updated');
    live.resync.next();
    await vi.advanceTimersByTimeAsync(3_000);

    expect(reads - 1).toBeLessThanOrEqual(2);
    expect(reads - 1).toBeGreaterThanOrEqual(1);
  });

  // @traces 1431-FR-004
  it('reads again for an event once the previous window has passed', async () => {
    fake();
    answer = async () => todayFigures();
    await opened();

    live.emit('booking.confirmed');
    await vi.advanceTimersByTimeAsync(5_000);
    live.emit('booking.confirmed');
    await vi.advanceTimersByTimeAsync(350);

    expect(reads).toBe(3);
  });

  // @traces 1431-FR-004
  it('never runs two reads in parallel when events keep coming while a read hangs', async () => {
    fake();
    answer = async () => todayFigures();
    await opened();
    let finish: (value: TodayFiguresDto) => void = () => undefined;
    answer = () => new Promise((resolve) => (finish = resolve));

    for (let i = 0; i < 10; i++) {
      live.emit('booking.confirmed');
      await vi.advanceTimersByTimeAsync(1_000);
    }
    await vi.advanceTimersByTimeAsync(5_000);
    expect(reads).toBe(2);
    expect(maxInFlight).toBe(1);

    answer = async () => todayFigures();
    finish(todayFigures());
    await vi.advanceTimersByTimeAsync(3_000);
    expect(reads).toBe(3);
  });

  // @traces 1431-FR-004
  it('takes no event after the section is destroyed', async () => {
    fake();
    answer = async () => todayFigures();
    const { fixture } = await opened();

    fixture.destroy();
    live.emit('booking.confirmed');
    live.resync.next();
    await vi.advanceTimersByTimeAsync(5_000);

    expect(reads).toBe(1);
  });
});

describe('the midnight timer across clock changes', () => {
  // @traces 1431-FR-004
  it('does not read before Bucharest midnight', async () => {
    fake();
    vi.setSystemTime(new Date('2026-10-31T21:59:30Z'));
    answer = async () => todayFigures();
    await opened();

    await vi.advanceTimersByTimeAsync(29_500);

    expect(reads).toBe(1);
  });

  // @traces 1431-FR-004
  it('reads at midnight by the Bucharest wall clock when the day is 25 hours long', async () => {
    fake();
    vi.setSystemTime(new Date('2026-10-24T20:59:30Z'));
    answer = async () => todayFigures();
    await opened();

    await vi.advanceTimersByTimeAsync(31_000);
    expect(reads).toBe(2);
    await vi.advanceTimersByTimeAsync(24 * 3_600_000);
    expect(reads).toBe(2);
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(reads).toBe(3);
  });

  // @traces 1431-FR-004
  it('reads at midnight by the Bucharest wall clock when the day is 23 hours long', async () => {
    fake();
    vi.setSystemTime(new Date('2026-03-28T21:59:30Z'));
    answer = async () => todayFigures();
    await opened();

    await vi.advanceTimersByTimeAsync(31_000);
    expect(reads).toBe(2);
    await vi.advanceTimersByTimeAsync(23 * 3_600_000);
    expect(reads).toBe(3);
  });

  // @traces 1431-FR-004
  it('reads at the first midnight and not before when opened just after midnight', async () => {
    fake();
    vi.setSystemTime(new Date('2026-11-01T22:00:01Z'));
    answer = async () => todayFigures();
    await opened();

    await vi.advanceTimersByTimeAsync(23 * 3_600_000);
    expect(reads).toBe(1);
    await vi.advanceTimersByTimeAsync(2 * 3_600_000);
    expect(reads).toBe(2);
  });

  // @traces 1431-FR-004
  it('leaves no timer armed once the section is destroyed', async () => {
    fake();
    vi.setSystemTime(new Date('2026-10-31T12:00:00Z'));
    answer = async () => todayFigures();
    const { fixture } = await opened();

    fixture.destroy();
    await vi.advanceTimersByTimeAsync(3_000);

    expect(vi.getTimerCount()).toBe(0);
  });

  // @traces 1431-FR-004
  it('keeps one timer armed after several midnights, not one per firing', async () => {
    fake();
    vi.setSystemTime(new Date('2026-10-31T21:59:30Z'));
    answer = async () => todayFigures();
    await opened();

    await vi.advanceTimersByTimeAsync(3 * 24 * 3_600_000);

    expect(reads).toBe(4);
    expect(vi.getTimerCount()).toBeLessThanOrEqual(2);
  });
});

describe('the garage texts', () => {
  const read = (language: 'ro' | 'en') =>
    JSON.parse(
      readFileSync(
        resolve(process.cwd(), `libs/i18n/src/garage/${language}.json`),
        'utf8',
      ),
    ) as { daily: Record<string, unknown>; home: Record<string, any> };
  const keys = (value: unknown, prefix = ''): string[] =>
    typeof value === 'object' && value !== null
      ? Object.entries(value).flatMap(([key, item]) =>
          keys(item, `${prefix}${key}.`),
        )
      : [prefix.slice(0, -1)];

  // @traces 1431-FR-006
  it('holds the same daily keys in both languages', () => {
    expect(keys(read('ro').daily).sort()).toEqual(
      keys(read('en').daily).sort(),
    );
    expect(keys(read('en').daily)).toContain('note.slots');
  });

  // @traces 1431-FR-006
  it('holds no kpi empty-state text in either language', () => {
    for (const language of ['ro', 'en'] as const) {
      expect(read(language).home['empty']?.kpi).toBeUndefined();
    }
  });

  // @traces 1431-FR-006
  it('writes the Romanian daily texts with comma-below diacritics and every placeholder the English has', () => {
    const ro = JSON.stringify(read('ro').daily);
    expect(ro).not.toMatch(/[şŞţŢ]/);
    expect(ro).toContain('{month}');
    expect(ro).toContain('{day}');
    expect(ro).toContain('{n}');
  });
});
