import { convertToParamMap } from '@angular/router';

import { countOf, filterParams, filtersIn, OFF, unfiltered } from './filters';

const bar = (params: Record<string, string | string[]>) =>
  convertToParamMap(params);

describe('filters read from a hostile address bar', () => {
  it.each([
    '01',
    ' 1',
    '1 ',
    'true',
    'ON',
    '１',
    '1.0',
    '-1',
    '[object Object]',
  ])('reads %j as off', (value) => {
    expect(
      filtersIn(
        bar({
          card: value,
          max_price: value,
          min_rating: value,
          open_now: value,
          open_saturday: value,
        }),
      ),
    ).toEqual(OFF);
  });

  it('reads only the first value of a repeated key', () => {
    expect(filtersIn(bar({ open_now: ['0', '1'] })).open_now).toBe(false);
    expect(filtersIn(bar({ open_now: ['1', '0'] })).open_now).toBe(true);
  });

  it('ignores unknown and prototype keys', () => {
    expect(
      filtersIn(bar({ __proto__: '1', constructor: '1', open: '1' })),
    ).toEqual(OFF);
  });

  it('reads an empty bar as everything off', () => {
    expect(filtersIn(bar({}))).toEqual(OFF);
  });
});

describe('filter counts and request parameters', () => {
  it('counts none, one and both', () => {
    expect(countOf(OFF)).toBe(0);
    expect(countOf({ ...OFF, open_saturday: true })).toBe(1);
    expect(countOf({ ...OFF, open_now: true, open_saturday: true })).toBe(2);
  });

  it('builds no parameters with everything off', () => {
    expect(filterParams(OFF)).toEqual({});
  });

  it('builds the parameters in the written order', () => {
    expect(
      Object.keys(
        filterParams({ ...OFF, open_now: true, open_saturday: true }),
      ),
    ).toEqual(['open_now', 'open_saturday']);
    expect(filterParams({ ...OFF, open_saturday: true })).toEqual({
      open_saturday: '1',
    });
  });
});

describe('a query stripped of its filters', () => {
  it('drops both filters, even set to undefined, and keeps the rest', () => {
    const query = {
      brand: 'bmw',
      ids: 'a,b',
      open_now: '1',
      open_saturday: undefined,
    };
    const stripped = unfiltered(query);
    expect(stripped).toEqual({ brand: 'bmw', ids: 'a,b' });
    expect(Object.keys(stripped)).toEqual(['brand', 'ids']);
  });

  it('leaves the original query untouched', () => {
    const query = { brand: 'bmw', open_now: '1', open_saturday: '1' };
    unfiltered(query);
    expect(query).toEqual({
      brand: 'bmw',
      open_now: '1',
      open_saturday: '1',
    });
  });

  it('returns an empty query for an empty query', () => {
    expect(unfiltered({})).toEqual({});
  });

  it('keeps a log flag and a cursor', () => {
    expect(unfiltered({ cursor: 'c', log: '1', open_now: '1' })).toEqual({
      cursor: 'c',
      log: '1',
    });
  });
});
