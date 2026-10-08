import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { HomeQueryDto, PopularBrandsQueryDto } from './home.dto';

const errors = (dto: new () => object, query: Record<string, unknown>) =>
  validateSync(plainToInstance(dto, query), {
    forbidNonWhitelisted: true,
    whitelist: true,
  });

describe('HomeQueryDto', () => {
  it.each(['dacia', 'mercedes-benz', 'a', 'a'.repeat(60)])(
    'takes the slug %s',
    (brand) => {
      expect(errors(HomeQueryDto, { brand })).toEqual([]);
    },
  );

  it.each([
    ['no brand', {}],
    ['a blank brand', { brand: '' }],
    ['a brand with a trailing space', { brand: 'dacia ' }],
    ['a brand in capitals', { brand: 'Dacia' }],
    ['a brand of 61 characters', { brand: 'a'.repeat(61) }],
    ['a brand with a control character', { brand: 'da\u0000cia' }],
    ['a brand with a double hyphen', { brand: 'mercedes--benz' }],
    ['a parameter it does not know', { brand: 'dacia', sort: 'rating' }],
  ])('refuses %s', (_, query) => {
    expect(errors(HomeQueryDto, query)).not.toEqual([]);
  });

  it.each(['44.43,26.10', '-90,-180', '90,180', '0,0'])(
    'takes the place %s and ignores it',
    (near) => {
      expect(errors(HomeQueryDto, { brand: 'dacia', near })).toEqual([]);
    },
  );

  it.each(['91,26', '44,181', '44', '44,26,1', 'abc,def', 'NaN,1', ''])(
    'refuses the place %s',
    (near) => {
      expect(errors(HomeQueryDto, { brand: 'dacia', near })).not.toEqual([]);
    },
  );
});

describe('PopularBrandsQueryDto', () => {
  const limit = (value: unknown) =>
    plainToInstance(PopularBrandsQueryDto, { limit: value });

  it('asks for eight tiles when no limit is given', () => {
    expect(plainToInstance(PopularBrandsQueryDto, {}).limit).toBe(8);
  });

  it.each(['1', '12'])('takes the limit %s as a number', (value) => {
    expect(limit(value).limit).toBe(Number(value));
    expect(errors(PopularBrandsQueryDto, { limit: value })).toEqual([]);
  });

  it.each(['0', '13', '2.5', 'eight', ''])('refuses the limit %s', (value) => {
    expect(errors(PopularBrandsQueryDto, { limit: value })).not.toEqual([]);
  });
});
