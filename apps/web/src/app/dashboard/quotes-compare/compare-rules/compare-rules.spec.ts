import type {
  CompareQuoteDto,
  CompareRequestDto,
  RequestSummaryDto,
} from '@motor-fix/data-access';

import {
  headerCount,
  headerWhat,
  openRequestOf,
  rowState,
  SORT_KEY,
  sortQuotes,
  storedSort,
} from './compare-rules';

const NOW = new Date('2026-10-17T10:00:00.000Z');

const quote = (over: Partial<CompareQuoteDto> = {}): CompareQuoteDto => ({
  changedAt: null,
  durationMinutes: 60,
  expiresAt: '2026-10-24T10:00:00.000Z',
  fromBani: 15_000,
  garage: {
    area: 'București',
    id: 'g-1',
    mobile: false,
    name: 'Atelier Dinamo',
    rating: 4.7,
    reviewCount: 31,
    slug: 'atelier-dinamo',
  },
  id: 'q-1',
  jobs: [],
  note: null,
  sentAt: '2026-10-17T08:00:00.000Z',
  slot: '2026-10-19T09:00:00.000Z',
  status: 'waiting',
  toBani: 22_000,
  ...over,
});

const rated = (rating: number | null, reviewCount: number) => ({
  ...quote().garage,
  rating,
  reviewCount,
});

const summary = (over: Partial<RequestSummaryDto> = {}): RequestSummaryDto => ({
  booking: null,
  car: {
    brand: 'Mini',
    engine: null,
    fuel: 'petrol',
    model: 'Cooper S',
    year: 2019,
  },
  closedAt: null,
  closedReason: null,
  createdAt: '2026-10-10T09:00:00.000Z',
  description: null,
  expiresAt: '2026-10-24T09:00:00.000Z',
  id: 'req-1',
  jobs: [],
  quotesCount: 2,
  status: 'quoted',
  ...over,
});

const ids = (quotes: CompareQuoteDto[]) => quotes.map((q) => q.id);

// @traces 313-FR-005
describe('the header', () => {
  it('counts every row but the ones the driver declined', () => {
    const quotes = [
      quote({ id: 'a' }),
      quote({ id: 'b', status: 'expired' }),
      quote({ id: 'c', status: 'lost' }),
      quote({ id: 'd', status: 'accepted' }),
      quote({ id: 'e', status: 'declined_by_driver' }),
    ];

    expect(headerCount(quotes)).toBe(4);
  });

  it.each([1, 3, 21])('counts %i quotes', (n) => {
    const quotes = Array.from({ length: n }, (_, i) => quote({ id: `q-${i}` }));

    expect(headerCount(quotes)).toBe(n);
  });

  const request = (
    over: Partial<CompareRequestDto> = {},
  ): CompareRequestDto => ({
    booking: null,
    car: summary().car,
    description: 'Scârțâie la frânare',
    id: 'req-1',
    jobs: [
      {
        id: 'rj-1',
        jobTypeId: 'j-1',
        nameEn: 'Air-con diagnosis',
        nameRo: 'Diagnoză climă',
        position: 0,
      },
      {
        id: 'rj-2',
        jobTypeId: 'j-2',
        nameEn: 'Oil change',
        nameRo: 'Schimb ulei',
        position: 1,
      },
    ],
    status: 'quoted',
    ...over,
  });

  it('names the jobs in the reader’s language, joined by a comma', () => {
    expect(headerWhat(request(), 'ro')).toBe('Diagnoză climă, Schimb ulei');
    expect(headerWhat(request(), 'en')).toBe('Air-con diagnosis, Oil change');
  });

  it('names a request without a job by its description', () => {
    expect(headerWhat(request({ jobs: [] }), 'ro')).toBe('Scârțâie la frânare');
  });
});

// @traces 313-FR-007
describe('a row’s state', () => {
  it.each([
    ['waiting', 'open'],
    ['expired', 'expired'],
    ['declined_by_driver', 'declined'],
    ['accepted', 'accepted'],
    ['lost', 'closed'],
  ] as const)('reads %s as %s', (status, state) => {
    expect(rowState(quote({ status }), null, NOW)).toBe(state);
  });

  it('reads a waiting quote past its expiry as expired', () => {
    const late = quote({ expiresAt: '2026-10-17T09:59:59.000Z' });

    expect(rowState(late, null, NOW)).toBe('expired');
  });

  it('holds every waiting quote while the newest booking waits for the garage', () => {
    const booking = {
      confirmBy: '2026-10-18T10:00:00.000Z',
      status: 'awaiting_confirmation' as const,
    };

    expect(rowState(quote(), booking, NOW)).toBe('on_hold');
    expect(rowState(quote({ status: 'accepted' }), booking, NOW)).toBe(
      'accepted',
    );
  });

  it('gives a waiting quote its action back once the booking lapsed', () => {
    const booking = {
      confirmBy: '2026-10-16T10:00:00.000Z',
      status: 'lapsed' as const,
    };

    expect(rowState(quote(), booking, NOW)).toBe('open');
  });
});

