import { DELETED_AUTHOR } from '@motor-fix/contracts';

import {
  CLIENT_REPAIR_SELECT,
  type ClientRepairRow,
  changes,
  ownerScope,
  stored,
  toItem,
} from './client-repairs';

const before = {
  costBani: 45_000 as number | null,
  doneOn: '2026-10-01',
  odometerKm: 151_000 as number | null,
  what: 'Schimb ulei',
};

const updatedAt = new Date('2026-10-20T08:00:00.123Z');

const row = (over: Partial<ClientRepairRow> = {}): ClientRepairRow => ({
  car: {
    brand: { name: 'Volkswagen' },
    model: 'Golf',
    ownerships: [
      { account: { name: 'Andrei Marin', status: 'active' }, accountId: 'a1' },
    ],
    year: 2015,
  },
  costBani: 45_000,
  doneOn: new Date('2026-10-01T00:00:00Z'),
  id: 'r1',
  odometerKm: 151_000,
  updatedAt,
  updatedByRole: null,
  what: 'Schimb ulei',
  ...over,
});

// @traces 409-FR-010
describe('changes under odd values', () => {
  it('reports nothing for an empty body', () => {
    expect(changes(before, {})).toEqual({});
  });

  it('reports nothing when every sent value equals the stored one', () => {
    expect(changes(before, { ...before } as never)).toEqual({});
  });

  it('reports nothing when a null amount is sent over a null amount', () => {
    expect(changes({ ...before, costBani: null }, { costBani: null })).toEqual(
      {},
    );
  });

  it('reports an amount cleared to null as a change', () => {
    expect(changes(before, { costBani: null })).toEqual({ costBani: null });
  });

  it('reports an amount set over none as a change', () => {
    expect(changes({ ...before, costBani: null }, { costBani: 0 })).toEqual({
      costBani: 0,
    });
  });

  it('reports an odometer of zero over a stored zero as no change', () => {
    expect(changes({ ...before, odometerKm: 0 }, { odometerKm: 0 })).toEqual(
      {},
    );
  });

  it('reports a negative zero over a stored zero as no change', () => {
    expect(changes({ ...before, odometerKm: 0 }, { odometerKm: -0 })).toEqual(
      {},
    );
  });

  it('reports a negative zero amount over a stored zero as no change', () => {
    expect(changes({ ...before, costBani: 0 }, { costBani: -0 })).toEqual({});
  });

  it('reports a zero odometer over a stored none as a change', () => {
    expect(changes({ ...before, odometerKm: null }, { odometerKm: 0 })).toEqual(
      {
        odometerKm: 0,
      },
    );
  });

  it('ignores fields the owner may never change', () => {
    const hostile = { garageId: 'g2', source: 'motorfix' } as never;
    expect(changes(before, hostile)).toEqual({});
  });

  it('does not mutate the stored values or the body', () => {
    const body = { what: 'Altceva' };
    const copy = { ...before };
    changes(before, body);
    expect(before).toEqual(copy);
    expect(body).toEqual({ what: 'Altceva' });
  });

  it('is the same on a second call', () => {
    const body = { doneOn: '2026-10-02', what: 'Altceva' };
    expect(changes(before, body)).toEqual(changes(before, body));
  });
});

// @traces 409-FR-003
// @traces 409-FR-007
describe('ownerScope under odd ids', () => {
  it('answers a fresh object each call', () => {
    expect(ownerScope('g1')).not.toBe(ownerScope('g1'));
  });

  it('holds the garage id as given, with no widening', () => {
    expect(ownerScope('')).toEqual({
      deletedAt: null,
      garage: { status: 'approved' },
      garageId: '',
      sharedWithGarage: true,
      source: 'logged',
    });
  });

  it('keeps a hostile id verbatim', () => {
    expect(ownerScope("g1' OR '1'='1").garageId).toBe("g1' OR '1'='1");
  });
});

