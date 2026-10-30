import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import 'reflect-metadata';

import {
  GaragePinDto,
  GaragePinsQueryDto,
  GarageSearchQueryDto,
} from './garage-search.dto';
import { bucharestClock } from './open-status';
import { filtersKey, filtersOf } from './search-filters';

const messages = (
  dto: typeof GaragePinsQueryDto | typeof GarageSearchQueryDto,
  query: Record<string, unknown>,
) =>
  validateSync(plainToInstance(dto, query), {
    forbidNonWhitelisted: true,
    whitelist: true,
  }).flatMap((error) => Object.values(error.constraints ?? {}));

// @traces 1260-FR-002 1260-FR-003
describe('bucharestClock at the edges of the day and the clock changes', () => {
  it.each([
    ['one second before the spring change', '2027-03-28T00:59:59Z', '02:59'],
    ['the spring change itself', '2027-03-28T01:00:00Z', '04:00'],
    [
      'the first hour after the autumn change starts',
      '2027-10-31T00:59:59Z',
      '03:59',
    ],
    ['the autumn change itself', '2027-10-31T01:00:00Z', '03:00'],
  ])('reads %s as %s', (_name, at, time) => {
    expect(bucharestClock(new Date(at)).time).toBe(time);
  });

  it.each([
    ['winter midnight', '2026-12-31T22:00:00Z', '2027-01-01', '00:00'],
    ['summer midnight', '2026-07-14T21:00:00Z', '2026-07-15', '00:00'],
    [
      'one minute before winter midnight',
      '2026-12-31T21:59:00Z',
      '2026-12-31',
      '23:59',
    ],
    ['leap day midnight', '2028-02-28T22:00:00Z', '2028-02-29', '00:00'],
  ])('writes %s as 00:00, never 24:00', (_name, at, day, time) => {
    const clock = bucharestClock(new Date(at));
    expect(clock.day).toBe(day);
    expect(clock.time).toBe(time);
  });

  it('names Saturday for a Friday evening in UTC that is already Saturday in Bucharest', () => {
    expect(bucharestClock(new Date('2026-10-30T22:30:00Z'))).toEqual({
      day: '2026-10-31',
      time: '00:30',
      weekday: 'sat',
    });
  });

  it('names Sunday for the first minute after Saturday night', () => {
    expect(bucharestClock(new Date('2026-10-31T22:00:00Z')).weekday).toBe(
      'sun',
    );
  });

  it('names Monday for the week turn', () => {
    expect(bucharestClock(new Date('2026-11-01T22:00:00Z')).weekday).toBe(
      'mon',
    );
  });

  it('reads the epoch and a far future date', () => {
    expect(bucharestClock(new Date(0))).toEqual({
      day: '1970-01-01',
      time: '02:00',
      weekday: 'thu',
    });
    expect(bucharestClock(new Date('2099-12-31T23:59:59Z')).day).toBe(
      '2100-01-01',
    );
  });

  it('refuses an invalid date by throwing rather than answering a made-up day', () => {
    expect(() => bucharestClock(new Date(Number.NaN))).toThrow();
  });

  it('answers the same twice and leaves the date alone', () => {
    const at = new Date('2026-10-30T07:15:00Z');
    const before = at.getTime();
    expect(bucharestClock(at)).toEqual(bucharestClock(at));
    expect(at.getTime()).toBe(before);
  });
});

