import { TestBed } from '@angular/core/testing';
import type { OpenStatus } from '@motor-fix/contracts/open-status';
import { I18n } from '@motor-fix/i18n';

import { openLine } from './open-line';

const closed = (
  reason: 'hours' | 'holiday' | 'closed',
  inDays: number,
  at = '08:00',
): OpenStatus => ({ kind: 'closed', next: { at, inDays }, reason });

let i18n: I18n;

beforeEach(async () => {
  i18n = TestBed.inject(I18n);
  await i18n.enter('public');
});

const say = async (status: OpenStatus, now: Date, lang: 'ro' | 'en') => {
  await i18n.use(lang);
  return openLine(status, now, i18n);
};

// @traces 309-FR-005
describe('the opening status line at the edges of the date form', () => {
  it.each<[string, string, number, string, string]>([
    [
      'seven days ahead',
      '2026-10-27T10:15:00+02:00',
      7,
      'pe 3 noiembrie',
      'on 3 November',
    ],
    [
      'fourteen days ahead',
      '2026-10-27T10:15:00+02:00',
      14,
      'pe 10 noiembrie',
      'on 10 November',
    ],
    [
      'across a year end',
      '2027-12-30T10:15:00+02:00',
      7,
      'pe 6 ianuarie',
      'on 6 January',
    ],
    [
      'into a leap day',
      '2028-02-22T10:15:00+02:00',
      7,
      'pe 29 februarie',
      'on 29 February',
    ],
    [
      'past a leap day',
      '2028-02-25T10:15:00+02:00',
      7,
      'pe 3 martie',
      'on 3 March',
    ],
    [
      'across the autumn clock change',
      '2027-10-27T10:15:00+03:00',
      7,
      'pe 3 noiembrie',
      'on 3 November',
    ],
    [
      'across the spring clock change',
      '2027-03-24T10:15:00+02:00',
      7,
      'pe 31 martie',
      'on 31 March',
    ],
    [
      'a single digit day',
      '2026-10-29T10:15:00+02:00',
      7,
      'pe 5 noiembrie',
      'on 5 November',
    ],
  ])('writes the date %s', async (_t, now, inDays, ro, en) => {
    const status = closed('hours', inDays);
    expect(await say(status, new Date(now), 'ro')).toBe(
      `Închis acum · deschide ${ro} la 08:00`,
    );
    expect(await say(status, new Date(now), 'en')).toBe(
      `Closed now · opens ${en} at 08:00`,
    );
  });

  it('counts the days from the Bucharest date when UTC is still the day before', async () => {
    const now = new Date('2026-10-26T22:30:00Z');
    expect(await say(closed('hours', 7), now, 'en')).toBe(
      'Closed now · opens on 3 November at 08:00',
    );
  });

  it('names weekdays from the Bucharest date when UTC is still the day before', async () => {
    const now = new Date('2026-10-26T22:30:00Z');
    expect(await say(closed('hours', 2), now, 'ro')).toBe(
      'Închis acum · deschide joi la 08:00',
    );
    expect(await say(closed('hours', 2), now, 'en')).toBe(
      'Closed now · opens Thursday at 08:00',
    );
  });

  it('names every weekday two to six days ahead in both languages', async () => {
    const now = new Date('2026-10-27T10:15:00+02:00');
    const ro = [];
    const en = [];
    for (const n of [2, 3, 4, 5, 6]) {
      ro.push(await say(closed('hours', n), now, 'ro'));
      en.push(await say(closed('hours', n), now, 'en'));
    }
    expect(ro).toEqual([
      'Închis acum · deschide joi la 08:00',
      'Închis acum · deschide vineri la 08:00',
      'Închis acum · deschide sâmbătă la 08:00',
      'Închis acum · deschide duminică la 08:00',
      'Închis acum · deschide luni la 08:00',
    ]);
    expect(en).toEqual([
      'Closed now · opens Thursday at 08:00',
      'Closed now · opens Friday at 08:00',
      'Closed now · opens Saturday at 08:00',
      'Closed now · opens Sunday at 08:00',
      'Closed now · opens Monday at 08:00',
    ]);
  });

  it('reads the holiday line with a date', async () => {
    const now = new Date('2026-12-25T10:15:00+02:00');
    expect(await say(closed('holiday', 8, '09:30'), now, 'ro')).toBe(
      'Închis azi · sărbătoare legală · deschide pe 2 ianuarie la 09:30',
    );
    expect(await say(closed('closed', 8, '09:30'), now, 'en')).toBe(
      'Closed today · opens on 2 January at 09:30',
    );
  });

  it('passes the times through without padding or rewriting', async () => {
    const now = new Date('2026-10-27T10:15:00+02:00');
    expect(await say({ kind: 'open', until: '23:45' }, now, 'en')).toBe(
      'Open today until 23:45',
    );
    expect(await say({ kind: 'break', until: '00:00' }, now, 'ro')).toBe(
      'Pauză până la 00:00',
    );
  });

  it('answers null for the none outcome in both languages', async () => {
    const now = new Date('2026-10-27T10:15:00+02:00');
    expect(await say({ kind: 'none' }, now, 'ro')).toBeNull();
    expect(await say({ kind: 'none' }, now, 'en')).toBeNull();
  });

  it('answers the same line twice for the same status', async () => {
    const now = new Date('2026-10-27T10:15:00+02:00');
    const status = closed('hours', 9);
    expect(await say(status, now, 'en')).toBe(await say(status, now, 'en'));
  });
});
