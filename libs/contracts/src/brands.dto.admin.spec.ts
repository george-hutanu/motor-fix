import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import {
  AdminBrandsQueryDto,
  CreateBrandDto,
  UpdateBrandDto,
} from './brands.dto';

const strict = { forbidNonWhitelisted: true, whitelist: true };
const problemsOf = async (type: new () => object, plain: object) =>
  (await validate(plainToInstance(type, plain), strict)).map(
    (error) => error.property,
  );

// @traces 105-FR-004 105-FR-017
describe('the body of a new brand', () => {
  const create = (name: unknown) => problemsOf(CreateBrandDto, { name });

  it('takes a name of 2 to 40 characters, trimmed first', async () => {
    const dto = plainToInstance(CreateBrandDto, { name: '  Xpeng ' });

    expect(dto.name).toBe('Xpeng');
    expect(await validate(dto, strict)).toEqual([]);
    expect(await create('BY')).toEqual([]);
    expect(await create('é'.repeat(40))).toEqual([]);
  });

  it('refuses a name shorter than 2, longer than 40 or missing', async () => {
    expect(await create('X')).toEqual(['name']);
    expect(await create('  X  ')).toEqual(['name']);
    expect(await create('a'.repeat(41))).toEqual(['name']);
    expect(await create('')).toEqual(['name']);
    expect(await problemsOf(CreateBrandDto, {})).toEqual(['name']);
    expect(await create(42)).toEqual(['name']);
  });

  it('refuses a control character in the name', async () => {
    expect(await create('Xp\u0000eng')).toEqual(['name']);
    expect(await create('Xpeng\n')).toEqual([]);
    expect(await create('Xp\neng')).toEqual(['name']);
  });

  it('refuses a field it does not know', async () => {
    expect(
      await problemsOf(CreateBrandDto, { name: 'Xpeng', slug: 'x' }),
    ).toEqual(['slug']);
  });
});

// @traces 105-FR-006 105-FR-017
describe('the body of a brand edit', () => {
  const seenUpdatedAt = '2026-10-24T12:00:00.000Z';
  const update = (values: object) =>
    problemsOf(UpdateBrandDto, { seenUpdatedAt, ...values });

  it('takes a name, a state or both, with the value it saw', async () => {
    expect(await update({ name: 'Mercedes-Benz' })).toEqual([]);
    expect(await update({ active: false })).toEqual([]);
    expect(await update({ active: true, name: 'Dacia' })).toEqual([]);
  });

  it('trims the name and holds it to the bounds of a new brand', async () => {
    const dto = plainToInstance(UpdateBrandDto, {
      name: ' Dacia ',
      seenUpdatedAt,
    });

    expect(dto.name).toBe('Dacia');
    expect(await update({ name: 'D' })).toEqual(['name']);
    expect(await update({ name: 'a'.repeat(41) })).toEqual(['name']);
    expect(await update({ name: 'Da\u0007cia' })).toEqual(['name']);
  });

  it('takes only a boolean state', async () => {
    expect(await update({ active: 'false' })).toEqual(['active']);
    expect(await update({ active: 0 })).toEqual(['active']);
  });

  it('needs a strict ISO 8601 seen value', async () => {
    expect(await problemsOf(UpdateBrandDto, { active: true })).toEqual([
      'seenUpdatedAt',
    ]);
    expect(await update({ active: true, seenUpdatedAt: 'yesterday' })).toEqual([
      'seenUpdatedAt',
    ]);
    expect(
      await update({ active: true, seenUpdatedAt: '2026-02-30T00:00:00Z' }),
    ).toEqual(['seenUpdatedAt']);
  });
});

// @traces 105-FR-003 105-FR-017
describe('the brand list search', () => {
  const query = (values: object) => problemsOf(AdminBrandsQueryDto, values);

  it('takes no search, an empty one, or one of up to 40 characters', async () => {
    expect(await query({})).toEqual([]);
    expect(await query({ q: '' })).toEqual([]);
    expect(await query({ q: 'a'.repeat(40) })).toEqual([]);
  });

  it('refuses a search longer than 40 characters', async () => {
    expect(await query({ q: 'a'.repeat(41) })).toEqual(['q']);
  });
});
