import { randomUUID } from 'node:crypto';

import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { ReplaceGarageBrandsDto } from './garage-brands.dto';

const problems = (dto: object) =>
  validateSync(dto, { forbidNonWhitelisted: true, whitelist: true }).map(
    (e) => e.property,
  );

const replace = (body: Record<string, unknown>) =>
  plainToInstance(ReplaceGarageBrandsDto, body);

const bmw = randomUUID();
const tesla = randomUUID();

describe('ReplaceGarageBrandsDto', () => {
  it('takes a set of taken and refused brands with the two texts', () => {
    const dto = replace({
      brandNote: 'Fără mașini 100% electrice și nimic fabricat înainte de 2005',
      brands: [
        { brandId: bmw, stance: 'works_on' },
        { brandId: tesla, stance: 'does_not_take' },
      ],
      refusalPhrase: 'orice nu e BMW',
    });

    expect(problems(dto)).toEqual([]);
    expect(dto.brands.map((b) => b.stance)).toEqual([
      'works_on',
      'does_not_take',
    ]);
  });

  it('takes the ticked fuels of a taken brand, none ticked included', () => {
    const dto = replace({
      brands: [
        { brandId: bmw, fuels: ['petrol', 'diesel'], stance: 'works_on' },
        { brandId: tesla, fuels: [], stance: 'works_on' },
      ],
    });

    expect(problems(dto)).toEqual([]);
    expect(dto.brands.map((b) => b.fuels)).toEqual([['petrol', 'diesel'], []]);
  });

  it('takes an empty set, which switches every brand off', () => {
    expect(problems(replace({ brands: [] }))).toEqual([]);
  });

  it('trims the texts and reads a blank one as no text', () => {
    const dto = replace({
      brandNote: '   ',
      brands: [],
      refusalPhrase: '  orice nu e BMW ',
    });

    expect(problems(dto)).toEqual([]);
    expect(dto.brandNote).toBeUndefined();
    expect(dto.refusalPhrase).toBe('orice nu e BMW');
  });

  it('counts the limits in characters, so 140 letters with diacritics pass', () => {
    const dto = replace({
      brandNote: 'ș'.repeat(140),
      brands: [],
      refusalPhrase: '🚗'.repeat(60),
    });

    expect(problems(dto)).toEqual([]);
  });

  it.each([
    ['a note of 141 characters', { brandNote: 'a'.repeat(141) }, 'brandNote'],
    [
      'a phrase of 61 characters',
      { refusalPhrase: 'a'.repeat(61) },
      'refusalPhrase',
    ],
    [
      'a stance that is neither taken nor refused',
      { brands: [{ brandId: bmw, stance: 'unstated' }] },
      'brands',
    ],
    [
      'a brand id that is not a uuid',
      { brands: [{ brandId: 'bmw', stance: 'works_on' }] },
      'brands',
    ],
    [
      'the same brand twice',
      {
        brands: [
          { brandId: bmw, stance: 'works_on' },
          { brandId: bmw, stance: 'does_not_take' },
        ],
      },
      'brands',
    ],
    [
      'a fuel twice',
      {
        brands: [
          { brandId: bmw, fuels: ['diesel', 'diesel'], stance: 'works_on' },
        ],
      },
      'brands',
    ],
    [
      'an unknown fuel',
      { brands: [{ brandId: bmw, fuels: ['lpg'], stance: 'works_on' }] },
      'brands',
    ],
    [
      'fuels that are not a list',
      { brands: [{ brandId: bmw, fuels: 'petrol', stance: 'works_on' }] },
      'brands',
    ],
    ['no set at all', { brands: undefined }, 'brands'],
    ['an unknown property', { status: 'approved' }, 'status'],
  ])('refuses %s', (_, change, property) => {
    expect(problems(replace({ brands: [], ...change }))).toContain(property);
  });
});
