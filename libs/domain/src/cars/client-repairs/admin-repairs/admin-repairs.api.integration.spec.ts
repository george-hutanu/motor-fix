import {
  adminRepairsApp,
  list,
  missing,
  one,
  version,
} from './admin-repairs.testing';
import { addDays, localDay } from '../../../bucharest';

// @traces 1267-FR-001 1267-FR-002 1267-FR-003 1267-FR-005 1267-FR-006
// @traces 1267-FR-009 1267-FR-011 1267-FR-014

const { closeOwnership, get, prisma, reread, scene, send, world } =
  adminRepairsApp();

describe('GET /admin/accounts/:id/repairs', () => {
  it('lists the logged repairs on the cars the account owns now, shared or not, whatever the garage', async () => {
    const s = await scene();
    const shared = await s.repair({ doneOn: '2026-09-01', what: 'Shared' });
    const unshared = await s.repair({ doneOn: '2026-08-01', shared: false });
    const offMotorFix = await s.repair({
      doneOn: '2026-07-01',
      garageId: null,
      garageName: 'Service Popescu',
      shared: false,
    });
    await s.repair({ deletedAt: new Date(), doneOn: '2026-10-02' });
    await s.repair({ doneOn: '2026-10-03', source: 'motorfix' });

    const res = await get(list(s.driverId), s.auth.admin);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      items: [shared, unshared, offMotorFix].map((r) => ({
        car: s.carName,
        doneOn: r.doneOn.toISOString().slice(0, 10),
        id: r.id,
      })),
      truncated: false,
    });
  });

  it('orders the newest day first and, on one day, the newest logged first', async () => {
    const s = await scene();
    const older = await s.repair({
      createdAt: new Date('2026-10-02T08:00:00Z'),
      doneOn: '2026-10-01',
    });
    const newer = await s.repair({
      createdAt: new Date('2026-10-02T09:00:00Z'),
      doneOn: '2026-10-01',
    });
    const latest = await s.repair({ doneOn: '2026-10-05' });

    const res = await get(list(s.driverId), s.auth.admin).expect(200);

    expect(res.body.items.map((i: { id: string }) => i.id)).toEqual([
      latest.id,
      newer.id,
      older.id,
    ]);
  });

  it('leaves out a car sold away and takes in the repairs of a car bought', async () => {
    const s = await scene();
    await s.repair({ what: 'Sold away' });
    await closeOwnership(s.car.id);
    const seller = await world.account('Maria Ionescu');
    const bought = await world.car(seller);
    await closeOwnership(bought.id);
    await prisma.carOwnership.create({
      data: {
        access: 'owner',
        accountId: s.driverId,
        carId: bought.id,
        fromDate: new Date(`${localDay(new Date())}T00:00:00Z`),
        openedAt: new Date(),
      },
    });
    const before = await s.repair({ carId: bought.id, shared: false });

    const res = await get(list(s.driverId), s.auth.admin).expect(200);

    expect(res.body.items.map((i: { id: string }) => i.id)).toEqual([
      before.id,
    ]);
    expect(
      (await get(list(seller), s.auth.admin).expect(200)).body.items,
    ).toEqual([]);
  });

  it('answers at most 200 repairs and says the list was cut', async () => {
    const s = await scene();
    await prisma.repair.createMany({
      data: Array.from({ length: 201 }, (_, n) => ({
        carId: s.car.id,
        doneOn: new Date('2026-10-01T00:00:00Z'),
        garageName: 'Service Popescu',
        source: 'logged' as const,
        what: `Repair ${n}`,
      })),
    });

    const res = await get(list(s.driverId), s.auth.admin).expect(200);

    expect(res.body.items).toHaveLength(200);
    expect(res.body.truncated).toBe(true);
  });

  it('answers an empty list for an account with no car', async () => {
    const s = await scene();
    const carless = await world.account('Ion Pop');

    expect((await get(list(carless), s.auth.admin).expect(200)).body).toEqual({
      items: [],
      truncated: false,
    });
  });

  it('answers 404 for an unknown, malformed or deleted account', async () => {
    const s = await scene();
    await s.repair();
    const gone = await world.account('Gone Driver');
    await prisma.account.update({
      data: { status: 'deleted' },
      where: { id: gone },
    });

    for (const id of [missing, 'not-a-uuid', gone]) {
      const res = await get(list(id), s.auth.admin);
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('not_found');
    }
  });

  it('answers 401 signed out and 404 to every other role, even for a malformed id', async () => {
    const s = await scene();
    await s.repair();

    expect((await get(list(s.driverId))).status).toBe(401);
    for (const auth of s.notAdmins) {
      expect((await get(list(s.driverId), auth)).status).toBe(404);
      expect((await get(list('not-a-uuid'), auth)).status).toBe(404);
    }
  });
});

