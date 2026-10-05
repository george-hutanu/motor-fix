import { bucharestDaily, nextRun, runDue, shortenedDaily } from './daily';

const at = (iso: string) => new Date(iso);
const nine = bucharestDaily(9);

describe('the daily run at 09:00 Europe/Bucharest', () => {
  it('is 09:00 local on every day around the October clock change', () => {
    expect(nine.runAt('2026-10-24').toISOString()).toBe(
      '2026-10-24T06:00:00.000Z',
    );
    expect(nine.runAt('2026-10-25').toISOString()).toBe(
      '2026-10-25T07:00:00.000Z',
    );
    expect(nine.runAt('2026-10-26').toISOString()).toBe(
      '2026-10-26T07:00:00.000Z',
    );
  });

  it('is 09:00 local on every day around the March clock change', () => {
    expect(nine.runAt('2027-03-27').toISOString()).toBe(
      '2027-03-27T07:00:00.000Z',
    );
    expect(nine.runAt('2027-03-28').toISOString()).toBe(
      '2027-03-28T06:00:00.000Z',
    );
    expect(nine.runAt('2027-03-29').toISOString()).toBe(
      '2027-03-29T06:00:00.000Z',
    );
  });

  it('counts the day in Bucharest, not in UTC', () => {
    // 23:30 UTC on 9 November is 01:30 on 10 November in Bucharest.
    expect(nine.today(at('2026-11-09T23:30:00Z'))).toBe('2026-11-10');
    expect(nine.today(at('2026-11-10T21:59:00Z'))).toBe('2026-11-10');
  });

  it('is due from 09:00 on, not before', () => {
    expect(runDue(nine, at('2026-11-10T06:59:59Z'))).toBe(false);
    expect(runDue(nine, at('2026-11-10T07:00:00Z'))).toBe(true);
    // 11:20, after a worker that was down at 09:00 starts again.
    expect(runDue(nine, at('2026-11-10T09:20:00Z'))).toBe(true);
  });

  it('runs next today before 09:00 and tomorrow after it', () => {
    expect(nextRun(nine, at('2026-11-10T05:00:00Z'))).toEqual({
      at: at('2026-11-10T07:00:00Z'),
      day: '2026-11-10',
    });
    expect(nextRun(nine, at('2026-11-10T07:00:00Z'))).toEqual({
      at: at('2026-11-11T07:00:00Z'),
      day: '2026-11-11',
    });
  });

  it('runs next across the clock change at 09:00 local', () => {
    expect(nextRun(nine, at('2026-10-24T08:00:00Z'))).toEqual({
      at: at('2026-10-25T07:00:00Z'),
      day: '2026-10-25',
    });
  });
});

describe('a shortened day', () => {
  const start = at('2026-11-10T10:00:00Z');
  const fast = shortenedDaily(start, 1000);

  it('starts on the start day, with a run at the start', () => {
    expect(fast.today(start)).toBe('2026-11-10');
    expect(fast.runAt('2026-11-10')).toEqual(start);
    expect(runDue(fast, start)).toBe(true);
  });

  it('moves one day on every interval', () => {
    expect(fast.today(at('2026-11-10T10:00:00.999Z'))).toBe('2026-11-10');
    expect(fast.today(at('2026-11-10T10:00:01Z'))).toBe('2026-11-11');
    expect(fast.today(at('2026-11-10T10:00:31.5Z'))).toBe('2026-12-11');
    expect(fast.runAt('2026-12-11')).toEqual(at('2026-11-10T10:00:31Z'));
  });

  it('runs next one interval on', () => {
    expect(nextRun(fast, at('2026-11-10T10:00:00.2Z'))).toEqual({
      at: at('2026-11-10T10:00:01Z'),
      day: '2026-11-11',
    });
  });
});
