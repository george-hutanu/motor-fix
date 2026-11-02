import { convertToParamMap } from '@angular/router';

import {
  chipsOf,
  countOf,
  type Filters,
  filterParams,
  filtersIn,
  unfiltered,
} from './filters';

// Every filter off, as an empty address bar reads.
const OFF: Filters = { card: false, open_now: false, open_saturday: false };

const bar = (params: Record<string, string | string[]>) =>
  convertToParamMap(params);

describe('max_price read from a hostile bar', () => {
  it.each([
    '2e2',
    '2E2',
    '0200',
    '200.0',
    '200.',
    ' 200',
    '200 ',
    '+200',
    '0x96',
    '１５０',
    '175',
    '',
    '0',
    '-150',
    'Infinity',
    'NaN',
    '__proto__',
    '150,200',
  ])('reads %j as off', (value) => {
    expect(filtersIn(bar({ max_price: value })).max_price).toBeUndefined();
  });

  it.each(['150', '200', '250', '300'])('reads %s as that ceiling', (value) => {
    expect(filtersIn(bar({ max_price: value })).max_price).toBe(Number(value));
  });

  it('reads only the first of repeated values, valid or not', () => {
    expect(filtersIn(bar({ max_price: ['200', '300'] })).max_price).toBe(200);
    expect(
      filtersIn(bar({ max_price: ['175', '300'] })).max_price,
    ).toBeUndefined();
  });
});

describe('min_rating read from a hostile bar', () => {
  it.each([
    '4.50',
    '4.5 ',
    ' 4.5',
    '4,5',
    '04.5',
    '4.5e0',
    '45e-1',
    '3.50',
    '4',
    '4.00',
    '3.5.',
    '5.0',
    '',
    'NaN',
    'constructor',
  ])('reads %j as off', (value) => {
    expect(filtersIn(bar({ min_rating: value })).min_rating).toBeUndefined();
  });

  it.each(['3.5', '4.0', '4.5'])('reads %s as itself', (value) => {
    expect(filtersIn(bar({ min_rating: value })).min_rating).toBe(value);
  });
});

describe('card read from a hostile bar', () => {
  it.each(['01', '1.0', '1e0', ' 1', '1 ', 'on', '', '١'])(
    'reads %j as off',
    (value) => {
      expect(filtersIn(bar({ card: value })).card).toBe(false);
    },
  );

  it('ignores prototype-named keys beside real ones', () => {
    const filters = filtersIn(
      bar({ __proto__: '1', card: '1', constructor: '1', toString: '1' }),
    );
    expect(filters).toEqual({ ...OFF, card: true });
  });

  it('returns a fresh object, not the shared OFF', () => {
    const filters = filtersIn(bar({}));
    expect(filters).toEqual(OFF);
    expect(filters).not.toBe(OFF);
  });
});

describe('filterParams ordering', () => {
  const keys = ['card', 'min_rating', 'max_price', 'open_saturday', 'open_now'];

  it('writes the written order whatever order the object was built in', () => {
    const base: Record<string, unknown> = {
      card: true,
      max_price: 250,
      min_rating: '4.5',
      open_now: true,
      open_saturday: true,
    };
    const orders = [
      keys,
      [...keys].reverse(),
      [keys[2], keys[0], keys[4], keys[1], keys[3]],
    ];
    for (const order of orders) {
      const filters = Object.fromEntries(order.map((k) => [k, base[k]]));
      expect(Object.keys(filterParams(filters as unknown as Filters))).toEqual([
        'open_now',
        'open_saturday',
        'max_price',
        'min_rating',
        'card',
      ]);
    }
  });

  it('writes a ceiling as a number and a rating as its text', () => {
    expect(filterParams({ ...OFF, max_price: 150, min_rating: '4.0' })).toEqual(
      { max_price: 150, min_rating: '4.0' },
    );
  });

  it('does not copy an extra property on the filters into the request', () => {
    const filters = { ...OFF, card: true, log: '1' } as unknown as Filters;
    expect(filterParams(filters)).toEqual({ card: '1' });
  });

  it('is the same on a second call', () => {
    const filters: Filters = { ...OFF, card: true, max_price: 300 };
    expect(filterParams(filters)).toEqual(filterParams(filters));
  });
});

describe('chips per language', () => {
  const all: Filters = {
    card: true,
    max_price: 200,
    min_rating: '4.5',
    open_now: true,
    open_saturday: true,
  };

  it('gives no chips with everything off', () => {
    expect(chipsOf(OFF, 'ro')).toEqual([]);
  });

  it('orders the five chips as the bar does', () => {
    expect(chipsOf(all, 'en').map((c) => c.key)).toEqual([
      'open_now',
      'open_saturday',
      'max_price',
      'min_rating',
      'card',
    ]);
  });

  it('writes the rating with a comma in Romanian', () => {
    const chip = chipsOf({ ...OFF, min_rating: '4.5' }, 'ro')[0];
    expect(chip).toEqual({
      key: 'min_rating',
      label: 'public.results.filters.ratingChip',
      params: { r: '4,5' },
    });
  });

  it('writes the rating with a point in English', () => {
    expect(chipsOf({ ...OFF, min_rating: '3.5' }, 'en')[0].params).toEqual({
      r: '3.5',
    });
  });

  it('writes 4.0 as 4,0 and 4.0 in the two languages', () => {
    expect(chipsOf({ ...OFF, min_rating: '4.0' }, 'ro')[0].params).toEqual({
      r: '4,0',
    });
    expect(chipsOf({ ...OFF, min_rating: '4.0' }, 'en')[0].params).toEqual({
      r: '4.0',
    });
  });

  it('carries the ceiling as the bare number in both languages', () => {
    for (const language of ['ro', 'en'] as const) {
      expect(chipsOf({ ...OFF, max_price: 300 }, language)[0]).toEqual({
        key: 'max_price',
        label: 'public.results.filters.priceChip',
        params: { n: 300 },
      });
    }
  });

  it('gives a switch chip no params', () => {
    expect(chipsOf({ ...OFF, card: true }, 'ro')).toEqual([
      { key: 'card', label: 'public.results.filters.card' },
    ]);
  });
});

describe('counting and stripping with the new filters', () => {
  it('counts a ceiling and a rating once each', () => {
    expect(
      countOf({ ...OFF, card: true, max_price: 150, min_rating: '3.5' }),
    ).toBe(3);
  });

  it('strips the five keys and leaves the input object untouched', () => {
    const input = {
      brand: 'dacia',
      card: '1',
      ids: [1, 2],
      max_price: 200,
      min_rating: '4.5',
      open_now: '1',
      open_saturday: '1',
    };
    const copy = JSON.parse(JSON.stringify(input));
    expect(unfiltered(input)).toEqual({ brand: 'dacia', ids: [1, 2] });
    expect(input).toEqual(copy);
    expect(Object.keys(input)).toEqual(Object.keys(copy));
  });

  it('returns a new object even when nothing is stripped', () => {
    const input: { brand: string; card?: '1' } = { brand: 'dacia' };
    const out = unfiltered(input);
    expect(out).toEqual(input);
    expect(out).not.toBe(input);
  });

  it('keeps a falsy non-filter value', () => {
    expect(unfiltered({ card: '1', cursor: '', log: undefined })).toEqual({
      cursor: '',
      log: undefined,
    });
  });
});
