import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { HomeQueryDto, PopularBrandsQueryDto } from './home.dto';

const errors = (dto: new () => object, query: Record<string, unknown>) =>
  validateSync(plainToInstance(dto, query), {
    forbidNonWhitelisted: true,
    whitelist: true,
  });

describe('HomeQueryDto under hostile input', () => {
  it.each([
    ['a trailing newline', 'dacia\n'],
    ['a leading hyphen', '-dacia'],
    ['a trailing hyphen', 'dacia-'],
    ['an accented letter', 'dacià'],
    ['a full-width letter', 'ｄacia'],
    ['an underscore', 'mercedes_benz'],
    ['an embedded space', 'mercedes benz'],
    ['a slash', 'a/b'],
    ['a number', 5],
    ['an array of slugs', ['dacia', 'bmw']],
    ['an object', { slug: 'dacia' }],
    ['a boolean', true],
    ['a 61 character slug made of hyphen groups', `${'a-'.repeat(30)}a`],
  ])('refuses a brand with %s', (_, brand) => {
    expect(errors(HomeQueryDto, { brand })).not.toEqual([]);
  });

  it('takes a 59 and a 60 character slug with hyphens inside', () => {
    expect(errors(HomeQueryDto, { brand: `${'a-'.repeat(29)}a` })).toEqual([]);
    expect(errors(HomeQueryDto, { brand: `${'a-'.repeat(29)}ab` })).toEqual([]);
  });

  it.each([
    ['padding spaces', ' 44,26'],
    ['an empty latitude', ',26'],
    ['an empty longitude', '44,'],
    ['an infinite latitude', 'Infinity,26'],
    ['an infinite longitude', '44,-Infinity'],
    ['an exponent that leaves the range', '1e3,26'],
    ['a hexadecimal number', '0x10,26'],
    ['a semicolon separator', '44;26'],
    ['a decimal comma', '44,5,26'],
    ['a latitude just past the pole', '90.0001,0'],
    ['a longitude just past the antimeridian', '0,-180.0001'],
    ['an array of places', ['44,26', '45,27']],
    ['a number', 44],
  ])('refuses a place with %s', (_, near) => {
    expect(errors(HomeQueryDto, { brand: 'dacia', near })).not.toEqual([]);
  });

  it('refuses a second brand field arriving as an array', () => {
    expect(errors(HomeQueryDto, { brand: ['dacia', 'dacia'] })).not.toEqual([]);
  });
});

describe('PopularBrandsQueryDto under hostile input', () => {
  it.each([
    ['a negative', '-1'],
    ['infinity', 'Infinity'],
    ['NaN', 'NaN'],
    ['a very large number', '99999999999999999999'],
    ['two values', ['1', '2']],
  ])('refuses a limit with %s', (_, value) => {
    expect(errors(PopularBrandsQueryDto, { limit: value })).not.toEqual([]);
  });

  it('refuses a field it does not know', () => {
    expect(
      errors(PopularBrandsQueryDto, { limit: '3', offset: '1' }),
    ).not.toEqual([]);
  });
});
