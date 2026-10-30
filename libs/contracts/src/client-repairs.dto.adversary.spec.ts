import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { CorrectClientRepairDto } from './client-repairs.dto';

const problems = (dto: object) =>
  validateSync(dto, { forbidNonWhitelisted: true, whitelist: true }).map(
    (e) => e.property,
  );

const version = '2026-10-11T08:00:00.000Z';
const correction = (over: Record<string, unknown>) =>
  plainToInstance(CorrectClientRepairDto, { version, ...over });
const fromJson = (json: string) =>
  plainToInstance(CorrectClientRepairDto, JSON.parse(json));

// @traces 409-FR-005
// @traces 409-FR-006
describe('CorrectClientRepairDto under hostile input', () => {
  it('refuses a date far in the future', () => {
    expect(problems(correction({ doneOn: '2999-01-01' }))).toEqual(['doneOn']);
  });

  it('refuses a date tomorrow in Romania', () => {
    const now = new Date(Date.now() + 36 * 3_600_000);
    expect(
      problems(correction({ doneOn: now.toISOString().slice(0, 10) })),
    ).toEqual(['doneOn']);
  });

  it.each([
    ['a date-time', '2026-10-01T00:00:00Z'],
    ['a padded day', ' 2026-10-01 '],
    ['a trailing newline', '2026-10-01\n'],
    ['an Arabic-Indic digit day', '٢٠٢٦-١٠-٠١'],
    ['a number', 20261001],
    ['an array', ['2026-10-01']],
  ])('refuses doneOn as %s', (_, value) => {
    expect(problems(correction({ doneOn: value }))).toEqual(['doneOn']);
  });

  it.each([
    ['a newline', 'a\nb'],
    ['a tab', 'a\tb'],
    ['a NUL', 'a\u0000b'],
    ['an array', ['Ulei']],
    ['an object', { x: 1 }],
    ['a boolean', true],
  ])('refuses what holding %s', (_, value) => {
    expect(problems(correction({ what: value }))).toEqual(['what']);
  });

  it('trims a no-break space around what and refuses it when nothing is left', () => {
    expect(problems(correction({ what: '  ' }))).toEqual(['what']);
  });

  it('counts 200 emoji as 200 characters', () => {
    expect(problems(correction({ what: '🔧'.repeat(200) }))).toEqual([]);
  });

  it('refuses 201 emoji', () => {
    expect(problems(correction({ what: '🔧'.repeat(201) }))).toEqual(['what']);
  });

  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['a boolean', true],
    ['an array', [1]],
    ['1e21', 1e21],
  ])('refuses odometerKm as %s', (_, value) => {
    expect(problems(correction({ odometerKm: value }))).toEqual(['odometerKm']);
  });

  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['a boolean', false],
    ['a fraction at the cap', 92_000_000.5],
    ['an empty string', ''],
    ['an object', {}],
  ])('refuses costBani as %s', (_, value) => {
    expect(problems(correction({ costBani: value }))).toEqual(['costBani']);
  });

  // A negative zero is zero: taken as 0, which the change check reads as
  // equal to a stored 0.
  it('takes a negative zero odometer parsed from JSON as zero', () => {
    expect(
      problems(fromJson(`{"version":"${version}","odometerKm":-0}`)),
    ).toEqual([]);
  });

  it('takes a negative zero amount parsed from JSON as zero', () => {
    expect(
      problems(fromJson(`{"version":"${version}","costBani":-0}`)),
    ).toEqual([]);
  });

  it.each([
    ['null', null],
    ['an empty string', ''],
    ['a number', 0],
    ['a date-only day', '2026-10-11'],
    ['an array', [version]],
    ['an object', {}],
    ['a non-ISO date', 'Oct 11 2026'],
  ])('refuses a version that is %s', (_, value) => {
    expect(
      problems(plainToInstance(CorrectClientRepairDto, { version: value })),
    ).toEqual(['version']);
  });

  it('refuses a body that is an empty object', () => {
    expect(problems(plainToInstance(CorrectClientRepairDto, {}))).toEqual([
      'version',
    ]);
  });

  it.each(['updatedAt', 'updatedBy', 'id', 'version2'])(
    'refuses the extra field %s',
    (field) => {
      const dto = fromJson(`{"version":"${version}","${field}":"x"}`);
      expect(problems(dto)).toEqual([field]);
    },
  );

  it('refuses several bad fields at once, naming each', () => {
    expect(
      problems(
        correction({ costBani: -1, doneOn: 'x', odometerKm: -1, what: '' }),
      ).sort(),
    ).toEqual(['costBani', 'doneOn', 'odometerKm', 'what']);
  });
});
