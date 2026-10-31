import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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
    noShowAt: null,
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

const closed = { finalPriceBani: 125050, handedOverAt: HANDED_OVER };

// @traces 1393-FR-010
// @traces 1393-FR-017
describe('Cererile mele once the garage hands the car over', () => {
  it('closes the row on its day with the final price', async () => {
    const { element } = await render([[row(closed)]]);

    expect(text(card(element)?.querySelector('.status') ?? null)).toBe(
      'Încheiată pe 3 oct.',
    );
    expect(text(amount(element))).toBe('1.250,50 lei');
    expect(spoken(element)).toBe('Preț final 1.250,50 lei');
    expect(card(element)?.querySelector('time')).not.toBeNull();
  });

  it('writes it in English', async () => {
    const { element } = await render([[row(closed)]], 'en');

    expect(text(card(element)?.querySelector('.status') ?? null)).toBe(
      'Closed on 3 Oct',
    );
    expect(text(amount(element))).toBe('1,250.50 lei');
    expect(spoken(element)).toBe('Final price 1,250.50 lei');
  });

  it('shows a done row not yet handed over as before, with no amount', async () => {
    const { element } = await render([[row({})]]);

    expect(text(card(element)?.querySelector('.status') ?? null)).not.toContain(
      'Încheiată',
    );
    expect(amountEl(element)).toBeNull();
  });

  it('closes the row with no amount when no price is recorded', async () => {
    const { element } = await render([
      [row({ finalPriceBani: null, handedOverAt: HANDED_OVER })],
    ]);

    expect(text(card(element))).toContain('Încheiată pe 3 oct.');
    expect(amountEl(element)).toBeNull();
  });

  // PR #636 lap 2: the largest amount on a closed row at 320 px.
  it('writes the largest amount whole, on a head that wraps rather than scrolls', async () => {
    const { element } = await render([
      [row({ finalPriceBani: 100_000_000, handedOverAt: HANDED_OVER })],
    ]);

    expect(text(amount(element))).toBe('1.000.000 lei');
    const css = readFileSync(join(__dirname, 'requests-view.css'), 'utf8');
    expect(css).toMatch(/\.head \{[^}]*flex-wrap: wrap;/);
    expect(css).toMatch(/\.amount \{[^}]*white-space: nowrap;/);
  });
});

// @traces 1393-FR-012
// @traces 1393-FR-017
describe('Cererile mele and the final price events', () => {
  it.each(['job.handed_over', 'job.final_price_corrected'] as const)(
    'reads the list again on %s',
    async (kind) => {
      const { element, settle } = await render([[row({})], [row(closed)]]);
      expect(amountEl(element)).toBeNull();

      events.next({ at: new Date().toISOString(), id: 'job-1', kind });
      await wait(400);
      await settle();

      expect(list).toHaveBeenCalledTimes(2);
      expect(text(amount(element))).toBe('1.250,50 lei');
    },
  );

  it('still reads nothing again for an undone decline', async () => {
    await render([[row({})]]);

    events.next({
      at: new Date().toISOString(),
      id: 'req-1',
      kind: 'request.decline_undone',
    });
    await wait(400);

    expect(list).toHaveBeenCalledTimes(1);
  });
});
