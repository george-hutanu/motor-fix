import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { VerificationDecisionDto } from './verification-file.dto';

// @traces 305-FR-003

const check = async (plain: unknown) => {
  const dto = plainToInstance(VerificationDecisionDto, plain);
  const errors = await validate(dto);
  return { dto, fields: errors.map((e) => e.property).sort() };
};
const reject = (extra: object) => ({
  decision: 'rejected',
  note: 'Autorizația RAR a expirat.',
  reason: 'rar',
  ...extra,
});

describe('a rejection at the edge, attacked', () => {
  it.each(['documents', 'rar', 'address', 'photos', 'other'])(
    'accepts the reason %s',
    async (reason) => {
      expect((await check(reject({ reason }))).fields).toEqual([]);
    },
  );

  it.each([
    ['upper case', 'DOCUMENTS'],
    ['padded', ' rar'],
    ['the old list', 'documents_unreadable'],
    ['empty', ''],
    ['null', null],
    ['an object', { code: 'rar' }],
    ['an array', ['rar']],
    ['a number', 1],
  ])('refuses a reason that is %s', async (_name, reason) => {
    expect((await check(reject({ reason }))).fields).toEqual(['reason']);
  });

  it('accepts a note of 1,000 characters and refuses 1,001', async () => {
    expect((await check(reject({ note: 'a'.repeat(1000) }))).fields).toEqual(
      [],
    );
    expect((await check(reject({ note: 'a'.repeat(1001) }))).fields).toEqual([
      'note',
    ]);
  });

  it('accepts a note of 1,000 code points that are emoji', async () => {
    expect((await check(reject({ note: '🚗'.repeat(1000) }))).fields).toEqual(
      [],
    );
  });

  it('refuses a note of 1,001 code points that are emoji', async () => {
    expect((await check(reject({ note: '🚗'.repeat(1001) }))).fields).toEqual([
      'note',
    ]);
  });

  it('trims a padded note of 1,000 code points to a valid one', async () => {
    const { dto, fields } = await check(
      reject({ note: `  ${'a'.repeat(1000)}  ` }),
    );

    expect(fields).toEqual([]);
    expect(dto.note).toBe('a'.repeat(1000));
  });

  it.each([
    ['a number', 12345678901],
    ['null', null],
    ['an array', ['a long enough note']],
    ['an object', { text: 'a long enough note' }],
  ])('refuses a note that is %s', async (_name, note) => {
    expect((await check(reject({ note }))).fields).toEqual(['note']);
  });

  it('refuses a note holding a NUL character', async () => {
    expect(
      (await check(reject({ note: 'Autorizația\u0000 expirată' }))).fields,
    ).toEqual(['note']);
  });

  it('leaves a blank note to the use case, as no note', async () => {
    const { dto, fields } = await check(reject({ note: '   \n' }));

    expect(fields).toEqual([]);
    expect(dto.note).toBeUndefined();
  });

  it('refuses a decision outside the three', async () => {
    expect((await check(reject({ decision: 'REJECTED' }))).fields).toEqual([
      'decision',
    ]);
  });
});
