import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import 'reflect-metadata';

import {
  GaragePinDto,
  GaragePinsQueryDto,
  GarageSearchQueryDto,
} from './garage-search.dto';
import { bucharestClock } from './open-status';
import { filtersKey, filtersOf, type SearchFilters } from './search-filters';
import { SEARCH_MIN_RATINGS, SEARCH_PRICE_CEILINGS } from './search-place';

const AT = new Date('2026-10-30T07:15:00Z');

const refused = (
  dto: typeof GarageSearchQueryDto | typeof GaragePinsQueryDto,
  query: Record<string, unknown>,
) =>
  validateSync(plainToInstance(dto, { brand: 'bmw', ...query }), {
    forbidNonWhitelisted: true,
    whitelist: true,
  }).map((error) => error.property);

// @traces 1261-FR-008 1261-FR-009
describe('filtersKey', () => {
  it.each([
    ['undefined', undefined],
    ['an empty object', {}],
    ['card false', { card: false } as unknown as SearchFilters],
  ])('gives no key for %s', (_, filters) => {
    expect(filtersKey(filters)).toBeUndefined();
  });

  it('tells apart every combination of the three filters', () => {
    const prices = [undefined, ...SEARCH_PRICE_CEILINGS];
    const ratings = [undefined, ...SEARCH_MIN_RATINGS];
    const combos: SearchFilters[] = prices.flatMap((maxPrice) =>
      ratings.flatMap((minRating) =>
        [false, true].map(
          (card): SearchFilters => ({
            ...(maxPrice && { maxPrice }),
            ...(minRating && { minRating }),
            ...(card && { card }),
          }),
        ),
      ),
    );
    const keys = combos.map((filters) => filtersKey(filters));

    expect(keys.filter((key) => key === undefined)).toHaveLength(1);
    expect(new Set(keys).size).toBe(combos.length);
  });

  it('gives the same key whatever order the keys were written in', () => {
    expect(filtersKey({ card: true, maxPrice: 200, minRating: '4.0' })).toBe(
      filtersKey({ card: true, maxPrice: 200, minRating: '4.0' }),
    );
  });

  it('keeps a price ceiling and a rating apart even when only one is set', () => {
    expect(filtersKey({ maxPrice: 150 })).not.toBe(
      filtersKey({ minRating: '3.5' }),
    );
  });
});

// @traces 1261-FR-001
describe('filtersOf', () => {
  it('reads an empty query as no filter', () => {
    expect(filtersOf({}, AT)).toBeUndefined();
  });

  it('reads the three filters by their names in the address bar', () => {
    expect(
      filtersOf({ card: '1', max_price: 300, min_rating: '4.5' }, AT),
    ).toEqual({ card: true, maxPrice: 300, minRating: '4.5' });
  });

  it('does not set card for any value but 1', () => {
    expect(filtersOf({ card: '0' }, AT)).toBeUndefined();
  });

  it('keeps nothing for undefined values', () => {
    expect(
      filtersOf(
        { card: undefined, max_price: undefined, min_rating: undefined },
        AT,
      ),
    ).toBeUndefined();
  });
});

// @traces 1261-FR-001
describe.each([
  ['the list', GarageSearchQueryDto],
  ['the pins', GaragePinsQueryDto],
])('the filters on %s under hostile input', (_, dto) => {
  it.each([
    ['full-width digits', '２００'],
    ['a trailing space', '200 '],
    ['a plus sign', '+200'],
    ['a trailing newline', '200\n'],
    ['an exponent', '1e2'],
    ['Infinity', 'Infinity'],
    ['a nul byte', '200\u0000'],
    ['a comma list', '150,200'],
    ['an object', { $gt: 0 }],
    ['an array of one', ['200']],
  ])('refuses max_price as %s', (_title, value) => {
    expect(refused(dto, { max_price: value })).toEqual(['max_price']);
  });

  it.each([
    ['a trailing space', '4.0 '],
    ['a comma', '4,5'],
    ['a leading zero', '04.0'],
    ['Arabic-Indic digits', '٤.٠'],
    ['a number', 4.5],
    ['an array of one', ['4.0']],
    ['an object', { gte: 4 }],
    ['3.0', '3.0'],
    ['5.0', '5.0'],
  ])('refuses min_rating as %s', (_title, value) => {
    expect(refused(dto, { min_rating: value })).toEqual(['min_rating']);
  });

  it.each([
    ['an array of one', ['1']],
    ['a trailing space', '1 '],
    ['full-width one', '１'],
    ['an object', { a: 1 }],
    ['the word on', 'on'],
  ])('refuses card as %s', (_title, value) => {
    expect(refused(dto, { card: value })).toEqual(['card']);
  });

  it.each([
    ['maxPrice', 200],
    ['minRating', '4.0'],
    ['Card', '1'],
    ['MAX_PRICE', '200'],
  ])('refuses the unknown key %s', (key, value) => {
    expect(refused(dto, { [key]: value })).toEqual([key]);
  });

  it('refuses each bad filter alongside good ones', () => {
    expect(
      refused(dto, { card: '1', max_price: '175', min_rating: '4.0' }),
    ).toEqual(['max_price']);
  });

  it('names every bad filter at once', () => {
    expect(
      refused(dto, { card: '0', max_price: '175', min_rating: '4' }).sort(),
    ).toEqual(['card', 'max_price', 'min_rating']);
  });

  it('keeps max_price a number only for the four ceilings', () => {
    const read = (value: string) =>
      plainToInstance(dto, { brand: 'bmw', max_price: value }).max_price;

    expect(SEARCH_PRICE_CEILINGS.map((c) => read(String(c)))).toEqual([
      150, 200, 250, 300,
    ]);
    expect(read('200.0')).toBe('200.0');
  });
});

