import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { CarModels3dQueryDto } from './car-models-3d.dto';

// @traces 035-FR-001

const errors = (query: Record<string, unknown>) =>
  validateSync(plainToInstance(CarModels3dQueryDto, query), {
    forbidNonWhitelisted: true,
    whitelist: true,
  });

const CAR = '0b7c4f3e-8d2a-4c1b-9e5f-6a7b8c9d0e1f';

describe('CarModels3dQueryDto, hostile queries', () => {
  it.each([
    ['a null brand', { brand: null }],
    ['a numeric brand', { brand: 123 }],
    ['an object brand', { brand: { $ne: 'x' } }],
    ['a nested brand array', { brand: [['dacia']] }],
    ['a brand with a trailing newline', { brand: 'dacia\n' }],
    ['a brand with a leading newline', { brand: '\ndacia' }],
    ['a brand with an embedded newline', { brand: 'da\ncia' }],
    ['a brand with a Cyrillic letter', { brand: 'dacіa' }],
    ['a brand with a full-width letter', { brand: 'ｄacia' }],
    ['a brand with a null byte', { brand: 'dacia\u0000' }],
    ['a brand that is a path', { brand: '../etc' }],
    ['a brand with a dot', { brand: 'mercedes.benz' }],
    ['a brand with a percent escape', { brand: 'da%63ia' }],
    ['an empty car', { brand: 'dacia', car: '' }],
    ['a car with a trailing space', { brand: 'dacia', car: `${CAR} ` }],
    ['a car with a trailing newline', { brand: 'dacia', car: `${CAR}\n` }],
    ['a numeric car', { brand: 'dacia', car: 5 }],
    ['an object car', { brand: 'dacia', car: { id: CAR } }],
    ['a car with an extra hex digit', { brand: 'dacia', car: `${CAR}0` }],
    ['a car without hyphens', { brand: 'dacia', car: CAR.replaceAll('-', '') }],
    ['a car in braces', { brand: 'dacia', car: `{${CAR}}` }],
    ['an extra account parameter', { account: 'x', brand: 'dacia' }],
    ['a stray empty-key parameter', { '': 'x', brand: 'dacia' }],
  ])('refuses %s', (_, query) => {
    expect(errors(query)).not.toEqual([]);
  });

  // class-validator's whitelist looks keys up on a plain object, so a key of
  // Object.prototype passes it; what the route reads stays brand and car.
  it('lets an extra constructor parameter reach neither brand nor car', () => {
    const dto = plainToInstance(CarModels3dQueryDto, {
      brand: 'dacia',
      constructor: 'x',
    });
    expect([dto.brand, dto.car]).toEqual(['dacia', undefined]);
  });

  it.each([
    ['a single hyphen', '-'],
    ['digits only', '0123456789'],
    ['a hyphenated key', 'land-rover'],
    ['forty digits', '9'.repeat(40)],
  ])('takes %s as a brand', (_, brand) => {
    expect(errors({ brand })).toEqual([]);
  });

  it('takes an upper-case UUID for car', () => {
    expect(errors({ brand: 'dacia', car: CAR.toUpperCase() })).toEqual([]);
  });

  it('refuses a brand of forty-one characters made of hyphens', () => {
    expect(errors({ brand: '-'.repeat(41) })).not.toEqual([]);
  });

  it('keeps refusing the same query on a second pass', () => {
    const query = { brand: 'Dacia' };
    expect(errors(query).length).toBe(errors(query).length);
    expect(errors(query)).not.toEqual([]);
  });
});
