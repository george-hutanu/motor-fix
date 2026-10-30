import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { convertToParamMap } from '@angular/router';

import {
  countOf,
  FILTERS,
  filterParams,
  filtersIn,
  unfiltered,
} from './filters';

const bar = (query: string) => {
  const params: Record<string, string[]> = {};
  for (const [key, value] of new URLSearchParams(query)) {
    params[key] = [...(params[key] ?? []), value];
  }
  return convertToParamMap(params);
};

// @traces 1398-FR-004
describe('the filters the address bar names', () => {
  it('reads a filter as on only for the value 1', () => {
    expect(filtersIn(bar('open_now=1&open_saturday=1'))).toEqual({
      open_now: true,
      open_saturday: true,
    });
    expect(filtersIn(bar('open_now=yes&open_saturday='))).toEqual({
      open_now: false,
      open_saturday: false,
    });
    expect(filtersIn(bar('brand=bmw'))).toEqual({
      open_now: false,
      open_saturday: false,
    });
  });

  it('lets the first value of a repeated key decide', () => {
    expect(filtersIn(bar('open_now=1&open_now=0')).open_now).toBe(true);
    expect(filtersIn(bar('open_now=0&open_now=1')).open_now).toBe(false);
  });

  it('counts the filters on', () => {
    expect(countOf({ open_now: false, open_saturday: false })).toBe(0);
    expect(countOf({ open_now: true, open_saturday: false })).toBe(1);
    expect(countOf({ open_now: true, open_saturday: true })).toBe(2);
  });

  it('lists open now before open on Saturday, each with its label', () => {
    expect(FILTERS).toEqual([
      { key: 'open_now', label: 'public.results.filters.openNow' },
      { key: 'open_saturday', label: 'public.results.filters.openSaturday' },
    ]);
  });
});

// @traces 1398-FR-005
describe('the filters on a search request', () => {
  it('sends 1 for each filter on, and nothing for one off', () => {
    expect(filterParams({ open_now: true, open_saturday: false })).toEqual({
      open_now: '1',
    });
    expect(filterParams({ open_now: true, open_saturday: true })).toEqual({
      open_now: '1',
      open_saturday: '1',
    });
    expect(filterParams({ open_now: false, open_saturday: false })).toEqual({});
  });

  it('strips both filters from a request, keeping the rest', () => {
    expect(
      unfiltered({
        brand: 'bmw',
        near: '44.437,26.117',
        open_now: '1' as const,
        open_saturday: '1' as const,
      }),
    ).toEqual({ brand: 'bmw', near: '44.437,26.117' });
  });

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
