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

describe('the demand and supply query', () => {
  it('takes nothing, a brand of 1 to 80 characters and an area code or unknown', async () => {
    expect(await problemsOf({})).toEqual([]);
    expect(await problemsOf({ brand: 'B' })).toEqual([]);
    expect(await problemsOf({ brand: 'é'.repeat(80) })).toEqual([]);
    expect(await problemsOf({ area: 'unknown' })).toEqual([]);
    expect(await problemsOf({ area: 'sector-3' })).toEqual([]);
    expect(
      await problemsOf({ area: 'cluj-napoca', brand: 'Mercedes-Benz' }),
    ).toEqual([]);
  });

  it.each([
    [{ brand: '' }, 'brand'],
    [{ brand: 'a'.repeat(81) }, 'brand'],
    [{ area: 'Sector-3' }, 'area'],
    [{ area: 'sector 3' }, 'area'],
    [{ area: 'sector--3' }, 'area'],
    [{ area: '-sector' }, 'area'],
    [{ area: '' }, 'area'],
    [{ city: 'cluj-napoca' }, 'city'],
  ])('refuses %j', async (plain, field) => {
    expect(await problemsOf(plain)).toEqual([field]);
  });
});
