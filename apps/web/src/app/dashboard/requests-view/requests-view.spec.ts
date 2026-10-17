import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
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
      { provide: RequestsService, useValue: { requestsControllerList: list } },
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

// @traces 222-FR-007
// @traces 222-FR-009
describe('Cererile mele once a quote is accepted', () => {
  const HOUR = 3_600_000;
  const booked = (confirmIn: number, status = 'awaiting_confirmation') =>
    row({
      booking: {
        confirmBy: new Date(Date.now() + confirmIn).toISOString(),
        status: status as 'awaiting_confirmation',
      },
      quotesCount: 2,
      status: 'booked',
    });
  const waiting = (element: HTMLElement) =>
    element.querySelector('[data-request] .waiting');

  it('shows Programată with the hours left for the garage to confirm', async () => {
    const { element } = await render([[booked(5 * HOUR + 30 * 60_000)]]);

    expect(text(rows(element)[0])).toContain('Programată');
    const line = waiting(element);
    expect(line && text(line)).toBe(
      'Așteaptă confirmarea service‑ului · încă 5 h',
    );
  });

  it('writes it in English for an English reader', async () => {
    const { element } = await render([[booked(5 * HOUR + 30 * 60_000)]], 'en');

    expect(text(rows(element)[0])).toContain('Booked');
    const line = waiting(element);
    expect(line && text(line)).toBe('Waiting for the garage · 5 h left');
  });

  it('counts minutes under an hour and moments under a minute', async () => {
    const minutes = await render([[booked(42 * 60_000 + 10_000)]]);
    const minutesLine = waiting(minutes.element);
    expect(minutesLine && text(minutesLine)).toBe(
      'Așteaptă confirmarea service‑ului · încă 42 min',
    );
    TestBed.resetTestingModule();

    const moments = await render([[booked(20_000)]], 'en');
    const momentsLine = waiting(moments.element);
    expect(momentsLine && text(momentsLine)).toBe(
      'Waiting for the garage · moments left',
    );
  });

  it.each(['confirmed', 'lapsed', 'cancelled'])(
    'shows no waiting line once the booking is %s',
    async (status) => {
      const { element } = await render([[booked(5 * HOUR, status)]]);

      expect(waiting(element)).toBeNull();
    },
  );

  it('shows no waiting line on a request with no booking', async () => {
    const { element } = await render([[row({ status: 'quoted' })]]);

    expect(waiting(element)).toBeNull();
  });

  it('counts the time down as the minutes pass', async () => {
    jest.useFakeTimers({
      advanceTimers: true,
      doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'],
    });
    try {
      const { element, settle } = await render([[booked(61 * 60_000)]]);
      expect(text(waiting(element) as Element)).toContain('încă 1 h');

      jest.advanceTimersByTime(2 * 60_000);
      await settle();

      expect(text(waiting(element) as Element)).toContain('încă 59 min');
    } finally {
      jest.useRealTimers();
    }
  });

  it('reads the list again when the driver accepts a quote, from this tab or another', async () => {
    const { element, settle } = await render([
      [row({ quotesCount: 2, status: 'quoted' })],
      [booked(24 * HOUR)],
    ]);

    events.next({
      at: new Date().toISOString(),
      id: 'quote-1',
      kind: 'quote.accepted',
    });
    await wait(400);
    await settle();

    expect(list).toHaveBeenCalledTimes(2);
    expect(waiting(element)).not.toBeNull();
  });
});