describe('GET /admin/repairs/:id', () => {
  it('answers the repair as stored, the garage by its stored name, with its version', async () => {
    const s = await scene();
    const row = await s.repair({ shared: false });

    const res = await get(one(row.id), s.auth.admin);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      car: s.carName,
      correctedBy: null,
      costBani: 45_000,
      doneOn: '2026-10-01',
      garageName: 'Garaj Nordic',
      id: row.id,
      odometerKm: 151_000,
      version: version(row),
      what: 'Schimb ulei',
    });
  });

  it('shows a repair naming a garage not on MotorFix by the name the driver typed', async () => {
    const s = await scene();
    const row = await s.repair({
      costBani: null,
      garageId: null,
      garageName: 'Service Popescu',
    });

    const res = await get(one(row.id), s.auth.admin).expect(200);

    expect(res.body).toMatchObject({
      costBani: null,
      garageName: 'Service Popescu',
    });
  });

  it.each([
    ['owner', 'garage'],
    ['admin', 'admin'],
    ['driver', null],
  ] as const)(
    'tells a last write by the %s as %p',
    async (updatedByRole, by) => {
      const s = await scene();
      const row = await s.repair({ updatedByRole });

      expect(
        (await get(one(row.id), s.auth.admin).expect(200)).body.correctedBy,
      ).toBe(by);
    },
  );

  it('answers 404 for a deleted, unknown, MotorFix or malformed repair', async () => {
    const s = await scene();
    const deleted = await s.repair({ deletedAt: new Date() });
    const motorFix = await s.repair({ source: 'motorfix' });

    for (const id of [deleted.id, motorFix.id, missing, 'not-a-uuid']) {
      const res = await get(one(id), s.auth.admin);
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('not_found');
    }
  });

  it('answers 401 signed out and 404 to every other role', async () => {
    const s = await scene();
    const row = await s.repair();

    expect((await get(one(row.id))).status).toBe(401);
    for (const auth of s.notAdmins) {
      expect((await get(one(row.id), auth)).status).toBe(404);
    }
  });
});

