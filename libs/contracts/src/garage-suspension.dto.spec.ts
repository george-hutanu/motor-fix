import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { SUSPENSION_CAUSES, SuspendGarageDto } from './garage-suspension.dto';

// @traces 049-FR-005

const REASON = 'Autorizație RAR expirată pe 12 sept. 2026';

const read = (plain: unknown) => plainToInstance(SuspendGarageDto, plain);
const errorsFor = (plain: unknown) => validate(read(plain));

describe('SuspendGarageDto', () => {
  it('takes the four causes and no other', () => {
    expect([...SUSPENSION_CAUSES]).toEqual([
      'recheck_failed',
      'documents_overdue',
      'admin',
      'report_confirmed',
    ]);
  });

  it.each(SUSPENSION_CAUSES)('accepts the cause %s', async (cause) => {
    expect(await errorsFor({ cause, reason: REASON })).toEqual([]);
  });

  it.each([
    ['one character', 'a'],
    ['200 characters', 'ș'.repeat(200)],
    ['200 characters inside spaces', ` ${'a'.repeat(200)} `],
  ])('accepts a reason of %s', async (_, reason) => {
    expect(await errorsFor({ cause: 'admin', reason })).toEqual([]);
  });

  it('trims the reason', () => {
    expect(read({ cause: 'admin', reason: `  ${REASON}\n` }).reason).toBe(
      REASON,
    );
  });

  it.each([
    ['an unknown cause', { cause: 'unpaid', reason: REASON }],
    ['a cause in capitals', { cause: 'ADMIN', reason: REASON }],
    ['no cause', { reason: REASON }],
    ['no reason', { cause: 'admin' }],
    ['an empty reason', { cause: 'admin', reason: '' }],
    ['a blank reason', { cause: 'admin', reason: ' \t ' }],
    ['a null reason', { cause: 'admin', reason: null }],
    ['a number', { cause: 'admin', reason: 42 }],
    ['an array', { cause: 'admin', reason: [REASON] }],
    ['201 characters', { cause: 'admin', reason: 'a'.repeat(201) }],
    ['a control character', { cause: 'admin', reason: 'RAR\u0007 expirat' }],
  ])('refuses %s', async (_, body) => {
    expect((await errorsFor(body)).length).toBeGreaterThan(0);
  });
});
