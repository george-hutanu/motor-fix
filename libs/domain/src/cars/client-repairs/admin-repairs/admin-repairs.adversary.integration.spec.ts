import {
  adminRepairsApp,
  list,
  missing,
  one,
  version,
} from './admin-repairs.testing';
import { addDays, localDay } from '../../../bucharest';

// @traces 1267-FR-001 1267-FR-003 1267-FR-005 1267-FR-006 1267-FR-009
// @traces 1267-FR-011 1267-FR-014

const { get, prisma, reread, scene, send } = adminRepairsApp();

const logOf = (subjectId: string) =>
  prisma.activityLog.findMany({ where: { subjectId } });

describe('PATCH /admin/repairs/:id under hostile bodies', () => {
  it.each([
    ['odometerKm', null],
    ['odometerKm', -1],
    ['odometerKm', 1.5],
    ['odometerKm', '150000'],
    ['costBani', -1],
    ['costBani', 0.5],
    ['costBani', '500'],
    ['costBani', 92_000_001],
    ['what', '   '],
    ['what', null],
    ['what', 42],
    ['what', 'Ulei\u0000'],
    ['what', 'Ulei\nfiltre'],
    ['what', 'x'.repeat(201)],
    ['doneOn', null],
    ['doneOn', 20261001],
    ['doneOn', '2026-10-01T00:00:00Z'],
    ['doneOn', '1-10-2026'],
    ['doneOn', '2026-13-01'],
    ['garageId', missing],
    ['garageName', 'Altul'],
    ['id', missing],
    ['deletedAt', '2026-10-01T00:00:00Z'],
    ['updatedBy', missing],
    ['updatedByRole', 'owner'],
    ['correctedBy', 'garage'],
    ['__proto__', { what: 'x' }],
  ])('answers 400 for %s = %p and changes nothing', async (field, value) => {
    const s = await scene();
    const row = await s.repair();

    const res = await send(
      'patch',
      one(row.id),
      s.auth.admin,
      JSON.parse(
        `{"${field}": ${JSON.stringify(value)}, "version": "${version(row)}"}`,
      ),
    );

    expect(res.status).toBe(400);
    expect(await reread(row.id)).toEqual(row);
    expect(await logOf(row.id)).toEqual([]);
  });

  it.each([
    ['a number', 1_761_000_000_000],
    ['null', null],
    ['an empty string', ''],
    ['a date without a time', '2026-10-01'],
    ['text', 'latest'],
    ['an array', ['2026-10-01T00:00:00.000Z']],
  ])('answers 400 for a version that is %s', async (_title, bad) => {
    const s = await scene();
    const row = await s.repair();

    const res = await send('patch', one(row.id), s.auth.admin, {
      odometerKm: 150_000,
      version: bad,
    });

    expect(res.status).toBe(400);
    expect(await reread(row.id)).toEqual(row);
  });

  it.each([
    ['an array', []],
    ['a list of bodies', [{ version: 'x' }]],
  ])('answers 400 for a body that is %s', async (_title, body) => {
    const s = await scene();
    const row = await s.repair();

    const res = await send('patch', one(row.id), s.auth.admin, body as never);

    expect(res.status).toBe(400);
    expect(await reread(row.id)).toEqual(row);
  });

  it('accepts every limit exactly at its cap', async () => {
    const s = await scene();
    const row = await s.repair({ shared: false });
    const today = localDay(new Date());

    const res = await send('patch', one(row.id), s.auth.admin, {
      costBani: 92_000_000,
      doneOn: today,
      odometerKm: 2_000_000,
      version: version(row),
      what: 'x'.repeat(200),
    });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      costBani: 92_000_000,
      doneOn: today,
      odometerKm: 2_000_000,
    });
    expect(res.body.what).toHaveLength(200);
  });

  it('accepts the lower limits exactly: one character, zero km, zero bani', async () => {
    const s = await scene();
    const row = await s.repair();

    const res = await send('patch', one(row.id), s.auth.admin, {
      costBani: 0,
      odometerKm: 0,
      version: version(row),
      what: 'a',
    });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ costBani: 0, odometerKm: 0, what: 'a' });
  });

  it('refuses the day after today', async () => {
    const s = await scene();
    const row = await s.repair();

    const res = await send('patch', one(row.id), s.auth.admin, {
      doneOn: addDays(localDay(new Date()), 1),
      version: version(row),
    });

    expect(res.status).toBe(400);
  });

  it('counts what was done in characters, so 200 emoji are not refused', async () => {
    const s = await scene();
    const row = await s.repair();

    const res = await send('patch', one(row.id), s.auth.admin, {
      version: version(row),
      what: '🔧'.repeat(200),
    });

    expect(res.status).toBe(200);
    expect([...res.body.what]).toHaveLength(200);
  });

  it('keeps unicode in what was done as written', async () => {
    const s = await scene();
    const row = await s.repair();

    const res = await send('patch', one(row.id), s.auth.admin, {
      version: version(row),
      what: 'Înlocuit șuruburi țeavă 🔧',
    });

    expect(res.status).toBe(200);
    expect((await reread(row.id)).what).toBe('Înlocuit șuruburi țeavă 🔧');
  });

  it('answers 400 for an invalid body on a malformed id, before the 404', async () => {
    const s = await scene();

    const res = await send('patch', one('not-a-uuid'), s.auth.admin, {
      version: 'x',
    });

    expect(res.status).toBe(400);
  });

  it('answers 404, not 409, for a stale version on a deleted repair', async () => {
    const s = await scene();
    const row = await s.repair({ deletedAt: new Date() });

    const res = await send('patch', one(row.id), s.auth.admin, {
      odometerKm: 1,
      version: '2000-01-01T00:00:00.000Z',
    });

    expect(res.status).toBe(404);
  });

  it('answers 404, not 409, for a stale version on a unknown repair', async () => {
    const s = await scene();

    const res = await send('patch', one(missing), s.auth.admin, {
      odometerKm: 1,
      version: '2000-01-01T00:00:00.000Z',
    });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('not_found');
  });

  it('corrects a repair shared with a garage that is not approved', async () => {
    const s = await scene();
    const row = await s.repair();
    await prisma.garage.update({
      data: { status: 'suspended' },
      where: { id: s.garage.id },
    });

    const res = await send('patch', one(row.id), s.auth.admin, {
      odometerKm: 150_000,
      version: version(row),
    });

    expect(res.status).toBe(200);
    expect((await reread(row.id)).updatedByRole).toBe('admin');
  });

  it('writes no open entry and no entry at all for a save that changes nothing', async () => {
    const s = await scene();
    const row = await s.repair();

    await send('patch', one(row.id), s.auth.admin, {
      odometerKm: 151_000,
      version: version(row),
    });

    expect(await logOf(row.id)).toEqual([]);
  });

  it('answers the same corrected repair when the same save is sent twice, the second as stale', async () => {
    const s = await scene();
    const row = await s.repair();
    const body = { odometerKm: 150_000, version: version(row) };

    const first = await send('patch', one(row.id), s.auth.admin, body);
    const second = await send('patch', one(row.id), s.auth.admin, body);

    expect(first.status).toBe(200);
    expect(second.status).toBe(409);
    expect(second.body.code).toBe('stale_version');
    expect(await logOf(row.id)).toHaveLength(1);
  });

  it('refuses a save sent as form data before reading the body', async () => {
    const s = await scene();
    const row = await s.repair();

    const res = await send('patch', one(row.id), s.auth.admin, undefined, {
      'Content-Type': 'application/x-www-form-urlencoded',
    }).send(`version=${version(row)}&what=Ulei`);

    expect(res.status).toBe(415);
    expect(res.body.code).toBe('unsupported_media_type');
    expect(await reread(row.id)).toEqual(row);
  });
});

