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

describe('CarModels3dQueryDto', () => {
  it('takes a brand key alone, and with a car id', () => {
    expect(errors({ brand: 'dacia' })).toEqual([]);
    expect(errors({ brand: 'mercedes-benz', car: CAR })).toEqual([]);
    expect(errors({ brand: 'a'.repeat(40) })).toEqual([]);
  });

  it.each([
    ['no brand', {}],
    ['an empty brand', { brand: '' }],
    ['a 41 character brand', { brand: 'a'.repeat(41) }],
    ['an upper-case brand', { brand: 'Dacia' }],
    ['a brand with a trailing space', { brand: 'dacia ' }],
    ['a brand with an underscore', { brand: 'mercedes_benz' }],
    ['a repeated brand', { brand: ['dacia', 'bmw'] }],
    ['a car that is no UUID', { brand: 'dacia', car: 'abc' }],
    ['a repeated car', { brand: 'dacia', car: [CAR, CAR] }],
    ['an unknown parameter', { brand: 'dacia', fuel: 'petrol' }],
  ])('refuses %s', (_, query) => {
    expect(errors(query)).not.toEqual([]);
  });
});
