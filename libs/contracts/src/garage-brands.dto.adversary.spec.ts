import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { ReplaceGarageBrandsDto } from './garage-brands.dto';

const strict = { forbidNonWhitelisted: true, whitelist: true };
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const taken = (n: number, extra: object = {}) => ({
  brandId: id(n),
  stance: 'works_on',
  ...extra,
});
const check = async (plain: unknown) => {
  const dto = plainToInstance(ReplaceGarageBrandsDto, plain);
  const errors = await validate(dto, strict);
  return { dto, properties: errors.map((e) => e.property) };
};

// @traces 1247-FR-004
describe('the brand answer body at its size limit', () => {
  it('passes exactly 200 distinct brands and refuses 201', async () => {
    const many = (count: number) => ({
      brands: Array.from({ length: count }, (_, i) => taken(i + 1)),
    });
    expect((await check(many(200))).properties).toEqual([]);
    expect((await check(many(201))).properties).toEqual(['brands']);
  });

  it('refuses ten thousand brands without choking', async () => {
    const brands = Array.from({ length: 10_000 }, (_, i) => taken(i + 1));
    expect((await check({ brands })).properties).toEqual(['brands']);
  });

  it('takes the empty set and refuses a missing, null, string or object brands', async () => {
    expect((await check({ brands: [] })).properties).toEqual([]);
    expect((await check({})).properties).toEqual(['brands']);
    expect((await check({ brands: null })).properties).toEqual(['brands']);
    expect((await check({ brands: 'bmw' })).properties).toEqual(['brands']);
    expect((await check({ brands: { 0: taken(1) } })).properties).toEqual([
      'brands',
    ]);
  });
});

// @traces 1247-FR-006
describe('one brand of the answer under hostile input', () => {
  const one = (entry: unknown) => check({ brands: [entry] });

  it('refuses null, a string and a number in place of a brand', async () => {
    expect((await one(null)).properties).toEqual(['brands']);
    expect((await one('bmw')).properties).toEqual(['brands']);
    expect((await one(7)).properties).toEqual(['brands']);
  });

  it('refuses a brand id that is not a uuid, missing, null or numeric', async () => {
    for (const brandId of ['bmw', '', null, 12, undefined, `${id(1)} `]) {
      expect((await one({ brandId, stance: 'works_on' })).properties).toEqual([
        'brands',
      ]);
    }
  });

  it('refuses a stance outside the two, in capitals, null or missing', async () => {
    for (const stance of ['unstated', 'WORKS_ON', 'works_on ', null, 1]) {
      expect((await one({ brandId: id(1), stance })).properties).toEqual([
        'brands',
      ]);
    }
    expect((await one({ brandId: id(1) })).properties).toEqual(['brands']);
  });

  it('refuses a field the contract does not know, such as note or priceList', async () => {
    expect((await one(taken(1, { note: 'x' }))).properties).toEqual(['brands']);
    expect((await check({ brands: [], priceList: [] })).properties).toEqual([
      'priceList',
    ]);
  });

  it('refuses a fuel outside the four, a repeated fuel and a null or string list', async () => {
    for (const fuels of [
      ['lpg'],
      ['petrol', 'petrol'],
      null,
      'petrol',
      [null],
      ['PETROL'],
    ]) {
      expect((await one(taken(1, { fuels }))).properties).toEqual(['brands']);
    }
  });

  it('takes each of the four fuels alone, all four together, and no fuels key', async () => {
    for (const fuels of [
      ['petrol'],
      ['diesel'],
      ['hybrid'],
      ['electric'],
      ['petrol', 'diesel', 'hybrid', 'electric'],
    ]) {
      expect((await one(taken(1, { fuels }))).properties).toEqual([]);
    }
    expect((await one(taken(1))).properties).toEqual([]);
  });

  it('refuses job ids that are not uuids, null entries and a job list that is a string', async () => {
    for (const jobs of [['oil'], [null], [''], 'x', [id(1), 5]]) {
      expect((await one(taken(1, { jobs }))).properties).toEqual(['brands']);
    }
  });

  it('refuses the same brand twice, also in capitals, and a repeated brand with another stance', async () => {
    const upper = id(1).replace(/[a-f]/g, 'A');
    expect(
      (
        await check({
          brands: [taken(1), { brandId: upper, stance: 'does_not_take' }],
        })
      ).properties,
    ).toEqual(['brands']);
  });

  it('does not let a __proto__ key through onto the brand', async () => {
    const hostile = JSON.parse(
      `{"brandId":"${id(1)}","stance":"works_on","__proto__":{"stance":"does_not_take"}}`,
    );
    const { dto } = await check({ brands: [hostile] });
    expect(({} as { stance?: string }).stance).toBeUndefined();
    expect(dto.brands[0].stance).toBe('works_on');
  });
});

// @traces 1247-FR-006
describe('the brand note and refusal phrase at their limits', () => {
  it('passes a note of 140 and refuses one of 141', async () => {
    expect(
      (await check({ brandNote: 'a'.repeat(140), brands: [] })).properties,
    ).toEqual([]);
    expect(
      (await check({ brandNote: 'a'.repeat(141), brands: [] })).properties,
    ).toEqual(['brandNote']);
  });

  it('passes a phrase of 60 and refuses one of 61', async () => {
    expect(
      (await check({ brands: [], refusalPhrase: 'a'.repeat(60) })).properties,
    ).toEqual([]);
    expect(
      (await check({ brands: [], refusalPhrase: 'a'.repeat(61) })).properties,
    ).toEqual(['refusalPhrase']);
  });

  it('measures the note after trimming, so 140 letters padded with spaces pass', async () => {
    const { dto, properties } = await check({
      brandNote: `   ${'a'.repeat(140)}   `,
      brands: [],
    });
    expect(properties).toEqual([]);
    expect(dto.brandNote).toBe('a'.repeat(140));
  });

  it('reads a note of spaces, tabs and newlines as no note', async () => {
    const { dto, properties } = await check({
      brandNote: ' \t\n ',
      brands: [],
      refusalPhrase: '   ',
    });
    expect(properties).toEqual([]);
    expect(dto.brandNote).toBeUndefined();
    expect(dto.refusalPhrase).toBeUndefined();
  });

  it('refuses a note or phrase that is a number, an array, an object or a boolean', async () => {
    for (const value of [5, ['a'], { a: 1 }, true]) {
      expect(
        (await check({ brandNote: value, brands: [] })).properties,
      ).toEqual(['brandNote']);
      expect(
        (await check({ brands: [], refusalPhrase: value })).properties,
      ).toEqual(['refusalPhrase']);
    }
  });

  it('counts an emoji as one character, so 140 emoji pass in a note', async () => {
    expect(
      (await check({ brandNote: '🚗'.repeat(140), brands: [] })).properties,
    ).toEqual([]);
  });

  it('takes a note of Romanian letters with comma-below diacritics at 140', async () => {
    expect(
      (await check({ brandNote: 'ș'.repeat(140), brands: [] })).properties,
    ).toEqual([]);
    expect(
      (await check({ brandNote: 'ț'.repeat(141), brands: [] })).properties,
    ).toEqual(['brandNote']);
  });
});
