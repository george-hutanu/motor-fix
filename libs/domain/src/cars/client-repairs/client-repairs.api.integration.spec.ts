import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { DELETED_AUTHOR } from '@motor-fix/contracts';

import { ClientRepairsModule } from './client-repairs.module';
import { addDays, localDay } from '../../bucharest';
import { EVENT_PORT, type EventPort } from '../../events/event.port';
import { quotesApp } from '../../quotes/quotes-api.testing';
import { CarHistoryModule } from '../history/history.module';

// @traces 409-FR-001
// @traces 409-FR-002
// @traces 409-FR-003
// @traces 409-FR-004
// @traces 409-FR-005
// @traces 409-FR-006
// @traces 409-FR-007
// @traces 409-FR-008
// @traces 409-FR-009
// @traces 409-FR-010
// @traces 409-FR-011
// @traces 409-FR-012
// @traces 409-FR-015
// @traces 409-FR-017

const { bearer, get, provider, send, team, world } = quotesApp([
  ClientRepairsModule,
  CarHistoryModule,
]);
const { prisma } = world;

const LIST = '/garage/client-repairs';
const one = (id: string) => `${LIST}/${id}`;
const missing = '6f1c0c5e-2b7a-4d1e-9a3b-8c4d5e6f7a80';

type Over = {
  costBani?: number | null;
  createdAt?: Date;
  deletedAt?: Date | null;
  doneOn?: string;
  garageId?: string | null;
  garageName?: string;
  odometerKm?: number | null;
  shared?: boolean;
  source?: 'logged' | 'motorfix';
  what?: string;
};

// A garage with its owner, and a driver's car with a logged repair naming
// that garage, shared with it.
async function scene(name = 'Garaj Nordic') {
  const staff = await team(name);
  const driverId = await world.account('Andrei Ion Marin');
  const car = await world.car(driverId);
  // A repair done through MotorFix carries its own job, as the table's check
  // requires.
  const motorFixJob = async () => {
    const { booking } = await world.chain(driverId, staff.garage.id);
    await prisma.quoteRequest.update({
      data: { carId: car.id },
      where: { id: booking.requestId },
    });
    return (await world.job(booking.id, 'done')).id;
  };
  const repair = async (over: Over = {}) => {
    const { shared, ...rest } = over;
    const jobId = rest.source === 'motorfix' ? await motorFixJob() : null;
    return prisma.repair.create({
      data: {
        carId: car.id,
        costBani: 45_000,
        doneOn: new Date('2026-10-01T00:00:00Z'),
        garageId: staff.garage.id,
        garageName: name,
        jobId,
        odometerKm: 151_000,
        source: 'logged',
        what: 'Schimb ulei',
        ...rest,
        ...(rest.doneOn && { doneOn: new Date(`${rest.doneOn}T00:00:00Z`) }),
        sharedWithGarage: shared ?? true,
      },
    });
  };
  const owner = bearer(staff.owner, 'garage');
  return {
    ...staff,
    auth: {
      admin: bearer(await world.account('Admin', ['admin']), 'admin'),
      driver: bearer(driverId, 'driver'),
      mechanic: bearer(staff.plain, 'mechanic'),
      owner,
      receptionist: bearer(staff.receptionist, 'receptionist'),
    },
    car,
    driverId,
    repair,
  };
}

const version = (repair: { updatedAt: Date }) => repair.updatedAt.toISOString();
const reread = (id: string) =>
  prisma.repair.findUniqueOrThrow({ where: { id } });
const entries = (subjectId: string) =>
  prisma.activityLog.findMany({
    orderBy: { field: 'asc' },
    where: { subjectId },
  });
const events = (subjectId: string) =>
  prisma.outboxEvent.findMany({
    where: { kind: 'repair.updated', subjectId },
  });

