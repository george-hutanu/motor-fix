import type { HttpException } from '@nestjs/common';

import { idOr404, toAdminItem, toListItem } from './admin-repairs';
import type { ClientRepairRow } from '../client-repairs';

const id = 'b8a9a0b4-6a7e-4c38-9a8e-2f2c8f4b1d11';
const car = {
  brand: { name: 'Volkswagen' },
  model: 'Golf',
  ownerships: [
    {
      account: { name: 'Andrei Ion Marin', status: 'active' },
      accountId: 'driver-account',
    },
  ],
  year: 2015,
};

const row = (over: Partial<ClientRepairRow> = {}): ClientRepairRow => ({
  car,
  carId: 'c1',
  costBani: 45_000,
  doneOn: new Date('2026-10-01T00:00:00Z'),
  garageId: 'g1',
  garageName: 'Garaj Nordic',
  id,
  odometerKm: 151_000,
  sharedWithGarage: false,
  updatedAt: new Date('2026-10-20T08:00:00.000Z'),
  updatedByRole: null,
  what: 'Schimb ulei',
  ...over,
});

const refused = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    const http = error as HttpException;
    return { body: http.getResponse(), status: http.getStatus() };
  }
  throw new Error('not refused');
};

// @traces 1267-FR-001 1267-FR-003
describe('idOr404', () => {
  it('passes a well-formed id through', () => {
    expect(idOr404(id, 'repair')).toBe(id);
  });

  it.each([
    ['account', 'No such account'],
    ['repair', 'No such repair'],
  ] as const)('answers a malformed %s id as not found', (noun, message) => {
    expect(refused(() => idOr404('not-an-id', noun))).toEqual({
      body: { code: 'not_found', message },
      status: 404,
    });
  });
});

// @traces 1267-FR-002
describe('toListItem', () => {
  it('shows the day and the car alone', () => {
    expect(
      toListItem({
        car: { brand: { name: 'Volkswagen' }, model: 'Golf', year: 2015 },
        doneOn: new Date('2026-10-01T00:00:00Z'),
        id,
      }),
    ).toEqual({
      car: { brandName: 'Volkswagen', model: 'Golf', year: 2015 },
      doneOn: '2026-10-01',
      id,
    });
  });
});

// @traces 1267-FR-003
describe('toAdminItem', () => {
  it('shows the repair as stored, the garage by its stored name, with the version to send back', () => {
    expect(toAdminItem(row())).toEqual({
      car: { brandName: 'Volkswagen', model: 'Golf', year: 2015 },
      correctedBy: null,
      costBani: 45_000,
      doneOn: '2026-10-01',
      garageName: 'Garaj Nordic',
      id,
      odometerKm: 151_000,
      version: '2026-10-20T08:00:00.000Z',
      what: 'Schimb ulei',
    });
  });

  it.each([
    ['owner', 'garage'],
    ['admin', 'admin'],
    ['driver', null],
  ] as const)('tells a last write by the %s as %p', (role, by) => {
    expect(toAdminItem(row({ updatedByRole: role })).correctedBy).toBe(by);
  });

  it('keeps no reading and no amount as null', () => {
    const item = toAdminItem(row({ costBani: null, odometerKm: null }));
    expect(item.costBani).toBeNull();
    expect(item.odometerKm).toBeNull();
  });

  it('names nothing of the driver', () => {
    const text = JSON.stringify(toAdminItem(row()));
    for (const part of ['Andrei', 'Marin', 'driver-account']) {
      expect(text).not.toContain(part);
    }
  });
});
