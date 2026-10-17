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

const request = (over: Partial<CompareRequestDto> = {}): CompareRequestDto => ({
  booking: null,
  car: summary().car,
  description: null,
  id: 'req-1',
  jobs: [],
  status: 'quoted',
  ...over,
});

const job = (position: number, nameRo: string, nameEn: string) => ({
  id: `rj-${position}`,
  jobTypeId: `j-${position}`,
  nameEn,
  nameRo,
  position,
});

const ids = (quotes: CompareQuoteDto[]) => quotes.map((q) => q.id);

// @traces 313-FR-004
describe('sorting the rows, the edges', () => {
  it.each(['fastest', 'price', 'earliest', 'rating'] as const)(
    'gives an empty list back for %s',
    (sort) => {
      expect(sortQuotes([], sort)).toEqual([]);
    },
  );

  it('gives one quote back for every sort', () => {
    const only = quote({ id: 'only' });

    for (const sort of ['fastest', 'price', 'earliest', 'rating'] as const) {
      expect(ids(sortQuotes([only], sort))).toEqual(['only']);
    }
  });

  it('orders equal slots by the fastest answer, then id', () => {
    const quotes = [
      quote({ id: 'c', sentAt: '2026-10-17T09:00:00.000Z' }),
      quote({ id: 'b', sentAt: '2026-10-17T08:00:00.000Z' }),
      quote({ id: 'a', sentAt: '2026-10-17T08:00:00.000Z' }),
    ];

    expect(ids(sortQuotes(quotes, 'earliest'))).toEqual(['a', 'b', 'c']);
  });

  it('orders equal price ranges by the fastest answer, then id', () => {
    const quotes = [
      quote({ id: 'b', sentAt: '2026-10-17T08:00:00.000Z' }),
      quote({ id: 'a', sentAt: '2026-10-17T08:00:00.000Z' }),
      quote({ id: 'z', sentAt: '2026-10-17T07:00:00.000Z' }),
    ];

    expect(ids(sortQuotes(quotes, 'price'))).toEqual(['z', 'a', 'b']);
  });

  it('ranks a 4.9 with one review above a 4.8 with a hundred', () => {
    const quotes = [
      quote({ garage: rated(4.8, 100), id: 'many' }),
      quote({ garage: rated(4.9, 1), id: 'few' }),
    ];

    expect(ids(sortQuotes(quotes, 'rating'))).toEqual(['few', 'many']);
  });

  it('orders an equal rating and review count by the fastest answer, then id', () => {
    const quotes = [
      quote({ garage: rated(4.5, 10), id: 'b' }),
      quote({ garage: rated(4.5, 10), id: 'a' }),
      quote({
        garage: rated(4.5, 10),
        id: 'z',
        sentAt: '2026-10-17T07:00:00.000Z',
      }),
    ];

    expect(ids(sortQuotes(quotes, 'rating'))).toEqual(['z', 'a', 'b']);
  });

  it('keeps several unrated garages after every rated one, in the fastest order', () => {
    const quotes = [
      quote({
        garage: rated(null, 0),
        id: 'u2',
        sentAt: '2026-10-17T09:00:00.000Z',
      }),
      quote({ garage: rated(1, 1), id: 'low' }),
      quote({
        garage: rated(null, 0),
        id: 'u1',
        sentAt: '2026-10-17T07:00:00.000Z',
      }),
    ];

    expect(ids(sortQuotes(quotes, 'rating'))).toEqual(['low', 'u1', 'u2']);
  });

  it('sorts a sent time given with an offset by the moment it names', () => {
    const quotes = [
      quote({ id: 'a', sentAt: '2026-10-17T09:00:00.000+03:00' }),
      quote({ id: 'b', sentAt: '2026-10-17T07:30:00.000Z' }),
    ];

    expect(ids(sortQuotes(quotes, 'fastest'))).toEqual(['a', 'b']);
  });

  it('sorts a thousand quotes without losing or repeating one', () => {
    const quotes = Array.from({ length: 1000 }, (_, i) =>
      quote({
        fromBani: (i * 7919) % 1000,
        id: `q-${String(i).padStart(4, '0')}`,
      }),
    );

    const sorted = sortQuotes(quotes, 'price');

    expect(new Set(ids(sorted)).size).toBe(1000);
    expect(sorted.map((q) => q.fromBani)).toEqual(
      [...quotes.map((q) => q.fromBani)].sort((a, b) => a - b),
    );
  });
});

