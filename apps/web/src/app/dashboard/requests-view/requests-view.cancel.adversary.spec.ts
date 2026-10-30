// @traces 1385-FR-002

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { EventKind, LiveMessage } from '@motor-fix/contracts';
import {
  type ActiveRequestAnswerDto,
  QuoteRequestsService,
  QuotesService,
  type RequestSummaryDto,
  RequestsService,
} from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';
import { filter, Subject } from 'rxjs';

import { RequestsView } from './requests-view';
import { Live } from '../live';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const row = (over: Partial<RequestSummaryDto> = {}): RequestSummaryDto => ({
  booking: null,
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
  quotesCount: 0,
  status: 'sent',
  ...over,
});

let events: Subject<LiveMessage>;
let list: jest.Mock;
let compare: jest.Mock;
let active: jest.Mock;
const activeAnswer: ActiveRequestAnswerDto = { openCount: 0, request: null };

// The active read left pending, for the specs about the list alone.

// The comparison panel's own reads; its behaviour is quotes-compare's spec.
const comparing = () => {
  compare = jest.fn(() => new Promise<never>(() => undefined));
  return [
    {
      provide: QuoteRequestsService,
      useValue: { compareControllerGet: compare },
    },
    { provide: QuotesService, useValue: { acceptControllerAccept: jest.fn() } },
  ];
};