// @traces 313-FR-012
describe('the request the overview shows', () => {
  it('picks the most recent quoted request with quotes', () => {
    const items = [
      summary({
        createdAt: '2026-10-11T09:00:00.000Z',
        id: 'newest-no-quotes',
        quotesCount: 0,
      }),
      summary({ createdAt: '2026-10-09T09:00:00.000Z', id: 'older' }),
      summary({ createdAt: '2026-10-10T09:00:00.000Z', id: 'newer' }),
    ];

    expect(openRequestOf(items)?.id).toBe('newer');
  });

  it('takes a booked request only while its booking waits for the garage', () => {
    const waiting = summary({
      booking: {
        confirmBy: '2026-10-18T10:00:00.000Z',
        status: 'awaiting_confirmation',
      },
      createdAt: '2026-10-12T09:00:00.000Z',
      id: 'waiting',
      status: 'booked',
    });
    const confirmed = summary({
      booking: { confirmBy: '2026-10-18T10:00:00.000Z', status: 'confirmed' },
      createdAt: '2026-10-13T09:00:00.000Z',
      id: 'confirmed',
      status: 'booked',
    });

    expect(openRequestOf([confirmed, waiting, summary()])?.id).toBe('waiting');
  });

  it('finds none among sent, done and closed requests', () => {
    const items = (['sent', 'done', 'closed'] as const).map((status) =>
      summary({ id: status, status }),
    );

    expect(openRequestOf(items)).toBeUndefined();
  });
});

// @traces 313-FR-004
describe('sorting the rows', () => {
  it('keeps the fastest answer first, equal times by id', () => {
    const quotes = [
      quote({ id: 'c', sentAt: '2026-10-17T09:00:00.000Z' }),
      quote({ id: 'b', sentAt: '2026-10-17T08:00:00.000Z' }),
      quote({ id: 'a', sentAt: '2026-10-17T08:00:00.000Z' }),
    ];

    expect(ids(sortQuotes(quotes, 'fastest'))).toEqual(['a', 'b', 'c']);
  });

  it('orders by the low end of the price, then the high end, then the fastest answer', () => {
    const quotes = [
      quote({ fromBani: 20_000, id: 'dear', toBani: 25_000 }),
      quote({ fromBani: 15_000, id: 'wide', toBani: 30_000 }),
      quote({ fromBani: 15_000, id: 'narrow', toBani: 20_000 }),
      quote({
        fromBani: 15_000,
        id: 'late',
        sentAt: '2026-10-17T09:00:00.000Z',
        toBani: 20_000,
      }),
    ];

    expect(ids(sortQuotes(quotes, 'price'))).toEqual([
      'narrow',
      'late',
      'wide',
      'dear',
    ]);
  });

  it('orders by the earliest slot', () => {
    const quotes = [
      quote({ id: 'later', slot: '2026-10-20T09:00:00.000Z' }),
      quote({ id: 'sooner', slot: '2026-10-18T09:00:00.000Z' }),
    ];

    expect(ids(sortQuotes(quotes, 'earliest'))).toEqual(['sooner', 'later']);
  });

  it('orders by rating high to low, more reviews first on a tie, the unrated last', () => {
    const quotes = [
      quote({ garage: rated(null, 0), id: 'unrated' }),
      quote({ garage: rated(4.5, 10), id: 'good' }),
      quote({ garage: rated(4.9, 3), id: 'best-few' }),
      quote({ garage: rated(4.9, 40), id: 'best-many' }),
      quote({ garage: rated(1.0, 2), id: 'poor' }),
    ];

    expect(ids(sortQuotes(quotes, 'rating'))).toEqual([
      'best-many',
      'best-few',
      'good',
      'poor',
      'unrated',
    ]);
  });

  it('sorts greyed rows with the rest under the same rule', () => {
    const quotes = [
      quote({ fromBani: 30_000, id: 'live' }),
      quote({ fromBani: 10_000, id: 'expired', status: 'expired' }),
      quote({ fromBani: 20_000, id: 'lost', status: 'lost' }),
    ];

    expect(ids(sortQuotes(quotes, 'price'))).toEqual([
      'expired',
      'lost',
      'live',
    ]);
  });

  it('leaves the list it was given as it was', () => {
    const quotes = [
      quote({ fromBani: 2, id: 'b' }),
      quote({ fromBani: 1, id: 'a' }),
    ];

    sortQuotes(quotes, 'price');

    expect(ids(quotes)).toEqual(['b', 'a']);
  });
});

// @traces 313-FR-004
describe('the sort kept for the tab', () => {
  it('is stored under one key', () => {
    expect(SORT_KEY).toBe('mf.quotes.sort');
  });

  it('reads a stored sort back', () => {
    expect(storedSort(() => 'price')).toBe('price');
  });

  it('starts on the fastest with nothing stored, an unknown value or storage that throws', () => {
    expect(storedSort(() => null)).toBe('fastest');
    expect(storedSort(() => 'cheapest')).toBe('fastest');
    expect(
      storedSort(() => {
        throw new Error('SecurityError');
      }),
    ).toBe('fastest');
  });
});
