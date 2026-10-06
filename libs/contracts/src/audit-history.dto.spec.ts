import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { AuditHistoryQueryDto } from './audit-history.dto';

function errors(query: Record<string, unknown>) {
  return validateSync(plainToInstance(AuditHistoryQueryDto, query)).flatMap(
    (error) => Object.values(error.constraints ?? {}),
  );
}

describe('AuditHistoryQueryDto', () => {
  it.each([
    '2026-10-05T08:30Z',
    '2026-10-05T08:30:15Z',
    '2026-10-05T08:30:15.123Z',
    '2026-10-05T08:30:15+03:00',
    '2026-10-05T08:30:15.5-01:30',
  ])('takes the instant %s', (from) => {
    expect(errors({ from, to: from })).toEqual([]);
  });

  it.each([
    ['a calendar day', '2026-10-05'],
    ['a time without a zone', '2026-10-05T08:30:15'],
    ['a two-digit year', '26-10-05T08:30Z'],
    ['a one-digit month', '2026-1-05T08:30Z'],
    ['a one-digit day', '2026-10-5T08:30Z'],
    ['a one-digit hour', '2026-10-05T8:30Z'],
    ['a one-digit minute', '2026-10-05T08:3Z'],
    ['a one-digit second', '2026-10-05T08:30:1Z'],
    ['a dot without a fraction', '2026-10-05T08:30:15.Z'],
    ['a one-digit zone hour', '2026-10-05T08:30+3:00'],
    ['a one-digit zone minute', '2026-10-05T08:30+03:0'],
    ['a zone without a sign', '2026-10-05T08:30 03:00'],
    ['text before the instant', 'x2026-10-05T08:30Z'],
    ['text after the instant', '2026-10-05T08:30Zx'],
  ])('refuses %s, naming the zone', (_, from) => {
    expect(errors({ from })).toContain('from must be a date-time with a zone');
  });

  it('refuses a time without a zone as the end too', () => {
    expect(errors({ to: '2026-10-05T08:30' })).toContain(
      'to must be a date-time with a zone',
    );
  });

  it('takes no filter at all', () => {
    expect(errors({})).toEqual([]);
  });
});