// @traces 221-FR-014, 221-SC-002
describe('Cererile mele', () => {
  it('shows each request with its car, jobs, status and how long ago, in the order read', async () => {
    const { element } = await render([
      [
        row(),
        row({
          createdAt: new Date(Date.now() - 3 * 3_600_000).toISOString(),
          description: 'Scârțâie la frânare\nmai ales dimineața',
          id: 'req-0',
          jobs: [],
          status: 'quoted',
        }),
      ],
    ]);

    const [first, second] = rows(element);
    expect(text(first)).toContain('Dacia Logan 2017');
    expect(text(first)).toContain('Schimb ulei');
    expect(text(first)).toContain('Trimisă');
    expect(text(first)).toContain('acum câteva secunde');
    expect(text(second)).toContain('Scârțâie la frânare');
    expect(text(second)).not.toContain('dimineața');
    expect(text(second)).toContain('Ofertă');
    expect(text(second)).toContain('acum 3 ore');
  });

  it('names the jobs and the status in English for an English reader', async () => {
    const { element } = await render([[row()]], 'en');

    const [first] = rows(element);
    expect(text(first)).toContain('Oil change');
    expect(text(first)).toContain('Sent');
    expect(text(first)).toContain('a few seconds ago');
  });

  // @traces 030-FR-009
  it('says there is no request yet in the shared empty state, with Caută un service to Home', async () => {
    const { element } = await render([[]]);

    const empty = element.querySelector('mf-empty-state') as HTMLElement;
    expect(text(empty)).toContain(
      'Nicio cerere încă. Cere oferte de la mai multe service‑uri deodată.',
    );
    expect(empty.querySelector('svg[data-icon="inbox"]')).not.toBeNull();
    const link = empty.querySelector('a[href="/ro"]');
    expect(link && text(link)).toBe('Caută un service');
    expect(text(element)).not.toContain('Cerere nouă');
  });

  // @traces 030-FR-009
  it('says it in English for an English reader', async () => {
    const { element } = await render([[]], 'en');

    const empty = element.querySelector('mf-empty-state') as HTMLElement;
    expect(text(empty)).toContain(
      'No requests yet. Ask several garages for a quote at once.',
    );
    const link = empty.querySelector('a[href="/en"]');
    expect(link && text(link)).toBe('Find a garage');
  });

  it('reads the list again when a request is created elsewhere', async () => {
    const { element, settle } = await render([[], [row()]]);
    expect(rows(element)).toHaveLength(0);

    events.next({
      at: new Date().toISOString(),
      id: 'req-1',
      kind: 'request.created',
    });
    await wait(400);
    await settle();

    expect(list).toHaveBeenCalledTimes(2);
    expect(rows(element)).toHaveLength(1);
  });

  // @traces 344-FR-015
  it('reads the list again when a garage sends a quote', async () => {
    const { element, settle } = await render([
      [row()],
      [row({ quotesCount: 1, status: 'quoted' })],
    ]);

    events.next({
      at: new Date().toISOString(),
      id: 'quote-1',
      kind: 'quote.sent',
    });
    await wait(400);
    await settle();

    expect(list).toHaveBeenCalledTimes(2);
    expect(text(rows(element)[0])).toContain('Ofertă');
  });

  // @traces 345-FR-016
  it('reads the list again when a garage’s decline window closes', async () => {
    await render([[row()], [row()]]);

    events.next({
      at: new Date().toISOString(),
      id: 'rr-1',
      kind: 'request.declined',
    });
    await wait(400);

    expect(list).toHaveBeenCalledTimes(2);
  });

  // @traces 345-FR-016
  it('reads nothing again for an undone decline, which the driver never saw', async () => {
    await render([[row()], [row()]]);

    events.next({
      at: new Date().toISOString(),
      id: 'rr-1',
      kind: 'request.decline_undone',
    });
    await wait(400);

    expect(list).toHaveBeenCalledTimes(1);
  });

  it('offers a retry when the first read fails, and shows the list after it', async () => {
    const { element, settle } = await render([new Error('down'), [row()]]);

    expect(element.querySelector('[role="alert"]')).not.toBeNull();
    const retry = [...element.querySelectorAll('button')].find(
      (b) => text(b) === 'Încearcă din nou',
    );
    retry?.click();
    await settle();

    expect(rows(element)).toHaveLength(1);
  });
});