// @traces 313-FR-004
describe('the stored sort, hostile values', () => {
  it.each([
    '',
    ' price',
    'PRICE',
    'constructor',
    '__proto__',
    'toString',
    'hasOwnProperty',
    'null',
    'undefined',
  ])('starts on the fastest for %j', (value) => {
    expect(storedSort(() => value)).toBe('fastest');
  });

  it('starts on the fastest when the read answers undefined', () => {
    expect(storedSort(() => undefined as unknown as null)).toBe('fastest');
  });

  it.each(['fastest', 'price', 'earliest', 'rating'])('keeps %s', (value) => {
    expect(storedSort(() => value)).toBe(value);
  });
});

// @traces 313-FR-005
describe('the header, the edges', () => {
  it('counts no rows as zero', () => {
    expect(headerCount([])).toBe(0);
  });

  it('counts zero when the driver declined every row', () => {
    const quotes = [
      quote({ id: 'a', status: 'declined_by_driver' }),
      quote({ id: 'b', status: 'declined_by_driver' }),
    ];

    expect(headerCount(quotes)).toBe(0);
  });

  it('counts a waiting quote past its expiry, which still has a row', () => {
    expect(
      headerCount([quote({ expiresAt: '2020-01-01T00:00:00.000Z' })]),
    ).toBe(1);
  });

  it('names the jobs in position order whatever order they arrive in', () => {
    const jobs = [
      job(1, 'Schimb ulei', 'Oil change'),
      job(0, 'Diagnoză climă', 'Air-con diagnosis'),
    ];

    expect(headerWhat(request({ jobs }), 'ro')).toBe(
      'Diagnoză climă, Schimb ulei',
    );
  });

  it('prefers the jobs to the description when it has both', () => {
    const jobs = [job(0, 'Schimb ulei', 'Oil change')];

    expect(headerWhat(request({ description: 'Scârțâie', jobs }), 'en')).toBe(
      'Oil change',
    );
  });

  it('reads nothing, not the word null, for a request with no job and no description', () => {
    expect(headerWhat(request(), 'ro')).toBe('');
  });
});

// @traces 313-FR-007
describe('a row’s state, the edges', () => {
  const awaiting = {
    confirmBy: '2026-10-18T10:00:00.000Z',
    status: 'awaiting_confirmation' as const,
  };

  it('keeps a waiting quote open one millisecond before it expires', () => {
    const q = quote({ expiresAt: '2026-10-17T10:00:00.001Z' });

    expect(rowState(q, null, NOW)).toBe('open');
  });

  it('reads an expired waiting quote as expired, not on hold, while a booking waits', () => {
    const q = quote({ expiresAt: '2026-10-17T09:00:00.000Z' });

    expect(rowState(q, awaiting, NOW)).toBe('expired');
  });

  it.each([
    ['expired', 'expired'],
    ['declined_by_driver', 'declined'],
    ['lost', 'closed'],
    ['accepted', 'accepted'],
  ] as const)('keeps %s as %s while a booking waits', (status, state) => {
    expect(rowState(quote({ status }), awaiting, NOW)).toBe(state);
  });

  it.each(['confirmed', 'cancelled', 'no_show', 'completed'] as const)(
    'leaves a waiting quote open when the newest booking is %s',
    (status) => {
      const booking = { confirmBy: '2026-10-18T10:00:00.000Z', status };

      expect(rowState(quote(), booking, NOW)).toBe('open');
    },
  );
});

