import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { CarDto, UpdateCarDto } from './cars.dto';

const problems = (dto: object) =>
  validateSync(dto, { forbidNonWhitelisted: true, whitelist: true }).map(
    (e) => e.property,
  );

const version = '2026-10-11T08:00:00.000Z';
const patch = (over: Record<string, unknown>) =>
  plainToInstance(UpdateCarDto, { version, ...over });
const nextYear = new Date().getFullYear() + 1;

// @traces 092-FR-001
describe('UpdateCarDto', () => {
  it('accepts a version alone', () => {
    expect(problems(patch({}))).toEqual([]);
  });

  it('accepts every field of the add dialog', () => {
    const dto = patch({
      brandId: '3f2b8c1e-5d4a-4b6f-8a7c-1d2e3f4a5b6c',
      engine: ' 2.0 TDI ',
      fuel: 'diesel',
      itpUntil: '2027-11-13',
      model: ' 320d ',
      odometerKm: 151000,
      plate: 'cj-12 abc',
      rcaUntil: '2027-01-20',
      rovinietaUntil: '2027-03-01',
      year: 2019,
    });
    expect(problems(dto)).toEqual([]);
    expect(dto).toMatchObject({
      engine: '2.0 TDI',
      model: '320d',
      plate: 'CJ12ABC',
    });
  });

  it.each([
    ['brandId', 'not-a-uuid'],
    ['model', ''],
    ['model', 'x'.repeat(41)],
    ['model', 'a\u0007b'],
    ['year', 1949],
    ['year', nextYear + 1],
    ['year', 2019.5],
    ['year', '2019'],
    ['odometerKm', -1],
    ['odometerKm', 2_000_001],
    ['odometerKm', 1.5],
    ['fuel', 'steam'],
    ['engine', 'x'.repeat(31)],
    ['engine', 'a\nb'],
    ['plate', 'not a plate!'],
    ['itpUntil', '2027-02-30'],
    ['rcaUntil', '20.10.2026'],
    ['rovinietaUntil', 2027],
  ])('refuses %s of %j as the add dialog does', (field, value) => {
    expect(problems(patch({ [field]: value }))).toEqual([field]);
  });

  // @traces 092-FR-014
  it.each(['engine', 'plate', 'itpUntil', 'rcaUntil', 'rovinietaUntil'])(
    'accepts null for %s, which clears it',
    (field) => {
      const dto = patch({ [field]: null });
      expect(problems(dto)).toEqual([]);
      expect((dto as unknown as Record<string, unknown>)[field]).toBeNull();
    },
  );

  it.each(['brandId', 'model', 'year', 'odometerKm', 'fuel'])(
    'refuses null for %s, which a car always has',
    (field) => {
      expect(problems(patch({ [field]: null }))).toEqual([field]);
    },
  );

  it.each([
    ['missing', undefined],
    ['null', null],
    ['free text', 'yesterday'],
    ['a number', 1760169600000],
  ])('refuses a version that is %s', (_, value) => {
    const dto = plainToInstance(UpdateCarDto, { version: value });
    expect(problems(dto)).toEqual(['version']);
  });

  it('refuses a field the car does not have', () => {
    expect(problems(patch({ ownerId: 'someone' }))).toEqual(['ownerId']);
  });

  it('leaves an omitted field absent', () => {
    const dto = patch({ odometerKm: 151000 });
    expect(problems(dto)).toEqual([]);
    for (const field of [
      'brandId',
      'engine',
      'fuel',
      'itpUntil',
      'model',
      'plate',
      'rcaUntil',
      'rovinietaUntil',
      'year',
    ]) {
      expect(
        (dto as unknown as Record<string, unknown>)[field],
      ).toBeUndefined();
    }
  });
});

// @traces 092-FR-002
describe('CarDto', () => {
  it('carries updatedAt, the version an edit sends back', () => {
    const car: CarDto = plainToInstance(CarDto, {
      updatedAt: version,
    } as Partial<CarDto>);
    expect(car.updatedAt).toBe(version);
  });
});
