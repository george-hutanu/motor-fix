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
    expect(key({ open_now: '1' })).toBe('1,');
    expect(key({ open_saturday: '1' })).toBe(',1');
    expect(key({ open_now: '1', open_saturday: '1' })).toBe('1,1');
  });

  it('keys open now the same at any instant', () => {
    const later = new Date('2027-11-06T23:59:00+02:00');

    expect(filtersKey(filtersOf({ open_now: '1' }, later))).toBe(
      filtersKey(filtersOf({ open_now: '1' }, TUESDAY)),
    );
  });
});
