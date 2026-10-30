import { bucharestInstant, bucharestWall, nextQuarter } from './bucharest-time';

const quarters = () =>
  Array.from({ length: 96 }, (_, q) => {
    const hh = String(Math.floor(q / 4)).padStart(2, '0');
    return `${hh}:${String((q % 4) * 15).padStart(2, '0')}`;
  });

const GAPPED = new Set(['2030-03-31', '2030-10-27']);

function roundTripLosses(day: string): string[] {
  return quarters()
    .filter((time) => !(GAPPED.has(day) && time.startsWith('03:')))
    .map((time) => ({ back: bucharestWall(bucharestInstant(day, time)), time }))
    .filter(({ time, back }) => back.day !== day || back.time !== time)
    .map(({ time, back }) => `${day} ${time} -> ${back.day} ${back.time}`);
}

const offsetOf = (instant: string) => instant.slice(-6);

// @traces 1403-FR-005
describe('the Bucharest clock under hostile days and zones', () => {
  const zone = process.env['TZ'];

  afterEach(() => {
    process.env['TZ'] = zone;
    jest.useRealTimers();
  });

  describe.each(['UTC', 'Pacific/Kiritimati', 'Asia/Kathmandu'])(
    'under %s',
    (tz) => {
      beforeEach(() => {
        process.env['TZ'] = tz;
      });

      it('answers a time that does not exist on the spring day with one of the two real offsets', () => {
        const instant = bucharestInstant('2026-03-29', '03:30');

        expect(['+02:00', '+03:00']).toContain(offsetOf(instant));
        expect(instant.startsWith('2026-03-29T03:30:00')).toBe(true);
      });

      it('reads back a time that happens twice on the autumn day as the same wall time', () => {
        const instant = bucharestInstant('2026-10-25', '03:30');

        expect(['+02:00', '+03:00']).toContain(offsetOf(instant));
        expect(bucharestWall(instant)).toEqual({
          day: '2026-10-25',
          time: '03:30',
        });
      });

      it('round-trips every quarter hour of the days around both clock changes outside the gap and the repeat', () => {
        const days = [
          '2030-03-30',
          '2030-03-31',
          '2030-04-01',
          '2030-10-26',
          '2030-10-27',
          '2030-10-28',
          '2028-02-29',
          '2027-12-31',
        ];
        const lost = days.flatMap(roundTripLosses);
        expect(lost).toEqual([]);
      });

      it('writes midnight as 00:00 of the next day, never 24:00', () => {
        expect(bucharestWall('2026-12-31T22:00:00Z')).toEqual({
          day: '2027-01-01',
          time: '00:00',
        });
        expect(bucharestWall('2026-06-30T21:00:00.000Z')).toEqual({
          day: '2026-07-01',
          time: '00:00',
        });
      });

      it('cuts the day exactly at the spring change', () => {
        expect(bucharestWall('2026-03-29T00:59:59Z').time).toBe('02:59');
        expect(bucharestWall('2026-03-29T01:00:00Z').time).toBe('04:00');
      });

      it('cuts the day exactly at the autumn change', () => {
        expect(bucharestWall('2026-10-25T00:59:59Z').time).toBe('03:59');
        expect(bucharestWall('2026-10-25T01:00:00Z').time).toBe('03:00');
      });

      it('reads an instant given with another offset on the Bucharest clock', () => {
        expect(bucharestWall('2026-07-15T10:00:00+03:00')).toEqual({
          day: '2026-07-15',
          time: '10:00',
        });
        expect(bucharestWall('2026-07-15T00:00:00-12:00')).toEqual({
          day: '2026-07-15',
          time: '15:00',
        });
      });

      it('moves to the following quarter when now is exactly on one, and a millisecond either side', () => {
        jest.useFakeTimers({ now: new Date('2026-01-15T08:14:59.999Z') });
        expect(nextQuarter()).toBe('10:15');
        jest.setSystemTime(new Date('2026-01-15T08:15:00.000Z'));
        expect(nextQuarter()).toBe('10:30');
        jest.setSystemTime(new Date('2026-01-15T08:15:00.001Z'));
        expect(nextQuarter()).toBe('10:30');
      });

      it('gives a quarter mark across the spring change day', () => {
        jest.useFakeTimers({ now: new Date('2026-03-29T00:50:00.000Z') });

        expect(nextQuarter()).toBe('03:00');
        jest.setSystemTime(new Date('2026-03-29T01:00:00.000Z'));
        expect(nextQuarter()).toBe('04:15');
      });
    },
  );
});