const messages = (
  dto: typeof GaragePinsQueryDto | typeof GarageSearchQueryDto,
  query: Record<string, unknown>,
) =>
  validateSync(plainToInstance(dto, query), {
    forbidNonWhitelisted: true,
    whitelist: true,
  }).flatMap((error) => Object.values(error.constraints ?? {}));

// @traces 1260-FR-002 1260-FR-003
describe('bucharestClock at the edges of the day and the clock changes', () => {
  it.each([
    ['one second before the spring change', '2027-03-28T00:59:59Z', '02:59'],
    ['the spring change itself', '2027-03-28T01:00:00Z', '04:00'],
    [
      'the first hour after the autumn change starts',
      '2027-10-31T00:59:59Z',
      '03:59',
    ],
    ['the autumn change itself', '2027-10-31T01:00:00Z', '03:00'],
  ])('reads %s as %s', (_name, at, time) => {
    expect(bucharestClock(new Date(at)).time).toBe(time);
  });

  it.each([
    ['winter midnight', '2026-12-31T22:00:00Z', '2027-01-01', '00:00'],
    ['summer midnight', '2026-07-14T21:00:00Z', '2026-07-15', '00:00'],
    [
      'one minute before winter midnight',
      '2026-12-31T21:59:00Z',
      '2026-12-31',
      '23:59',
    ],
    ['leap day midnight', '2028-02-28T22:00:00Z', '2028-02-29', '00:00'],
  ])('writes %s as 00:00, never 24:00', (_name, at, day, time) => {
    const clock = bucharestClock(new Date(at));
    expect(clock.day).toBe(day);
    expect(clock.time).toBe(time);
  });

  it('names Saturday for a Friday evening in UTC that is already Saturday in Bucharest', () => {
    expect(bucharestClock(new Date('2026-10-30T22:30:00Z'))).toEqual({
      day: '2026-10-31',
      time: '00:30',
      weekday: 'sat',
    });
  });

  it('names Sunday for the first minute after Saturday night', () => {
    expect(bucharestClock(new Date('2026-10-31T22:00:00Z')).weekday).toBe(
      'sun',
    );
  });

  it('names Monday for the week turn', () => {
    expect(bucharestClock(new Date('2026-11-01T22:00:00Z')).weekday).toBe(
      'mon',
    );
  });

  it('reads the epoch and a far future date', () => {
    expect(bucharestClock(new Date(0))).toEqual({
      day: '1970-01-01',
      time: '02:00',
      weekday: 'thu',
    });
    expect(bucharestClock(new Date('2099-12-31T23:59:59Z')).day).toBe(
      '2100-01-01',
    );
  });

  it('refuses an invalid date by throwing rather than answering a made-up day', () => {
    expect(() => bucharestClock(new Date(Number.NaN))).toThrow();
  });

  it('answers the same twice and leaves the date alone', () => {
    const at = new Date('2026-10-30T07:15:00Z');
    const before = at.getTime();
    expect(bucharestClock(at)).toEqual(bucharestClock(at));
    expect(at.getTime()).toBe(before);
  });
});

