import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { GaragePinsQueryDto, GarageSearchQueryDto } from './garage-search.dto';
import {
  filtersKey,
  filtersOf,
  SEARCH_MIN_RATINGS,
  SEARCH_PRICE_CEILINGS,
  type SearchFilters,
} from './search-place';

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
    expect(filtersOf({})).toEqual({});
  });

  it('reads the three filters by their names in the address bar', () => {
    expect(filtersOf({ card: '1', max_price: 300, min_rating: '4.5' })).toEqual(
      { card: true, maxPrice: 300, minRating: '4.5' },
    );
  });

  it('does not set card for any value but 1', () => {
    expect(filtersOf({ card: '0' as '1' })).toEqual({});
  });

  it('keeps nothing for undefined values', () => {
    expect(
      filtersOf({
        card: undefined,
        max_price: undefined,
        min_rating: undefined,
      }),
    ).toEqual({});
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
