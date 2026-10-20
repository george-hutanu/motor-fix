import type { GarageSearchPageDto } from '@motor-fix/data-access';

import { ResultsMemory, type SearchKey } from './results-memory';

const page = (cursor: string | null) =>
  ({ items: [], nextCursor: cursor }) as unknown as GarageSearchPageDto;
const SEARCH = { brand: 'dacia', near: '44.43,26.1' };

// @traces 1356-FR-008
describe('ResultsMemory', () => {
  it('gives the kept results back once, for the same search', () => {
    const memory = new ResultsMemory();
    const entry = {
      inSheet: false,
      logged: 'dacia|44.43,26.1',
      page: page('c2'),
      scrollY: 900,
    };
    memory.keep(SEARCH, entry);

    expect(memory.take({ ...SEARCH })).toBe(entry);
    expect(memory.take({ ...SEARCH })).toBeUndefined();
  });

  it.each([
    ['another brand', { ...SEARCH, brand: 'tesla' }],
    ['the brand by its id', { brandId: 'dacia', near: SEARCH.near }],
    ['another place', { ...SEARCH, near: '46.77,23.62' }],
    ['the wide radius', { ...SEARCH, radius: 50 }],
    ['a box', { ...SEARCH, bbox: '44,26,45,27' }],
  ] as [string, SearchKey][])('gives nothing for %s', (_, other) => {
    const memory = new ResultsMemory();
    memory.keep(SEARCH, {
      inSheet: false,
      logged: undefined,
      page: page(null),
      scrollY: 0,
    });

    expect(memory.take(other)).toBeUndefined();
  });

  it('keeps the last search only', () => {
    const memory = new ResultsMemory();
    memory.keep(SEARCH, {
      inSheet: false,
      logged: undefined,
      page: page('a'),
      scrollY: 0,
    });
    const tesla = { ...SEARCH, brand: 'tesla' };
    const entry = {
      inSheet: false,
      logged: undefined,
      page: page('b'),
      scrollY: 0,
    };
    memory.keep(tesla, entry);

    expect(memory.take(SEARCH)).toBeUndefined();
    expect(memory.take(tesla)).toBe(entry);
  });

  it('names the kept box for the search the bar names around it', () => {
    const memory = new ResultsMemory();
    const box = '44.1,26,44.6,26.4';
    memory.keep(
      { ...SEARCH, bbox: box },
      {
        inSheet: false,
        logged: undefined,
        page: page(null),
        scrollY: 0,
      },
    );

    expect(memory.boxOf({ ...SEARCH, brand: 'tesla' })).toBeUndefined();
    expect(memory.boxOf(SEARCH)).toBe(box);
    expect(memory.take({ ...SEARCH, bbox: box })).toBeDefined();
  });
});
