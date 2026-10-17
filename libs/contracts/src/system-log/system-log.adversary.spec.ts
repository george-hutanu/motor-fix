import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { SystemLogQueryDto } from './system-log.dto';

function errorsOf(query: Record<string, unknown>) {
  return validateSync(plainToInstance(SystemLogQueryDto, query)).flatMap(
    (error) => Object.values(error.constraints ?? {}),
  );
}

const FROM = '2026-10-16T21:00:00.000Z';

// @traces 298-FR-001
describe('SystemLogQueryDto under hostile input', () => {
  it.each([
    ['a day that does not exist', '2026-02-30T00:00:00Z'],
    ['a month 13', '2026-13-01T00:00:00Z'],
    ['an hour 25', '2026-10-17T25:00:00Z'],
    ['a minute 61', '2026-10-17T00:61:00Z'],
    ['a lower-case zone letter', '2026-10-17T00:00:00z'],
    ['an offset without a colon', '2026-10-17T00:00:00+0300'],
    ['a trailing newline', `${FROM}\n`],
    ['leading whitespace', ` ${FROM}`],
    ['a trailing SQL fragment', `${FROM}'; DROP TABLE system_log_entry;--`],
    ['a unix timestamp', '1792184400000'],
    ['an empty string', ''],
  ])('refuses %s as the start', (_, from) => {
    expect(errorsOf({ from })).not.toEqual([]);
  });

  it.each([
    ['null', null],
    ['a number', 1792184400000],
    ['an array of instants', [FROM, FROM]],
    ['an object', { $gt: FROM }],
  ])('refuses %s as the start', (_, from) => {
    expect(errorsOf({ from })).not.toEqual([]);
  });

  it.each([
    '020',
    ' 5',
    '5 ',
    '1e1',
    '+5',
    '0x10',
    '٥',
    'NaN',
    'Infinity',
    '20.0000001',
    '9007199254740993',
  ])('refuses a limit of "%s"', (limit) => {
    const accepted = errorsOf({ from: FROM, limit }).length === 0;
    const value = plainToInstance(SystemLogQueryDto, {
      from: FROM,
      limit,
    }).limit;
    if (accepted) expect(value).toBeGreaterThanOrEqual(1);
    expect(accepted && !(Number.isInteger(value) && value! <= 20)).toBe(false);
  });

  it.each([
    ['a repeated limit', ['1', '2']],
    ['an object', { $gt: 1 }],
    ['a boolean', true],
  ])('refuses %s as the limit', (_, limit) => {
    expect(errorsOf({ from: FROM, limit })).not.toEqual([]);
  });

  it('takes an instant with a negative offset and a fraction of a second', () => {
    expect(errorsOf({ from: '2026-10-16T16:00:00.123456-05:00' })).toEqual([]);
  });

  it('takes the boundary limits 1 and 20 given as numbers', () => {
    expect(errorsOf({ from: FROM, limit: 1 })).toEqual([]);
    expect(errorsOf({ from: FROM, limit: 20 })).toEqual([]);
    expect(errorsOf({ from: FROM, limit: 21 })).not.toEqual([]);
    expect(errorsOf({ from: FROM, limit: 0 })).not.toEqual([]);
  });
});
