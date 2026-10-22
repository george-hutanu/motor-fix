import { TestBed } from '@angular/core/testing';
import { I18n } from '@motor-fix/i18n';

import { hoursLines } from './hours-lines';

const OPEN = [['08:00', '19:00']];
const week = (days: Partial<Record<string, string[][]>>) => ({
  fri: OPEN,
  mon: OPEN,
  sat: OPEN,
  sun: OPEN,
  thu: OPEN,
  tue: OPEN,
  wed: OPEN,
  ...days,
});

let i18n: I18n;

beforeEach(async () => {
  TestBed.configureTestingModule({});
  i18n = TestBed.inject(I18n);
  await i18n.enter('public');
  await i18n.use('ro');
});

const lines = (hours: unknown) =>
  hoursLines(hours, i18n.language(), (key) => i18n.t(key));

// @traces 308-FR-012
describe('the opening hours as lines, under odd tables', () => {
  it('does not join a closed Monday to a closed Sunday around the week end', () => {
    expect(lines(week({ mon: [], sun: [] }))).toEqual([
      { days: 'Luni', times: 'Închis' },
      { days: 'Marți – sâmbătă', times: '08:00 – 19:00' },
      { days: 'Duminică', times: 'Închis' },
    ]);
  });

  it('writes a week of closed days as one line', () => {
    expect(
      lines({ fri: [], mon: [], sat: [], sun: [], thu: [], tue: [], wed: [] }),
    ).toEqual([{ days: 'Luni – duminică', times: 'Închis' }]);
  });

  it('keeps a split day apart from a single-interval day covering the same span', () => {
    expect(
      lines(
        week({
          tue: [
            ['08:00', '12:00'],
            ['12:00', '19:00'],
          ],
        }),
      ),
    ).toEqual([
      { days: 'Luni', times: '08:00 – 19:00' },
      { days: 'Marți', times: '08:00 – 12:00, 12:00 – 19:00' },
      { days: 'Miercuri – duminică', times: '08:00 – 19:00' },
    ]);
  });

  it('writes midnight and the last quarter-hour as two-digit times', () => {
    expect(lines(week({ sun: [['00:00', '23:45']] }))[1]).toEqual({
      days: 'Duminică',
      times: '00:00 – 23:45',
    });
  });

  it('leaves the table it was given untouched, even a frozen one', () => {
    const frozen = JSON.parse(JSON.stringify(week({ sun: [] })));
    for (const day of Object.values<string[][]>(frozen)) {
      for (const interval of day) Object.freeze(interval);
      Object.freeze(day);
    }
    Object.freeze(frozen);

    expect(lines(frozen)).toEqual([
      { days: 'Luni – sâmbătă', times: '08:00 – 19:00' },
      { days: 'Duminică', times: 'Închis' },
    ]);
  });

  it.each([
    ['an eighth key', { ...week({}), holiday: OPEN }],
    [
      'three intervals in a day',
      week({
        mon: [
          ['06:00', '07:00'],
          ['08:00', '09:00'],
          ['10:00', '11:00'],
        ],
      }),
    ],
    ['a time off the grid', week({ mon: [['08:07', '19:00']] })],
    ['the time 24:00', week({ mon: [['08:00', '24:00']] })],
    ['a list of seven days', Object.values(week({}))],
    ['a day that is null', { ...week({}), mon: null }],
  ])('gives no line for %s', (_, hours) => {
    expect(lines(hours)).toEqual([]);
  });
});
