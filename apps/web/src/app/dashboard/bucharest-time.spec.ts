import { bucharestInstant, bucharestWall, nextQuarter } from './bucharest-time';

// @traces 1403-FR-005
describe('the Bucharest clock, whatever the browser’s zone', () => {
  const zone = process.env['TZ'];

  afterEach(() => {
    process.env['TZ'] = zone;
    jest.useRealTimers();
  });

  describe.each(['UTC', 'America/New_York', 'Asia/Tokyo'])('under %s', (tz) => {
    beforeEach(() => {
      process.env['TZ'] = tz;
    });

    it('sends a winter day with +02:00 and a summer day with +03:00', () => {
      expect(bucharestInstant('2026-01-15', '10:00')).toBe(
        '2026-01-15T10:00:00+02:00',
      );
      expect(bucharestInstant('2026-07-15', '10:00')).toBe(
        '2026-07-15T10:00:00+03:00',
      );
    });

    it('takes the offset each side of the spring change, on that day', () => {
      expect(bucharestInstant('2026-03-29', '01:00')).toBe(
        '2026-03-29T01:00:00+02:00',
      );
      expect(bucharestInstant('2026-03-29', '10:00')).toBe(
        '2026-03-29T10:00:00+03:00',
      );
    });

    it('takes the offset each side of the autumn change, on that day', () => {
      expect(bucharestInstant('2026-10-25', '01:00')).toBe(
        '2026-10-25T01:00:00+03:00',
      );
      expect(bucharestInstant('2026-10-25', '10:00')).toBe(
        '2026-10-25T10:00:00+02:00',
      );
    });

    it('reads an instant back as the day and time on the Bucharest clock', () => {
      expect(bucharestWall('2026-07-15T07:30:00.000Z')).toEqual({
        day: '2026-07-15',
        time: '10:30',
      });
      expect(bucharestWall('2026-01-15T22:15:00.000Z')).toEqual({
        day: '2026-01-16',
        time: '00:15',
      });
    });

    it('rounds now up to the next quarter hour on the Bucharest clock', () => {
      jest.useFakeTimers({ now: new Date('2026-07-15T07:07:00.000Z') });
      expect(nextQuarter()).toBe('10:15');
      jest.setSystemTime(new Date('2026-01-15T08:00:00.000Z'));
      expect(nextQuarter()).toBe('10:15');
      jest.setSystemTime(new Date('2026-01-15T08:44:00.000Z'));
      expect(nextQuarter()).toBe('10:45');
    });

    it('stays on the same day late in the evening', () => {
      jest.useFakeTimers({ now: new Date('2026-01-15T21:50:00.000Z') });
      expect(nextQuarter()).toBe('23:45');
    });
  });
});
