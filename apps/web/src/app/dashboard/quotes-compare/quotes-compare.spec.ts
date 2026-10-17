import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { EventKind, LiveMessage } from '@motor-fix/contracts';
import {
  type CompareQuoteDto,
  type QuoteComparisonDto,
  QuoteRequestsService,
  QuotesService,
} from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { filter, Subject } from 'rxjs';

import { QuotesCompare } from './quotes-compare';
import { Live } from '../live';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const garage = (
  name: string,
  over: Partial<CompareQuoteDto['garage']> = {},
) => ({
  area: 'București',
  id: `g-${name}`,
  mobile: false,
  name,
  rating: 4.5,
  reviewCount: 10,
  slug: name.toLowerCase().replace(/\s+/g, '-'),
  ...over,
});

const quote = (over: Partial<CompareQuoteDto> = {}): CompareQuoteDto => ({
  changedAt: null,
  durationMinutes: 60,
  expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
  fromBani: 15_000,
  garage: garage('Atelier Dinamo'),
  id: 'q-1',
  jobs: [
    {
      included: true,
      nameEn: 'Oil change',
      nameRo: 'Schimb ulei',
      requestJobId: 'rj-1',
    },
  ],
  note: null,
  sentAt: '2026-10-17T08:00:00.000Z',
  slot: new Date(Date.now() + 2 * 86_400_000).toISOString(),
  status: 'waiting',
  toBani: 22_000,
  ...over,
});

const FAST = quote({
  fromBani: 30_000,
  id: 'q-fast',
  sentAt: '2026-10-17T08:00:00.000Z',
});
const CHEAP = quote({
  fromBani: 10_000,
  garage: garage('Volt Service'),
  id: 'q-cheap',
  sentAt: '2026-10-17T09:00:00.000Z',
});

const comparison = (
  over: Partial<QuoteComparisonDto> = {},
): QuoteComparisonDto => ({
  declined: [],
  quotes: [FAST, CHEAP],
  request: {
    booking: null,
    car: {
      brand: 'Mini',
      engine: null,
      fuel: 'petrol',
      model: 'Cooper S',
      year: 2019,
    },
    description: null,
    id: 'req-1',
    jobs: [
      {
        id: 'rj-1',
        jobTypeId: 'job-oil',
        nameEn: 'Oil change',
        nameRo: 'Schimb ulei',
        position: 0,
      },
    ],
    status: 'quoted',
  },
  waiting: [],
  withdrawn: [],
  ...over,
});

type Answer = QuoteComparisonDto | Error | Promise<never>;

let events: Subject<LiveMessage>;
let offline: ReturnType<typeof signal<boolean>>;
let read: jest.Mock;
let accept: jest.Mock;

