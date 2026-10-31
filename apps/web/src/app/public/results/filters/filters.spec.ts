import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { convertToParamMap } from '@angular/router';

import {
  chipsOf,
  countOf,
  type Filters,
  filterParams,
  filtersIn,
  NONE,
  OFF,
  SWITCHES,
  unfiltered,
} from './filters';

const bar = (query: string) => {
  const params: Record<string, string[]> = {};
  for (const [key, value] of new URLSearchParams(query)) {
    params[key] = [...(params[key] ?? []), value];
  }
  return convertToParamMap(params);
};

const ALL: Filters = {
  card: true,
  max_price: 200,
  min_rating: '4.5',
  open_now: true,
  open_saturday: true,
};

// @traces 1398-FR-004
// @traces 1399-FR-010
describe('the filters the address bar names', () => {
  it('reads a switch as on only for the value 1', () => {
    expect(filtersIn(bar('open_now=1&open_saturday=1'))).toEqual({
      ...OFF,
      open_now: true,
      open_saturday: true,
    });
    expect(filtersIn(bar('open_now=yes&open_saturday='))).toEqual(OFF);
    expect(filtersIn(bar('brand=bmw'))).toEqual(OFF);
  });

  it('lets the first value of a repeated key decide', () => {
    expect(filtersIn(bar('open_now=1&open_now=0')).open_now).toBe(true);
    expect(filtersIn(bar('open_now=0&open_now=1')).open_now).toBe(false);
  });

  it('lists the switches open now, open on Saturday, then card payment', () => {
    expect(SWITCHES).toEqual([
      { key: 'open_now', label: 'public.results.filters.openNow' },
      { key: 'open_saturday', label: 'public.results.filters.openSaturday' },
      { key: 'card', label: 'public.results.filters.card' },
    ]);
  });
});

// @traces 1399-FR-003
describe('the price, rating and card filters the address bar names', () => {
  it.each([150, 200, 250, 300])('reads max_price=%s as that ceiling', (n) => {
    expect(filtersIn(bar(`max_price=${n}`)).max_price).toBe(n);
  });

  it.each(['3.5', '4.0', '4.5'])('reads min_rating=%s as that rating', (r) => {
    expect(filtersIn(bar(`min_rating=${r}`)).min_rating).toBe(r);
  });

  it('reads card=1 as card payment on', () => {
    expect(filtersIn(bar('card=1')).card).toBe(true);
  });

  it.each([
    'max_price=175',
    'max_price=200.0',
    'min_rating=4',
    'min_rating=',
    'card=yes',
    'card=0',
  ])('reads %s as off', (value) => {
    expect(filtersIn(bar(value))).toEqual(OFF);
  });

  it('lets the first value of a repeated key decide', () => {
    expect(filtersIn(bar('max_price=200&max_price=300')).max_price).toBe(200);
    expect(filtersIn(bar('min_rating=x&min_rating=4.5')).min_rating).toBe(
      undefined,
    );
    expect(filtersIn(bar('card=0&card=1')).card).toBe(false);
  });

  it('counts each filter on once, a ceiling or a rating whatever its value', () => {
    expect(countOf(OFF)).toBe(0);
    expect(countOf({ ...OFF, max_price: 300 })).toBe(1);
    expect(countOf({ ...OFF, min_rating: '3.5', open_now: true })).toBe(2);
    expect(countOf(ALL)).toBe(5);
  });
});

// @traces 1399-FR-002
describe('the chips of the filters on', () => {
  it('lists them in the page order, each with its label and parameters', () => {
    expect(chipsOf(ALL, 'ro')).toEqual([
      { key: 'open_now', label: 'public.results.filters.openNow' },
      { key: 'open_saturday', label: 'public.results.filters.openSaturday' },
      {
        key: 'max_price',
        label: 'public.results.filters.priceChip',
        params: { n: 200 },
      },
      {
        key: 'min_rating',
        label: 'public.results.filters.ratingChip',
        params: { r: '4,5' },
      },
      { key: 'card', label: 'public.results.filters.card' },
    ]);
  });

  it('writes the rating with the decimal point in English', () => {
    expect(chipsOf({ ...OFF, min_rating: '4.0' }, 'en')).toEqual([
      {
        key: 'min_rating',
        label: 'public.results.filters.ratingChip',
        params: { r: '4.0' },
      },
    ]);
  });

  it('shows none with every filter off', () => {
    expect(chipsOf(OFF, 'ro')).toEqual([]);
  });
});

// @traces 1398-FR-005
// @traces 1399-FR-004
describe('the filters on a search request', () => {
  it('sends 1 for each switch on, the value for a choice, and nothing for one off', () => {
    expect(filterParams({ ...OFF, open_now: true })).toEqual({
      open_now: '1',
    });
    expect(filterParams(OFF)).toEqual({});
    expect(filterParams({ ...OFF, card: true, max_price: 150 })).toEqual({
      card: '1',
      max_price: 150,
    });
  });

  it('writes the five in the page order', () => {
    expect(filterParams(ALL)).toEqual({
      card: '1',
      max_price: 200,
      min_rating: '4.5',
      open_now: '1',
      open_saturday: '1',
    });
    expect(Object.keys(filterParams(ALL))).toEqual([
      'open_now',
      'open_saturday',
      'max_price',
      'min_rating',
      'card',
    ]);
  });

  it('clears the five keys of the bar at once', () => {
    expect(NONE).toEqual({
      card: null,
      max_price: null,
      min_rating: null,
      open_now: null,
      open_saturday: null,
    });
  });

  it('strips the five filters from a request, keeping the rest', () => {
    expect(
      unfiltered({
        brand: 'bmw',
        card: '1' as const,
        max_price: 200 as const,
        min_rating: '4.5' as const,
        near: '44.437,26.117',
        open_now: '1' as const,
        open_saturday: '1' as const,
      }),
    ).toEqual({ brand: 'bmw', near: '44.437,26.117' });
  });

  // @traces 1398-FR-016
  // @traces 1399-FR-011
  // The API judges a match; the results page carries no filter rules
  // and no Bucharest clock (the garage profile's own chunk reads the clock).
  it('leaves the filter rules and the Bucharest clock out of the results bundle', () => {
    const files = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) return files(path);
        return /\.ts$/.test(name) && !/\.spec\.ts$/.test(name) ? [path] : [];
      });
    const importing = (dir: string, lib: RegExp) =>
      files(dir).filter((file) => lib.test(readFileSync(file, 'utf8')));
    const web = join(__dirname, '../../../..');
    const results = join(__dirname, '..');

    expect(files(web).length).toBeGreaterThan(100);
    expect(importing(web, /contracts\/search-filters'/)).toEqual([]);
    // Nor through the contracts barrel, by any of the module's names.
    expect(importing(web, /\b(filtersOf|filtersKey|SearchFilters)\b/)).toEqual(
      [],
    );
    expect(importing(results, /contracts\/open-status'/)).toEqual([]);
  });
});

// @traces 1399-FR-009
// No new signal: the two search routes' inventory entries name the five
// filters that narrow their query.
describe('the observability inventory of the filtered search', () => {
  it('names the five filters on the search and the pins routes', () => {
    const inventory = readFileSync(
      join(
        __dirname,
        '../../../../../../../infra/observability/inventory.json',
      ),
      'utf8',
    );
    const naming = inventory
      .split('\n')
      .filter((line) =>
        line.includes(
          'open_now, open_saturday, max_price, min_rating and card filters',
        ),
      );

    expect(naming).toHaveLength(2);
  });
});
