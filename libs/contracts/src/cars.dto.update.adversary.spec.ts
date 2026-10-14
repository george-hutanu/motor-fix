import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { UpdateCarDto } from './cars.dto';

const problems = (dto: object) =>
  validateSync(dto, { forbidNonWhitelisted: true, whitelist: true }).map(
    (e) => e.property,
  );

const version = '2026-10-11T08:00:00.000Z';
const patch = (over: Record<string, unknown>) =>
  plainToInstance(UpdateCarDto, { version, ...over });
const nextYear = new Date().getFullYear() + 1;

// @traces 092-FR-001
describe('UpdateCarDto under hostile input', () => {
  it.each(['brandId', 'model', 'year', 'odometerKm', 'fuel'])(
    'refuses an explicit null for %s',
    (field) => {
      expect(problems(patch({ [field]: null }))).toEqual([field]);
    },
  );

  it.each(['engine', 'plate', 'itpUntil', 'rcaUntil', 'rovinietaUntil'])(
    'takes an explicit null for %s',
    (field) => {
      expect(problems(patch({ [field]: null }))).toEqual([]);
    },
  );

  it('keeps a null for a clearable field as null', () => {
    expect(patch({ engine: null, plate: null })).toMatchObject({
      engine: null,
      plate: null,
    });
  });

  it('turns an engine of spaces into an empty one, which clears it', () => {
    const dto = patch({ engine: '    ' });
    expect(problems(dto)).toEqual([]);
    expect(dto.engine).toBe('');
  });

  it('refuses an empty plate, since only null clears it', () => {
    expect(problems(patch({ plate: '' }))).toEqual(['plate']);
    expect(problems(patch({ plate: ' - ' }))).toEqual(['plate']);
  });

  it.each([
    ['ȘĂ123', 'a plate with diacritics'],
    ['AB１２３', 'a plate with full-width digits'],
    ['AB12​3', 'a plate with a zero-width space'],
    ['A'.repeat(13), 'a plate of 13 characters'],
    ['A', 'a plate of one character'],
  ])('refuses %j, %s', (plate) => {
    expect(problems(patch({ plate }))).toEqual(['plate']);
  });

  it('takes a plate of exactly 2 and exactly 12 characters', () => {
    expect(problems(patch({ plate: 'ab' }))).toEqual([]);
    expect(problems(patch({ plate: 'a'.repeat(12) }))).toEqual([]);
  });

  it.each([
    [40, true],
    [41, false],
  ])('judges a model of %i characters', (length, ok) => {
    expect(problems(patch({ model: 'm'.repeat(length) }))).toEqual(
      ok ? [] : ['model'],
    );
  });

  it('refuses a model of only spaces, tabs and non-breaking spaces', () => {
    expect(problems(patch({ model: ' \t  ' }))).toEqual(['model']);
  });

  it.each([1950, nextYear])('takes the year %i at the edge', (year) => {
    expect(problems(patch({ year }))).toEqual([]);
  });

  it.each([1949, nextYear + 1, Number.NaN, Infinity, '2019', true])(
    'refuses the year %j',
    (year) => {
      expect(problems(patch({ year }))).toEqual(['year']);
    },
  );

  it.each([0, 2_000_000])('takes %i kilometres', (odometerKm) => {
    expect(problems(patch({ odometerKm }))).toEqual([]);
  });

  it.each([-1, 2_000_001, 0.5, Number.NaN, '100', Number.MAX_SAFE_INTEGER])(
    'refuses %j kilometres',
    (odometerKm) => {
      expect(problems(patch({ odometerKm }))).toEqual(['odometerKm']);
    },
  );

  it.each([
    '2026-13-01',
    '2026-00-10',
    '2026-04-31',
    '2026-1-5',
    '26-10-08',
    '2026-10-08 ',
    ' 2026-10-08',
    '２０２６-10-08',
    '',
    0,
    true,
    {},
  ])('refuses the date %j', (day) => {
    expect(problems(patch({ itpUntil: day }))).toEqual(['itpUntil']);
  });

  it('takes 29 February of a leap year and refuses it in a year that is not', () => {
    expect(problems(patch({ rcaUntil: '2028-02-29' }))).toEqual([]);
    expect(problems(patch({ rcaUntil: '2027-02-29' }))).toEqual(['rcaUntil']);
  });

  it.each([
    undefined,
    null,
    '',
    'now',
    1760000000000,
    ['2026-10-11T08:00:00.000Z'],
  ])('refuses the version %j', (value) => {
    expect(
      problems(plainToInstance(UpdateCarDto, { model: 'M3', version: value })),
    ).toEqual(['version']);
  });

  it('refuses a fuel outside the list in any case or padding', () => {
    expect(problems(patch({ fuel: 'Diesel' }))).toEqual(['fuel']);
    expect(problems(patch({ fuel: 'diesel ' }))).toEqual(['fuel']);
    expect(problems(patch({ fuel: ['diesel'] }))).toEqual(['fuel']);
  });

  it.each([
    'ownerId',
    'removedAt',
    'id',
    'updatedAt',
    'createdAt',
    '__proto__x',
  ])('refuses the field %s the contract does not name', (field) => {
    expect(problems(patch({ [field]: 'x' }))).toEqual([field]);
  });

  it('reports every bad field of one body, not only the first', () => {
    expect(
      problems(patch({ model: '', odometerKm: -1, year: 1900 })).sort(),
    ).toEqual(['model', 'odometerKm', 'year']);
  });
});
