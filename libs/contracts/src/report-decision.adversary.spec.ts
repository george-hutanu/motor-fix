import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { ReportDecisionDto } from './verification-file.dto';

const check = async (plain: unknown) => {
  const dto = plainToInstance(ReportDecisionDto, plain);
  return { dto, errors: await validate(dto) };
};
const refused = async (plain: unknown) =>
  (await check(plain)).errors.map((e) => e.property).sort();

describe('the report decision payload', () => {
  // @traces 069-FR-001
  it.each([
    ['missing', {}],
    ['null', { decision: null }],
    ['unknown', { decision: 'approved' }],
    ['wrong case', { decision: 'Confirmed' }],
    ['a list', { decision: ['confirmed'] }],
    ['a number', { decision: 1 }],
    ['padded', { decision: ' unfounded', note: 'x' }],
  ])('refuses a decision that is %s', async (_, plain) => {
    expect(await refused(plain)).toContain('decision');
  });

  // @traces 069-FR-001
  it('accepts a reason of exactly 200 characters and refuses 201', async () => {
    expect(
      await refused({ decision: 'confirmed', reason: 'a'.repeat(200) }),
    ).toEqual([]);
    expect(
      await refused({ decision: 'confirmed', reason: 'a'.repeat(201) }),
    ).toEqual(['reason']);
  });

  // @traces 069-FR-001
  it('counts a reason in code points, so 200 emoji are accepted and 201 refused', async () => {
    expect(
      await refused({ decision: 'confirmed', reason: '🚗'.repeat(200) }),
    ).toEqual([]);
    expect(
      await refused({ decision: 'confirmed', reason: '🚗'.repeat(201) }),
    ).toEqual(['reason']);
  });

  // @traces 069-FR-001
  it('counts a note in code points, so 1000 emoji are accepted and 1001 refused', async () => {
    expect(
      await refused({ decision: 'unfounded', note: '🚗'.repeat(1000) }),
    ).toEqual([]);
    expect(
      await refused({ decision: 'unfounded', note: '🚗'.repeat(1001) }),
    ).toEqual(['note']);
  });

  // @traces 069-FR-001
  it('accepts a note of exactly 1000 characters and refuses 1001', async () => {
    expect(
      await refused({ decision: 'unfounded', note: 'n'.repeat(1000) }),
    ).toEqual([]);
    expect(
      await refused({ decision: 'unfounded', note: 'n'.repeat(1001) }),
    ).toEqual(['note']);
  });

  // @traces 069-FR-001
  it('trims before measuring, so padding does not count', async () => {
    const { dto, errors } = await check({
      decision: 'confirmed',
      reason: `  ${'a'.repeat(200)}  `,
    });
    expect(errors).toEqual([]);
    expect(dto.reason).toBe('a'.repeat(200));
  });

  // @traces 069-FR-001
  it('reads a blank reason as none, leaving the 422 to the use case', async () => {
    const { dto, errors } = await check({
      decision: 'confirmed',
      reason: '  ',
    });
    expect(errors).toEqual([]);
    expect(dto.reason).toBeUndefined();
  });

  // @traces 069-FR-001
  it.each([
    ['null', null],
    ['a number', 12],
    ['a list', ['x']],
    ['an object', { a: 1 }],
  ])('refuses a confirmed reason that is %s', async (_, reason) => {
    expect(await refused({ decision: 'confirmed', reason })).toEqual([
      'reason',
    ]);
  });

  // @traces 069-FR-001
  it.each([
    ['null', null],
    ['a number', 12],
    ['a list', ['x']],
  ])('refuses an unfounded note that is %s', async (_, note) => {
    expect(await refused({ decision: 'unfounded', note })).toEqual(['note']);
  });

  // @traces 069-FR-001
  it('ignores the field that belongs to the other decision, however wrong', async () => {
    expect(
      await refused({
        decision: 'unfounded',
        note: 'ok',
        reason: 'r'.repeat(5000),
      }),
    ).toEqual([]);
    expect(
      await refused({
        decision: 'confirmed',
        note: 'n'.repeat(5000),
        reason: 'ok',
      }),
    ).toEqual([]);
  });

  // @traces 069-FR-001
  it.each(['\u0000', '\u0007', '\u001b[31m', '\u0085'])(
    'refuses a reason holding the control character %j',
    async (ctl) => {
      expect(
        await refused({ decision: 'confirmed', reason: `a${ctl}b` }),
      ).toEqual(['reason']);
    },
  );

  // @traces 069-FR-001
  it('refuses a note holding a null byte but keeps its line breaks', async () => {
    expect(await refused({ decision: 'unfounded', note: 'a\u0000b' })).toEqual([
      'note',
    ]);
    expect(await refused({ decision: 'unfounded', note: 'a\r\nb\tc' })).toEqual(
      [],
    );
  });

  // @traces 069-FR-001
  it('keeps markup as plain text and does not strip it', async () => {
    const { dto, errors } = await check({
      decision: 'confirmed',
      reason: '<img src=x onerror=alert(1)>',
    });
    expect(errors).toEqual([]);
    expect(dto.reason).toBe('<img src=x onerror=alert(1)>');
  });

  // @traces 069-FR-001
  it('reads a unicode non-breaking space around a reason as padding', async () => {
    const { dto, errors } = await check({
      decision: 'confirmed',
      reason: ' motiv ',
    });
    expect(errors).toEqual([]);
    expect(dto.reason).toBe('motiv');
  });
});
