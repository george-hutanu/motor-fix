import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { CreateCarDto } from './cars.dto';

const problems = (dto: object) =>
  validateSync(dto, { forbidNonWhitelisted: true, whitelist: true }).map(
    (e) => e.property,
  );

const base = {
  brandId: '3f2b8c1e-5d4a-4b6f-8a7c-1d2e3f4a5b6c',
  fuel: 'diesel',
  model: '320d',
  odometerKm: 148200,
  year: 2019,
};
const car = (over: Record<string, unknown>) =>
  plainToInstance(CreateCarDto, { ...base, ...over });
const nextYear = new Date().getFullYear() + 1;

describe('CreateCarDto under hostile input', () => {
  it('accepts the plain car', () => {
    expect(problems(car({}))).toEqual([]);
  });

  it.each([
    ['1949', 1949, ['year']],
    ['1950', 1950, []],
    ['next year', nextYear, []],
    ['the year after next', nextYear + 1, ['year']],
    ['a decimal', 2019.5, ['year']],
    ['a numeric string', '2019', ['year']],
    ['null', null, ['year']],
    ['NaN', Number.NaN, ['year']],
    ['Infinity', Number.POSITIVE_INFINITY, ['year']],
    ['negative', -2019, ['year']],
  ])('year of %s', (_, year, expected) => {
    expect(problems(car({ year }))).toEqual(expected);
  });

  it.each([
    ['zero', 0, []],
    ['minus one', -1, ['odometerKm']],
    ['the cap', 2_000_000, []],
    ['one past the cap', 2_000_001, ['odometerKm']],
    ['a decimal', 100.5, ['odometerKm']],
    ['a string with separators', '148.200', ['odometerKm']],
    ['huge', 1e21, ['odometerKm']],
    ['unsafe integer', 2 ** 60, ['odometerKm']],
    ['null', null, ['odometerKm']],
    ['negative zero', -0, []],
  ])('kilometres of %s', (_, odometerKm, expected) => {
    expect(problems(car({ odometerKm }))).toEqual(expected);
  });

  it.each([
    ['empty', '', ['model']],
    ['only spaces', '   ', ['model']],
    ['one character', 'X', []],
    ['forty characters', 'a'.repeat(40), []],
    ['forty-one characters', 'a'.repeat(41), ['model']],
    ['forty characters padded with spaces', ` ${'a'.repeat(40)} `, []],
    ['forty emoji', '😀'.repeat(40), []],
    ['a NUL byte', 'A\u0000B', ['model']],
    ['a line break', 'A\nB', ['model']],
    ['a tab', 'A\tB', ['model']],
    ['diacritics', 'Ștefan Țigănești', []],
    ['a number', 320, ['model']],
    ['null', null, ['model']],
    ['an array', ['320d'], ['model']],
  ])('model of %s', (_, model, expected) => {
    expect(problems(car({ model }))).toEqual(expected);
  });

  it.each([
    ['thirty characters', 'a'.repeat(30), []],
    ['thirty-one characters', 'a'.repeat(31), ['engine']],
    ['thirty characters padded', ` ${'a'.repeat(30)} `, []],
    ['a NUL byte', '2.0\u0000TDI', ['engine']],
    ['a number', 2.0, ['engine']],
    ['undefined', undefined, []],
  ])('engine of %s', (_, engine, expected) => {
    expect(problems(car({ engine }))).toEqual(expected);
  });

  it.each(['petrol', 'diesel', 'hybrid', 'electric'])('fuel %s', (fuel) => {
    expect(problems(car({ fuel }))).toEqual([]);
  });

  it.each(['Diesel', 'DIESEL', 'lpg', '', null, 1, ['diesel'], 'benzină'])(
    'refuses fuel %p',
    (fuel) => {
      expect(problems(car({ fuel }))).toEqual(['fuel']);
    },
  );

  it.each([
    'not-a-uuid',
    '',
    null,
    42,
    '3f2b8c1e-5d4a-4b6f-8a7c-1d2e3f4a5b6c ',
    "' OR 1=1 --",
  ])('refuses brandId %p', (brandId) => {
    expect(problems(car({ brandId }))).toEqual(['brandId']);
  });

  it('refuses a missing brand', () => {
    expect(problems(car({ brandId: undefined }))).toEqual(['brandId']);
  });

  it.each([
    ['2026-02-29', ['itpUntil']],
    ['2027-02-29', ['itpUntil']],
    ['2028-02-29', []],
    ['2026-13-01', ['itpUntil']],
    ['2026-00-10', ['itpUntil']],
    ['2026-04-31', ['itpUntil']],
    ['2026-11-00', ['itpUntil']],
    ['2026-1-1', ['itpUntil']],
    ['13.11.2026', ['itpUntil']],
    ['2026-11-13T00:00:00Z', ['itpUntil']],
    [' 2026-11-13', ['itpUntil']],
    ['2026-11-13\n', ['itpUntil']],
    ['', ['itpUntil']],
    ['0000-01-01', []],
    ['١٢٣٤-١١-١٣', ['itpUntil']],
  ])('itp date %p', (itpUntil, expected) => {
    expect(problems(car({ itpUntil }))).toEqual(expected);
  });

  it.each(['rcaUntil', 'rovinietaUntil'])('refuses an impossible %s', (f) => {
    expect(problems(car({ [f]: '2026-02-30' }))).toEqual([f]);
  });

  it('refuses a date given as a number', () => {
    expect(problems(car({ itpUntil: 20261113 }))).toEqual(['itpUntil']);
  });

  it('refuses a field the contract does not name', () => {
    expect(problems(car({ ownerId: 'x' }))).toEqual(['ownerId']);
    expect(problems(car({ nextServiceKm: 5, removedAt: null })).sort()).toEqual(
      ['nextServiceKm', 'removedAt'],
    );
  });

  it('refuses an empty body with every required field', () => {
    expect(problems(plainToInstance(CreateCarDto, {})).sort()).toEqual([
      'brandId',
      'fuel',
      'model',
      'odometerKm',
      'year',
    ]);
  });

  it.each([
    ['spaces and hyphens', ' b-123 abc ', 'B123ABC', []],
    ['two characters', 'b1', 'B1', []],
    ['one character', 'b', 'B', ['plate']],
    ['twelve characters', 'a'.repeat(12), 'A'.repeat(12), []],
    ['thirteen characters', 'a'.repeat(13), 'A'.repeat(13), ['plate']],
    ['only separators', ' - - ', '', ['plate']],
    ['empty', '', '', ['plate']],
    ['a diacritic', 'ș123abc', 'Ș123ABC', ['plate']],
    ['an underscore', 'B_123ABC', 'B_123ABC', ['plate']],
    ['a dot', 'B.123.ABC', 'B.123.ABC', ['plate']],
    ['a Cyrillic lookalike', 'В123АВС', 'В123АВС', ['plate']],
    ['an emoji', 'B123😀', 'B123😀', ['plate']],
    ['a tab between groups', 'B\t123ABC', 'B123ABC', []],
  ])('plate of %s', (_, typed, stored, expected) => {
    const dto = car({ plate: typed });
    expect(problems(dto)).toEqual(expected);
    expect(dto.plate).toBe(stored);
  });

  it('refuses a plate that is not text', () => {
    expect(problems(car({ plate: 123456 }))).toEqual(['plate']);
    expect(problems(car({ plate: ['B123ABC'] }))).toEqual(['plate']);
  });
});
