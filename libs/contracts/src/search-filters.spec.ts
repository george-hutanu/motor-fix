import { filtersKey, filtersOf } from './search-filters';

const TUESDAY = new Date('2027-11-02T10:15:00+02:00');

// @traces 1260-FR-003 1260-FR-008 1260-FR-009
describe('the filters of a search', () => {
  it('reads no filters when neither is set', () => {
    expect(filtersOf({}, TUESDAY)).toBeUndefined();
  });

  it('reads no filter from a value other than 1', () => {
    expect(
      filtersOf({ open_now: '0', open_saturday: '' }, TUESDAY),
    ).toBeUndefined();
  });

  it('reads open now as the Bucharest day, time and weekday of the instant', () => {
    expect(filtersOf({ open_now: '1' }, TUESDAY)).toEqual({
      openNow: { day: '2027-11-02', time: '10:15', weekday: 'tue' },
    });
  });

  it('reads open on Saturday without the instant', () => {
    expect(filtersOf({ open_saturday: '1' }, TUESDAY)).toEqual({
      saturday: true,
    });
  });

  it('reads both filters together', () => {
    expect(filtersOf({ open_now: '1', open_saturday: '1' }, TUESDAY)).toEqual({
      openNow: { day: '2027-11-02', time: '10:15', weekday: 'tue' },
      saturday: true,
    });
  });

  it('keys each combination apart and no filter not at all', () => {
    const key = (query: { open_now?: string; open_saturday?: string }) =>
      filtersKey(filtersOf(query, TUESDAY));

    expect(key({})).toBeUndefined();
    expect(key({ open_now: '1' })).toBe('1,,,,');
    expect(key({ open_saturday: '1' })).toBe(',1,,,');
    expect(key({ open_now: '1', open_saturday: '1' })).toBe('1,1,,,');
  });

  it('keys open now the same at any instant', () => {
    const later = new Date('2027-11-06T23:59:00+02:00');

    expect(filtersKey(filtersOf({ open_now: '1' }, later))).toBe(
      filtersKey(filtersOf({ open_now: '1' }, TUESDAY)),
    );
  });
});

// @traces 1261-FR-008 1261-FR-009
describe('the result filters', () => {
  it('reads the filters a query sets', () => {
    expect(
      filtersOf({ card: '1', max_price: 200, min_rating: '4.0' }, TUESDAY),
    ).toEqual({ card: true, maxPrice: 200, minRating: '4.0' });
    expect(filtersOf({ min_rating: '4.5' }, TUESDAY)).toEqual({
      minRating: '4.5',
    });
  });

  it('reads no filters from a query with none', () => {
    expect(filtersOf({}, TUESDAY)).toBeUndefined();
    expect(filtersKey(filtersOf({}, TUESDAY))).toBeUndefined();
    expect(filtersKey(undefined)).toBeUndefined();
  });

  it('keys each combination apart, keeping the empty slots', () => {
    expect(filtersKey({ card: true, maxPrice: 200, minRating: '4.0' })).toBe(
      ',,200,4.0,1',
    );
    expect(filtersKey({ maxPrice: 200 })).toBe(',,200,,');
    expect(filtersKey({ minRating: '4.5' })).toBe(',,,4.5,');
    expect(filtersKey({ card: true })).toBe(',,,,1');
  });

  it('keys the open-hours filters apart from the result filters', () => {
    expect(filtersKey({ maxPrice: 200, saturday: true })).toBe(',1,200,,');
    expect(filtersKey({ card: true })).not.toBe(filtersKey({ saturday: true }));
  });
});
