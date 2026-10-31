import { oilStatus } from './car-lines';

const NOW = new Date('2026-10-08T09:00:00+03:00');

// @traces 1386-FR-003
describe('the oil lamp judged by the estimated date', () => {
  it.each([
    ['2026-12-08', 'green', 61],
    ['2026-12-07', 'amber', 60],
    ['2026-10-16', 'amber', 8],
    ['2026-10-15', 'red', 7],
    ['2026-10-08', 'red', 0],
  ])('reads %s as %s with %i days', (serviceDueOn, state, days) => {
    expect(oilStatus(152000, 148200, serviceDueOn, NOW)).toEqual({
      days,
      kmLeft: 3800,
      state,
    });
  });

  it('keeps the lamp red at 0 km left whatever a far date says', () => {
    expect(oilStatus(148200, 148200, '2027-06-01', NOW)).toMatchObject({
      kmLeft: 0,
      state: 'red',
    });
  });

  it('keeps the lamp red when overdue whatever a far date says', () => {
    expect(oilStatus(148000, 148200, '2027-06-01', NOW)).toMatchObject({
      kmLeft: -200,
      state: 'red',
    });
  });

  it('falls back to the default estimate when the date is absent', () => {
    expect(oilStatus(152000, 148200, undefined, NOW)).toEqual({
      days: 116,
      kmLeft: 3800,
      state: 'green',
    });
  });

  it('falls back to the default estimate when the date is null', () => {
    expect(oilStatus(150000, 148200, null, NOW)).toMatchObject({
      days: 55,
      state: 'amber',
    });
  });

  it('ranks an overdue line by the km-derived days despite a date', () => {
    expect(oilStatus(147200, 148200, '2030-01-01', NOW).days).toBe(-30);
  });

  it('counts calendar days in Bucharest just after local midnight', () => {
    const late = new Date('2026-10-08T21:30:00Z');
    expect(oilStatus(152000, 148200, '2026-10-09', late).days).toBe(0);
  });

  it('counts the boundary across the October clock change', () => {
    const night = new Date('2026-10-24T21:30:00Z');
    expect(oilStatus(152000, 148200, '2026-12-24', night)).toMatchObject({
      days: 60,
      state: 'amber',
    });
  });

  it('treats a malformed date as no date', () => {
    expect(oilStatus(152000, 148200, 'soon', NOW)).toMatchObject({
      days: 116,
      state: 'green',
    });
  });
});
