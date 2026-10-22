import { TestBed } from '@angular/core/testing';
import { I18n } from '@motor-fix/i18n';

import { hoursLines } from './hours-lines';

const OPEN = [['08:00', '19:00']];
const SHORT = [['09:00', '14:00']];
const LUNCH = [
  ['08:00', '12:00'],
  ['13:00', '19:00'],
];
const week = (days: Partial<Record<string, string[][]>>) => ({
  fri: OPEN,
  mon: OPEN,
  sat: SHORT,
  sun: [],
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
// @traces 308-FR-016
describe('the opening hours as lines', () => {
  it('groups the working week, then Saturday, then a closed Sunday', () => {
    expect(lines(week({}))).toEqual([
      { days: 'Luni – vineri', times: '08:00 – 19:00' },
      { days: 'Sâmbătă', times: '09:00 – 14:00' },
      { days: 'Duminică', times: 'Închis' },
    ]);
  });

  it('says the same in English, the second day name keeping its capital', async () => {
    await i18n.use('en');

    expect(lines(week({}))).toEqual([
      { days: 'Monday – Friday', times: '08:00 – 19:00' },
      { days: 'Saturday', times: '09:00 – 14:00' },
      { days: 'Sunday', times: 'Closed' },
    ]);
  });

  it('writes a lunch break as two intervals and splits the run around it', () => {
    expect(lines(week({ tue: LUNCH }))).toEqual([
      { days: 'Luni', times: '08:00 – 19:00' },
      { days: 'Marți', times: '08:00 – 12:00, 13:00 – 19:00' },
      { days: 'Miercuri – vineri', times: '08:00 – 19:00' },
      { days: 'Sâmbătă', times: '09:00 – 14:00' },
      { days: 'Duminică', times: 'Închis' },
    ]);
  });

  it('writes a two-day run with the dash, never a comma', () => {
    expect(
      lines(week({ fri: SHORT, sat: [], thu: SHORT, wed: SHORT })),
    ).toEqual([
      { days: 'Luni – marți', times: '08:00 – 19:00' },
      { days: 'Miercuri – vineri', times: '09:00 – 14:00' },
      { days: 'Sâmbătă – duminică', times: 'Închis' },
    ]);
  });

  it('writes a whole week alike as one line', () => {
    expect(lines(week({ sat: OPEN, sun: OPEN }))).toEqual([
      { days: 'Luni – duminică', times: '08:00 – 19:00' },
    ]);
  });

  it('keeps equal days apart when a different day stands between them', () => {
    expect(lines(week({ thu: SHORT, tue: SHORT }))).toEqual([
      { days: 'Luni', times: '08:00 – 19:00' },
      { days: 'Marți', times: '09:00 – 14:00' },
      { days: 'Miercuri', times: '08:00 – 19:00' },
      { days: 'Joi', times: '09:00 – 14:00' },
      { days: 'Vineri', times: '08:00 – 19:00' },
      { days: 'Sâmbătă', times: '09:00 – 14:00' },
      { days: 'Duminică', times: 'Închis' },
    ]);
  });

  it('starts on Monday whatever order the days were stored in', () => {
    const { mon, ...rest } = week({ mon: SHORT });

    expect(lines({ ...rest, mon })[0]).toEqual({
      days: 'Luni',
      times: '09:00 – 14:00',
    });
  });

  it.each([
    ['an empty table', {}],
    ['nothing', undefined],
    ['null', null],
    ['a missing day', { mon: OPEN }],
    [
      'an interval ending before it starts',
      week({ mon: [['19:00', '08:00']] }),
    ],
    [
      'overlapping intervals',
      week({
        mon: [
          ['08:00', '13:00'],
          ['12:00', '19:00'],
        ],
      }),
    ],
    ['a string', 'luni-vineri'],
  ])('gives no line for %s', (_, hours) => {
    expect(lines(hours)).toEqual([]);
  });
});