// @traces 313-FR-012
describe('the request the overview shows, the edges', () => {
  it('finds none in an empty list', () => {
    expect(openRequestOf([])).toBeUndefined();
  });

  it('skips a quoted request that holds no quotes however new it is', () => {
    const items = [
      summary({
        createdAt: '2026-10-16T09:00:00.000Z',
        id: 'empty',
        quotesCount: 0,
      }),
    ];

    expect(openRequestOf(items)).toBeUndefined();
  });

  it('gives the same request whatever order the list arrives in', () => {
    const items = [
      summary({ createdAt: '2026-10-09T09:00:00.000Z', id: 'a' }),
      summary({ createdAt: '2026-10-12T09:00:00.000Z', id: 'b' }),
      summary({ createdAt: '2026-10-10T09:00:00.000Z', id: 'c' }),
    ];

    expect(openRequestOf(items)?.id).toBe('b');
    expect(openRequestOf([...items].reverse())?.id).toBe('b');
  });

  it('skips a booked request whose booking lapsed or was cancelled', () => {
    const items = (['lapsed', 'cancelled', 'completed'] as const).map(
      (status) =>
        summary({
          booking: { confirmBy: '2026-10-18T10:00:00.000Z', status },
          id: status,
          status: 'booked',
        }),
    );

    expect(openRequestOf(items)).toBeUndefined();
  });

  it('skips a booked request that has no booking at all', () => {
    expect(
      openRequestOf([summary({ booking: null, status: 'booked' })]),
    ).toBeUndefined();
  });

  it('does not change the list it was given', () => {
    const items = [
      summary({ createdAt: '2026-10-09T09:00:00.000Z', id: 'a' }),
      summary({ createdAt: '2026-10-12T09:00:00.000Z', id: 'b' }),
    ];

    openRequestOf(items);

    expect(items.map((r) => r.id)).toEqual(['a', 'b']);
  });
});

// @traces 313-FR-004
describe('sorting and storing, more edges', () => {
  it('keeps the session key the panel and the spec name', () => {
    expect(SORT_KEY).toBe('mf.quotes.sort');
  });

  it('starts on the fastest when reading the storage throws', () => {
    expect(
      storedSort(() => {
        throw new DOMException('denied', 'SecurityError');
      }),
    ).toBe('fastest');
  });

  it('orders equal starting prices by the upper end', () => {
    const quotes = [
      quote({ fromBani: 100, id: 'b', toBani: 900 }),
      quote({ fromBani: 100, id: 'a', toBani: 500 }),
      quote({ fromBani: 50, id: 'c', toBani: 5000 }),
    ];

    expect(ids(sortQuotes(quotes, 'price'))).toEqual(['c', 'a', 'b']);
  });

  it('orders by the moment of the slot, not by its text', () => {
    const quotes = [
      quote({ id: 'a', slot: '2026-10-19T10:00:00.000+03:00' }),
      quote({ id: 'b', slot: '2026-10-19T06:30:00.000Z' }),
    ];

    expect(ids(sortQuotes(quotes, 'earliest'))).toEqual(['b', 'a']);
  });

  it('ranks a garage rated 0 above one with no rating', () => {
    const quotes = [
      quote({ garage: rated(null, 0), id: 'none' }),
      quote({ garage: rated(0, 3), id: 'zero' }),
    ];

    expect(ids(sortQuotes(quotes, 'rating'))).toEqual(['zero', 'none']);
  });

  it('leaves the list it was given in its order', () => {
    const quotes = [
      quote({ fromBani: 9, id: 'b' }),
      quote({ fromBani: 1, id: 'a' }),
    ];

    sortQuotes(quotes, 'price');

    expect(ids(quotes)).toEqual(['b', 'a']);
  });

  it('gives the same order twice for the same input', () => {
    const quotes = [
      quote({ garage: rated(4, 2), id: 'b' }),
      quote({ garage: rated(4, 2), id: 'a' }),
      quote({ garage: rated(null, 0), id: 'c' }),
    ];

    expect(ids(sortQuotes(sortQuotes(quotes, 'rating'), 'rating'))).toEqual(
      ids(sortQuotes(quotes, 'rating')),
    );
  });

  it('puts equal ids last-resort in code order for non-ASCII ids', () => {
    const quotes = [quote({ id: 'é' }), quote({ id: 'z' }), quote({ id: 'a' })];

    expect(ids(sortQuotes(quotes, 'fastest'))).toEqual(['a', 'z', 'é']);
  });
});

