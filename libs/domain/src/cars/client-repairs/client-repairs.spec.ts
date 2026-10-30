import { DELETED_AUTHOR } from '@motor-fix/contracts';

import {
  ADMIN_SCOPE,
  type ClientRepairRow,
  changes,
  garageScope,
  ownerScope,
  toItem,
  writerOf,
} from './client-repairs';

const stored = {
  costBani: 45_000,
  doneOn: '2026-10-01',
  odometerKm: 151_000,
  what: 'Schimb ulei',
};

const updatedAt = new Date('2026-10-20T08:00:00.000Z');

const row = (over: Partial<ClientRepairRow> = {}): ClientRepairRow => ({
  car: {
    brand: { name: 'Volkswagen' },
    model: 'Golf',
    ownerships: [
      {
        account: { name: 'Andrei Ion Marin', status: 'active' },
        accountId: 'a1',
      },
    ],
    year: 2015,
  },
  carId: 'c1',
  costBani: 45_000,
  doneOn: new Date('2026-10-01T00:00:00Z'),
  garageId: 'g1',
  garageName: 'Garaj Nordic',
  id: 'b8a9a0b4-6a7e-4c38-9a8e-2f2c8f4b1d11',
  odometerKm: 151_000,
  sharedWithGarage: true,
  updatedAt,
  updatedByRole: null,
  what: 'Schimb ulei',
  ...over,
});

// @traces 409-FR-010
describe('changes', () => {
  it('finds nothing when no field is sent', () => {
    expect(changes(stored, {})).toEqual({});
  });

  it('finds nothing when every sent field holds its stored value', () => {
    expect(changes(stored, { ...stored })).toEqual({});
  });

  it.each([
    ['what', 'Schimb ulei și filtre'],
    ['doneOn', '2026-09-30'],
    ['odometerKm', 150_000],
    ['costBani', 50_000],
  ] as const)('finds %s alone', (field, value) => {
    expect(changes(stored, { [field]: value })).toEqual({ [field]: value });
  });

  it('finds the amount cleared to none', () => {
    expect(changes(stored, { costBani: null })).toEqual({ costBani: null });
  });

  it('finds an amount given where there was none', () => {
    expect(changes({ ...stored, costBani: null }, { costBani: 0 })).toEqual({
      costBani: 0,
    });
  });

  it('finds every changed field together, leaving out the unchanged ones', () => {
    expect(
      changes(stored, {
        costBani: 45_000,
        doneOn: '2026-09-30',
        odometerKm: 150_000,
        what: 'Schimb ulei',
      }),
    ).toEqual({ doneOn: '2026-09-30', odometerKm: 150_000 });
  });
});

// @traces 409-FR-004
describe('toItem', () => {
  it('shapes a repair for the garage, with the version read back', () => {
    expect(toItem(row())).toEqual({
      car: { brandName: 'Volkswagen', model: 'Golf', year: 2015 },
      correctedAt: null,
      costBani: 45_000,
      doneOn: '2026-10-01',
      driver: { shortName: 'Andrei M.' },
      id: 'b8a9a0b4-6a7e-4c38-9a8e-2f2c8f4b1d11',
      odometerKm: 151_000,
      version: '2026-10-20T08:00:00.000Z',
      what: 'Schimb ulei',
    });
  });

  it('names nothing more of the driver than the short name', () => {
    const text = JSON.stringify(toItem(row()));
    expect(text).not.toContain('Ion');
    expect(text).not.toContain('Marin');
  });

  it('dates the correction when the garage was the last writer', () => {
    expect(toItem(row({ updatedByRole: 'owner' })).correctedAt).toBe(
      '2026-10-20T08:00:00.000Z',
    );
  });

  it.each(['driver', 'admin'] as const)(
    'shows no correction when the last writer was the %s',
    (role) => {
      expect(toItem(row({ updatedByRole: role })).correctedAt).toBeNull();
    },
  );

  it('keeps no reading and no amount as null', () => {
    const item = toItem(row({ costBani: null, odometerKm: null }));
    expect(item.costBani).toBeNull();
    expect(item.odometerKm).toBeNull();
  });

  it('labels a car with no owner as the deleted author', () => {
    const base = row();
    expect(
      toItem(row({ car: { ...base.car, ownerships: [] } })).driver.shortName,
    ).toBe(DELETED_AUTHOR);
  });

  it('labels a deleted owner as the deleted author', () => {
    const base = row();
    expect(
      toItem(
        row({
          car: {
            ...base.car,
            ownerships: [
              {
                account: { name: 'Andrei Marin', status: 'deleted' },
                accountId: 'a1',
              },
            ],
          },
        }),
      ).driver.shortName,
    ).toBe(DELETED_AUTHOR);
  });
});

// @traces 409-FR-003
describe('ownerScope', () => {
  const garageId = '0d8d1f62-9c55-4d7e-9a3c-7f3a2a1c5e10';

  it('reads only logged, shared, live repairs naming the approved garage', () => {
    expect(ownerScope(garageId)).toEqual({
      deletedAt: null,
      garage: { status: 'approved' },
      garageId,
      sharedWithGarage: true,
      source: 'logged',
    });
  });
});

// @traces 409-FR-011
describe('writerOf', () => {
  it.each([
    ['admin', 'admin'],
    ['garage', 'owner'],
    ['receptionist', 'owner'],
  ] as const)('records a %s as the %s', (role, writer) => {
    expect(writerOf({ role })).toBe(writer);
  });
});

// @traces 1267-FR-006
describe('the scope a correction is made in', () => {
  const garageId = '0d8d1f62-9c55-4d7e-9a3c-7f3a2a1c5e10';

  it('limits a garage owner to the repairs shared with the approved garage', () => {
    expect(garageScope({ garageId })).toEqual({
      capability: 'garage.client_repairs',
      where: ownerScope(garageId),
    });
  });

  it('gives an actor with no garage no scope', () => {
    expect(garageScope({ garageId: null })).toBeNull();
  });

  it('lets an admin reach every logged repair not deleted, shared or not', () => {
    expect(ADMIN_SCOPE).toEqual({
      capability: 'admin.users',
      where: { deletedAt: null, source: 'logged' },
    });
  });
});
