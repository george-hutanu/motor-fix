import type { GarageSearchPageDto } from '@motor-fix/data-access';

import { ResultsMemory, type SearchKey } from './results-memory';

const page = (cursor: string | null) =>
  ({ items: [], nextCursor: cursor }) as unknown as GarageSearchPageDto;
const entryOf = (cursor: string | null, scrollY = 0) => ({
  inSheet: false,
  logged: undefined,
  page: page(cursor),
  scrollY,
});
const SEARCH: SearchKey = { brand: 'bmw', near: '44.43,26.1' };

// @traces 1356-FR-008
describe('ResultsMemory under hostile input', () => {
  it('gives nothing when nothing was kept', () => {
    const memory = new ResultsMemory();

    expect(memory.take(SEARCH)).toBeUndefined();
    expect(memory.boxOf(SEARCH)).toBeUndefined();
  });

  it('keeps the entry after a take for another search', () => {
    const memory = new ResultsMemory();
    const entry = entryOf('c1', 300);
    memory.keep(SEARCH, entry);

    expect(memory.take({ ...SEARCH, brand: 'audi' })).toBeUndefined();
    expect(memory.take(SEARCH)).toBe(entry);
  });

  it('keeps the entry after boxOf reads it', () => {
    const memory = new ResultsMemory();
    const search = { ...SEARCH, bbox: '44,26,45,27' };
    const entry = entryOf('c1');
    memory.keep(search, entry);

    expect(memory.boxOf(SEARCH)).toBe('44,26,45,27');
    expect(memory.boxOf(SEARCH)).toBe('44,26,45,27');
    expect(memory.take(search)).toBe(entry);
  });

  it('names no box for a kept search without one', () => {
    const memory = new ResultsMemory();
    memory.keep(SEARCH, entryOf(null));

    expect(memory.boxOf(SEARCH)).toBeUndefined();
  });

  it('names no box for another brand', () => {
    const memory = new ResultsMemory();
    memory.keep({ ...SEARCH, bbox: '44,26,45,27' }, entryOf(null));

    expect(memory.boxOf({ ...SEARCH, brand: 'audi' })).toBeUndefined();
    expect(memory.boxOf({ brand: 'bmw', near: '1,2' })).toBeUndefined();
  });

  it('does not confuse an empty brand with a missing one', () => {
    const memory = new ResultsMemory();
    memory.keep({ brand: '', near: SEARCH.near }, entryOf('c'));

    expect(memory.take({ near: SEARCH.near })).toBeUndefined();
  });

  it('does not confuse a brand slug with the same text as a brand id', () => {
    const memory = new ResultsMemory();
    memory.keep({ brand: 'x' }, entryOf('c'));

    expect(memory.take({ brandId: 'x' })).toBeUndefined();
  });

  it('does not confuse the 50 km search with the default radius', () => {
    const memory = new ResultsMemory();
    memory.keep({ ...SEARCH, radius: 50 }, entryOf('c'));

    expect(memory.take(SEARCH)).toBeUndefined();
  });

  it('does not let a place made to look like a key field collide', () => {
    const memory = new ResultsMemory();
    memory.keep({ brand: 'bmw', near: '1,2","3' }, entryOf('c'));

    expect(
      memory.take({ brand: 'bmw', near: '1,2', radius: 25 }),
    ).toBeUndefined();
  });

  it('keeps a second search of the same key by replacing the first', () => {
    const memory = new ResultsMemory();
    memory.keep(SEARCH, entryOf('old', 1));
    const fresh = entryOf('new', 2);
    memory.keep(SEARCH, fresh);

    expect(memory.take(SEARCH)).toBe(fresh);
  });

  it('keeps a list of 500 pages worth of cards untouched', () => {
    const memory = new ResultsMemory();
    const big = {
      ...entryOf('c'),
      page: {
        items: Array.from({ length: 500 }, (_, i) => ({ id: String(i) })),
        nextCursor: null,
      } as unknown as GarageSearchPageDto,
    };
    memory.keep(SEARCH, big);

    expect(memory.take(SEARCH)?.page.items).toHaveLength(500);
  });

  it('keeps a negative or fractional scroll position as given', () => {
    const memory = new ResultsMemory();
    memory.keep(SEARCH, entryOf('c', -0.5));

    expect(memory.take(SEARCH)?.scrollY).toBe(-0.5);
  });
});