describe('PATCH /admin/repairs/:id', () => {
  it.each([
    ['what', 'Schimb ulei și filtre'],
    ['doneOn', '2026-09-30'],
    ['odometerKm', 150_000],
    ['costBani', 50_000],
    ['costBani', null],
  ] as const)(
    'corrects %s alone as the admin and answers the repair',
    async (field, value) => {
      const s = await scene();
      const row = await s.repair({ shared: false });

      const res = await send('patch', one(row.id), s.auth.admin, {
        [field]: value,
        version: version(row),
      });

      expect(res.status).toBe(200);
      const after = await reread(row.id);
      expect(res.body).toEqual({
        car: s.carName,
        correctedBy: 'admin',
        costBani: after.costBani,
        doneOn: after.doneOn.toISOString().slice(0, 10),
        garageName: 'Garaj Nordic',
        id: row.id,
        odometerKm: after.odometerKm,
        version: version(after),
        what: after.what,
      });
      expect(res.body[field]).toEqual(value);
      expect(after.updatedByRole).toBe('admin');
      expect(after.updatedAt.getTime()).toBeGreaterThan(
        row.updatedAt.getTime(),
      );
    },
  );

  it('corrects every field together, trimming what was done', async () => {
    const s = await scene();
    const row = await s.repair();

    const res = await send('patch', one(row.id), s.auth.admin, {
      costBani: 60_000,
      doneOn: '2026-09-29',
      odometerKm: 149_000,
      version: version(row),
      what: '  Schimb ulei și filtre  ',
    }).expect(200);

    expect(res.body).toMatchObject({
      costBani: 60_000,
      doneOn: '2026-09-29',
      odometerKm: 149_000,
      what: 'Schimb ulei și filtre',
    });
  });

  it('corrects a repair naming a garage not on MotorFix', async () => {
    const s = await scene();
    const row = await s.repair({
      garageId: null,
      garageName: 'Service Popescu',
      shared: false,
    });

    const res = await send('patch', one(row.id), s.auth.admin, {
      odometerKm: 150_000,
      version: version(row),
    });

    expect(res.status).toBe(200);
    expect(res.body.garageName).toBe('Service Popescu');
  });

  it('writes nothing and keeps the version when nothing changed', async () => {
    const s = await scene();
    const row = await s.repair();

    const res = await send('patch', one(row.id), s.auth.admin, {
      odometerKm: 151_000,
      version: version(row),
      what: ' Schimb ulei ',
    });

    expect(res.status).toBe(200);
    expect(res.body.version).toBe(version(row));
    expect(res.body.correctedBy).toBeNull();
    expect((await reread(row.id)).updatedBy).toBeNull();
  });

  it.each([
    ['what', ''],
    ['what', 'x'.repeat(201)],
    ['doneOn', '2026-02-30'],
    ['doneOn', addDays(localDay(new Date()), 1)],
    ['odometerKm', 2_000_001],
    ['costBani', 92_000_001],
    ['carId', missing],
    ['source', 'motorfix'],
    ['sharedWithGarage', true],
  ])('answers 400 for %s = %p, changing nothing', async (field, value) => {
    const s = await scene();
    const row = await s.repair();

    const res = await send('patch', one(row.id), s.auth.admin, {
      [field]: value,
      version: version(row),
    });

    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain(field);
    expect((await reread(row.id)).updatedAt).toEqual(row.updatedAt);
  });

  it('answers 400 without a version and for a body that is not JSON', async () => {
    const s = await scene();
    const row = await s.repair();

    expect(
      (await send('patch', one(row.id), s.auth.admin, { what: 'Ulei' })).status,
    ).toBe(400);
    expect(
      (
        await send('patch', one(row.id), s.auth.admin, undefined, {
          'Content-Type': 'text/plain',
        }).send('what=Ulei')
      ).status,
    ).toBe(400);
  });

  it('answers 404 for a deleted, unknown, MotorFix or malformed repair', async () => {
    const s = await scene();
    const deleted = await s.repair({ deletedAt: new Date() });
    const motorFix = await s.repair({ source: 'motorfix' });

    for (const [id, at] of [
      [deleted.id, version(deleted)],
      [motorFix.id, version(motorFix)],
      [missing, new Date().toISOString()],
      ['not-a-uuid', new Date().toISOString()],
    ]) {
      const res = await send('patch', one(id), s.auth.admin, {
        odometerKm: 1,
        version: at,
      });
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('not_found');
    }
    expect((await reread(deleted.id)).odometerKm).toBe(151_000);
  });

  it('answers 401 signed out and 404 to every other role, before any 400', async () => {
    const s = await scene();
    const row = await s.repair();

    expect(
      (await send('patch', one(row.id), '', { version: version(row) })).status,
    ).toBe(401);
    for (const auth of s.notAdmins) {
      expect(
        (await send('patch', one(row.id), auth, { what: '' })).status,
      ).toBe(404);
    }
    expect((await reread(row.id)).updatedAt).toEqual(row.updatedAt);
  });

  it('answers 409 stale_version for an older version, even when the body changes nothing', async () => {
    const s = await scene();
    const row = await s.repair();
    const old = new Date(row.updatedAt.getTime() - 1000).toISOString();

    for (const body of [
      { odometerKm: 150_000, version: old },
      { version: old },
    ]) {
      const res = await send('patch', one(row.id), s.auth.admin, body);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('stale_version');
    }
    expect((await reread(row.id)).odometerKm).toBe(151_000);
  });

  it('answers 409 to the admin once the garage corrected the repair since it was opened', async () => {
    const s = await scene();
    const row = await s.repair();
    await send('patch', `/garage/client-repairs/${row.id}`, s.auth.owner, {
      odometerKm: 150_000,
      version: version(row),
    }).expect(200);

    const res = await send('patch', one(row.id), s.auth.admin, {
      odometerKm: 149_000,
      version: version(row),
    });

    expect(res.status).toBe(409);
    expect((await reread(row.id)).odometerKm).toBe(150_000);
  });

  it('lets one of two saves with the same version through, and refuses the other', async () => {
    const s = await scene();
    const row = await s.repair();

    const answers = await Promise.all([
      send('patch', one(row.id), s.auth.admin, {
        odometerKm: 150_000,
        version: version(row),
      }),
      send('patch', one(row.id), s.auth.admin, {
        odometerKm: 149_000,
        version: version(row),
      }),
    ]);

    expect(answers.map((r) => r.status).sort()).toEqual([200, 409]);
  });
});

describe('DELETE /admin/repairs/:id', () => {
  it('answers 403 to the admin whatever the id, and leaves the repair as it was', async () => {
    const s = await scene();
    const row = await s.repair();
    const deleted = await s.repair({ deletedAt: new Date() });

    for (const id of [row.id, deleted.id, missing, 'not-a-uuid']) {
      const res = await send('delete', one(id), s.auth.admin);
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({
        code: 'forbidden',
        message: 'Doar șoferul poate șterge reparația',
      });
    }
    expect(await reread(row.id)).toEqual(row);
  });

  it('answers 401 signed out and 404 to every other role', async () => {
    const s = await scene();
    const row = await s.repair();

    expect((await send('delete', one(row.id), '')).status).toBe(401);
    for (const auth of s.notAdmins) {
      expect((await send('delete', one(row.id), auth)).status).toBe(404);
    }
    expect(await reread(row.id)).toEqual(row);
  });
});
