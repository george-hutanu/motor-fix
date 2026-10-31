import { TestBed } from '@angular/core/testing';
import type { EventKind, LiveMessage } from '@motor-fix/contracts';
import { GarageJobsService, type JobSummaryDto } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';
import { filter, Subject } from 'rxjs';

import { OwnJobsSection } from './own-jobs-section';
import { Live } from '../../live';

const base: JobSummaryDto = {
  bookingId: 'b',
  canRecordNoShow: false,
  canWithdrawNoShow: false,
  car: {
    brand: 'Dacia',
    engine: '1.5 dCi',
    fuel: 'diesel',
    model: 'Logan',
    odometerKm: 84000,
    plate: 'B 101 QAT',
    year: 2018,
  },
  createdAt: '2026-10-01T09:00:00.000Z',
  driver: { shortName: 'Andrei M.' },
  etaAt: null,
  finishedAt: null,
  handedOverAt: null,
  id: 'j',
  jobs: [
    {
      id: 'rj',
      jobTypeId: 't',
      nameEn: 'Brake pads',
      nameRo: 'Plăcuțe de frână',
      position: 0,
    },
  ],
  mechanicId: 'm',
  mechanicName: 'Elena Stan',
  noShowAt: null,
  odometerKm: null,
  pausedAt: null,
  receivedAt: null,
  startedAt: null,
  startsAt: '2026-10-09T09:00:00.000Z',
  status: 'to_do',
  stepsDone: 0,
  stepsTotal: 0,
  workedSeconds: 0,
};
const job = (id: string, over: Partial<JobSummaryDto> = {}): JobSummaryDto => ({
  ...base,
  id,
  ...over,
});

const frozen = (now: string) =>
  jest.useFakeTimers({
    doNotFake: [
      'nextTick',
      'setImmediate',
      'clearImmediate',
      'setTimeout',
      'clearTimeout',
      'setInterval',
      'clearInterval',
      'queueMicrotask',
      'requestAnimationFrame',
      'cancelAnimationFrame',
      'requestIdleCallback',
      'cancelIdleCallback',
      'hrtime',
      'performance',
    ],
    now: new Date(now),
  });

async function render(
  now: string,
  items: JobSummaryDto[] | (() => Promise<unknown>),
  language: 'ro' | 'en' = 'ro',
) {
  frozen(now);
  const events = new Subject<LiveMessage>();
  TestBed.configureTestingModule({
    providers: [
      {
        provide: GarageJobsService,
        useValue: {
          garageJobsControllerList: async () =>
            typeof items === 'function'
              ? items()
              : { items, nextCursor: null, total: items.length },
        },
      },
      { provide: Overlays, useValue: { open: jest.fn() } },
      {
        provide: Live,
        useValue: {
          events,
          on: (kinds: readonly EventKind[]) =>
            events.pipe(
              filter((m) => (kinds as readonly string[]).includes(m.kind)),
            ),
          resync: new Subject<void>(),
        },
      },
    ],
  });
  await TestBed.inject(I18n).enter('garage');
  if (language === 'en') await TestBed.inject(I18n).use('en');
  const fixture = TestBed.createComponent(OwnJobsSection);
  for (let i = 0; i < 3; i++) {
    fixture.detectChanges();
    await fixture.whenStable();
  }
  return fixture.nativeElement as HTMLElement;
}

const text = (el: Element | null) =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const ids = (el: HTMLElement) =>
  [...el.querySelectorAll<HTMLElement>('[data-job]')].map(
    (r) => r.dataset['job'],
  );

afterEach(() => {
  jest.useRealTimers();
  TestBed.resetTestingModule();
});

// @traces 423-FR-001
describe("Bucharest's day on the own jobs", () => {
  it('counts 23:59 Bucharest as today and 00:00 the next day as later', async () => {
    const el = await render('2026-10-09T07:00:00Z', [
      job('late', { startsAt: '2026-10-09T20:59:00Z' }),
      job('midnight', { startsAt: '2026-10-09T21:00:00Z' }),
    ]);
    expect(ids(el)).toEqual(['late']);
    expect(text(el.querySelector('[data-next]'))).toContain('Logan');
  });

  it('counts 00:00 Bucharest as today and the minute before as yesterday', async () => {
    const el = await render('2026-10-09T07:00:00Z', [
      job('before', { startsAt: '2026-10-08T20:59:00Z' }),
      job('after', { startsAt: '2026-10-08T21:00:00Z' }),
    ]);
    expect(ids(el)).toEqual(['after']);
  });

  it('uses the Bucharest day, not the UTC day, when the clock is after local midnight', async () => {
    const el = await render('2026-10-09T21:30:00Z', [
      job('local-today', { startsAt: '2026-10-09T21:10:00Z' }),
      job('utc-today', { startsAt: '2026-10-09T10:00:00Z' }),
    ]);
    expect(ids(el)).toEqual(['local-today']);
  });

  it('keeps the whole day of the autumn clock change: 00:30 and 23:59 are today', async () => {
    const el = await render('2026-10-25T09:00:00Z', [
      job('first', { startsAt: '2026-10-24T21:30:00Z' }),
      job('last', { startsAt: '2026-10-25T21:59:00Z' }),
      job('next-day', { startsAt: '2026-10-25T22:00:00Z' }),
    ]);
    expect(ids(el)).toEqual(['first', 'last']);
  });

  it('keeps the whole day of the spring clock change: 23:30 is today, 00:00 after is not', async () => {
    const el = await render('2026-03-29T09:00:00Z', [
      job('first', { startsAt: '2026-03-28T22:00:00Z' }),
      job('last', { startsAt: '2026-03-29T20:59:00Z' }),
      job('next-day', { startsAt: '2026-03-29T21:00:00Z' }),
    ]);
    expect(ids(el)).toEqual(['first', 'last']);
  });
});

