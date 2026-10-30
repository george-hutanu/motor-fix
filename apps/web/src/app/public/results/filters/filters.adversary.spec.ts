import { convertToParamMap } from '@angular/router';

import { countOf, filterParams, filtersIn, unfiltered } from './filters';

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
    expect(filtersIn(bar({ open_now: value, open_saturday: value }))).toEqual({
      open_now: false,
      open_saturday: false,
    });
  });

  it('reads only the first value of a repeated key', () => {
    expect(filtersIn(bar({ open_now: ['0', '1'] })).open_now).toBe(false);
    expect(filtersIn(bar({ open_now: ['1', '0'] })).open_now).toBe(true);
  });

  it('ignores unknown and prototype keys', () => {
    expect(
      filtersIn(bar({ __proto__: '1', constructor: '1', open: '1' })),
    ).toEqual({ open_now: false, open_saturday: false });
  });

  it('reads an empty bar as everything off', () => {
    expect(filtersIn(bar({}))).toEqual({
      open_now: false,
      open_saturday: false,
    });
  });
});

describe('filter counts and request parameters', () => {
  it('counts none, one and both', () => {
    expect(countOf({ open_now: false, open_saturday: false })).toBe(0);
    expect(countOf({ open_now: false, open_saturday: true })).toBe(1);
    expect(countOf({ open_now: true, open_saturday: true })).toBe(2);
  });

  it('builds no parameters with everything off', () => {
    expect(filterParams({ open_now: false, open_saturday: false })).toEqual({});
  });

  it('builds the parameters in the written order', () => {
    expect(
      Object.keys(filterParams({ open_now: true, open_saturday: true })),
    ).toEqual(['open_now', 'open_saturday']);
    expect(filterParams({ open_now: false, open_saturday: true })).toEqual({
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