describe('the repair columns', () => {
  it('starts a repair unshared, with no reading, amount or writer, its version its creation', async () => {
    const { car } = await scene();
    const row = await prisma.repair.create({
      data: {
        carId: car.id,
        doneOn: new Date('2026-10-01T00:00:00Z'),
        garageName: 'Service Popescu',
        source: 'logged',
        what: 'Ulei',
      },
    });
    expect(row).toMatchObject({
      costBani: null,
      odometerKm: null,
      sharedWithGarage: false,
      updatedBy: null,
      updatedByRole: null,
    });
    expect(row.updatedAt.getTime()).toBeGreaterThanOrEqual(
      row.createdAt.getTime(),
    );
  });

  it('gives a repair older than the columns its creation as its version', async () => {
    const { car } = await scene();
    const row = await prisma.repair.create({
      data: {
        carId: car.id,
        createdAt: new Date('2026-01-05T10:00:00.000Z'),
        doneOn: new Date('2026-01-04T00:00:00Z'),
        garageName: 'Service Popescu',
        source: 'logged',
        updatedAt: new Date('2026-10-30T09:00:00.000Z'),
        what: 'Ulei',
      },
    });
    const migration = readFileSync(
      join(
        __dirname,
        '../../../prisma/migrations/20261030090000_repair_corrections/migration.sql',
      ),
      'utf8',
    );
    const backfill = migration.match(/^UPDATE "repair"[^;]*;/m)?.[0];
    expect(backfill).toBeDefined();

    await prisma.$executeRawUnsafe(backfill as string);

    expect((await reread(row.id)).updatedAt).toEqual(
      new Date('2026-01-05T10:00:00.000Z'),
    );
  });

  it.each([
    ['odometer_km', -1],
    ['odometer_km', 2_000_001],
    ['cost_bani', -1],
    ['cost_bani', 100_000_001],
  ])('refuses %s = %p in the database', async (column, value) => {
    const { repair } = await scene();
    const { id } = await repair();
    await expect(
      prisma.$executeRawUnsafe(
        `UPDATE repair SET ${column} = $1 WHERE id = $2::uuid`,
        value,
        id,
      ),
    ).rejects.toThrow();
  });

  it('refuses a writer without a role in the database', async () => {
    const { owner, repair } = await scene();
    const { id } = await repair();
    await expect(
      prisma.$executeRaw`UPDATE repair SET updated_by = ${owner}::uuid, updated_by_role = NULL WHERE id = ${id}::uuid`,
    ).rejects.toThrow();
  });
});

describe('GET /garage/client-repairs', () => {
  it('lists only the shared logged repairs naming the approved garage, newest first', async () => {
    const s = await scene();
    const other = await team('Service Popescu');
    await s.repair({ shared: false, what: 'Unshared' });
    await s.repair({ deletedAt: new Date(), what: 'Deleted' });
    await s.repair({ source: 'motorfix', what: 'MotorFix' });
    await s.repair({ garageId: other.garage.id, what: 'Other garage' });
    await s.repair({ garageId: null, what: 'By text only' });
    const older = await s.repair({ doneOn: '2026-09-01', what: 'Older' });
    const first = await s.repair({
      createdAt: new Date('2026-10-02T08:00:00Z'),
      what: 'Same day, first',
    });
    const second = await s.repair({
      createdAt: new Date('2026-10-02T09:00:00Z'),
      what: 'Same day, second',
    });

    const res = await get(LIST, s.auth.owner);

    expect(res.status).toBe(200);
    expect(res.body.truncated).toBe(false);
    expect(res.body.items.map((i: { id: string }) => i.id)).toEqual([
      second.id,
      first.id,
      older.id,
    ]);
  });

  it('answers each repair with the short name and the car, never the plate or contact details', async () => {
    const s = await scene();
    const row = await s.repair();
    const brand = await prisma.brand.findUniqueOrThrow({
      where: { id: s.car.brandId },
    });

    const res = await get(LIST, s.auth.owner);

    expect(res.body.items).toEqual([
      {
        car: { brandName: brand.name, model: 'Cooper S', year: 2019 },
        correctedAt: null,
        costBani: 45_000,
        doneOn: '2026-10-01',
        driver: { shortName: 'Andrei M.' },
        id: row.id,
        odometerKm: 151_000,
        version: version(row),
        what: 'Schimb ulei',
      },
    ]);
    const text = JSON.stringify(res.body);
    expect(text).not.toContain('B123ABC');
    expect(text).not.toContain('Andrei Ion Marin');
  });

  it('labels the driver as the deleted author once the account is deleted', async () => {
    const s = await scene();
    await s.repair();
    await prisma.account.update({
      data: { status: 'deleted' },
      where: { id: s.driverId },
    });

    const res = await get(LIST, s.auth.owner);

    expect(res.body.items[0].driver).toEqual({ shortName: DELETED_AUTHOR });
  });

  it('answers at most 200 repairs and says the list was cut', async () => {
    const s = await scene();
    await prisma.repair.createMany({
      data: Array.from({ length: 201 }, (_, n) => ({
        carId: s.car.id,
        doneOn: new Date('2026-10-01T00:00:00Z'),
        garageId: s.garage.id,
        garageName: 'Garaj Nordic',
        sharedWithGarage: true,
        source: 'logged' as const,
        what: `Repair ${n}`,
      })),
    });

    const res = await get(LIST, s.auth.owner);

    expect(res.body.items).toHaveLength(200);
    expect(res.body.truncated).toBe(true);
  });

  it.each(['suspended', 'draft'] as const)(
    'answers 404 to the owner of a %s garage',
    async (status) => {
      const s = await scene();
      await s.repair();
      await prisma.garage.update({
        data: { status },
        where: { id: s.garage.id },
      });

      expect((await get(LIST, s.auth.owner)).status).toBe(404);
    },
  );

  it('answers 401 signed out, 403 to the staff and 404 to a driver or an admin', async () => {
    const s = await scene();

    expect((await get(LIST)).status).toBe(401);
    expect((await get(LIST, s.auth.receptionist)).status).toBe(403);
    expect((await get(LIST, s.auth.mechanic)).status).toBe(403);
    expect((await get(LIST, s.auth.driver)).status).toBe(404);
    expect((await get(LIST, s.auth.admin)).status).toBe(404);
  });
});

