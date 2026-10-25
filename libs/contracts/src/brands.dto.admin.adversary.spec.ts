import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import {
  AdminBrandsQueryDto,
  CreateBrandDto,
  UpdateBrandDto,
} from './brands.dto';
import { brandLoadTimeoutMs } from './env';

const strict = { forbidNonWhitelisted: true, whitelist: true };
const problemsOf = async (type: new () => object, plain: object) =>
  (await validate(plainToInstance(type, plain), strict)).map(
    (error) => error.property,
  );

// @traces 105-FR-004
describe('a new brand name under hostile input', () => {
  const create = (name: unknown) => problemsOf(CreateBrandDto, { name });

  it('refuses null, an array, an object and a boolean as the name', async () => {
    expect(await create(null)).toEqual(['name']);
    expect(await create(['Xpeng'])).toEqual(['name']);
    expect(await create({ toString: 'Xpeng' })).toEqual(['name']);
    expect(await create(true)).toEqual(['name']);
  });

  it('refuses a name of only spaces or only tabs', async () => {
    expect(await create('        ')).toEqual(['name']);
    expect(await create('\t\t\t')).toEqual(['name']);
  });

  it('counts 40 emoji as 40 characters and refuses 41', async () => {
    expect(await create('🚗'.repeat(40))).toEqual([]);
    expect(await create('🚗'.repeat(41))).toEqual(['name']);
  });

  it('refuses a C1 control character and a DEL', async () => {
    expect(await create('Xp\u0085eng')).toEqual(['name']);
    expect(await create('Xp\u007feng')).toEqual(['name']);
  });

  it('refuses a name of 2 invisible characters', async () => {
    expect(await create('​​')).toEqual(['name']);
  });

  it('accepts exactly 40 characters after trimming 100 of padding', async () => {
    expect(await create(` ${'a'.repeat(40)} `.padEnd(100, ' '))).toEqual([]);
  });
});

// @traces 105-FR-006
describe('a brand edit under hostile input', () => {
  const update = (values: object) => problemsOf(UpdateBrandDto, values);

  it('refuses a body with no seenUpdatedAt', async () => {
    expect(await update({ name: 'Dacia' })).toEqual(['seenUpdatedAt']);
  });

  it('refuses a seenUpdatedAt that is null, a number or an impossible date', async () => {
    expect(await update({ active: false, seenUpdatedAt: null })).toEqual([
      'seenUpdatedAt',
    ]);
    expect(
      await update({ active: false, seenUpdatedAt: 1760000000000 }),
    ).toEqual(['seenUpdatedAt']);
    expect(
      await update({ active: false, seenUpdatedAt: '2026-02-30T00:00:00Z' }),
    ).toEqual(['seenUpdatedAt']);
    expect(await update({ active: false, seenUpdatedAt: '' })).toEqual([
      'seenUpdatedAt',
    ]);
  });

  it('refuses a null name or a null active when sent explicitly', async () => {
    const seenUpdatedAt = '2026-10-24T12:00:00.000Z';
    expect(await update({ name: 5, seenUpdatedAt })).toEqual(['name']);
    expect(await update({ active: [true], seenUpdatedAt })).toEqual(['active']);
  });

  it('refuses a field it does not know, such as popularity', async () => {
    expect(
      await update({
        active: true,
        popularity: 1,
        seenUpdatedAt: '2026-10-24T12:00:00.000Z',
      }),
    ).toEqual(['popularity']);
  });
});

// @traces 105-FR-003
describe('the admin brand search text', () => {
  const query = (q: unknown) => problemsOf(AdminBrandsQueryDto, { q });

  it('accepts 40 characters and refuses 41', async () => {
    expect(await query('a'.repeat(40))).toEqual([]);
    expect(await query('a'.repeat(41))).toEqual(['q']);
  });

  it('accepts an empty q', async () => {
    expect(await query('')).toEqual([]);
  });

  it('refuses a repeated q', async () => {
    expect(await query(['a', 'b'])).toEqual(['q']);
  });

  it('refuses an extra parameter', async () => {
    expect(await problemsOf(AdminBrandsQueryDto, { limit: '5' })).toEqual([
      'limit',
    ]);
  });
});

// @traces 105-FR-013
describe('BRAND_LOAD_TIMEOUT_MS under hostile values', () => {
  it.each(['0', '-5', '1.5', '1e3', '0x10', ' 5', '5 ', '5ms', '٣٠٠٠', '007'])(
    'refuses %j naming the variable',
    (value) => {
      expect(() =>
        brandLoadTimeoutMs({ BRAND_LOAD_TIMEOUT_MS: value }),
      ).toThrow(/BRAND_LOAD_TIMEOUT_MS/);
    },
  );

  it('takes 1 and a very large whole number as they are', () => {
    expect(brandLoadTimeoutMs({ BRAND_LOAD_TIMEOUT_MS: '1' })).toBe(1);
    expect(brandLoadTimeoutMs({ BRAND_LOAD_TIMEOUT_MS: '600000' })).toBe(
      600_000,
    );
  });
});
