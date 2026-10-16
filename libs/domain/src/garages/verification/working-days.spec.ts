import { workingDaysWaited } from './working-days';

// @traces 301-FR-004

// Bucharest is UTC+3 until the last Sunday of October, then UTC+2.
const at = (iso: string) => new Date(iso);
const none = new Set<string>();

describe('the working days a file has waited', () => {
  // Monday 12 October 2026, 10:00 in Bucharest.
  const monday = at('2026-10-12T10:00:00+03:00');
  const waited = (now: string, holidays = none) =>
    workingDaysWaited(monday, at(now), holidays);

  it('counts nothing on the day it was sent', () => {
    expect(waited('2026-10-12T18:00:00+03:00')).toBe(0);
  });

  it('counts a day once its hour of sending has passed', () => {
    expect(waited('2026-10-13T09:59:00+03:00')).toBe(0);
    expect(waited('2026-10-13T10:01:00+03:00')).toBe(1);
  });

  it('reads 2 on Wednesday at 10:01 and 3 on Thursday at 10:01', () => {
    expect(waited('2026-10-14T10:01:00+03:00')).toBe(2);
    expect(waited('2026-10-15T10:01:00+03:00')).toBe(3);
  });

  it('skips the weekend', () => {
    const friday = at('2026-10-16T15:00:00+03:00');
    const from = (now: string) => workingDaysWaited(friday, at(now), none);
    expect(from('2026-10-19T15:01:00+03:00')).toBe(1);
    expect(from('2026-10-20T15:01:00+03:00')).toBe(2);
    expect(from('2026-10-21T15:01:00+03:00')).toBe(3);
  });

  it('skips a legal holiday', () => {
    // Friday 28 November 2025; Monday 1 December is a legal holiday.
    const friday = at('2025-11-28T10:00:00+02:00');
    const tuesday = at('2025-12-02T10:01:00+02:00');
    expect(workingDaysWaited(friday, tuesday, new Set(['2025-12-01']))).toBe(1);
    expect(workingDaysWaited(friday, tuesday, none)).toBe(2);
  });

  it('counts a Saturday sending from Monday', () => {
    const saturday = at('2026-10-10T11:00:00+03:00');
    const from = (now: string) => workingDaysWaited(saturday, at(now), none);
    expect(from('2026-10-12T10:59:00+03:00')).toBe(0);
    expect(from('2026-10-12T11:01:00+03:00')).toBe(1);
  });

  it('keeps the wall-clock hour across the clock change', () => {
    // Friday 23 October 2026 is at UTC+3; Monday 26 at UTC+2.
    const friday = at('2026-10-23T10:00:00+03:00');
    const from = (now: string) => workingDaysWaited(friday, at(now), none);
    expect(from('2026-10-26T09:59:00+02:00')).toBe(0);
    expect(from('2026-10-26T10:01:00+02:00')).toBe(1);
  });

  it('reads 0 before the sending', () => {
    expect(waited('2026-10-11T10:00:00+03:00')).toBe(0);
  });
});
