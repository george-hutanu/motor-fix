import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { UpdateGarageProfileDto } from './garage-profile-update.dto';
import { isRecord } from './is-record';

const DAY = [['08:00', '17:00']];
const WEEK = {
  fri: DAY,
  mon: DAY,
  sat: [],
  sun: [],
  thu: DAY,
  tue: DAY,
  wed: DAY,
};

const failed = (body: Record<string, unknown>) =>
  validateSync(plainToInstance(UpdateGarageProfileDto, body), {
    forbidNonWhitelisted: true,
    whitelist: true,
  }).map((e) => e.property);

const save = (fields: Record<string, unknown>) =>
  failed({ version: '0', ...fields });

// @traces 1246-FR-002
describe('UpdateGarageProfileDto under hostile input', () => {
  it.each([
    'name',
    'description',
    'phone',
    'hours',
    'closedDays',
    'serviceRadiusKm',
  ])('refuses null for %s', (field) => {
    expect(save({ [field]: null })).toEqual([field]);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, '30', true, [30], { v: 30 }])(
    'refuses a radius of %p',
    (serviceRadiusKm) => {
      expect(save({ serviceRadiusKm })).toEqual(['serviceRadiusKm']);
    },
  );

  it('refuses a radius written as 30.0000001', () => {
    expect(save({ serviceRadiusKm: 30.0000001 })).toEqual(['serviceRadiusKm']);
  });

  it.each([
    ['a name that is an object', { a: 1 }],
    ['a name that is a list', ['ab']],
  ])('refuses %s', (_title, name) => {
    expect(save({ name })).toEqual(['name']);
  });

  it('counts a name of 80 emoji as 80 characters', () => {
    expect(save({ name: '😀'.repeat(80) })).toEqual([]);
  });

  it('counts a name of 81 emoji as too long', () => {
    expect(save({ name: '😀'.repeat(81) })).toEqual(['name']);
  });

  it.each([
    ['arabic-indic digits', '٠٧٢٢١٢٣٤٥٦'],
    ['a thousand digits', '7'.repeat(1000)],
    ['a trailing script', '0722123456<script>'],
  ])('refuses a phone with %s', (_title, phone) => {
    expect(save({ phone })).toEqual(['phone']);
  });

  it.each([
    [
      'a third interval',
      {
        ...WEEK,
        mon: [
          ['06:00', '08:00'],
          ['09:00', '12:00'],
          ['13:00', '17:00'],
        ],
      },
    ],
    [
      'an interval ending before it starts',
      { ...WEEK, mon: [['17:00', '08:00']] },
    ],
    ['an interval of zero length', { ...WEEK, mon: [['08:00', '08:00']] }],
    ['hour 24', { ...WEEK, mon: [['08:00', '24:00']] }],
    [
      'overlapping intervals',
      {
        ...WEEK,
        mon: [
          ['08:00', '12:00'],
          ['11:00', '17:00'],
        ],
      },
    ],
    ['a missing weekday', { mon: DAY }],
    ['an unknown weekday', { ...WEEK, xyz: DAY }],
    ['a list instead of an object', [DAY]],
    ['a string interval', { ...WEEK, mon: ['08:00-17:00'] }],
    ['a time with seconds', { ...WEEK, mon: [['08:00:00', '17:00:00']] }],
  ])('refuses hours with %s', (_title, hours) => {
    expect(save({ closedDays: [], hours })).toEqual(['hours']);
  });

  it.each([
    ['a duplicate day', [{ day: '2099-01-01' }, { day: '2099-01-01' }]],
    ['an impossible date', [{ day: '2099-02-30' }]],
    ['a date with a time', [{ day: '2099-01-01T00:00:00Z' }]],
    [
      'a note of 201 characters',
      [{ day: '2099-01-01', note: 'x'.repeat(10_000) }],
    ],
    ['a non-object entry', ['2099-01-01']],
    [
      'ten thousand days',
      Array.from({ length: 10_000 }, (_, i) => ({
        day: `2${String(i).padStart(3, '0')}-01-01`,
      })),
    ],
    ['a map instead of a list', { day: '2099-01-01' }],
  ])('refuses closed days with %s', (_title, closedDays) => {
    expect(save({ closedDays, hours: WEEK })).toEqual(['closedDays']);
  });

  it('refuses a stamp that is a number', () => {
    expect(failed({ version: 0 })).toEqual(['version']);
  });

  it('refuses a body with no stamp', () => {
    expect(failed({ name: 'Auto' })).toEqual(['version']);
  });

  it('refuses an unknown field next to a valid group', () => {
    expect(save({ name: 'Auto Nord', slug: 'x' })).toEqual(['slug']);
  });

  it.each([
    'role',
    'ownerId',
    'status',
    'businessKind',
    'profileVersion',
    'phoneVerified',
  ])('refuses the unrelated field %s', (field) => {
    expect(save({ [field]: 'x' })).toEqual([field]);
  });
});

// @traces 1246-FR-016
describe('isRecord on odd values', () => {
  it('takes an object without a prototype', () => {
    expect(isRecord(Object.create(null))).toBe(true);
  });

  it.each([
    ['a function', () => 1],
    ['a symbol', Symbol('x')],
    ['a bigint', 1n],
    ['NaN', Number.NaN],
  ])('refuses %s', (_title, value) => {
    expect(isRecord(value)).toBe(false);
  });
});
