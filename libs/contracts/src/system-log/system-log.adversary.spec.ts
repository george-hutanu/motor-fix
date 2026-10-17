import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { SystemLogQueryDto } from './system-log.dto';

function errorsOf(query: Record<string, unknown>) {
  return validateSync(plainToInstance(SystemLogQueryDto, query)).flatMap(
    (error) => Object.values(error.constraints ?? {}),
  );
}

const FROM = '2026-10-16T21:00:00.000Z';

// @traces 298-FR-001 299-FR-003
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

  it('reads a zero-padded limit as its number', () => {
    expect(errorsOf({ from: FROM, limit: '020' })).toEqual([]);
    expect(
      plainToInstance(SystemLogQueryDto, { from: FROM, limit: '020' }).limit,
    ).toBe(20);
  });

  it.each([
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
    expect(errorsOf({ from: FROM, limit })).not.toEqual([]);
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

  it('takes the boundary limits 1 and 50 given as numbers', () => {
    expect(errorsOf({ from: FROM, limit: 1 })).toEqual([]);
    expect(errorsOf({ from: FROM, limit: 50 })).toEqual([]);
    expect(errorsOf({ from: FROM, limit: 51 })).not.toEqual([]);
    expect(errorsOf({ from: FROM, limit: 0 })).not.toEqual([]);
  });
});

// @traces 299-system-log-search-FR-001 299-system-log-search-FR-003
describe('SystemLogQueryDto filters under hostile input', () => {
  it.each([
    ['one character', 'a'],
    ['one character with padding', '  a  '],
    ['101 characters', 'a'.repeat(101)],
    ['a list of two searches', ['ab', 'cd']],
    ['a number', 12],
    ['an object', { $ne: 'ab' }],
    ['a NUL byte the database cannot store', 'ab\u0000cd'],
  ])('refuses %s as the search', (_, q) => {
    expect(errorsOf({ from: FROM, q })).not.toEqual([]);
  });

  it.each([
    ['two characters', 'ab'],
    ['exactly 100 characters', 'a'.repeat(100)],
    ['100 characters with padding around', `  ${'a'.repeat(100)}  `],
    ['percent, underscore and backslash', '%_\\'],
    ['diacritics', 'ăîșțâ'],
  ])('accepts %s as the search', (_, q) => {
    expect(errorsOf({ from: FROM, q })).toEqual([]);
  });

  it('reads a blank search as no search', () => {
    const dto = plainToInstance(SystemLogQueryDto, { from: FROM, q: '   ' });

    expect(validateSync(dto)).toEqual([]);
    expect(dto.q).toBeUndefined();
  });

  it('trims the search it keeps', () => {
    expect(
      plainToInstance(SystemLogQueryDto, { from: FROM, q: ' ab ' }).q,
    ).toBe('ab');
  });

  it.each([
    ['kind', 'nope'],
    ['kind', ''],
    ['kind', 'status_changed,deploy'],
    ['kind', 'STATUS_CHANGED'],
    ['kind', '__proto__'],
    ['kind', 'constructor'],
    ['severity', 'critical'],
    ['severity', 'Info'],
    ['source', 'nope'],
    ['source', ' api'],
  ])('refuses %s of "%s"', (name, value) => {
    expect(errorsOf({ from: FROM, [name]: value })).not.toEqual([]);
  });

  it('refuses a list in which one kind is unknown', () => {
    expect(errorsOf({ from: FROM, kind: ['deploy', 'nope'] })).not.toEqual([]);
  });

  it('reads a single kind and a repeated kind as lists', () => {
    expect(
      plainToInstance(SystemLogQueryDto, { from: FROM, kind: 'deploy' }).kind,
    ).toEqual(['deploy']);
    expect(
      plainToInstance(SystemLogQueryDto, {
        from: FROM,
        kind: ['deploy', 'job_failed'],
      }).kind,
    ).toEqual(['deploy', 'job_failed']);
  });

  it.each([
    ['a day without a time', '2026-10-17'],
    ['an instant without a zone', '2026-10-17T00:00:00'],
    ['a nonexistent day', '2026-02-30T00:00:00Z'],
    ['null', null],
    ['a list', [FROM, FROM]],
  ])('refuses %s as the end', (_, to) => {
    expect(errorsOf({ from: FROM, to })).not.toEqual([]);
  });

  it.each([
    ['201 characters', 'A'.repeat(201)],
    ['padding', 'abc='],
    ['a plus sign', 'ab+c'],
    ['a newline at the end', 'abc\n'],
    ['nothing', ''],
    ['a list', ['abc', 'def']],
  ])('refuses a cursor of %s', (_, cursor) => {
    expect(errorsOf({ cursor, from: FROM })).not.toEqual([]);
  });

  it('accepts a cursor of exactly 200 characters', () => {
    expect(errorsOf({ cursor: 'A'.repeat(200), from: FROM })).toEqual([]);
  });

  it.each(['0', '51', '-1', '1000000', ''])(
    'refuses a limit of "%s"',
    (limit) => {
      expect(errorsOf({ from: FROM, limit })).not.toEqual([]);
    },
  );

  it.each(['1', '50'])('accepts a limit of %s', (limit) => {
    expect(errorsOf({ from: FROM, limit })).toEqual([]);
  });
});