async function render(
  answers: (RequestSummaryDto[] | Error)[],
  language: 'ro' | 'en' = 'ro',
) {
  events = new Subject();
  active = jest.fn(async () => activeAnswer);
  let call = 0;
  list = jest.fn(async () => {
    const items = answers[Math.min(call++, answers.length - 1)];
    if (items instanceof Error) throw items;
    return { items, nextCursor: null, total: items.length };
  });
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      ...comparing(),
      {
        provide: RequestsService,
        useValue: {
          activeRequestControllerGet: active,
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

const text = (el: Element) =>
  (el.textContent ?? '').replace(/\s+/g, ' ').trim();
const rows = (element: HTMLElement) => [
  ...element.querySelectorAll<HTMLElement>('[data-request]'),
];

afterEach(() => TestBed.resetTestingModule());

const HOURS = 3_600_000;
const GARAGE = {
  id: 'garage-1',
  name: 'Service Auto Militari',
  slug: 'service-auto-militari',
};
type Booking = NonNullable<RequestSummaryDto['booking']>;
const booking = (over: Partial<Booking> = {}): Booking => ({
  cancelledBySide: null,
  confirmBy: new Date(Date.now() + HOURS).toISOString(),
  finalPriceBani: null,
  garage: GARAGE,
  handedOverAt: null,
  id: 'booking-1',
  jobStarted: false,
  lateCancellation: false,
  startsAt: new Date(Date.now() + 24 * HOURS).toISOString(),
  status: 'confirmed',
  ...over,
});
const actionsOf = (element: HTMLElement) =>
  [...element.querySelectorAll<HTMLElement>('[data-request] .actions > *')].map(
    text,
  );
const lineOf = (element: HTMLElement, name: string) => {
  const found = element.querySelector(`[data-request] .${name}`);
  return found ? text(found) : null;
};
const cancelButton = (element: HTMLElement) =>
  element.querySelector<HTMLButtonElement>('[data-request] .actions button');

let opened: jest.Mock;
const dialogs = (answer: string) => {
  opened = jest.fn(async () => answer);
  TestBed.overrideProvider(Overlays, { useValue: { open: opened } });
};
const noCancel = (element: HTMLElement) =>
  [...element.querySelectorAll('[data-request] .actions button')].length;

// @traces 1385-FR-002
describe('Cererile mele: the cancel action on odd rows', () => {
  it('offers no cancel when the booking starts exactly now', async () => {
    jest.useFakeTimers({
      advanceTimers: true,
      now: new Date('2026-10-26T10:00:00Z'),
    });
    try {
      const { element } = await render([
        [
          row({
            booking: booking({ startsAt: '2026-10-26T10:00:00.000Z' }),
            status: 'booked',
          }),
        ],
      ]);

      expect(noCancel(element)).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it('offers no cancel on a booked request with no booking summary', async () => {
    const { element } = await render([
      [row({ booking: null, status: 'booked' })],
    ]);

    expect(noCancel(element)).toBe(0);
  });

  it('offers no cancel when the start time cannot be read as a date', async () => {
    const { element } = await render([
      [
        row({
          booking: booking({ startsAt: 'garbage' }),
          status: 'booked',
        }),
      ],
    ]);

    expect(noCancel(element)).toBe(0);
  });

  it('offers no cancel on a request in an unknown status', async () => {
    const { element } = await render([
      [row({ status: 'mystery' as RequestSummaryDto['status'] })],
    ]);

    expect(noCancel(element)).toBe(0);
  });

  it('offers no cancel on a request that is closed as cancelled', async () => {
    const { element } = await render([
      [row({ closedReason: 'cancelled', status: 'closed' })],
    ]);

    expect(noCancel(element)).toBe(0);
  });

  it('gives each of many rows exactly one cancel action, and opens the dialog for the one tapped', async () => {
    dialogs('cancelled');
    const many = Array.from({ length: 200 }, (_, i) =>
      row({ id: `req-${i}`, status: 'sent' }),
    );
    const { element, settle } = await render([many]);

    expect(element.querySelectorAll('[data-request] .actions')).toHaveLength(
      200,
    );
    expect(noCancel(element)).toBe(200);
    element
      .querySelectorAll<HTMLButtonElement>(
        '[data-request] .actions button',
      )[137]
      .click();
    await settle();

    expect(opened.mock.calls[0][1].data.requestId).toBe('req-137');
  });

  it('hands the dialog a description when the request has no jobs', async () => {
    dialogs('cancelled');
    const { element, settle } = await render([
      [
        row({
          description: 'Zgomot la frână\nal doilea rând',
          jobs: [],
          status: 'sent',
        }),
      ],
    ]);

    cancelButton(element)?.click();
    await settle();

    expect(opened.mock.calls[0][1].data.what).toBe('Zgomot la frână');
  });
});

// @traces 1385-FR-003
describe('Cererile mele: who cancelled, on odd rows', () => {
  it('does not claim the driver cancelled a closed booking_cancelled request with no booking summary', async () => {
    const { element } = await render([
      [
        row({
          booking: null,
          closedReason: 'booking_cancelled',
          status: 'closed',
        }),
      ],
    ]);

    expect(lineOf(element, 'cancelled')).toBeNull();
  });

  it('does not say Anulată de tine for a driver-cancelled booking while the request is still booked', async () => {
    const { element } = await render([
      [
        row({
          booking: booking({ cancelledBySide: 'driver', status: 'cancelled' }),
          status: 'booked',
        }),
      ],
    ]);

    expect(lineOf(element, 'cancelled')).toBeNull();
  });

  it('adds no late suffix to a request cancelled with no booking', async () => {
    const { element } = await render([
      [
        row({
          booking: booking({ lateCancellation: true }),
          closedReason: 'cancelled',
          status: 'closed',
        }),
      ],
    ]);

    expect(lineOf(element, 'cancelled')).toBe('Anulată de tine');
  });

  it('shows the cancelled-booking line in English on a quoted request', async () => {
    const { element } = await render(
      [
        [
          row({
            booking: booking({
              cancelledBySide: 'driver',
              status: 'cancelled',
            }),
            quotesCount: 2,
            status: 'quoted',
          }),
        ],
      ],
      'en',
    );

    expect(text(rows(element)[0])).toContain(
      'You cancelled the booking. You can choose another quote.',
    );
  });

  it('shows the cancelled-booking line on no row whose booking the system cancelled', async () => {
    const { element } = await render([
      [
        row({
          booking: booking({ cancelledBySide: 'system', status: 'cancelled' }),
          quotesCount: 2,
          status: 'quoted',
        }),
      ],
    ]);

    expect(text(rows(element)[0])).not.toContain('Ai anulat programarea');
    expect(actionsOf(element)).toEqual([
      'Compară ofertele',
      'Anulează cererea',
    ]);
  });
});

// @traces 1385-FR-006
describe('Cererile mele: the answer of a cancel dialog', () => {
  it('does not re-read the list when the dialog is closed without a cancel', async () => {
    dialogs('cancelled');
    const { element, settle } = await render([
      [row({ booking: booking(), status: 'booked' })],
    ]);

    cancelButton(element)?.click();
    await settle();
    await settle();

    expect(list).toHaveBeenCalledTimes(1);
  });

  it('opens one dialog when the action is tapped twice before the first answers', async () => {
    opened = jest.fn(() => new Promise<string>(() => undefined));
    TestBed.overrideProvider(Overlays, { useValue: { open: opened } });
    const { element, settle } = await render([[row({ status: 'sent' })]]);

    cancelButton(element)?.click();
    cancelButton(element)?.click();
    await settle();

    expect(opened).toHaveBeenCalledTimes(1);
  });
});