// @traces 1260-FR-008
describe('filtersOf and filtersKey under odd queries', () => {
  it('leaves openNow out when only open_saturday is set, even with an explicit undefined', () => {
    const filters = filtersOf({ open_now: undefined, open_saturday: '1' }, AT);
    expect(filters).toEqual({ saturday: true });
    expect('openNow' in (filters ?? {})).toBe(false);
  });

  it('leaves saturday out when only open_now is set', () => {
    const filters = filtersOf({ open_now: '1' }, AT);
    expect('saturday' in (filters ?? {})).toBe(false);
  });

  it('gives the instant of the request for open now', () => {
    expect(filtersOf({ open_now: '1' }, AT)?.openNow).toEqual(
      bucharestClock(AT),
    );
  });

  it('keeps the key of no filter apart from the key of every filter', () => {
    expect(filtersKey(undefined)).toBeUndefined();
    expect(
      filtersKey(filtersOf({ open_now: '1', open_saturday: '1' }, AT)),
    ).toBe('1,1,,,');
  });

  it('gives open_now and open_saturday different keys', () => {
    expect(filtersKey(filtersOf({ open_now: '1' }, AT))).not.toBe(
      filtersKey(filtersOf({ open_saturday: '1' }, AT)),
    );
  });

  it('keeps the key of open now the same across a Saturday and a Tuesday instant', () => {
    expect(
      filtersKey(
        filtersOf({ open_now: '1' }, new Date('2026-10-31T08:00:00Z')),
      ),
    ).toBe(filtersKey(filtersOf({ open_now: '1' }, AT)));
  });

  it('does not treat a value other than 1 as a set filter', () => {
    expect(filtersOf({ open_now: '0' }, AT)).toBeUndefined();
    expect(filtersOf({ open_saturday: '' }, AT)).toBeUndefined();
  });
});

describe.each([
  ['pins', GaragePinsQueryDto],
  ['list', GarageSearchQueryDto],
] as const)(
  'the %s query under hostile open_now and open_saturday',
  (_name, dto) => {
    const hostile: [string, unknown][] = [
      ['null', null],
      ['the number 1', 1],
      ['the boolean true', true],
      ['an object', { 0: '1' }],
      ['a one-element list', ['1']],
      ['an empty list', []],
      ['a trailing newline', '1\n'],
      ['a trailing space', '1 '],
      ['a full-width digit', '１'],
      ['an Arabic-Indic digit', '١'],
      ['a zero-width joiner after the digit', '1‍'],
      ['a plus sign', '+1'],
      ['an exponent', '1e0'],
      ['uppercase true', 'TRUE'],
      ['a very long string', '1'.repeat(100_000)],
    ];

    describe.each(['open_now', 'open_saturday'])('%s', (field) => {
      it.each(hostile)('refuses %s', (_label, value) => {
        const found = messages(dto, { brand: 'bmw', [field]: value });
        expect(found.length).toBeGreaterThan(0);
        expect(found.every((message) => message.startsWith(`${field} `))).toBe(
          true,
        );
      });

      it('refuses the bad value even when the other filter is good', () => {
        const other = field === 'open_now' ? 'open_saturday' : 'open_now';
        const found = messages(dto, {
          brand: 'bmw',
          [other]: '1',
          [field]: 'true',
        });
        expect(found.length).toBeGreaterThan(0);
        expect(found.every((message) => message.startsWith(`${field} `))).toBe(
          true,
        );
      });

      it('refuses the bad value next to a bbox', () => {
        const found = messages(dto, {
          bbox: '44.35,26,44.5,26.25',
          brand: 'bmw',
          [field]: '0',
        });
        expect(found.length).toBeGreaterThan(0);
      });
    });

    it.each(['open_now[]', 'Open_Now', 'open-now', 'openNow', 'open_sat'])(
      'refuses the unknown parameter %s',
      (name) => {
        expect(messages(dto, { brand: 'bmw', [name]: '1' })).not.toEqual([]);
      },
    );

    it('takes both filters with a place and a brand', () => {
      expect(
        messages(dto, {
          brand: 'bmw',
          near: '44.437,26.117',
          open_now: '1',
          open_saturday: '1',
        }),
      ).toEqual([]);
    });
  },
);

// @traces 1260-FR-007
describe('the pin schema', () => {
  it('declares matches as a required boolean', () => {
    const meta = Reflect.getMetadata(
      'swagger/apiModelProperties',
      GaragePinDto.prototype,
      'matches',
    );
    expect(meta.required).not.toBe(false);
    expect(
      Reflect.getMetadata('design:type', GaragePinDto.prototype, 'matches'),
    ).toBe(Boolean);
  });
});
