import { TestBed } from '@angular/core/testing';
import type { OpenStatus } from '@motor-fix/contracts/open-status';
import { I18n } from '@motor-fix/i18n';

import { openLine } from './open-line';

// A Tuesday morning in Bucharest.
const NOW = new Date('2026-10-27T10:15:00+02:00');

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

const both = async (status: OpenStatus) => {
  await i18n.use('ro');
  const ro = openLine(status, NOW, i18n);
  await i18n.use('en');
  return [ro, openLine(status, NOW, i18n)];
};

// @traces 309-FR-005 309-FR-012
describe('the opening status line', () => {
  it.each<[string, OpenStatus, string, string]>([
    [
      'open until the end of the interval',
      { kind: 'open', until: '19:00' },
      'Deschis azi până la 19:00',
      'Open today until 19:00',
    ],
    [
      'a break until the next interval',
      { kind: 'break', until: '13:00' },
      'Pauză până la 13:00',
      'Break until 13:00',
    ],
    [
      'closed now, opening later today',
      closed('hours', 0),
      'Închis acum · deschide azi la 08:00',
      'Closed now · opens today at 08:00',
    ],
    [
      'closed now, opening tomorrow',
      closed('hours', 1),
      'Închis acum · deschide mâine la 08:00',
      'Closed now · opens tomorrow at 08:00',
    ],
    [
      'closed now, opening on a weekday two to six days ahead',
      closed('hours', 6),
      'Închis acum · deschide luni la 08:00',
      'Closed now · opens Monday at 08:00',
    ],
    [
      'closed now, opening on a date from seven days ahead',
      closed('hours', 9, '09:30'),
      'Închis acum · deschide pe 5 noiembrie la 09:30',
      'Closed now · opens on 5 November at 09:30',
    ],
    [
      'closed today for a legal holiday',
      closed('holiday', 2),
      'Închis azi · sărbătoare legală · deschide joi la 08:00',
      'Closed today · public holiday · opens Thursday at 08:00',
    ],
    [
      'closed today for a closed day of the garage',
      closed('closed', 1),
      'Închis azi · deschide mâine la 08:00',
      'Closed today · opens tomorrow at 08:00',
    ],
  ])('says %s in both languages', async (_title, status, ro, en) => {
    expect(await both(status)).toEqual([ro, en]);
  });

  it('says nothing when the rule answers no line', async () => {
    expect(await both({ kind: 'none' })).toEqual([null, null]);
  });

  it('names the weekday of the opening day, not of today', async () => {
    await i18n.use('ro');
    expect(openLine(closed('hours', 2), NOW, i18n)).toBe(
      'Închis acum · deschide joi la 08:00',
    );
    expect(openLine(closed('hours', 4), NOW, i18n)).toBe(
      'Închis acum · deschide sâmbătă la 08:00',
    );
  });

  it('counts days on the Bucharest calendar just after midnight', async () => {
    await i18n.use('en');
    // Wednesday in Bucharest, still Tuesday in UTC.
    const pastMidnight = new Date('2026-10-28T00:30:00+02:00');
    expect(openLine(closed('hours', 2), pastMidnight, i18n)).toBe(
      'Closed now · opens Friday at 08:00',
    );
  });
});