async function render(
  answers: Answer[],
  {
    language = 'ro',
    accepts = [],
  }: {
    language?: 'ro' | 'en';
    accepts?: (Promise<unknown> | Error | HttpErrorResponse)[];
  } = {},
) {
  events = new Subject();
  offline = signal(false);
  let call = 0;
  read = jest.fn(() => {
    const answer = answers[Math.min(call++, answers.length - 1)];
    return answer instanceof Error
      ? Promise.reject(answer)
      : Promise.resolve(answer);
  });
  let click = 0;
  accept = jest.fn(() => {
    const answer =
      accepts[Math.min(click++, accepts.length - 1)] ?? Promise.resolve({});
    // The client rejects with an HttpErrorResponse, which is not an Error.
    return answer instanceof Error || answer instanceof HttpErrorResponse
      ? Promise.reject(answer)
      : answer;
  });
  TestBed.configureTestingModule({
    providers: [
      {
        provide: QuoteRequestsService,
        useValue: { compareControllerGet: read },
      },
      { provide: QuotesService, useValue: { acceptControllerAccept: accept } },
      {
        provide: Live,
        useValue: {
          events,
          offline,
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
  const fixture = TestBed.createComponent(QuotesCompare);
  fixture.componentRef.setInput('requestId', 'req-1');
  const element = fixture.nativeElement as HTMLElement;
  const settle = async () => {
    for (let i = 0; i < 4; i++) {
      fixture.detectChanges();
      await fixture.whenStable();
      await wait(0);
    }
  };
  await settle();
  return { element, fixture, settle };
}

const emit = (kind: EventKind, id = 'req-1') =>
  events.next({ at: new Date().toISOString(), id, kind } as LiveMessage);

const text = (el: Element | null | undefined) =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const header = (element: HTMLElement) =>
  text(element.querySelector('[data-part="header"]'));
const rows = (element: HTMLElement) => [
  ...element.querySelectorAll<HTMLElement>('li[data-quote]'),
];
const order = (element: HTMLElement) =>
  rows(element).map((r) => r.dataset['quote']);
const lines = (element: HTMLElement) =>
  [...element.querySelectorAll('[data-line]')].map((l) => text(l));
const acceptOf = (row: HTMLElement | undefined) =>
  row?.querySelector<HTMLButtonElement>('button') ?? null;
const radio = (element: HTMLElement, name: string) =>
  [...element.querySelectorAll<HTMLInputElement>('input[type="radio"]')].find(
    (r) => text(r.closest('label')) === name,
  );

afterEach(() => {
  TestBed.resetTestingModule();
  sessionStorage.clear();
});

// @traces 313-FR-005
describe('the comparison panel', () => {
  it('reads the request’s quotes once', async () => {
    await render([comparison()]);

    expect(read).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledWith({ id: 'req-1' });
  });

  it('heads the rows with the jobs, the car and the count', async () => {
    const { element } = await render([comparison()]);

    expect(header(element)).toBe('Schimb ulei · Mini Cooper S · 2 oferte');
  });

  it('says it in English for an English reader', async () => {
    const { element } = await render([comparison()], { language: 'en' });

    expect(header(element)).toBe('Oil change · Mini Cooper S · 2 quotes');
  });

  it.each([
    [1, '1 ofertă'],
    [21, '21 de oferte'],
  ])('counts %i quotes as "%s"', async (n, count) => {
    const quotes = Array.from({ length: n }, (_, i) =>
      quote({ id: `q-${String(i).padStart(2, '0')}` }),
    );
    const { element } = await render([comparison({ quotes })]);

    expect(header(element)).toBe(`Schimb ulei · Mini Cooper S · ${count}`);
    expect(rows(element)).toHaveLength(n);
  });

  it('leaves the quotes the driver declined out of the count but keeps their rows', async () => {
    const declined = quote({ id: 'q-no', status: 'declined_by_driver' });
    const { element } = await render([
      comparison({ quotes: [FAST, CHEAP, declined] }),
    ]);

    expect(header(element)).toContain('2 oferte');
    expect(rows(element)).toHaveLength(3);
  });

  it('lists the rows fastest answer first', async () => {
    const { element } = await render([comparison({ quotes: [CHEAP, FAST] })]);

    expect(order(element)).toEqual(['q-fast', 'q-cheap']);
  });
});

// @traces 313-FR-009
describe('the lines under the rows', () => {
  const withLines = comparison({
    declined: [
      { declineReason: 'make_model_engine_not_done', garageName: 'Garaj Nord' },
    ],
    waiting: ['Service Auto Militari'],
    withdrawn: [
      { garageName: 'Volt Auto', reason: 'garage' },
      { garageName: 'Garaj Est', reason: 'suspended' },
    ],
  });

  it('says who withdrew, who no longer takes requests and who declined, and why', async () => {
    const { element } = await render([withLines]);

    expect(lines(element)).toEqual([
      'Volt Auto și‑a retras oferta',
      'Garaj Est nu mai primește cereri',
      'Refuzat: Garaj Nord · nu lucrează pe această marcă, model sau motor',
    ]);
  });

  it('says it in English for an English reader', async () => {
    const { element } = await render([withLines], { language: 'en' });

    expect(lines(element)).toEqual([
      'Volt Auto withdrew its quote',
      'Garaj Est no longer takes requests',
      'Declined: Garaj Nord · it does not work on this make, model or engine',
    ]);
  });

  it('gives a withdrawn or declined garage no row and no count', async () => {
    const { element } = await render([withLines]);

    expect(rows(element).map((r) => text(r))).not.toContainEqual(
      expect.stringContaining('Volt Auto'),
    );
    expect(header(element)).toContain('2 oferte');
  });

  it('shows no line for the garages that have not answered yet', async () => {
    const { element } = await render([withLines]);

    expect(text(element)).not.toContain('Service Auto Militari');
  });
});

// @traces 313-FR-014
describe('the comparison panel’s states', () => {
  it('shows three skeleton rows, marked busy, while the read is in flight', async () => {
    const { element } = await render([new Promise<never>(() => undefined)]);

    const busy = element.querySelector('[aria-busy="true"]');
    expect(busy?.querySelectorAll('.skeleton')).toHaveLength(3);
    expect(rows(element)).toHaveLength(0);
  });

  it('says the quotes could not be loaded, and reads again on Reîncearcă', async () => {
    const { element, settle } = await render([new Error('down'), comparison()]);

    expect(text(element)).toContain('Nu am putut încărca ofertele.');
    [...element.querySelectorAll('button')]
      .find((b) => text(b) === 'Reîncearcă')
      ?.click();
    await settle();

    expect(read).toHaveBeenCalledTimes(2);
    expect(rows(element)).toHaveLength(2);
  });

  it('says it in English for an English reader', async () => {
    const { element } = await render([new Error('down')], { language: 'en' });

    expect(text(element)).toContain('We could not load the quotes.');
    expect(
      [...element.querySelectorAll('button')].map((b) => text(b)),
    ).toContain('Retry');
  });

  it('keeps the rows offline with Acceptă disabled, leaving the offline line to the dashboard', async () => {
    const { element, settle } = await render([comparison()]);

    offline.set(true);
    await settle();

    expect(rows(element)).toHaveLength(2);
    expect(text(element)).not.toContain('Fără conexiune');
    for (const row of rows(element)) expect(acceptOf(row)?.disabled).toBe(true);
  });

  it('keeps the rows when a background re-read fails', async () => {
    const { element, settle } = await render([comparison(), new Error('down')]);

    emit('quote.sent');
    await wait(400);
    await settle();

    expect(read).toHaveBeenCalledTimes(2);
    expect(rows(element)).toHaveLength(2);
    expect(text(element)).not.toContain('Nu am putut încărca ofertele.');
  });

  it('shows one quote as one row', async () => {
    const { element } = await render([comparison({ quotes: [FAST] })]);

    expect(order(element)).toEqual(['q-fast']);
  });

  it('shows the empty state when every quote was withdrawn', async () => {
    const { element } = await render([
      comparison({
        quotes: [],
        withdrawn: [{ garageName: 'Volt Auto', reason: 'garage' }],
      }),
    ]);

    expect(rows(element)).toHaveLength(0);
    expect(text(element)).toContain(
      'Încă nu ai oferte. Trimite o cerere și compari ofertele aici.',
    );
  });
});

// @traces 313-FR-004
// @traces 313-FR-015
describe('sorting the comparison', () => {
  const SORTS = ['Cele mai rapide', 'Preț', 'Cel mai devreme', 'Notă'];

  it('offers the four sorts as one radio group, the fastest chosen', async () => {
    const { element } = await render([comparison()]);

    const group = element.querySelector('[role="radiogroup"]');
    const options = [
      ...(group?.querySelectorAll<HTMLInputElement>('input[type="radio"]') ??
        []),
    ];
    expect(options.map((o) => text(o.closest('label')))).toEqual(SORTS);
    expect(
      options.filter((o) => o.checked).map((o) => text(o.closest('label'))),
    ).toEqual(['Cele mai rapide']);
  });

  it('names the sorts in English for an English reader', async () => {
    const { element } = await render([comparison()], { language: 'en' });

    expect(
      [...element.querySelectorAll('[role="radiogroup"] label')].map((l) =>
        text(l),
      ),
    ).toEqual(['Fastest', 'Price', 'Earliest', 'Rating']);
  });

  it('re-sorts by price without reading again', async () => {
    const { element, settle } = await render([comparison()]);

    radio(element, 'Preț')?.click();
    await settle();

    expect(order(element)).toEqual(['q-cheap', 'q-fast']);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('keeps the chosen sort for a later panel in the same tab', async () => {
    const first = await render([comparison()]);
    radio(first.element, 'Preț')?.click();
    await first.settle();
    TestBed.resetTestingModule();

    const { element } = await render([comparison()]);

    expect(radio(element, 'Preț')?.checked).toBe(true);
    expect(order(element)).toEqual(['q-cheap', 'q-fast']);
  });

  it('starts a new tab on the fastest', async () => {
    sessionStorage.clear();
    const { element } = await render([comparison()]);

    expect(radio(element, 'Cele mai rapide')?.checked).toBe(true);
  });

  it('starts on the fastest when the storage cannot be read', async () => {
    const getItem = jest
      .spyOn(Storage.prototype, 'getItem')
      .mockImplementation(() => {
        throw new Error('SecurityError');
      });
    try {
      const { element } = await render([comparison()]);

      expect(radio(element, 'Cele mai rapide')?.checked).toBe(true);
      expect(order(element)).toEqual(['q-fast', 'q-cheap']);
    } finally {
      getItem.mockRestore();
    }
  });
});

// @traces 313-FR-010
// @traces 313-FR-015
describe('the comparison kept current', () => {
  it.each([
    'quote.sent',
    'quote.changed',
    'quote.withdrawn',
    'quote.expired',
    'quote.declined_by_driver',
    'request.declined',
    'request.decline_undone',
    'garage.suspended',
    'quote.accepted',
    'booking.confirmed',
    'booking.lapsed',
  ] as const)('reads again when %s arrives', async (kind) => {
    const { settle } = await render([comparison()]);

    emit(kind);
    await wait(400);
    await settle();

    expect(read).toHaveBeenCalledTimes(2);
  });

  it('reads once for a burst of events', async () => {
    const { settle } = await render([comparison()]);

    emit('quote.sent');
    emit('quote.changed');
    emit('quote.sent');
    await wait(400);
    await settle();

    expect(read).toHaveBeenCalledTimes(2);
  });

  it('reads nothing again for other kinds', async () => {
    const { settle } = await render([comparison()]);

    emit('message.sent');
    await wait(400);
    await settle();

    expect(read).toHaveBeenCalledTimes(1);
  });

  it('puts a new quote in its sorted place, keeps the unchanged rows’ elements and follows the count', async () => {
    const third = quote({ id: 'q-mid', sentAt: '2026-10-17T08:30:00.000Z' });
    const { element, settle } = await render([
      comparison(),
      comparison({ quotes: [FAST, CHEAP, third] }),
    ]);
    const before = rows(element);

    emit('quote.sent');
    await wait(400);
    await settle();

    expect(order(element)).toEqual(['q-fast', 'q-mid', 'q-cheap']);
    expect(rows(element)[0]).toBe(before[0]);
    expect(rows(element)[2]).toBe(before[1]);
    expect(header(element)).toContain('3 oferte');
  });

  it('announces the header and the lines politely', async () => {
    const { element } = await render([
      comparison({
        withdrawn: [{ garageName: 'Volt Auto', reason: 'garage' }],
      }),
    ]);

    const polite = [...element.querySelectorAll('[aria-live="polite"]')];
    expect(
      polite.some((r) =>
        r.contains(element.querySelector('[data-part="header"]')),
      ),
    ).toBe(true);
    expect(
      polite.some((r) => r.contains(element.querySelector('[data-line]'))),
    ).toBe(true);
  });

  it('gives the waiting rows Acceptă back once the booking lapsed', async () => {
    const held = comparison({
      quotes: [FAST, { ...CHEAP, status: 'accepted' }],
      request: {
        ...comparison().request,
        booking: {
          confirmBy: new Date(Date.now() + 3_600_000).toISOString(),
          status: 'awaiting_confirmation',
        },
        status: 'booked',
      },
    });
    const lapsed = comparison({
      quotes: [FAST, { ...CHEAP, status: 'expired' }],
      request: {
        ...comparison().request,
        booking: {
          confirmBy: new Date(Date.now() - 3_600_000).toISOString(),
          status: 'lapsed',
        },
      },
    });
    const { element, settle } = await render([held, lapsed]);
    expect(text(rows(element)[0])).toContain('În așteptare');
    expect(acceptOf(rows(element)[0])).toBeNull();

    emit('booking.lapsed');
    await wait(400);
    await settle();

    expect(text(acceptOf(rows(element)[0]))).toBe('Acceptă');
  });
});

// @traces 313-FR-008
describe('accepting a quote from the comparison', () => {
  const keyOf = (call: number) =>
    (accept.mock.calls[call][0] as { 'Idempotency-Key': string })[
      'Idempotency-Key'
    ];

  it('accepts with history not shared and a fresh key, then reads again', async () => {
    const { element, settle } = await render([comparison()]);

    acceptOf(rows(element)[1])?.click();
    await settle();

    expect(accept).toHaveBeenCalledWith({
      body: { historyShared: false },
      'Idempotency-Key': expect.stringMatching(/^[0-9a-f-]{36}$/),
      id: 'q-cheap',
    });
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('makes a new key for each click', async () => {
    const { element, settle } = await render([comparison()]);

    acceptOf(rows(element)[0])?.click();
    await settle();
    acceptOf(rows(element)[0])?.click();
    await settle();

    expect(keyOf(0)).not.toBe(keyOf(1));
  });

  it('repeats the key when the same click is retried after no answer', async () => {
    const { element, settle } = await render([comparison()], {
      accepts: [new HttpErrorResponse({ status: 0 }), Promise.resolve({})],
    });

    acceptOf(rows(element)[0])?.click();
    await settle();
    acceptOf(rows(element)[0])?.click();
    await settle();

    expect(accept).toHaveBeenCalledTimes(2);
    expect(keyOf(1)).toBe(keyOf(0));
  });

  it('shows the busy button and disables the other rows while in flight', async () => {
    const { element, settle } = await render([comparison()], {
      accepts: [new Promise(() => undefined)],
    });

    acceptOf(rows(element)[0])?.click();
    await settle();

    expect(acceptOf(rows(element)[0])?.getAttribute('aria-busy')).toBe('true');
    expect(acceptOf(rows(element)[1])?.disabled).toBe(true);
    acceptOf(rows(element)[1])?.click();
    expect(accept).toHaveBeenCalledTimes(1);
  });

  it('shows a refusal under its row and changes nothing', async () => {
    const refusal = new HttpErrorResponse({
      error: {
        code: 'quote_not_waiting',
        detail: 'Oferta nu mai poate fi acceptată.',
        status: 409,
        title: 'Conflict',
      },
      status: 409,
    });
    const { element, settle } = await render([comparison()], {
      accepts: [refusal],
    });

    acceptOf(rows(element)[1])?.click();
    await settle();

    expect(text(rows(element)[1])).toContain(
      'Oferta nu mai poate fi acceptată.',
    );
    expect(text(rows(element)[0])).not.toContain(
      'Oferta nu mai poate fi acceptată.',
    );
    expect(text(acceptOf(rows(element)[1]))).toBe('Acceptă');
    expect(read).toHaveBeenCalledTimes(1);
  });
});