describe('PATCH /garage/client-repairs/:id', () => {
  it.each([
    ['what', 'Schimb ulei și filtre'],
    ['doneOn', '2026-09-30'],
    ['odometerKm', 150_000],
    ['costBani', 50_000],
  ] as const)(
    'corrects %s alone and answers the item',
    async (field, value) => {
      const s = await scene();
      const row = await s.repair();

      const res = await send('patch', one(row.id), s.auth.owner, {
        [field]: value,
        version: version(row),
      });

      expect(res.status).toBe(200);
      expect(res.body[field]).toEqual(value);
      const after = await reread(row.id);
      expect(after.updatedBy).toBe(s.owner);
      expect(after.updatedByRole).toBe('owner');
      expect(after.updatedAt.getTime()).toBeGreaterThan(
        row.updatedAt.getTime(),
      );
      expect(res.body.version).toBe(version(after));
      expect(res.body.correctedAt).toBe(version(after));
    },
  );

  it('corrects every field together, trimming what was done', async () => {
    const s = await scene();
    const row = await s.repair();

    const res = await send('patch', one(row.id), s.auth.owner, {
      costBani: 0,
      doneOn: '2026-09-30',
      odometerKm: 0,
      version: version(row),
      what: '  Distribuție  ',
    });

    expect(res.status).toBe(200);
    expect(await reread(row.id)).toMatchObject({
      costBani: 0,
      doneOn: new Date('2026-09-30T00:00:00Z'),
      odometerKm: 0,
      what: 'Distribuție',
    });
  });

  it('clears the amount', async () => {
    const s = await scene();
    const row = await s.repair();

    const res = await send('patch', one(row.id), s.auth.owner, {
      costBani: null,
      version: version(row),
    });

    expect(res.status).toBe(200);
    expect(res.body.costBani).toBeNull();
    expect((await reread(row.id)).costBani).toBeNull();
  });

  it('writes one audit entry per changed field, as the owner, with the garage and the car', async () => {
    const s = await scene();
    const row = await s.repair();

    await send('patch', one(row.id), s.auth.owner, {
      costBani: null,
      odometerKm: 150_000,
      version: version(row),
      what: 'Schimb ulei',
    }).expect(200);

    const logged = await entries(row.id);
    expect(
      logged.map((e) => [e.field, e.oldValue, e.newValue, e.action]),
    ).toEqual([
      ['costBani', 45_000, null, 'update'],
      ['odometerKm', 151_000, 150_000, 'update'],
    ]);
    for (const entry of logged) {
      expect(entry).toMatchObject({
        actorId: s.owner,
        actorRole: 'owner',
        carId: s.car.id,
        garageId: s.garage.id,
        subjectType: 'repair',
      });
    }
  });

  it('records repair.updated for the owner and the garage, naming the changed fields', async () => {
    const s = await scene();
    const row = await s.repair();

    await send('patch', one(row.id), s.auth.owner, {
      doneOn: '2026-09-30',
      odometerKm: 150_000,
      version: version(row),
    }).expect(200);

    const [event, ...more] = await events(row.id);
    expect(more).toEqual([]);
    expect(event?.payload).toEqual({
      by: 'owner',
      carId: s.car.id,
      changed: ['doneOn', 'odometerKm'],
      garageId: s.garage.id,
      ownerId: s.driverId,
      repairId: row.id,
    });
    expect(event?.audience).toEqual([
      `account:${s.driverId}`,
      `garage:${s.garage.id}`,
    ]);
  });

  it('records repair.updated with no owner for a car whose owner left', async () => {
    const s = await scene();
    const row = await s.repair();
    await prisma.carOwnership.updateMany({
      data: {
        access: 'former_owner_read_only',
        closedAt: new Date(),
        toDate: new Date(`${localDay(new Date())}T00:00:00Z`),
      },
      where: { carId: s.car.id },
    });

    await send('patch', one(row.id), s.auth.owner, {
      odometerKm: 150_000,
      version: version(row),
    }).expect(200);

    const [event] = await events(row.id);
    expect(event?.payload).toMatchObject({ ownerId: null });
    expect(event?.audience).toEqual([`garage:${s.garage.id}`]);
  });

  it('writes nothing and keeps the version when nothing changed, or no field was sent', async () => {
    const s = await scene();
    const row = await s.repair();

    for (const body of [
      { version: version(row) },
      { odometerKm: 151_000, version: version(row), what: ' Schimb ulei ' },
    ]) {
      const res = await send('patch', one(row.id), s.auth.owner, body);
      expect(res.status).toBe(200);
      expect(res.body.version).toBe(version(row));
    }
    const after = await reread(row.id);
    expect(after.updatedAt).toEqual(row.updatedAt);
    expect(after.updatedBy).toBeNull();
    expect(await entries(row.id)).toEqual([]);
    expect(await events(row.id)).toEqual([]);
  });

  it('leaves nothing behind when the event cannot be recorded', async () => {
    const s = await scene();
    const row = await s.repair();
    const port = provider<EventPort>(EVENT_PORT);
    const spy = vi
      .spyOn(port, 'record')
      .mockRejectedValueOnce(new Error('outbox down'));

    try {
      const res = await send('patch', one(row.id), s.auth.owner, {
        odometerKm: 150_000,
        version: version(row),
      });
      expect(res.status).toBe(500);
    } finally {
      spy.mockRestore();
    }

    expect(await reread(row.id)).toMatchObject({
      odometerKm: 151_000,
      updatedAt: row.updatedAt,
    });
    expect(await entries(row.id)).toEqual([]);
  });

  it.each([
    ['what', ''],
    ['what', 'x'.repeat(201)],
    ['doneOn', '2026-02-30'],
    ['doneOn', addDays(localDay(new Date()), 1)],
    ['odometerKm', 2_000_001],
    ['odometerKm', null],
    ['costBani', 92_000_001],
    ['costBani', -1],
    ['carId', missing],
    ['garageId', missing],
    ['source', 'motorfix'],
    ['sharedWithGarage', false],
  ])('answers 400 for %s = %p, changing nothing', async (field, value) => {
    const s = await scene();
    const row = await s.repair();

    const res = await send('patch', one(row.id), s.auth.owner, {
      [field]: value,
      version: version(row),
    });

    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain(field);
    expect((await reread(row.id)).updatedAt).toEqual(row.updatedAt);
  });

  it('answers 400 without a version, and for a malformed id', async () => {
    const s = await scene();
    const row = await s.repair();

    expect(
      (await send('patch', one(row.id), s.auth.owner, { what: 'Ulei' })).status,
    ).toBe(400);
    expect(
      (
        await send('patch', one('not-a-uuid'), s.auth.owner, {
          version: version(row),
        })
      ).status,
    ).toBe(400);
  });

  it('accepts today in Bucharest as the day done', async () => {
    const s = await scene();
    const row = await s.repair();

    const res = await send('patch', one(row.id), s.auth.owner, {
      doneOn: localDay(new Date()),
      version: version(row),
    });

    expect(res.status).toBe(200);
  });

  it('answers 401 signed out, 403 to the staff and 404 to a driver or an admin', async () => {
    const s = await scene();
    const row = await s.repair();
    const body = { odometerKm: 150_000, version: version(row) };

    expect((await send('patch', one(row.id), '', body)).status).toBe(401);
    for (const [auth, status] of [
      [s.auth.receptionist, 403],
      [s.auth.mechanic, 403],
      [s.auth.driver, 404],
      [s.auth.admin, 404],
    ] as const) {
      expect((await send('patch', one(row.id), auth, body)).status).toBe(
        status,
      );
    }
    expect((await reread(row.id)).odometerKm).toBe(151_000);
  });

  it('answers 404 for every repair outside the garage’s shared logged ones', async () => {
    const s = await scene();
    const other = await team('Service Popescu');
    const rows = [
      await s.repair({ deletedAt: new Date() }),
      await s.repair({ source: 'motorfix' }),
      await s.repair({ garageId: other.garage.id }),
      await s.repair({ garageId: null }),
      await s.repair({ shared: false }),
    ];

    for (const row of rows) {
      const res = await send('patch', one(row.id), s.auth.owner, {
        odometerKm: 1,
        version: version(row),
      });
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('not_found');
    }
    expect(
      (
        await send('patch', one(missing), s.auth.owner, {
          version: new Date().toISOString(),
        })
      ).status,
    ).toBe(404);
  });

  it('answers 404 to a garage that reads the car’s history only through a booking', async () => {
    const s = await scene();
    const row = await s.repair();
    const other = await team('Service Popescu');
    const { booking } = await world.chain(s.driverId, other.garage.id);
    await prisma.quoteRequest.update({
      data: { carId: s.car.id },
      where: { id: booking.requestId },
    });
    await prisma.booking.update({
      data: { historyShared: true },
      where: { id: booking.id },
    });
    const otherOwner = bearer(other.owner, 'garage');

    const res = await send('patch', one(row.id), otherOwner, {
      odometerKm: 150_000,
      version: version(row),
    });

    expect(res.status).toBe(404);
    expect((await get(LIST, otherOwner).expect(200)).body.items).toEqual([]);
    expect((await reread(row.id)).odometerKm).toBe(151_000);
  });

  it('answers 404 once sharing stopped after the garage read the list', async () => {
    const s = await scene();
    const row = await s.repair();
    await get(LIST, s.auth.owner).expect(200);
    await prisma.repair.update({
      data: { sharedWithGarage: false },
      where: { id: row.id },
    });

    const res = await send('patch', one(row.id), s.auth.owner, {
      odometerKm: 150_000,
      version: version(row),
    });

    expect(res.status).toBe(404);
  });

  it('answers 404 to the owner of a suspended garage', async () => {
    const s = await scene();
    const row = await s.repair();
    await prisma.garage.update({
      data: { status: 'suspended' },
      where: { id: s.garage.id },
    });

    const res = await send('patch', one(row.id), s.auth.owner, {
      odometerKm: 150_000,
      version: version(row),
    });

    expect(res.status).toBe(404);
  });

  it('answers 409 stale_version for an older version, even when the body changes nothing', async () => {
    const s = await scene();
    const row = await s.repair();
    const old = new Date(row.updatedAt.getTime() - 1000).toISOString();

    for (const body of [
      { odometerKm: 150_000, version: old },
      { version: old },
    ]) {
      const res = await send('patch', one(row.id), s.auth.owner, body);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('stale_version');
    }
    expect((await reread(row.id)).odometerKm).toBe(151_000);
  });

  it('refuses in order: 403 before 400, 400 before 404, 404 before 409', async () => {
    const s = await scene();
    const row = await s.repair();
    const old = new Date(row.updatedAt.getTime() - 1000).toISOString();
    const future = addDays(localDay(new Date()), 1);

    const staff = await send('patch', one(row.id), s.auth.receptionist, {
      what: '',
    });
    const invalid = await send('patch', one(missing), s.auth.owner, {
      doneOn: future,
      version: old,
    });
    const absent = await send('patch', one(missing), s.auth.owner, {
      version: old,
    });
    const stale = await send('patch', one(row.id), s.auth.owner, {
      doneOn: future,
      version: old,
    });

    expect(staff.status).toBe(403);
    expect(invalid.status).toBe(400);
    expect(absent.status).toBe(404);
    expect(stale.status).toBe(400);
    expect(JSON.stringify(stale.body)).toContain('doneOn');
    expect((await reread(row.id)).doneOn).toEqual(row.doneOn);
  });

  it('checks the version before comparing values: a stale body that changes nothing answers 409', async () => {
    const s = await scene();
    const row = await s.repair();

    const res = await send('patch', one(row.id), s.auth.owner, {
      odometerKm: 151_000,
      version: new Date(row.updatedAt.getTime() - 1000).toISOString(),
    });

    expect(res.status).toBe(409);
  });

  it('lets one of two saves with the same version through, and refuses the other', async () => {
    const s = await scene();
    const row = await s.repair();

    const answers = await Promise.all([
      send('patch', one(row.id), s.auth.owner, {
        odometerKm: 150_000,
        version: version(row),
      }),
      send('patch', one(row.id), s.auth.owner, {
        odometerKm: 149_000,
        version: version(row),
      }),
    ]);

    expect(answers.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await entries(row.id)).toHaveLength(1);
    expect(await events(row.id)).toHaveLength(1);
  });
});

