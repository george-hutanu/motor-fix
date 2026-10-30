import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import {
  PROFILE_RADIUS_KM,
  PROFILE_DESCRIPTION_MAX as SHARED_DESCRIPTION_MAX,
} from './garage-profile-limits';
import {
  PROFILE_DESCRIPTION_MAX,
  UpdateGarageProfileDto,
} from './garage-profile-update.dto';

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

// @traces 1246-FR-001, 1246-FR-002, 1246-FR-003
describe('UpdateGarageProfileDto', () => {
  it('describes up to a thousand characters', () => {
    expect(PROFILE_DESCRIPTION_MAX).toBe(1000);
  });

  it('applies the browser-safe limits the dialog shows', () => {
    expect(SHARED_DESCRIPTION_MAX).toBe(PROFILE_DESCRIPTION_MAX);
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

  it.each([
    'address',
    'companyName',
    'cui',
    'mobileLegalForm',
    'seatAddress',
    'rarActivities',
    'proposedJobs',
  ])('lets %s through to be answered as needing verification', (field) => {
    expect(save({ [field]: 'anything' })).toEqual([]);
  });

  it('refuses a field it does not know', () => {
    expect(save({ slug: 'other' })).toEqual(['slug']);
  });
});
