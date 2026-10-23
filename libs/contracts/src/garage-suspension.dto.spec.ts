import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import {
  RestoreGarageDto,
  RestoreRecheckDto,
  SUSPENSION_CAUSES,
  SUSPENSION_LIFT_NOTE_MAX,
  SuspendGarageDto,
} from './garage-suspension.dto';

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

// @traces 067-FR-003 067-FR-005
describe('RestoreGarageDto', () => {
  const restore = (plain: unknown) => plainToInstance(RestoreGarageDto, plain);
  const refusedFields = async (plain: unknown) =>
    (await validate(restore(plain))).map((error) => error.property);
  const RECHECK = {
    activities: ['mechanics', 'brakes'],
    checkedOn: '2026-10-03',
  };

  it('accepts an empty body, a note alone and a re-check alone', async () => {
    expect(await refusedFields({})).toEqual([]);
    expect(await refusedFields({ note: 'A refăcut autorizația.' })).toEqual([]);
    expect(await refusedFields({ recheck: RECHECK })).toEqual([]);
  });

  it.each([
    ['one character', 'a'],
    ['1,000 characters', 'ș'.repeat(SUSPENSION_LIFT_NOTE_MAX)],
    ['1,000 characters beyond the basic plane', '🚗'.repeat(1000)],
    ['line breaks and a tab inside', 'Autorizație nouă\r\n\tverificată pe loc'],
  ])('accepts a note of %s', async (_, note) => {
    expect(await refusedFields({ note })).toEqual([]);
  });

  it('trims the note', () => {
    expect(restore({ note: '  Rezolvat.\n' }).note).toBe('Rezolvat.');
  });

  it.each([
    ['an empty note', { note: '' }],
    ['a blank note', { note: ' \n\t ' }],
    ['1,001 characters', { note: 'a'.repeat(1001) }],
    ['a bell character', { note: 'Rezolvat\u0007' }],
    ['a delete character', { note: 'Rezolvat\u007f' }],
    ['a C1 control character', { note: 'Rezolvat\u0085' }],
    ['a number', { note: 42 }],
  ])('refuses %s', async (_, body) => {
    expect(await refusedFields(body)).toEqual(['note']);
  });

  it.each([
    [
      'a date that is not a calendar day',
      { ...RECHECK, checkedOn: '2026-02-30' },
    ],
    ['a date with a time', { ...RECHECK, checkedOn: '2026-10-03T10:00:00Z' }],
    ['no date', { activities: RECHECK.activities }],
    ['no activities', { checkedOn: RECHECK.checkedOn }],
    ['empty activities', { ...RECHECK, activities: [] }],
    ['an empty code', { ...RECHECK, activities: [''] }],
    ['a code of 41 characters', { ...RECHECK, activities: ['a'.repeat(41)] }],
    ['a code that is not text', { ...RECHECK, activities: [7] }],
    ['activities that are not a list', { ...RECHECK, activities: 'mechanics' }],
  ])('refuses a re-check with %s', async (_, recheck) => {
    expect(await refusedFields({ recheck })).toEqual(['recheck']);
  });

  it('leaves an unknown activity code to the use case', async () => {
    expect(
      await refusedFields({ recheck: { ...RECHECK, activities: ['flying'] } }),
    ).toEqual([]);
  });

  it('reads the nested re-check as its own DTO', () => {
    expect(restore({ recheck: RECHECK }).recheck).toBeInstanceOf(
      RestoreRecheckDto,
    );
  });
});
