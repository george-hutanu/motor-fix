import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import {
  SYSTEM_LOG_PAGE,
  SYSTEM_LOG_PAGE_MAX,
  SYSTEM_LOG_RETENTION_DAYS,
  SYSTEM_LOG_SEARCH_MAX,
  SYSTEM_LOG_SEARCH_MIN,
} from './system-log';
import { SystemLogQueryDto } from './system-log.dto';

function parse(query: Record<string, unknown>) {
  const dto = plainToInstance(SystemLogQueryDto, query);
  const errors = validateSync(dto).flatMap((error) =>
    Object.values(error.constraints ?? {}),
  );
  return { dto, errors };
}

const FROM = '2026-10-16T21:00:00.000Z';

// @traces 298-FR-001 298-FR-003 299-FR-001 299-FR-003
describe('SystemLogQueryDto', () => {
  it('pages twenty entries at most', () => {
    expect(SYSTEM_LOG_PAGE).toBe(20);
  });

  it.each([FROM, '2026-10-17T00:00+03:00', '2026-10-17T00:00:00.5+03:00'])(
    'takes the instant %s with no limit',
    (from) => {
      expect(parse({ from }).errors).toEqual([]);
    },
  );

  it.each([
    ['1', 1],
    ['20', 20],
    ['50', 50],
  ])('takes a limit of %s from the query string', (limit, number) => {
    const { dto, errors } = parse({ from: FROM, limit });

    expect(errors).toEqual([]);
    expect(dto.limit).toBe(number);
  });

  it('refuses a query without a start', () => {
    expect(parse({}).errors).not.toEqual([]);
  });

  it.each([
    ['a calendar day', '2026-10-17'],
    ['a time without a zone', '2026-10-17T00:00:00'],
    ['words', 'today'],
  ])('refuses %s as the start, naming the zone', (_, from) => {
    expect(parse({ from }).errors).toContain(
      'from must be a date-time with a zone',
    );
  });

  it.each(['0', '51', '-1', '1.5', 'ten', ''])(
    'refuses a limit of "%s"',
    (limit) => {
      expect(parse({ from: FROM, limit }).errors).not.toEqual([]);
    },
  );
});

// @traces 299-FR-001 299-FR-003 299-FR-004
describe('SystemLogQueryDto narrowing', () => {
  it('reads fifty entries at most, keeps ninety days and searches 2 to 100 characters', () => {
    expect(SYSTEM_LOG_PAGE_MAX).toBe(50);
    expect(SYSTEM_LOG_RETENTION_DAYS).toBe(90);
    expect([SYSTEM_LOG_SEARCH_MIN, SYSTEM_LOG_SEARCH_MAX]).toEqual([2, 100]);
  });

  it('takes an end instant', () => {
    const { dto, errors } = parse({
      from: FROM,
      to: '2026-10-17T21:00:00.000Z',
    });

    expect(errors).toEqual([]);
    expect(dto.to).toBe('2026-10-17T21:00:00.000Z');
  });

  it('refuses a calendar day as the end, naming the zone', () => {
    expect(parse({ from: FROM, to: '2026-10-17' }).errors).toContain(
      'to must be a date-time with a zone',
    );
  });

  it.each([
    ['kind', 'backup_failed'],
    ['severity', 'error'],
    ['source', 'email'],
  ])('reads one %s as a list of one', (name, value) => {
    const { dto, errors } = parse({ from: FROM, [name]: value });

    expect(errors).toEqual([]);
    expect(dto[name as 'kind']).toEqual([value]);
  });

  it('reads repeated values of a parameter as a list', () => {
    const { dto, errors } = parse({
      from: FROM,
      kind: ['backup_completed', 'backup_failed'],
      severity: ['warning', 'error'],
      source: ['email', 'maps'],
    });

    expect(errors).toEqual([]);
    expect(dto.kind).toEqual(['backup_completed', 'backup_failed']);
    expect(dto.severity).toEqual(['warning', 'error']);
    expect(dto.source).toEqual(['email', 'maps']);
  });

  it.each([
    ['kind', 'backup'],
    ['severity', 'fatal'],
    ['source', 'mailgun'],
    ['kind', ['deploy', 'nope']],
  ])('refuses an unknown %s', (name, value) => {
    expect(parse({ from: FROM, [name]: value }).errors).not.toEqual([]);
  });

  it('trims the search text', () => {
    const { dto, errors } = parse({ from: FROM, q: '  brevo  ' });

    expect(errors).toEqual([]);
    expect(dto.q).toBe('brevo');
  });

  it.each(['', '   '])('treats the search "%s" as absent', (q) => {
    const { dto, errors } = parse({ from: FROM, q });

    expect(errors).toEqual([]);
    expect(dto.q).toBeUndefined();
  });

  it.each([
    ['2', 'ab'],
    ['100', 'a'.repeat(100)],
  ])('takes a search of %s characters', (_, q) => {
    expect(parse({ from: FROM, q }).errors).toEqual([]);
  });

  it.each([
    ['1', 'a'],
    ['1 between spaces', '  a  '],
    ['101', 'a'.repeat(101)],
  ])('refuses a search of %s characters', (_, q) => {
    expect(parse({ from: FROM, q }).errors).not.toEqual([]);
  });

  it('takes a url-safe cursor', () => {
    const { dto, errors } = parse({ cursor: 'MjAyNi0xMC0xN3x4', from: FROM });

    expect(errors).toEqual([]);
    expect(dto.cursor).toBe('MjAyNi0xMC0xN3x4');
  });

  it.each([
    ['empty', ''],
    ['with padding', 'abc='],
    ['with a slash', 'ab/c'],
    ['longer than 200 characters', 'A'.repeat(201)],
  ])('refuses a cursor that is %s', (_, cursor) => {
    expect(parse({ cursor, from: FROM }).errors).not.toEqual([]);
  });

  it('still needs a start when narrowed', () => {
    expect(parse({ kind: 'deploy', q: 'brevo' }).errors).not.toEqual([]);
  });
});