// @traces 423-FR-001
describe('the next booking and the rows by status', () => {
  const NOW = '2026-10-09T07:00:00Z';

  it('does not name a job starting exactly now as the next booking', async () => {
    const el = await render(NOW, [
      job('now', { startsAt: NOW }),
      job('later', { startsAt: '2026-10-09T09:00:00Z' }),
    ]);
    expect(text(el.querySelector('[data-next]'))).toBe(
      'Următoarea programare: 12:00 · Dacia Logan',
    );
  });

  it('names a job one millisecond after now', async () => {
    const el = await render(NOW, [
      job('soon', { startsAt: '2026-10-09T07:00:00.001Z' }),
    ]);
    expect(text(el.querySelector('[data-next]'))).toBe(
      'Următoarea programare: 10:00 · Dacia Logan',
    );
  });

  it('shows no next line when the only job started earlier today', async () => {
    const el = await render(NOW, [
      job('past', { startsAt: '2026-10-09T05:00:00Z' }),
    ]);
    expect(el.querySelector('[data-next]')).toBeNull();
  });

  it('never names a cancelled job as the next booking', async () => {
    const el = await render(NOW, [
      job('cancelled', {
        startsAt: '2026-10-09T08:00:00Z',
        status: 'cancelled',
      }),
      job('real', {
        car: { ...base.car, brand: 'Skoda', model: 'Octavia' },
        startsAt: '2026-10-10T08:00:00Z',
      }),
    ]);
    expect(text(el.querySelector('[data-next]'))).toContain('Octavia');
  });

  it("does not count a cancelled job today among the day's load", async () => {
    const el = await render(NOW, [
      job('a', { startsAt: '2026-10-09T08:00:00Z' }),
      job('x', { startsAt: '2026-10-09T09:00:00Z', status: 'cancelled' }),
    ]);
    expect(text(el.querySelector('[data-load]'))).toBe(
      '1 lucrare azi · 0 terminate',
    );
  });

  it('orders rows by start whatever order the read answers in', async () => {
    const el = await render(NOW, [
      job('c', { startsAt: '2026-10-09T15:00:00Z' }),
      job('a', { startsAt: '2026-10-09T05:00:00Z' }),
      job('b', { startsAt: '2026-10-09T09:00:00Z' }),
    ]);
    expect(ids(el)).toEqual(['a', 'b', 'c']);
  });

  it('keeps the read order for two jobs that start together', async () => {
    const el = await render(NOW, [
      job('first', { startsAt: '2026-10-09T09:00:00Z' }),
      job('second', { startsAt: '2026-10-09T09:00:00Z' }),
    ]);
    expect(ids(el)).toEqual(['first', 'second']);
  });

  it('shows a paused job of last month among the rows', async () => {
    const el = await render(NOW, [
      job('old', { startsAt: '2026-08-01T09:00:00Z', status: 'paused' }),
    ]);
    expect(ids(el)).toEqual(['old']);
  });

  it('writes an empty plate as no plate', async () => {
    const el = await render(NOW, [
      job('a', { car: { ...base.car, plate: '' } }),
    ]);
    expect(text(el.querySelector('[data-job]'))).toBe(
      '12:00 · Dacia Logan · Plăcuțe de frână · De făcut',
    );
  });

  it('writes a job with no works without a dangling separator', async () => {
    const el = await render(NOW, [job('a', { jobs: [] })]);
    expect(text(el.querySelector('[data-job]'))).toBe(
      '12:00 · Dacia Logan · B 101 QAT · De făcut',
    );
  });

  it('renders markup in a plate or work name as text', async () => {
    const el = await render(NOW, [
      job('a', {
        car: { ...base.car, plate: '<img src=x onerror=alert(1)>' },
      }),
    ]);
    expect(el.querySelector('img')).toBeNull();
    expect(text(el.querySelector('[data-job]'))).toContain('<img src=x');
  });

  it('handles ten thousand jobs of the day', async () => {
    const many = Array.from({ length: 10000 }, (_, i) =>
      job(`j${i}`, { startsAt: '2026-10-09T09:00:00Z' }),
    );
    const el = await render(NOW, many);
    expect(el.querySelectorAll('[data-job]')).toHaveLength(10000);
    expect(text(el.querySelector('[data-load]'))).toBe(
      '10000 de lucrări azi · 0 terminate',
    );
  });
});

// @traces 423-FR-001
describe('the Romanian count forms of the load line', () => {
  const NOW = '2026-10-09T07:00:00Z';
  const many = (n: number, done: number) =>
    Array.from({ length: n }, (_, i) =>
      job(`j${i}`, {
        startsAt: '2026-10-09T09:00:00Z',
        status: i < done ? 'done' : 'to_do',
      }),
    );

  it.each([
    [1, 1, '1 lucrare azi · 1 terminată'],
    [2, 2, '2 lucrări azi · 2 terminate'],
    [19, 19, '19 lucrări azi · 19 terminate'],
    [20, 20, '20 de lucrări azi · 20 de terminate'],
    [21, 21, '21 de lucrări azi · 21 de terminate'],
    [22, 0, '22 de lucrări azi · 0 terminate'],
    [101, 101, '101 lucrări azi · 101 terminate'],
    [102, 2, '102 lucrări azi · 2 terminate'],
  ])('writes %i jobs with %i done', async (n, done, line) => {
    const el = await render(NOW, many(n, done));
    expect(text(el.querySelector('[data-load]'))).toBe(line);
  });

  it('writes the English plurals at 1 and 2', async () => {
    const one = await render(NOW, many(1, 0), 'en');
    expect(text(one.querySelector('[data-load]'))).toBe('1 job today · 0 done');
  });
});
