import { plainToInstance } from 'class-transformer';
import { type ValidationError, validateSync } from 'class-validator';

import {
  PROFILE_DESCRIPTION_MAX,
  PROFILE_RADIUS_KM,
} from './garage-profile-limits';
import { UpdateGarageProfileDto } from './garage-profile-update.dto';

const WEEK = {
  fri: [['08:00', '17:00']],
  mon: [['08:00', '17:00']],
  sat: [],
  sun: [],
  thu: [['08:00', '17:00']],
  tue: [['08:00', '17:00']],
  wed: [['08:00', '17:00']],
};

// The fields the global pipe would refuse, as it is configured.
const failed = (body: Record<string, unknown>) =>
  validateSync(plainToInstance(UpdateGarageProfileDto, body), {
    forbidNonWhitelisted: true,
    whitelist: true,
  }).map((e) => e.property);

const save = (fields: Record<string, unknown>) =>
  failed({ version: '0', ...fields });

// @traces 1246-FR-001 1246-FR-002 1246-FR-003
describe('UpdateGarageProfileDto', () => {
  it('describes up to a thousand characters', () => {
    expect(PROFILE_DESCRIPTION_MAX).toBe(1000);
  });

  it('applies the browser-safe limits the dialog shows', () => {
    expect(PROFILE_RADIUS_KM).toEqual({ max: 100, min: 5 });
    expect(save({ serviceRadiusKm: PROFILE_RADIUS_KM.min - 1 })).toEqual([
      'serviceRadiusKm',
    ]);
    expect(save({ serviceRadiusKm: PROFILE_RADIUS_KM.max + 1 })).toEqual([
      'serviceRadiusKm',
    ]);
  });

  it('takes every group at once', () => {
    expect(
      save({
        closedDays: [{ day: '2026-12-27', note: 'Inventar' }],
        description: 'Specializați pe Dacia',
        hours: WEEK,
        name: 'Service Auto Nord',
        phone: '0722 123 456',
        serviceRadiusKm: 30,
      }),
    ).toEqual([]);
  });

  it.each([[undefined], [''], ['x'.repeat(21)], [7]])(
    'refuses the version %p',
    (version) => {
      expect(failed({ name: 'Service', version })).toContain('version');
    },
  );

  it('takes a version of twenty characters', () => {
    expect(failed({ version: '9'.repeat(20) })).toEqual([]);
  });

  it.each(['AB', '  AB  ', 'x'.repeat(80), ` ${'x'.repeat(80)} `])(
    'takes the name %p',
    (name) => {
      expect(save({ name })).toEqual([]);
    },
  );

  it.each(['A', '  A  ', 'x'.repeat(81), '', 5])(
    'refuses the name %p',
    (name) => {
      expect(save({ name })).toEqual(['name']);
    },
  );

  it.each(['', '   ', 'x'.repeat(1000), ` ${'x'.repeat(1000)} `])(
    'takes a description of %#',
    (description) => {
      expect(save({ description })).toEqual([]);
    },
  );

  it.each(['x'.repeat(1001), 3])(
    'refuses the description %#',
    (description) => {
      expect(save({ description })).toEqual(['description']);
    },
  );

  it.each(['0722 123 456', '+40722123456', '0040 722 123 456'])(
    'takes the phone %p',
    (phone) => {
      expect(save({ phone })).toEqual([]);
    },
  );

  it.each(['abc', '12', '', 722123456, '+4930123456', '0722 123 45'])(
    'refuses the phone %p',
    (phone) => {
      expect(save({ phone })).toEqual(['phone']);
    },
  );

  it.each([
    [{ ...WEEK, mon: [['17:00', '08:00']] }],
    [{ ...WEEK, sun: undefined }],
    ['all week'],
  ])('refuses the hours %#', (hours) => {
    expect(save({ hours })).toEqual(['hours']);
  });

  it.each([
    [[{ day: '2026-12-27' }, { day: '2026-12-27' }]],
    [[{ day: '27.12.2026' }]],
    [[{ day: '2026-12-27', note: 'x'.repeat(81) }]],
    ['2026-12-27'],
  ])('refuses the closed days %#', (closedDays) => {
    expect(save({ closedDays })).toEqual(['closedDays']);
  });

  it('takes no closed days', () => {
    expect(save({ closedDays: [] })).toEqual([]);
  });

  it.each([5, 30, 100])('takes a radius of %p km', (serviceRadiusKm) => {
    expect(save({ serviceRadiusKm })).toEqual([]);
  });

  it.each([4, 101, 20.5, 'x'])('refuses a radius of %p', (serviceRadiusKm) => {
    expect(save({ serviceRadiusKm })).toEqual(['serviceRadiusKm']);
  });

  it('refuses a field it does not know', () => {
    expect(save({ slug: 'other' })).toEqual(['slug']);
  });
});