// @traces 409-FR-004
describe('toItem under odd rows', () => {
  const FORBIDDEN = [
    'plate',
    'phone',
    'email',
    'name',
    'accountId',
    'updatedByRole',
  ];

  it('carries exactly the documented keys', () => {
    expect(Object.keys(toItem(row())).sort()).toEqual([
      'car',
      'correctedAt',
      'costBani',
      'doneOn',
      'driver',
      'id',
      'odometerKm',
      'version',
      'what',
    ]);
  });

  it('leaks nothing the row carries beyond the select', () => {
    const leaky = row({
      car: {
        ...row().car,
        ownerships: [
          {
            account: {
              email: 'a@b.ro',
              name: 'Andrei Marin',
              phone: '+40700',
              status: 'active',
            },
            accountId: 'a1',
          },
        ],
        plate: 'B123ABC',
      },
    } as never);
    const text = JSON.stringify(toItem(leaky));
    for (const secret of ['B123ABC', 'a@b.ro', '+40700', 'Marin']) {
      expect(text).not.toContain(secret);
    }
    expect(FORBIDDEN.filter((k) => k in toItem(leaky) && k !== 'name')).toEqual(
      [],
    );
  });

  it('shows the deleted-author label when the car has no ownership', () => {
    const item = toItem(row({ car: { ...row().car, ownerships: [] } }));
    expect(item.driver.shortName).toBe(DELETED_AUTHOR);
  });

  it('shows the deleted-author label for a deleted owner', () => {
    const item = toItem(
      row({
        car: {
          ...row().car,
          ownerships: [
            {
              account: { name: 'Ion Pop', status: 'deleted' },
              accountId: 'a1',
            },
          ],
        },
      }),
    );
    expect(item.driver.shortName).toBe(DELETED_AUTHOR);
  });

  it('shows a suspended owner by short name', () => {
    const item = toItem(
      row({
        car: {
          ...row().car,
          ownerships: [
            {
              account: { name: 'Ion Pop', status: 'suspended' },
              accountId: 'a1',
            },
          ],
        },
      }),
    );
    expect(item.driver.shortName).toBe('Ion P.');
  });

  it('takes the initial of a non-BMP family name whole', () => {
    const item = toItem(
      row({
        car: {
          ...row().car,
          ownerships: [
            {
              account: { name: 'Ion 𝒜lbu', status: 'active' },
              accountId: 'a1',
            },
          ],
        },
      }),
    );
    expect(item.driver.shortName).toBe('Ion 𝒜.');
  });

  it('shows a one-word name as it is', () => {
    const item = toItem(
      row({
        car: {
          ...row().car,
          ownerships: [
            { account: { name: 'Ion', status: 'active' }, accountId: 'a1' },
          ],
        },
      }),
    );
    expect(item.driver.shortName).toBe('Ion');
  });

  it('shows an unnamed owner as the deleted-author label rather than an empty string', () => {
    const item = toItem(
      row({
        car: {
          ...row().car,
          ownerships: [
            { account: { name: '   ', status: 'active' }, accountId: 'a1' },
          ],
        },
      }),
    );
    expect(item.driver.shortName).not.toBe('');
  });

  it.each([
    ['admin', null],
    ['driver', null],
    [null, null],
    ['owner', updatedAt.toISOString()],
  ] as const)('carries correctedAt for updater %s', (role, expected) => {
    expect(toItem(row({ updatedByRole: role })).correctedAt).toBe(expected);
  });

  it('keeps the version to the millisecond', () => {
    expect(toItem(row()).version).toBe('2026-10-20T08:00:00.123Z');
  });

  it('keeps a stored zero odometer and amount as zero, not null', () => {
    const item = toItem(row({ costBani: 0, odometerKm: 0 }));
    expect([item.odometerKm, item.costBani]).toEqual([0, 0]);
  });

  it('keeps a missing odometer and amount as null', () => {
    const item = toItem(row({ costBani: null, odometerKm: null }));
    expect([item.odometerKm, item.costBani]).toEqual([null, null]);
  });

  it('reads the first open ownership when two are returned', () => {
    const two = [
      { account: { name: 'Primul Om', status: 'active' }, accountId: 'a1' },
      { account: { name: 'Al Doilea', status: 'active' }, accountId: 'a2' },
    ];
    expect(
      toItem(row({ car: { ...row().car, ownerships: two } })).driver.shortName,
    ).toBe('Primul O.');
  });
});

// @traces 409-FR-011
describe('stored', () => {
  it('shows a day near the year boundary without a timezone shift', () => {
    expect(
      stored(row({ doneOn: new Date('2025-12-31T00:00:00Z') })).doneOn,
    ).toBe('2025-12-31');
    expect(
      stored(row({ doneOn: new Date('2024-02-29T00:00:00Z') })).doneOn,
    ).toBe('2024-02-29');
  });

  it('returns only the four correctable fields', () => {
    expect(Object.keys(stored(row())).sort()).toEqual([
      'costBani',
      'doneOn',
      'odometerKm',
      'what',
    ]);
  });
});

// @traces 409-FR-004
describe('CLIENT_REPAIR_SELECT', () => {
  it('never selects a plate, a phone or an e-mail', () => {
    const text = JSON.stringify(CLIENT_REPAIR_SELECT);
    for (const field of ['plate', 'phone', 'email', 'vin']) {
      expect(text).not.toContain(`"${field}"`);
    }
  });

  it('reads only open ownerships', () => {
    expect(CLIENT_REPAIR_SELECT.car.select.ownerships.where).toEqual({
      toDate: null,
    });
  });
});
