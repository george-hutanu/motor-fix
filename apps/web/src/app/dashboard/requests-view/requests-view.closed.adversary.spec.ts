import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { EventKind, LiveMessage } from '@motor-fix/contracts';
import {
  QuoteRequestsService,
  QuotesService,
  type RequestSummaryDto,
  RequestsService,
} from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { filter, Subject } from 'rxjs';

import { RequestsView } from './requests-view';
import { Live } from '../live';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

// 3 October, 14:00 in Bucharest.
const HANDED_OVER = '2026-10-03T11:00:00.000Z';

const row = (
  booking: Partial<NonNullable<RequestSummaryDto['booking']>> | null,
): RequestSummaryDto => ({
  booking: booking && {
    cancelledBySide: null,
    confirmBy: '2026-10-01T09:00:00.000Z',
    finalPriceBani: null,
    garage: {
      id: 'garage-1',
      name: 'Service Auto Militari',
      slug: 'service-auto-militari',
    },
    handedOverAt: null,
    id: 'booking-1',
    jobStarted: true,
    lateCancellation: false,
    startsAt: '2026-10-02T06:00:00.000Z',
    status: 'confirmed',
    ...booking,
  },
  car: {
    brand: 'Dacia',
    engine: null,
    fuel: 'petrol',
    model: 'Logan',
    year: 2017,
  },
  closedAt: null,
  closedReason: null,
  createdAt: new Date(Date.now() - 5_000).toISOString(),
  description: null,
  expiresAt: '2026-10-16T09:00:00.000Z',
  id: 'req-1',
  jobs: [
    {
      id: 'rj-1',
      jobTypeId: 'job-oil',
      nameEn: 'Oil change',
      nameRo: 'Schimb ulei',
      position: 1,
    },
  ],
  quotesCount: 1,
  status: 'done',
});

let events: Subject<LiveMessage>;
let list: jest.Mock;

async function render(
  answers: RequestSummaryDto[][],
  language: 'ro' | 'en' = 'ro',
) {
  events = new Subject();
  let call = 0;
  list = jest.fn(async () => {
    const items = answers[Math.min(call++, answers.length - 1)];
    return { items, nextCursor: null, total: items.length };
  });
  const pending = () => new Promise<never>(() => undefined);
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      {
        provide: QuoteRequestsService,
        useValue: { compareControllerGet: jest.fn(pending) },
      },
      {
        provide: QuotesService,
        useValue: { acceptControllerAccept: jest.fn() },
      },
      {
        provide: RequestsService,
        useValue: {
          activeRequestControllerGet: jest.fn(async () => ({
            openCount: 0,
            request: null,
          })),
          requestsControllerList: list,
        },
      },
      {
        provide: Live,
        useValue: {
          events,
          offline: signal(false),
          on: (kinds: readonly EventKind[]) =>
            events.pipe(
              filter((m) => (kinds as readonly string[]).includes(m.kind)),
            ),
          resync: new Subject<void>(),
        },
      },
    ],
  });
  await TestBed.inject(I18n).enter('driver');
  if (language === 'en') await TestBed.inject(I18n).use('en');
  const fixture = TestBed.createComponent(RequestsView);
  const element = fixture.nativeElement as HTMLElement;
  const settle = async () => {
    for (let i = 0; i < 3; i++) {
      fixture.detectChanges();
      await fixture.whenStable();
      await wait(0);
    }
  };
  await settle();
  return { element, settle };
}

const text = (el: Element | null) =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const card = (element: HTMLElement) =>
  element.querySelector<HTMLElement>('[data-request]');
const amountEl = (element: HTMLElement) =>
  element.querySelector<HTMLElement>('[data-request] [data-amount]');
// What the row shows, and what a screen reader says for it.
const amount = (element: HTMLElement) =>
  amountEl(element)?.querySelector('[aria-hidden="true"]') ?? null;
const spoken = (element: HTMLElement) =>
  text(amountEl(element)?.querySelector('.sr-only') ?? null);

afterEach(() => TestBed.resetTestingModule());

const status = (element: HTMLElement) =>
  text(card(element)?.querySelector('.status') ?? null);
const closed = { finalPriceBani: 125050, handedOverAt: HANDED_OVER };