// Each refused field as its dotted path, the way the pipe names it.
const paths = (errors: ValidationError[], parent = ''): string[] =>
  errors.flatMap((e) => {
    const path = parent ? `${parent}.${e.property}` : e.property;
    return e.children?.length ? paths(e.children, path) : [path];
  });

const group = (fields: Record<string, unknown>) =>
  paths(
    validateSync(
      plainToInstance(UpdateGarageProfileDto, {
        facilities: {
          facilities: ['waiting_area'],
          paymentMethods: { card: false, cash: true, transfer: false },
          ...fields,
        },
        version: '0',
      }),
      { forbidNonWhitelisted: true, whitelist: true },
    ),
  );

// @traces 1248-FR-001
// @traces 1248-FR-002
describe('UpdateGarageProfileDto facilities group', () => {
  it('takes the whole group', () => {
    expect(
      group({
        courtesyCar: { paid: true, pricePerDayBani: 15_000 },
        facilities: ['courtesy_car', 'pickup_dropoff', 'waiting_area'],
        facilitiesNote: 'Mașina la schimb se cere la programare.',
        paymentMethods: { card: true, cash: true, transfer: true },
      }),
    ).toEqual([]);
  });

  it('takes no facility ticked and no note', () => {
    expect(group({ facilities: [] })).toEqual([]);
  });

  it('takes a free car without a price', () => {
    expect(
      group({
        courtesyCar: { paid: false },
        facilities: ['courtesy_car'],
      }),
    ).toEqual([]);
  });

  it.each([100, 200_000])('takes a price of %p bani', (pricePerDayBani) => {
    expect(
      group({
        courtesyCar: { paid: true, pricePerDayBani },
        facilities: ['courtesy_car'],
      }),
    ).toEqual([]);
  });

  it.each([99, 200_100, 150, 15_000.5, '15000'])(
    'refuses a price of %p',
    (pricePerDayBani) => {
      expect(
        group({
          courtesyCar: { paid: true, pricePerDayBani },
          facilities: ['courtesy_car'],
        }),
      ).toEqual(['facilities.courtesyCar.pricePerDayBani']);
    },
  );

  it('refuses a paid car without a price', () => {
    expect(
      group({ courtesyCar: { paid: true }, facilities: ['courtesy_car'] }),
    ).toEqual(['facilities.courtesyCar.pricePerDayBani']);
  });

  it('refuses a free car with a price', () => {
    expect(
      group({
        courtesyCar: { paid: false, pricePerDayBani: 5000 },
        facilities: ['courtesy_car'],
      }),
    ).toEqual(['facilities.courtesyCar.pricePerDayBani']);
  });

  it.each([
    [['valet']],
    [['waiting_area', 'waiting_area']],
    ['waiting_area'],
    [undefined],
  ])('refuses the facilities %p', (facilities) => {
    expect(group({ facilities })).toEqual(['facilities.facilities']);
  });

  it.each([
    [undefined],
    [{ card: false, cash: false, transfer: false }],
    [{ card: true, cash: true }],
    [{ card: 'yes', cash: true, transfer: false }],
  ])('refuses the payment methods %p', (paymentMethods) => {
    const refused = group({ paymentMethods });
    expect(refused.length).toBeGreaterThan(0);
    for (const path of refused)
      expect(path).toMatch(/^facilities\.paymentMethods/);
  });

  it('takes a note of 200 characters, spaces around it aside', () => {
    expect(group({ facilitiesNote: ` ${'ș'.repeat(200)} ` })).toEqual([]);
  });

  it('takes an empty note', () => {
    expect(group({ facilitiesNote: '' })).toEqual([]);
  });

  it.each(['ș'.repeat(201), 'Rând unu\nrând doi', 'tab\there', 7])(
    'refuses the note %#',
    (facilitiesNote) => {
      expect(group({ facilitiesNote })).toEqual(['facilities.facilitiesNote']);
    },
  );

  it('refuses a key the group does not know', () => {
    expect(group({ hours: {} })).toEqual(['facilities.hours']);
  });

  it('refuses a group that is not an object', () => {
    expect(
      paths(
        validateSync(
          plainToInstance(UpdateGarageProfileDto, {
            facilities: ['waiting_area'],
            version: '0',
          }),
          { forbidNonWhitelisted: true, whitelist: true },
        ),
      )[0],
    ).toMatch(/^facilities/);
  });
});