describe('GET /admin/repairs/:id under repeated and hostile reads', () => {
  it('answers the same repair on a second read and records one open entry per read', async () => {
    const s = await scene();
    const row = await s.repair();

    const first = await get(one(row.id), s.auth.admin);
    const second = await get(one(row.id), s.auth.admin);

    expect(second.body).toEqual(first.body);
    expect(await logOf(row.id)).toHaveLength(2);
  });

  it('answers nothing of the driver, the plate or the garage id', async () => {
    const s = await scene();
    const row = await s.repair();

    const res = await get(one(row.id), s.auth.admin);
    const text = JSON.stringify(res.body);

    expect(Object.keys(res.body).sort()).toEqual([
      'car',
      'correctedBy',
      'costBani',
      'doneOn',
      'garageName',
      'id',
      'odometerKm',
      'version',
      'what',
    ]);
    expect(text).not.toContain(s.car.plate);
    expect(text).not.toContain('Andrei');
    expect(text).not.toContain(s.garage.id);
  });

  it('ignores a query string on the open', async () => {
    const s = await scene();
    const row = await s.repair();

    const res = await get(
      `${one(row.id)}?includeDeleted=true&id=${missing}`,
      s.auth.admin,
    );

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(row.id);
  });

  it('answers 404 for an id with url-encoded traversal', async () => {
    const s = await scene();

    const res = await get(one('%2e%2e%2faccounts'), s.auth.admin);

    expect(res.status).toBe(404);
  });
});