describe('Cererile mele opened at a request', () => {
  let scrolled: jest.Mock;

  async function open(url: string) {
    events = new Subject();
    scrolled = jest.fn();
    Element.prototype.scrollIntoView = scrolled;
    list = jest.fn(async () => {
      const items = [row(), row({ id: 'req-2' })];
      return { items, nextCursor: null, total: items.length };
    });
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          {
            children: [{ component: RequestsView, path: '**' }],
            path: 'requests',
          },
        ]),
        ...comparing(),
        {
          provide: RequestsService,
          useValue: { requestsControllerList: list },
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
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(url);
    await settled(harness);
    return harness;
  }

  async function settled(harness: RouterTestingHarness) {
    for (let i = 0; i < 4; i++) {
      harness.detectChanges();
      await harness.fixture.whenStable();
      await wait(0);
    }
  }

  const focused = () =>
    (document.activeElement as HTMLElement | null)?.getAttribute(
      'data-request',
    );

  // @traces 032-FR-004
  it('scrolls the request named in the address into view and focuses its row', async () => {
    await open('/requests/req-2');

    expect(focused()).toBe('req-2');
    expect(scrolled).toHaveBeenCalledTimes(1);
    expect(scrolled.mock.contexts[0]).toBe(document.activeElement);
  });

  // @traces 032-FR-004
  it('does not scroll again when the list is read again live', async () => {
    const harness = await open('/requests/req-2');

    events.next({
      at: new Date().toISOString(),
      id: 'req-3',
      kind: 'request.created',
    });
    await wait(400);
    await settled(harness);

    expect(list).toHaveBeenCalledTimes(2);
    expect(scrolled).toHaveBeenCalledTimes(1);
  });

  // @traces 032-FR-004 032-FR-005
  it('opens at the top with nothing focused for a request not listed', async () => {
    await open('/requests/gone');

    expect(focused()).toBeNull();
    expect(scrolled).not.toHaveBeenCalled();
  });
});

// @traces 313-FR-013
describe('Cererile mele comparing a request’s quotes', () => {
  const ITEMS = [
    row({
      createdAt: '2026-10-12T09:00:00.000Z',
      id: 'req-none',
      quotesCount: 0,
    }),
    row({
      createdAt: '2026-10-11T09:00:00.000Z',
      id: 'req-new',
      quotesCount: 2,
      status: 'quoted',
    }),
    row({
      createdAt: '2026-10-10T09:00:00.000Z',
      id: 'req-old',
      quotesCount: 1,
      status: 'quoted',
    }),
  ];

  async function open(url: string, items = ITEMS) {
    events = new Subject();
    list = jest.fn(async () => ({
      items,
      nextCursor: null,
      total: items.length,
    }));
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          {
            children: [{ component: RequestsView, path: '**' }],
            path: 'requests',
          },
        ]),
        ...comparing(),
        {
          provide: RequestsService,
          useValue: { requestsControllerList: list },
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
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(url);
    for (let i = 0; i < 4; i++) {
      harness.detectChanges();
      await harness.fixture.whenStable();
      await wait(0);
    }
    return harness.routeNativeElement as HTMLElement;
  }

  const shown = () =>
    compare.mock.calls.map(([args]) => (args as { id: string }).id);

  it('shows the panel above the list for the most recent open request with quotes', async () => {
    const element = await open('/requests');

    const panel = element.querySelector('mf-quotes-compare');
    const rows = element.querySelector('ul.rows');
    expect(panel).not.toBeNull();
    expect(rows).not.toBeNull();
    expect(
      panel!.compareDocumentPosition(rows!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
    expect(shown()).toEqual(['req-new']);
  });

  it('frames the panel under "Oferte primite", apart from the list', async () => {
    const element = await open('/requests');

    const frame = element
      .querySelector('mf-quotes-compare')
      ?.closest('mf-panel');
    expect(frame).not.toBeNull();
    expect(text(frame!)).toContain('Oferte primite');
    expect(frame!.contains(element.querySelector('ul.rows'))).toBe(false);
  });

  it('shows the request the address names', async () => {
    await open('/requests?request=req-old');

    expect(shown()).toEqual(['req-old']);
  });

  it.each([
    ['not the driver’s', 'req-someone-else'],
    ['without quotes', 'req-none'],
  ])('falls back to the default for a request %s', async (_, id) => {
    await open(`/requests?request=${id}`);

    expect(shown()).toEqual(['req-new']);
  });

  it('shows no panel while no open request has quotes', async () => {
    const element = await open('/requests', [
      row({ quotesCount: 2, status: 'done' }),
    ]);

    expect(element.querySelector('mf-quotes-compare')).toBeNull();
    expect(compare).not.toHaveBeenCalled();
  });

  it('links each request with quotes to its comparison, and no other', async () => {
    const element = await open('/requests');

    const linkOf = (id: string) =>
      element
        .querySelector(`[data-request="${id}"] a[href*="request="]`)
        ?.getAttribute('href');
    expect(linkOf('req-new')).toBe('/app/driver/requests?request=req-new');
    expect(linkOf('req-old')).toBe('/app/driver/requests?request=req-old');
    expect(linkOf('req-none')).toBeUndefined();
  });
});