// @traces 1260-FR-008
describe('filtersOf and filtersKey under odd queries', () => {
  const AT = new Date('2026-10-30T07:15:00Z');

  it('leaves openNow out when only open_saturday is set, even with an explicit undefined', () => {
    const filters = filtersOf({ open_now: undefined, open_saturday: '1' }, AT);
    expect(filters).toEqual({ saturday: true });
    expect('openNow' in (filters ?? {})).toBe(false);
  });

  it('leaves saturday out when only open_now is set', () => {
    const filters = filtersOf({ open_now: '1' }, AT);
    expect('saturday' in (filters ?? {})).toBe(false);
  });

  it('gives the instant of the request for open now', () => {
    expect(filtersOf({ open_now: '1' }, AT)?.openNow).toEqual(
      bucharestClock(AT),
    );
  });

  it('keeps the key of no filter apart from the key of every filter', () => {
    expect(filtersKey(undefined)).toBeUndefined();
    expect(
      filtersKey(filtersOf({ open_now: '1', open_saturday: '1' }, AT)),
    ).toBe('1,1');
  });

  it('gives open_now and open_saturday different keys', () => {
    expect(filtersKey(filtersOf({ open_now: '1' }, AT))).not.toBe(
      filtersKey(filtersOf({ open_saturday: '1' }, AT)),
    );
  });

  it('keeps the key of open now the same across a Saturday and a Tuesday instant', () => {
    expect(
      filtersKey(
        filtersOf({ open_now: '1' }, new Date('2026-10-31T08:00:00Z')),
      ),
    ).toBe(filtersKey(filtersOf({ open_now: '1' }, AT)));
  });

  it('does not treat a value other than 1 as a set filter', () => {
    expect(filtersOf({ open_now: '0' }, AT)).toBeUndefined();
    expect(filtersOf({ open_saturday: '' }, AT)).toBeUndefined();
  });
});

describe.each([
  ['pins', GaragePinsQueryDto],
  ['list', GarageSearchQueryDto],
] as const)(
  'the %s query under hostile open_now and open_saturday',
  (_name, dto) => {
    const hostile: [string, unknown][] = [
      ['null', null],
      ['the number 1', 1],
      ['the boolean true', true],
      ['an object', { 0: '1' }],
      ['a one-element list', ['1']],
      ['an empty list', []],
      ['a trailing newline', '1\n'],
      ['a trailing space', '1 '],
      ['a full-width digit', '１'],
      ['an Arabic-Indic digit', '١'],
      ['a zero-width joiner after the digit', '1‍'],
      ['a plus sign', '+1'],
      ['an exponent', '1e0'],
      ['uppercase true', 'TRUE'],
      ['a very long string', '1'.repeat(100_000)],
    ];

    describe.each(['open_now', 'open_saturday'])('%s', (field) => {
      it.each(hostile)('refuses %s', (_label, value) => {
        const found = messages(dto, { brand: 'bmw', [field]: value });
        expect(found.length).toBeGreaterThan(0);
        expect(found.every((message) => message.startsWith(`${field} `))).toBe(
          true,
        );
      });

      it('refuses the bad value even when the other filter is good', () => {
        const other = field === 'open_now' ? 'open_saturday' : 'open_now';
        const found = messages(dto, {
          brand: 'bmw',
          [other]: '1',
          [field]: 'true',
        });
        expect(found.length).toBeGreaterThan(0);
        expect(found.every((message) => message.startsWith(`${field} `))).toBe(
          true,
        );
      });

      it('refuses the bad value next to a bbox', () => {
        const found = messages(dto, {
          bbox: '44.35,26,44.5,26.25',
          brand: 'bmw',
          [field]: '0',
        });
        expect(found.length).toBeGreaterThan(0);
      });
    });

    it.each(['open_now[]', 'Open_Now', 'open-now', 'openNow', 'open_sat'])(
      'refuses the unknown parameter %s',
      (name) => {
        expect(messages(dto, { brand: 'bmw', [name]: '1' })).not.toEqual([]);
      },
    );

    it('takes both filters with a place and a brand', () => {
      expect(
        messages(dto, {
          brand: 'bmw',
          near: '44.437,26.117',
          open_now: '1',
          open_saturday: '1',
        }),
      ).toEqual([]);
    });
  },
);

// @traces 1260-FR-007
describe('the pin schema', () => {
  it('declares matches as a required boolean', () => {
    const meta = Reflect.getMetadata(
      'swagger/apiModelProperties',
      GaragePinDto.prototype,
      'matches',
    );
    expect(meta.required).not.toBe(false);
    expect(
      Reflect.getMetadata('design:type', GaragePinDto.prototype, 'matches'),
    ).toBe(Boolean);
  });
});
