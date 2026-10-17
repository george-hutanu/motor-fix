import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { SYSTEM_LOG_PAGE, SystemLogQueryDto } from './system-log.dto';

function parse(query: Record<string, unknown>) {
  const dto = plainToInstance(SystemLogQueryDto, query);
  const errors = validateSync(dto).flatMap((error) =>
    Object.values(error.constraints ?? {}),
  );
  return { dto, errors };
}

const FROM = '2026-10-16T21:00:00.000Z';

// @traces 298-FR-001 298-FR-003
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

  it.each(['0', '21', '-1', '1.5', 'ten', ''])(
    'refuses a limit of "%s"',
    (limit) => {
      expect(parse({ from: FROM, limit }).errors).not.toEqual([]);
    },
  );
});
