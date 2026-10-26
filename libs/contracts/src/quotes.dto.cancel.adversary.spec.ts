import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { CancelBookingDto } from './quotes.dto';

// @traces 1258-driver-cancel-FR-002

const problems = (body: Record<string, unknown>) => {
  const dto = plainToInstance(CancelBookingDto, body);
  return {
    dto,
    fields: validateSync(dto, {
      forbidNonWhitelisted: true,
      whitelist: true,
    }).map((e) => e.property),
  };
};

describe('CancelBookingDto under hostile input', () => {
  it('takes a note of exactly 500 characters and refuses 501', () => {
    expect(problems({ note: 'a'.repeat(500), reason: 'other' }).fields).toEqual(
      [],
    );
    expect(problems({ note: 'a'.repeat(501), reason: 'other' }).fields).toEqual(
      ['note'],
    );
  });

  it('counts characters, not UTF-16 units: 500 emoji pass and 501 do not', () => {
    expect(
      problems({ note: '😀'.repeat(500), reason: 'other' }).fields,
    ).toEqual([]);
    expect(
      problems({ note: '😀'.repeat(501), reason: 'other' }).fields,
    ).toEqual(['note']);
  });

  it('counts 500 combining-accent Romanian letters written as one code point each', () => {
    expect(problems({ note: 'ș'.repeat(500), reason: 'other' }).fields).toEqual(
      [],
    );
  });

  it('trims the note before counting and turns blank into null', () => {
    const padded = problems({
      note: `　 ${'a'.repeat(500)} \n`,
      reason: 'other',
    });
    expect(padded.fields).toEqual([]);
    expect(padded.dto.note).toBe('a'.repeat(500));
    expect(problems({ note: ' \t ', reason: 'other' }).dto.note).toBeNull();
  });

  it.each([
    ['empty reason', ''],
    ['padded reason', 'other '],
    ['upper-case reason', 'OTHER'],
    ['garage reason', 'no_mechanic_free'],
    ['account closed', 'driver_account_closed'],
    ['inherited key', 'constructor'],
    ['number', 1],
    ['null', null],
    ['array', ['other']],
  ])('refuses a %s as the reason', (_name, reason) => {
    expect(problems({ reason }).fields).toEqual(['reason']);
  });

  it('refuses a missing reason, a numeric note and an unknown field', () => {
    expect(problems({}).fields).toEqual(['reason']);
    expect(problems({ note: 7, reason: 'other' }).fields).toEqual(['note']);
    expect(problems({ extra: 1, reason: 'other' }).fields).toEqual(['extra']);
  });
});