// @traces 1393-FR-010
describe('the closed row under hostile data', () => {
  it.each([
    ['2026-10-03T20:59:59.000Z', 'Încheiată pe 3 oct.'],
    ['2026-10-03T21:00:00.000Z', 'Încheiată pe 4 oct.'],
    ['2026-12-31T21:59:59.000Z', 'Încheiată pe 31 dec.'],
    ['2026-12-31T22:00:00.000Z', 'Încheiată pe 1 ian.'],
  ])('puts a handover at %s on the Bucharest day: %s', async (at, said) => {
    const { element } = await render([
      [row({ finalPriceBani: 100, handedOverAt: at })],
    ]);

    expect(status(element)).toBe(said);
  });

  it('writes the Bucharest day in English across midnight', async () => {
    const { element } = await render(
      [
        [
          row({
            finalPriceBani: 100,
            handedOverAt: '2026-10-03T21:30:00.000Z',
          }),
        ],
      ],
      'en',
    );

    expect(status(element)).toBe('Closed on 4 Oct');
  });

  it.each([
    [100_000_000, '1.000.000 lei'],
    [1, '0,01 lei'],
    [100, '1 lei'],
  ])('shows %d bani as "%s"', async (bani, shown) => {
    const { element } = await render([
      [row({ finalPriceBani: bani, handedOverAt: HANDED_OVER })],
    ]);

    expect(text(amount(element))).toBe(shown);
    expect(spoken(element)).toBe(`Preț final ${shown}`);
  });

  it('shows no Invalid Date or NaN for an unparseable handover time', async () => {
    const { element } = await render([
      [row({ finalPriceBani: 100, handedOverAt: 'garbage' })],
    ]);

    expect(text(card(element))).not.toMatch(/Invalid|NaN|undefined|null/);
  });

  it('shows no amount for a closed row whose price is missing and no placeholder either', async () => {
    const { element } = await render([
      [row({ finalPriceBani: null, handedOverAt: HANDED_OVER })],
    ]);

    expect(text(card(element))).not.toMatch(/NaN|undefined|null|0 lei/);
  });

  it('shows the amount only on the handed over row among many', async () => {
    const { element } = await render([
      [
        { ...row({}), id: 'req-a' },
        { ...row(closed), id: 'req-b' },
        { ...row({}), id: 'req-c' },
      ],
    ]);

    expect(element.querySelectorAll('[data-request]')).toHaveLength(3);
    expect(element.querySelectorAll('[data-amount]')).toHaveLength(1);
  });

  it('offers no cancel on the closed row', async () => {
    const { element } = await render([[row(closed)]]);
    const names = [...(card(element)?.querySelectorAll('button, a') ?? [])].map(
      (e) => text(e),
    );

    expect(names.filter((n) => /Anulează|Cancel/i.test(n))).toEqual([]);
  });

  it('shows a request with no booking as before, no amount', async () => {
    const { element } = await render([[row(null)]]);

    expect(amountEl(element)).toBeNull();
    expect(text(card(element))).not.toContain('Încheiată pe');
  });
});

// @traces 1393-FR-012
describe('the list and a burst of final price events', () => {
  it('reads once for a burst of handover and correction events', async () => {
    await render([[row({})], [row(closed)]]);
    for (let i = 0; i < 5; i++) {
      events.next({
        at: new Date().toISOString(),
        id: 'j',
        kind: 'job.handed_over',
      });
    }
    events.next({
      at: new Date().toISOString(),
      id: 'j',
      kind: 'job.final_price_corrected',
    });
    await wait(400);

    expect(list).toHaveBeenCalledTimes(2);
  });

  it('shows the corrected amount after a correction event', async () => {
    const { element, settle } = await render([
      [row(closed)],
      [row({ finalPriceBani: 115000, handedOverAt: HANDED_OVER })],
    ]);
    expect(text(amount(element))).toBe('1.250,50 lei');
    events.next({
      at: new Date().toISOString(),
      id: 'j',
      kind: 'job.final_price_corrected',
    });
    await wait(400);
    await settle();

    expect(text(amount(element))).toBe('1.150 lei');
  });

  it('keeps the row it has when the re-read fails', async () => {
    const { element, settle } = await render([[row(closed)]]);
    list.mockRejectedValueOnce(new Error('down'));
    events.next({
      at: new Date().toISOString(),
      id: 'j',
      kind: 'job.final_price_corrected',
    });
    await wait(400);
    await settle();

    expect(text(amount(element))).toBe('1.250,50 lei');
  });

  it.each(['job.step_done', 'job.started', 'job.done'] as const)(
    'does not read the list again for %s',
    async (kind) => {
      await render([[row({})]]);
      events.next({ at: new Date().toISOString(), id: 'j', kind });
      await wait(400);

      expect(list).toHaveBeenCalledTimes(1);
    },
  );
});
