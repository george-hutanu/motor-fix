import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { RestoreGarageDto } from './garage-suspension.dto';

const refusedFields = async (plain: unknown) =>
  (await validate(plainToInstance(RestoreGarageDto, plain))).map(
    (error) => error.property,
  );
const recheck = (extra: Record<string, unknown>) => ({
  recheck: { activities: ['mechanics'], checkedOn: '2026-10-03', ...extra },
});

// @traces 067-FR-003 067-FR-005
describe('RestoreGarageDto under hostile input', () => {
  it.each([
    ['null', null],
    ['a boolean', true],
    ['an object', { a: 1 }],
    ['a list', ['a']],
  ])('refuses %s as the note', async (_, note) => {
    expect(await refusedFields({ note })).toEqual(['note']);
  });

  it.each([
    ['a no-break space', ' '],
    ['an ideographic space', '　'],
    ['a line separator and spaces', '   '],
  ])('refuses a note of only %s', async (_, note) => {
    expect(await refusedFields({ note })).toEqual(['note']);
  });

  it.each([
    ['a null character', 'a\u0000b'],
    ['an escape', 'a\u001bb'],
    ['a vertical tab', 'a\u000bb'],
    ['a form feed', 'a\u000cb'],
    ['a next-line character', 'a\u0085b'],
  ])('refuses a note with %s inside', async (_, note) => {
    expect(await refusedFields({ note })).toEqual(['note']);
  });

  it('counts a note of 1,000 characters after trimming, not before', async () => {
    const note = `\n\t ${'ș'.repeat(1000)} \r\n`;

    expect(await refusedFields({ note })).toEqual([]);
  });

  it.each([
    ['2028-02-29', []],
    ['2027-02-29', ['recheck']],
    ['2026-13-01', ['recheck']],
    ['2026-00-10', ['recheck']],
    ['2026-04-31', ['recheck']],
    ['', ['recheck']],
    [' 2026-10-03', ['recheck']],
  ])('reads the date %j', async (checkedOn, refused) => {
    expect(await refusedFields(recheck({ checkedOn }))).toEqual(refused);
  });

  it.each([
    ['a null date', { checkedOn: null }],
    ['a date as a number', { checkedOn: 20261003 }],
    ['activities as null', { activities: null }],
    ['an activity that is null', { activities: [null] }],
    ['an activity that is a list', { activities: [['mechanics']] }],
  ])('refuses a re-check with %s', async (_, extra) => {
    expect(await refusedFields(recheck(extra))).toEqual(['recheck']);
  });

  it('accepts an activity code of exactly 40 characters and of one', async () => {
    expect(
      await refusedFields(recheck({ activities: ['a'.repeat(40), 'b'] })),
    ).toEqual([]);
  });

  it('passes the same code twice to the use case, which owns what the list means', async () => {
    expect(
      await refusedFields(recheck({ activities: ['mechanics', 'mechanics'] })),
    ).toEqual([]);
  });
});