// @traces 313-FR-005
describe('the header, more edges', () => {
  it('counts accepted, lost, expired and waiting rows and skips the declined one', () => {
    const quotes = (
      ['waiting', 'accepted', 'lost', 'expired', 'declined_by_driver'] as const
    ).map((status, i) => quote({ id: `q${i}`, status }));

    expect(headerCount(quotes)).toBe(4);
  });

  it('reads the description in either language alike', () => {
    expect(headerWhat(request({ description: 'Scârțâie' }), 'en')).toBe(
      'Scârțâie',
    );
  });

  it('names the jobs in the reader’s language joined by a comma and a space', () => {
    const jobs = [job(0, 'A', 'a'), job(1, 'B', 'b'), job(2, 'C', 'c')];

    expect(headerWhat(request({ jobs }), 'en')).toBe('a, b, c');
  });

  it('does not reorder the jobs it was given', () => {
    const jobs = [job(1, 'B', 'b'), job(0, 'A', 'a')];

    headerWhat(request({ jobs }), 'ro');

    expect(jobs.map((j) => j.position)).toEqual([1, 0]);
  });
});

// @traces 313-FR-007
describe('a row’s state, more edges', () => {
  it('reads a waiting quote as expired at the very millisecond it expires', () => {
    const q = quote({ expiresAt: NOW.toISOString() });

    expect(rowState(q, null, NOW)).toBe('expired');
  });

  it('holds an open waiting quote while a booking awaits confirmation', () => {
    const booking = {
      confirmBy: '2026-10-18T10:00:00.000Z',
      status: 'awaiting_confirmation' as const,
    };

    expect(rowState(quote(), booking, NOW)).toBe('on_hold');
  });
});

// @traces 313-FR-012
describe('the request the overview shows, more edges', () => {
  it('picks a booked request whose booking awaits confirmation', () => {
    const items = [
      summary({
        booking: {
          confirmBy: '2026-10-18T10:00:00.000Z',
          status: 'awaiting_confirmation',
        },
        id: 'held',
        status: 'booked',
      }),
    ];

    expect(openRequestOf(items)?.id).toBe('held');
  });

  it('skips a held request that has no quotes', () => {
    const items = [
      summary({
        booking: {
          confirmBy: '2026-10-18T10:00:00.000Z',
          status: 'awaiting_confirmation',
        },
        quotesCount: 0,
        status: 'booked',
      }),
    ];

    expect(openRequestOf(items)).toBeUndefined();
  });

  it('skips requests that are neither quoted nor booked', () => {
    const items = (['open', 'closed', 'cancelled', 'expired'] as const).map(
      (status) => summary({ id: status, status: status as never }),
    );

    expect(openRequestOf(items)).toBeUndefined();
  });

  it('prefers a newer quoted request to an older held one', () => {
    const items = [
      summary({
        booking: {
          confirmBy: '2026-10-18T10:00:00.000Z',
          status: 'awaiting_confirmation',
        },
        createdAt: '2026-10-01T09:00:00.000Z',
        id: 'old-held',
        status: 'booked',
      }),
      summary({ createdAt: '2026-10-12T09:00:00.000Z', id: 'new-quoted' }),
    ];

    expect(openRequestOf(items)?.id).toBe('new-quoted');
  });

  it('keeps the first of two requests created at the same instant', () => {
    const items = [summary({ id: 'first' }), summary({ id: 'second' })];

    expect(openRequestOf(items)?.id).toBe('first');
  });
});
