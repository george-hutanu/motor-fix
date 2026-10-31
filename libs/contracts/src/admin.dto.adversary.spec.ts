// @traces 106-FR-006
import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { AdminDemandSupplyQueryDto } from './admin.dto';

const strict = { forbidNonWhitelisted: true, whitelist: true };
const problemsOf = async (plain: object) =>
  (
    await validate(plainToInstance(AdminDemandSupplyQueryDto, plain), strict)
  ).map((error) => error.property);

describe('the demand and supply query under hostile input', () => {
  it.each([
    ['exactly 80 characters', 'b'.repeat(80)],
    ['a single space', ' '],
    ['punctuation and quotes', "'; DROP TABLE area;--"],
    ['a colon, as the stored key uses', 'Mercedes:Benz'],
  ])('takes a brand of %s', async (_, brand) => {
    expect(await problemsOf({ brand })).toEqual([]);
  });

  it('counts a brand of 80 astral characters as 80 characters', async () => {
    expect(await problemsOf({ brand: '\u{1F697}'.repeat(80) })).toEqual([]);
  });

  it.each([
    ['a number', 7],
    ['null as a value', null],
    ['an array of strings', ['BMW', 'Audi']],
    ['an object', { $ne: '' }],
    ['a boolean', true],
  ])('refuses a brand that is %s', async (_, brand) => {
    expect(await problemsOf({ brand })).toEqual(['brand']);
  });

  it.each([
    ['upper case unknown', 'UNKNOWN'],
    ['a trailing newline', 'sector-3\n'],
    ['a leading space', ' sector-3'],
    ['an underscore', 'sector_3'],
    ['a diacritic', 'iași'],
    ['a full-width digit', 'sector-３'],
    ['a dot path', '../etc'],
    ['an array', ['sector-3', 'sector-4']],
    ['a number', 3],
    ['a trailing dash', 'sector-'],
    ['unknown with a suffix', 'unknown-'],
  ])('refuses an area with %s', async (_, area) => {
    expect(await problemsOf({ area })).toEqual(['area']);
  });
});
