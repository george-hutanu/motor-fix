import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { LogRepairDto } from './car-history.dto';

const problems = (dto: object) =>
  validateSync(dto, { forbidNonWhitelisted: true, whitelist: true }).map(
    (e) => e.property,
  );

const valid = {
  costBani: 45_000,
  doneOn: '2026-10-01',
  garageName: 'Service Popescu',
  odometerKm: 148_250,
  what: 'Schimb plăcuțe frână',
};
const repair = (over: Record<string, unknown>) =>
  plainToInstance(LogRepairDto, { ...valid, ...over });
const without = (field: keyof typeof valid) => {
  const { [field]: _, ...rest } = valid;
  return plainToInstance(LogRepairDto, rest);
};

const garageId = '0b9c7a4e-1d2f-4c3b-9a8e-7f6d5c4b3a21';

// @traces 062-FR-002
describe('LogRepairDto', () => {
  it('accepts a repair with every field, trimming what and the garage', () => {
    const dto = repair({
      confirm: true,
      garageId,
      garageName: '  Service Popescu  ',
      what: '  Schimb plăcuțe frână  ',
    });
    expect(problems(dto)).toEqual([]);
    expect(dto.what).toBe('Schimb plăcuțe frână');
    expect(dto.garageName).toBe('Service Popescu');
  });

  it('accepts a repair without an amount, and a null amount', () => {
    expect(problems(without('costBani'))).toEqual([]);
    expect(problems(repair({ costBani: null }))).toEqual([]);
  });

  it('accepts a garage from the list without a typed name', () => {
    const { garageName: _, ...rest } = valid;
    expect(
      problems(plainToInstance(LogRepairDto, { ...rest, garageId })),
    ).toEqual([]);
  });

  it.each([
    ['what', 'abc'],
    ['what', `  ${'x'.repeat(120)}  `],
    ['what', '🔧'.repeat(120)],
    ['garageName', 'AB'],
    ['garageName', 'x'.repeat(80)],
    ['doneOn', '2024-02-29'],
    ['odometerKm', 0],
    ['odometerKm', 2_000_000],
    ['costBani', 0],
    ['costBani', 100_000_000],
    ['confirm', false],
  ])('accepts %s at its limit (%p)', (field, value) => {
    expect(problems(repair({ [field]: value }))).toEqual([]);
  });

  it.each(['what', 'doneOn', 'odometerKm'] as const)(
    'refuses a repair without %s',
    (field) => {
      expect(problems(without(field))).toEqual([field]);
    },
  );

  it('refuses a repair with neither a garage name nor a garage id', () => {
    expect(problems(without('garageName'))).toEqual(['garageName']);
  });

  it.each([
    ['what', 'ab'],
    ['what', '  ab  '],
    ['what', 'x'.repeat(121)],
    ['what', 12],
    ['what', null],
    ['garageName', 'A'],
    ['garageName', '  A  '],
    ['garageName', 'x'.repeat(81)],
    ['garageName', 7],
    ['garageId', 'not-a-uuid'],
    ['garageId', 42],
    ['doneOn', '2025-02-30'],
    ['doneOn', '01.10.2026'],
    ['doneOn', '2026-10-01T00:00:00Z'],
    ['doneOn', null],
    ['odometerKm', -1],
    ['odometerKm', 2_000_001],
    ['odometerKm', 1.5],
    ['odometerKm', '148250'],
    ['odometerKm', null],
    ['costBani', -1],
    ['costBani', 100_000_001],
    ['costBani', 10.5],
    ['costBani', '450'],
    ['confirm', 'true'],
    ['confirm', 1],
  ])('refuses %s = %p, naming the field', (field, value) => {
    expect(problems(repair({ [field]: value }))).toEqual([field]);
  });

  it.each([['x'], ['x'.repeat(81)]])(
    'bounds the garage name beside a garage id (%p)',
    (garageName) => {
      expect(problems(repair({ garageId, garageName }))).toEqual([
        'garageName',
      ]);
    },
  );

  it.each(['carId', 'source', 'loggedBy', 'sharedWithGarage'])(
    'refuses the field %s',
    (field) => {
      expect(problems(repair({ [field]: 'x' }))).toEqual([field]);
    },
  );
});