describe('DELETE /garage/client-repairs/:id', () => {
  it('answers 403 to the owner and leaves the repair as it was', async () => {
    const s = await scene();
    const row = await s.repair();

    const res = await send('delete', one(row.id), s.auth.owner);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('forbidden');
    expect(await reread(row.id)).toEqual(row);
  });

  it('answers 401 signed out, 403 to the staff and 404 to a driver', async () => {
    const s = await scene();
    const row = await s.repair();

    expect((await send('delete', one(row.id), '')).status).toBe(401);
    expect((await send('delete', one(row.id), s.auth.mechanic)).status).toBe(
      403,
    );
    expect((await send('delete', one(row.id), s.auth.driver)).status).toBe(404);
  });
});

describe('the driver’s read of a corrected repair', () => {
  it('shows the reading, the amount and who corrected it', async () => {
    const s = await scene();
    const row = await s.repair();

    const before = await get(`/cars/${s.car.id}/repairs`, s.auth.driver);
    expect(before.body.items[0]).toMatchObject({
      correctedBy: null,
      costBani: 45_000,
      odometerKm: 151_000,
    });

    await send('patch', one(row.id), s.auth.owner, {
      odometerKm: 150_000,
      version: version(row),
    }).expect(200);

    const after = await get(`/cars/${s.car.id}/repairs`, s.auth.driver);
    expect(after.body.items[0]).toMatchObject({
      correctedBy: 'garage',
      odometerKm: 150_000,
    });
  });

  it('names an admin’s correction, and none for the driver’s own edit', async () => {
    const s = await scene();
    const byAdmin = await s.repair({ what: 'By admin' });
    const byDriver = await s.repair({ what: 'By driver' });
    await prisma.repair.update({
      data: { updatedBy: s.driverId, updatedByRole: 'admin' },
      where: { id: byAdmin.id },
    });
    await prisma.repair.update({
      data: { updatedBy: s.driverId, updatedByRole: 'driver' },
      where: { id: byDriver.id },
    });

    const res = await get(`/cars/${s.car.id}/repairs`, s.auth.driver);
    const by = Object.fromEntries(
      res.body.items.map((i: { what: string; correctedBy: unknown }) => [
        i.what,
        i.correctedBy,
      ]),
    );
    expect(by).toEqual({ 'By admin': 'admin', 'By driver': null });
  });
});
