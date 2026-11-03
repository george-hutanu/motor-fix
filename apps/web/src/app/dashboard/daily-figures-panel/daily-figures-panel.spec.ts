import { HttpErrorResponse } from '@angular/common/http';
import { PLATFORM_ID, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { EventKind } from '@motor-fix/contracts';
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
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: PLATFORM_ID, useValue: platform },
      { provide: Live, useValue: live },
      { provide: Session, useValue: { shown: signal(me) } },
      {
        provide: GaragesService,
        useValue: {
          garageTodayFigures: (params: { garageId: string }) => {
            expect(params).toEqual({ garageId: GARAGE });
            reads++;
            return answer();
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

const text = (node: Element | null | undefined) =>
  (node?.textContent ?? '').replace(/\s+/g, ' ').trim();
const cards = (element: HTMLElement) =>
  [...element.querySelectorAll<HTMLElement>('[data-card]')].map((card) => ({
    key: card.dataset['card'],
    label: text(card.querySelector('.label')),
    note: card.querySelector('[data-note]')
      ? text(card.querySelector('[data-note]'))
      : null,
    value: text(card.querySelector('[data-value]')),
  }));
const card = (element: HTMLElement, key: string) =>
  cards(element).find((c) => c.key === key);
const skeletons = (element: HTMLElement) =>
  element.querySelectorAll('.skeleton').length;
const busy = (element: HTMLElement) =>
  element.querySelector('section')?.getAttribute('aria-busy');

afterEach(() => {
  TestBed.resetTestingModule();
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('the four daily numbers', () => {
  // @traces 1431-FR-001 1431-FR-002
  it('shows the four cards with label, value and note in Romanian', async () => {
    answer = async () => todayFigures();
    const { element } = await open();

    expect(text(element.querySelector('h2'))).toBe('Cifrele zilei');
    expect(cards(element)).toEqual([
      {
        key: 'requests',
        label: 'Cereri noi azi',
        note: '+2 față de ieri',
        value: '3',
      },
      {
        key: 'bookings',
        label: 'Programări săptămâna asta',
        note: '2 locuri libere vineri',
        value: '37',
      },
      {
        key: 'rating',
        label: 'Nota service\u2011ului',
        note: 'din 212 recenzii',
        value: '4,9',
      },
      {
        key: 'work',
        label: 'Lucrări estimate, octombrie',
        note: 'lei, din prețuri finale și oferte acceptate',
        value: '1.530',
      },
    ]);
    expect(reads).toBe(1);
  });

  // @traces 1431-FR-001 1431-FR-002
  it('shows the same answer in English', async () => {
    answer = async () => todayFigures();
    const { element } = await open({ language: 'en' });

    expect(cards(element)).toEqual([
      {
        key: 'requests',
        label: 'New requests today',
        note: '+2 vs yesterday',
        value: '3',
      },
      {
        key: 'bookings',
        label: 'Bookings this week',
        note: '2 free slots on Friday',
        value: '37',
      },
      {
        key: 'rating',
        label: 'Garage rating',
        note: 'from 212 reviews',
        value: '4.9',
      },
      {
        key: 'work',
        label: 'Estimated work, October',
        note: 'lei, from final prices and accepted quotes',
        value: '1,530',
      },
    ]);
  });

  // @traces 1431-FR-001
  it.each([
    [
      { requestsToday: 1, requestsYesterday: 3 },
      '−2 față de ieri',
      '−2 vs yesterday',
    ],
    [
      { requestsToday: 4, requestsYesterday: 4 },
      'la fel ca ieri',
      'same as yesterday',
    ],
  ])('writes the difference with yesterday (%o)', async (over, ro, en) => {
    answer = async () => todayFigures(over);
    expect(card((await open()).element, 'requests')?.note).toBe(ro);
    TestBed.resetTestingModule();
    expect(
      card((await open({ language: 'en' })).element, 'requests')?.note,
    ).toBe(en);
  });

  // @traces 1431-FR-001
  it.each([
    [
      { nextFreeSlots: { count: 1, day: '2026-10-30' } },
      '1 loc liber vineri',
      '1 free slot on Friday',
    ],
    [
      { nextFreeSlots: { count: 3, day: '2026-10-26' } },
      '3 locuri libere luni',
      '3 free slots on Monday',
    ],
    [
      { nextFreeSlots: null },
      'fără locuri libere săptămâna asta',
      'no free slots this week',
    ],
    [
      { bookingsToday: 4, freeSlotsUnavailable: true, nextFreeSlots: null },
      '4 azi',
      '4 today',
    ],
    [
      {
        bookingsToday: 4,
        freeSlotsUnavailable: true,
        nextFreeSlots: { count: 2, day: '2026-10-30' },
      },
      '4 azi',
      '4 today',
    ],
  ])('writes the free slots note (%o)', async (over, ro, en) => {
    answer = async () => todayFigures(over);
    expect(card((await open()).element, 'bookings')?.note).toBe(ro);
    TestBed.resetTestingModule();
    expect(
      card((await open({ language: 'en' })).element, 'bookings')?.note,
    ).toBe(en);
  });

  // @traces 1431-FR-001 1431-FR-002
  it.each([
    [
      { rating: 4.9, reviewCount: 1 },
      '4,9',
      'dintr\u2011o recenzie',
      '4.9',
      'from 1 review',
    ],
    [
      { rating: 5, reviewCount: 1200 },
      '5,0',
      'din 1.200 recenzii',
      '5.0',
      'from 1,200 reviews',
    ],
    [
      { rating: null, reviewCount: 0 },
      '—',
      'încă nicio recenzie',
      '—',
      'no reviews yet',
    ],
    [
      { rating: 4.2, reviewCount: 0 },
      '—',
      'încă nicio recenzie',
      '—',
      'no reviews yet',
    ],
  ])(
    'writes the rating and its reviews (%o)',
    async (over, roValue, roNote, enValue, enNote) => {
      answer = async () => todayFigures(over);
      expect(card((await open()).element, 'rating')).toMatchObject({
        note: roNote,
        value: roValue,
      });
      TestBed.resetTestingModule();
      expect(
        card((await open({ language: 'en' })).element, 'rating'),
      ).toMatchObject({
        note: enNote,
        value: enValue,
      });
    },
  );

  // @traces 1431-FR-001 1431-FR-002
  it.each([
    [152_950, '1.530', '1,530'],
    [3_840_000, '38.400', '38,400'],
    [0, '0', '0'],
  ])('writes %i bani as whole lei rounded half up', async (bani, ro, en) => {
    answer = async () => todayFigures({ estimatedWorkBani: bani });
    expect(card((await open()).element, 'work')?.value).toBe(ro);
    TestBed.resetTestingModule();
    expect(card((await open({ language: 'en' })).element, 'work')?.value).toBe(
      en,
    );
  });

  // @traces 1431-FR-002
  it("names the month from the read's month, not the clock", async () => {
    vi.useFakeTimers({ toNotFake: ['setImmediate', 'setTimeout'] });
    vi.setSystemTime(new Date('2026-12-15T10:00:00Z'));
    answer = async () => todayFigures({ month: '2026-11-01' });
    const { element } = await open();

    expect(card(element, 'work')?.label).toBe('Lucrări estimate, noiembrie');
  });

  // @traces 1431-FR-002
  it('follows a language change with no new read', async () => {
    answer = async () => todayFigures();
    const { element, i18n } = await open();
    await i18n.use('en');
    await settle();

    expect(card(element, 'rating')).toMatchObject({
      label: 'Garage rating',
      value: '4.9',
    });
    expect(card(element, 'work')?.label).toBe('Estimated work, October');
    expect(reads).toBe(1);
  });

  // @traces 1431-FR-001
  it('shows a new garage as zeros and dashes, never blank', async () => {
    answer = async () => ({
      bookingsThisWeek: 0,
      bookingsToday: 0,
      estimatedWorkBani: 0,
      freeSlotsUnavailable: false,
      month: '2026-11-01',
      nextFreeSlots: null,
      rating: null,
      requestsToday: 0,
      requestsYesterday: 0,
      reviewCount: 0,
    });
    const { element } = await open();

    expect(cards(element).map((c) => [c.value, c.note])).toEqual([
      ['0', 'la fel ca ieri'],
      ['0', 'fără locuri libere săptămâna asta'],
      ['—', 'încă nicio recenzie'],
      ['0', 'lei, din prețuri finale și oferte acceptate'],
    ]);
    expect(element.querySelector('[role="alert"]')).toBeNull();
  });

  // @traces 1431-FR-005
  it('names each card by its label', async () => {
    answer = async () => todayFigures();
    const { element } = await open();

    for (const item of element.querySelectorAll<HTMLElement>('[data-card]')) {
      const label = item.querySelector('.label') as HTMLElement;
      expect(item.getAttribute('role')).toBe('group');
      expect(item.getAttribute('aria-labelledby')).toBe(label.id);
    }
    expect(element.querySelector('[aria-live]')).toBeNull();
  });
});

describe('while the numbers load or fail', () => {
  // @traces 1431-FR-003 1431-FR-008
  it('shows four skeletons and marks the section busy while the first read runs', async () => {
    answer = () => new Promise(() => undefined);
    const { element } = await open();

    expect(skeletons(element)).toBe(4);
    expect(busy(element)).toBe('true');
    expect(element.querySelector('.cards[aria-hidden="true"]')).not.toBeNull();
    expect(element.querySelectorAll('[data-card]')).toHaveLength(0);
  });

  // @traces 1431-FR-003
  it('reads nothing on the server and renders the skeletons', async () => {
    answer = async () => todayFigures();
    const { element } = await open({ platform: 'server' });

    expect(reads).toBe(0);
    expect(skeletons(element)).toBe(4);
  });

  // @traces 1431-FR-002 1431-FR-003 1431-FR-005
  it('shows four dashes, one alert and a retry when the first read fails, and reads again on retry', async () => {
    answer = refuse(500);
    const { element } = await open();

    expect(cards(element).map((c) => [c.value, c.note])).toEqual([
      ['—', null],
      ['—', null],
      ['—', null],
      ['—', null],
    ]);
    // No read, so no month: never the browser's clock.
    expect(card(element, 'work')?.label).toBe('Lucrări estimate');
    expect(text(element.querySelector('[role="alert"]'))).toBe(
      'Cifrele zilei nu s\u2011au putut încărca.',
    );
    const retry =
      element.querySelector<HTMLButtonElement>('button[data-retry]');
    expect(text(retry)).toBe('Reîncearcă');

    let answerNow: (value: TodayFiguresDto) => void = () => undefined;
    answer = () => new Promise((resolve) => (answerNow = resolve));
    retry?.click();
    await settle();
    expect(reads).toBe(2);
    expect(skeletons(element)).toBe(4);
    expect(element.querySelector('button[data-retry]')).toBeNull();

    answerNow(todayFigures());
    await settle();
    expect(card(element, 'requests')?.value).toBe('3');
    expect(element.querySelector('[role="alert"]')).toBeNull();
    expect(document.activeElement).toBe(element.querySelector('[data-card]'));
  });

  // @traces 1431-FR-003
  it.each([403, 404, 503])(
    'never retries on its own after a %i',
    async (status) => {
      vi.useFakeTimers({ toNotFake: ['setImmediate'] });
      answer = refuse(status);
      const opening = open();
      await vi.advanceTimersByTimeAsync(50);
      const { element } = await opening;
      await vi.advanceTimersByTimeAsync(180_000);

      expect(reads).toBe(1);
      expect(element.querySelector('[role="alert"]')).not.toBeNull();
    },
  );
});

describe('the numbers stay current', () => {
  const fake = () => vi.useFakeTimers({ toNotFake: ['setImmediate'] });
  const opened = async (options?: Parameters<typeof open>[0]) => {
    const opening = open(options);
    await vi.advanceTimersByTimeAsync(50);
    return opening;
  };

  // @traces 1431-FR-004
  it('reads again on a confirmed booking', async () => {
    fake();
    answer = async () => todayFigures();
    const { element } = await opened();
    answer = async () => todayFigures({ bookingsThisWeek: 38 });

    live.emit('booking.confirmed');
    await vi.advanceTimersByTimeAsync(350);

    expect(reads).toBe(2);
    expect(card(element, 'bookings')?.value).toBe('38');
  });

  // @traces 1431-FR-004
  it.each([
    'request.created',
    'quote.accepted',
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
  ] as EventKind[])('reads again on %s', async (kind) => {
    fake();
    answer = async () => todayFigures();
    await opened();

    live.emit(kind);
    await vi.advanceTimersByTimeAsync(350);

    expect(reads).toBe(2);
  });

  // @traces 1431-FR-004
  it.each(['review.posted', 'mechanic.updated'] as EventKind[])(
    'does not read on %s',
    async (kind) => {
      fake();
      answer = async () => todayFigures();
      await opened();

      live.emit(kind);
      await vi.advanceTimersByTimeAsync(3_000);

      expect(reads).toBe(1);
    },
  );

  // @traces 1431-FR-004
  it('reads at most twice for a burst of seven events and shows the last answer', async () => {
    fake();
    answer = async () => todayFigures();
    const { element } = await opened();

    for (let i = 0; i < 7; i++) {
      answer = async () => todayFigures({ bookingsThisWeek: 40 + i });
      live.emit('booking.confirmed');
      await vi.advanceTimersByTimeAsync(140);
    }
    await vi.advanceTimersByTimeAsync(5_000);

    expect(reads - 1).toBeLessThanOrEqual(2);
    expect(reads - 1).toBeGreaterThanOrEqual(1);
    expect(card(element, 'bookings')?.value).toBe('46');
  });

  // @traces 1431-FR-004
  it('reads again when the live channel resyncs', async () => {
    fake();
    answer = async () => todayFigures();
    await opened();

    live.resync.next();
    await vi.advanceTimersByTimeAsync(350);

    expect(reads).toBe(2);
  });

  // @traces 1431-FR-004
  it('reads again at midnight in Bucharest, and every midnight after', async () => {
    fake();
    vi.setSystemTime(new Date('2026-10-31T21:59:30Z')); // 23:59:30 in Bucharest
    answer = async () => todayFigures();
    const { element } = await opened();
    answer = async () => todayFigures({ month: '2026-11-01' });

    await vi.advanceTimersByTimeAsync(29_000);
    expect(reads).toBe(1);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(reads).toBe(2);
    expect(card(element, 'work')?.label).toBe('Lucrări estimate, noiembrie');

    await vi.advanceTimersByTimeAsync(24 * 3_600_000);
    expect(reads).toBe(3);
  });

  // @traces 1431-FR-004
  it('stops the midnight timer when the section goes', async () => {
    fake();
    vi.setSystemTime(new Date('2026-10-31T21:59:30Z'));
    answer = async () => todayFigures();
    const { fixture } = await opened();

    fixture.destroy();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(reads).toBe(1);
  });

  // @traces 1431-FR-004
  it('reads once when a wake brings the resync and midnight together', async () => {
    fake();
    vi.setSystemTime(new Date('2026-10-31T21:59:59Z'));
    answer = async () => todayFigures();
    await opened();

    await vi.advanceTimersByTimeAsync(950);
    live.resync.next();
    await vi.advanceTimersByTimeAsync(1_000);

    expect(reads).toBe(2);
  });

  // @traces 1431-FR-004
  it('makes one more read after a read that was running when an event came', async () => {
    fake();
    answer = async () => todayFigures();
    const { element } = await opened();
    let answerNow: (value: TodayFiguresDto) => void = () => undefined;
    answer = () => new Promise((resolve) => (answerNow = resolve));

    live.emit('booking.confirmed');
    await vi.advanceTimersByTimeAsync(350);
    expect(reads).toBe(2);
    answer = async () => todayFigures({ bookingsThisWeek: 39 });
    live.emit('booking.moved');
    await vi.advanceTimersByTimeAsync(2_500);
    expect(reads).toBe(2);

    answerNow(todayFigures({ bookingsThisWeek: 38 }));
    await vi.advanceTimersByTimeAsync(50);

    expect(reads).toBe(3);
    expect(card(element, 'bookings')?.value).toBe('39');
  });

  // @traces 1431-FR-003
  it('keeps the cards when a re-read fails', async () => {
    fake();
    answer = async () => todayFigures();
    const { element } = await opened();
    answer = refuse(500);

    live.emit('booking.confirmed');
    await vi.advanceTimersByTimeAsync(350);

    expect(reads).toBe(2);
    expect(card(element, 'bookings')?.value).toBe('37');
    expect(element.querySelector('[role="alert"]')).toBeNull();
  });
});