describe('GET /admin/accounts/:id/repairs under hostile ids and states', () => {
  it('answers an empty list for an account whose only repair is deleted', async () => {
    const s = await scene();
    await s.repair({ deletedAt: new Date() });

    const res = await get(list(s.driverId), s.auth.admin);

    expect(res.body).toEqual({ items: [], truncated: false });
  });

  it('answers exactly 200 repairs with truncated false at the cap', async () => {
    const s = await scene();
    await prisma.repair.createMany({
      data: Array.from({ length: 200 }, (_, index) => ({
        carId: s.car.id,
        costBani: 1,
        doneOn: new Date(Date.UTC(2020, 0, 1 + index)),
        garageName: 'Garaj Nordic',
        odometerKm: 1,
        source: 'logged' as const,
        what: `Lucrare ${index}`,
      })),
    });

    const res = await get(list(s.driverId), s.auth.admin);

    expect(res.body.items).toHaveLength(200);
    expect(res.body.truncated).toBe(false);
  });

  it('answers an empty list for an account that owns no car', async () => {
    const s = await scene();

    const res = await get(list(s.adminId), s.auth.admin);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ items: [], truncated: false });
  });

  it('answers 404 for url-encoded and padded account ids', async () => {
    const s = await scene();

    for (const id of ['%20', `${s.driverId}%0A`, `${s.driverId}%20`, '%00']) {
      expect((await get(list(id), s.auth.admin)).status).toBe(404);
    }
  });

  it('writes no open entry for the list', async () => {
    const s = await scene();
    const row = await s.repair();

    await get(list(s.driverId), s.auth.admin);

    expect(await logOf(row.id)).toEqual([]);
  });

  it('ignores query parameters that try to widen the list', async () => {
    const s = await scene();
    await s.repair({ deletedAt: new Date() });
    await s.repair({ source: 'motorfix' });

    const res = await get(
      `${list(s.driverId)}?includeDeleted=true&limit=5000&source=motorfix`,
      s.auth.admin,
    );

    expect(res.body).toEqual({ items: [], truncated: false });
  });
});

describe('DELETE /admin/repairs/:id under hostile calls', () => {
  it('answers 403 with a body and a query, changing nothing', async () => {
    const s = await scene();
    const row = await s.repair();

    const res = await send(
      'delete',
      `${one(row.id)}?force=true`,
      s.auth.admin,
      { force: true },
    );

    expect(res.status).toBe(403);
    expect(res.body.message).toBe('Doar șoferul poate șterge reparația');
    expect(await reread(row.id)).toEqual(row);
  });

  it('answers 403 twice for the same call', async () => {
    const s = await scene();
    const row = await s.repair();

    const first = await send('delete', one(row.id), s.auth.admin);
    const second = await send('delete', one(row.id), s.auth.admin);

    expect([first.status, second.status]).toEqual([403, 403]);
    expect(second.body).toEqual(first.body);
  });
});
