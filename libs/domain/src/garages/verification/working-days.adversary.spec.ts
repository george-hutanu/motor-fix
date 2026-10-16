import { workingDaysWaited } from './working-days';

// @traces 301-FR-004

const at = (iso: string) => new Date(iso);
const none = new Set<string>();

describe('working days waited, hostile inputs', () => {
  it('counts a Friday sending to the next Tuesday as 2 and to Wednesday as 3', () => {
    const friday = at('2026-10-16T15:00:00+03:00');
    expect(
      workingDaysWaited(friday, at('2026-10-20T15:01:00+03:00'), none),
    ).toBe(2);
    expect(
      workingDaysWaited(friday, at('2026-10-21T15:01:00+03:00'), none),
    ).toBe(3);
  });

  it('reads 3 on Thursday after a Monday 10:00 sending and 2 the minute before', () => {
    const monday = at('2026-10-12T10:00:00+03:00');
    expect(
      workingDaysWaited(monday, at('2026-10-15T10:01:00+03:00'), none),
    ).toBe(3);
    expect(
      workingDaysWaited(monday, at('2026-10-15T09:59:00+03:00'), none),
    ).toBe(2);
  });

  it('answers 0 when now is before the sending', () => {
    const sent = at('2026-10-14T10:00:00+03:00');
    expect(workingDaysWaited(sent, at('2026-10-10T10:00:00+03:00'), none)).toBe(
      0,
    );
  });

  it('answers 0 for the same instant', () => {
    const sent = at('2026-10-14T10:00:00+03:00');
    expect(workingDaysWaited(sent, sent, none)).toBe(0);
  });

  it('skips a weekday holiday in the middle of the wait', () => {
    const friday = at('2026-11-27T10:00:00+02:00');
    const now = at('2026-12-02T10:01:00+02:00');
    expect(workingDaysWaited(friday, now, none)).toBe(3);
    expect(workingDaysWaited(friday, now, new Set(['2026-12-01']))).toBe(2);
  });

  it('does not subtract a holiday that falls on a weekend', () => {
    const friday = at('2026-11-27T10:00:00+02:00');
    const now = at('2026-12-01T10:01:00+02:00');
    expect(
      workingDaysWaited(friday, now, new Set(['2026-11-28', '2026-11-29'])),
    ).toBe(2);
  });

  it('counts the first working day of a holiday sending on the next working day', () => {
    const holiday = at('2026-12-01T10:00:00+02:00');
    const holidays = new Set(['2026-12-01']);
    expect(
      workingDaysWaited(holiday, at('2026-12-01T18:00:00+02:00'), holidays),
    ).toBe(0);
    expect(
      workingDaysWaited(holiday, at('2026-12-02T10:01:00+02:00'), holidays),
    ).toBe(1);
  });

  it('does not count the weekend after a Saturday sending', () => {
    const saturday = at('2026-10-17T10:00:00+03:00');
    expect(
      workingDaysWaited(saturday, at('2026-10-18T23:00:00+03:00'), none),
    ).toBe(0);
    expect(
      workingDaysWaited(saturday, at('2026-10-19T10:01:00+03:00'), none),
    ).toBe(1);
  });

  it('ignores holiday strings that are not in the YYYY-MM-DD form', () => {
    const monday = at('2026-10-12T10:00:00+03:00');
    const now = at('2026-10-14T10:01:00+03:00');
    const bad = new Set(['2026-10-13T00:00:00Z', '13/10/2026', '2026-10-13 ']);
    expect(workingDaysWaited(monday, now, bad)).toBe(2);
  });

  it('counts every weekday of a whole year wait', () => {
    const sent = at('2026-01-05T10:00:00+02:00');
    expect(workingDaysWaited(sent, at('2027-01-04T10:01:00+02:00'), none)).toBe(
      260,
    );
  });

  it('keeps the wall-clock hour across the October clock change', () => {
    const friday = at('2026-10-23T10:00:00+03:00');
    expect(
      workingDaysWaited(friday, at('2026-10-26T09:59:00+02:00'), none),
    ).toBe(0);
    expect(
      workingDaysWaited(friday, at('2026-10-26T10:01:00+02:00'), none),
    ).toBe(1);
  });

  it('keeps the wall-clock hour across the March clock change', () => {
    const friday = at('2027-03-26T10:00:00+02:00');
    expect(
      workingDaysWaited(friday, at('2027-03-29T09:59:00+03:00'), none),
    ).toBe(0);
    expect(
      workingDaysWaited(friday, at('2027-03-29T10:01:00+03:00'), none),
    ).toBe(1);
  });

  it('reads the Bucharest day, not the UTC day, for a late evening sending', () => {
    const lateMonday = at('2026-10-12T23:30:00+03:00');
    expect(
      workingDaysWaited(lateMonday, at('2026-10-13T23:29:00+03:00'), none),
    ).toBe(0);
    expect(
      workingDaysWaited(lateMonday, at('2026-10-13T23:31:00+03:00'), none),
    ).toBe(1);
  });

  it('reads a just-after-midnight sending in Bucharest as the new day', () => {
    const sent = at('2026-10-13T00:10:00+03:00');
    expect(workingDaysWaited(sent, at('2026-10-13T00:30:00+03:00'), none)).toBe(
      0,
    );
    expect(workingDaysWaited(sent, at('2026-10-14T00:11:00+03:00'), none)).toBe(
      1,
    );
  });

  it('does not change the date objects it is given', () => {
    const sent = at('2026-10-12T10:00:00+03:00');
    const now = at('2026-10-15T10:01:00+03:00');
    workingDaysWaited(sent, now, none);
    expect(sent.toISOString()).toBe('2026-10-12T07:00:00.000Z');
    expect(now.toISOString()).toBe('2026-10-15T07:01:00.000Z');
  });
});
