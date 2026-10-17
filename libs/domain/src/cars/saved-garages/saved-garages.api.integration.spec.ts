import { randomUUID } from 'node:crypto';

import type { SavedGaragesPageDto } from '@motor-fix/contracts';
import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { SavedGaragesModule } from './saved-garages.module';
import { AuditService } from '../../audit/audit.service';
import { signAccessToken } from '../../auth/access-token';
import { AuthModule } from '../../auth/auth.module';
import type { Role } from '../../auth/capabilities';
import { serialDatabase } from '../../auth/serial-db.testing';
import { outboxMark } from '../../events/outbox.testing';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
} from '../../notifications/notifications.testing';

const redisUrl = redisUrlFor(15);
const tokenSecret = 'test-secret';
const { account, prisma, reset } = fixtures();
serialDatabase(databaseUrl);

let app: NestExpressApplication;
// The history and the outbox are never emptied: each test reads its own.
let since: Date;
let mark: bigint;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [
      AuthModule.register({ databaseUrl, redisUrl, tokenSecret }),
      SavedGaragesModule,
    ],
  }).compile();
  app = moduleRef.createNestApplication<NestExpressApplication>();
  app.useGlobalPipes(
    new ValidationPipe({
      forbidNonWhitelisted: true,
      transform: true,
      whitelist: true,
    }),
  );
  await app.init();
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await reset();
  const [{ now }] = await prisma.$queryRaw<
    { now: Date }[]
  >`SELECT clock_timestamp() AS now`;
  since = now;
  mark = await outboxMark(prisma);
});

afterEach(() => {
  jest.restoreAllMocks();
});

const http = () => request(app.getHttpServer());
const bearer = (accountId: string, role: Role) =>
  `Bearer ${signAccessToken({ accountId, role }, tokenSecret)}`;

let slugs = 0;
async function garage(status: 'approved' | 'draft' | 'suspended' = 'approved') {
  slugs += 1;
  const { id } = await prisma.garage.create({
    data: { name: `Service ${slugs}`, slug: `service-${slugs}`, status },
  });
  return id;
}

async function driver() {
  const id = await account(`sofer${randomUUID().slice(0, 8)}`, ['driver']);
  return { auth: bearer(id, 'driver'), id };
}

const path = (garageId: string) => `/me/saved-garages/${garageId}`;
const save = (auth: string | null, garageId: string, body?: object) => {
  const req = http().put(path(garageId));
  if (auth) req.set('Authorization', auth);
  return body === undefined ? req : req.send(body);
};
const remove = (auth: string | null, garageId: string) => {
  const req = http().delete(path(garageId));
  return auth ? req.set('Authorization', auth) : req;
};
const ids = (auth: string | null) => {
  const req = http().get('/me/saved-garages/ids');
  return auth ? req.set('Authorization', auth) : req;
};

const rows = (accountId: string) =>
  prisma.savedGarage.findMany({ where: { accountId } });
const entries = (garageId: string) =>
  prisma.activityLog.findMany({
    where: {
      at: { gte: since },
      subjectId: garageId,
      subjectType: 'saved_garage',
    },
  });
const events = (kind: string) =>
  prisma.outboxEvent.findMany({ where: { id: { gt: mark }, kind } });

// @traces 290-FR-001
// @traces 290-FR-002
// @traces 290-FR-007
// @traces 290-FR-008
// @traces 290-FR-017
describe('saving a garage', () => {
  it('answers 201 with the row and writes one entry and one event for the account', async () => {
    const { auth, id } = await driver();
    const garageId = await garage();

    const res = await save(auth, garageId);

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ garageId, savedAt: expect.any(String) });
    const [row] = await rows(id);
    expect(row.savedAt.toISOString()).toBe(res.body.savedAt);

    const audit = await entries(garageId);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: 'create',
      actorId: id,
      actorRole: 'driver',
      carId: null,
      garageId: null,
      jobId: null,
      newValue: { garageId, savedAt: res.body.savedAt },
    });

    const added = await events('saved_garage.added');
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({
      audience: [`account:${id}`],
      payload: { accountId: id, garageId, savedAt: res.body.savedAt },
    });
  });

  it('answers 200 with the first row on a second save and writes nothing more', async () => {
    const { auth, id } = await driver();
    const garageId = await garage();
    const first = await save(auth, garageId);

    const again = await save(auth, garageId, {
      savedAt: '2020-01-01T00:00:00.000Z',
    });

    expect(again.status).toBe(200);
    expect(again.body).toEqual(first.body);
    expect(await rows(id)).toHaveLength(1);
    expect(await entries(garageId)).toHaveLength(1);
    expect(await events('saved_garage.added')).toHaveLength(1);
  });

  it('leaves one row and no server error when two saves race', async () => {
    const { auth, id } = await driver();
    const garageId = await garage();

    const answers = await Promise.all([
      save(auth, garageId),
      save(auth, garageId),
    ]);

    expect(answers.map((r) => r.status).sort()).toEqual([200, 201]);
    expect(await rows(id)).toHaveLength(1);
    expect(await entries(garageId)).toHaveLength(1);
    expect(await events('saved_garage.added')).toHaveLength(1);
  });

  it('keeps a past savedAt sent by an undo', async () => {
    const { auth } = await driver();
    const garageId = await garage();
    const savedAt = '2026-01-02T03:04:05.678Z';

    const res = await save(auth, garageId, { savedAt });

    expect(res.status).toBe(201);
    expect(res.body.savedAt).toBe(savedAt);
  });

  it('answers 422 saved_at_in_future for a later time and stores nothing', async () => {
    const { auth, id } = await driver();
    const garageId = await garage();
    const savedAt = new Date(Date.now() + 60 * 60_000).toISOString();

    const res = await save(auth, garageId, { savedAt });

    expect(res.status).toBe(422);
    expect(res.body.code).toBe('saved_at_in_future');
    expect(await rows(id)).toHaveLength(0);
    expect(await events('saved_garage.added')).toHaveLength(0);
  });

  it('leaves no row and no event when the history cannot be written', async () => {
    const { auth, id } = await driver();
    const garageId = await garage();
    jest
      .spyOn(AuditService.prototype, 'record')
      .mockRejectedValue(new Error('history unavailable'));

    const res = await save(auth, garageId);

    expect(res.status).toBe(500);
    expect(await rows(id)).toHaveLength(0);
    expect(await events('saved_garage.added')).toHaveLength(0);
  });

  it.each([
    ['not an id', 'abc', undefined],
    ['a malformed time', undefined, { savedAt: 'yesterday' }],
    ['an unknown field', undefined, { note: 'x' }],
  ])('answers 400 for %s', async (_title, badId, body) => {
    const { auth, id } = await driver();
    const garageId = badId ?? (await garage());

    const res = await save(auth, garageId, body);

    expect(res.status).toBe(400);
    expect(await rows(id)).toHaveLength(0);
  });
});

// @traces 290-FR-003
describe('a garage that cannot be saved', () => {
  it.each(['draft', 'suspended'] as const)(
    'answers 404 not_found for a %s garage',
    async (status) => {
      const { auth, id } = await driver();
      const garageId = await garage(status);

      const res = await save(auth, garageId);

      expect(res.status).toBe(404);
      expect(res.body.code).toBe('not_found');
      expect(JSON.stringify(res.body)).not.toContain('Service');
      expect(await rows(id)).toHaveLength(0);
    },
  );

  it('answers 404 not_found for an unknown garage', async () => {
    const { auth, id } = await driver();

    const res = await save(auth, randomUUID());

    expect(res.status).toBe(404);
    expect(await rows(id)).toHaveLength(0);
  });
});

// @traces 290-FR-004
// @traces 290-FR-007
// @traces 290-FR-008
// @traces 290-FR-017
describe('removing a saved garage', () => {
  it('answers 200 with the removed time and writes one entry and one event', async () => {
    const { auth, id } = await driver();
    const garageId = await garage();
    const saved = await save(auth, garageId);

    const res = await remove(auth, garageId);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(saved.body);
    expect(await rows(id)).toHaveLength(0);
    const audit = (await entries(garageId)).filter(
      (e) => e.action === 'delete',
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actorId: id,
      garageId: null,
      oldValue: saved.body,
    });
    const removed = await events('saved_garage.removed');
    expect(removed).toHaveLength(1);
    expect(removed[0]).toMatchObject({
      audience: [`account:${id}`],
      payload: { accountId: id, ...saved.body },
    });
  });

  it('answers 204 when nothing was saved and writes nothing', async () => {
    const { auth } = await driver();
    const garageId = await garage();

    const res = await remove(auth, garageId);

    expect(res.status).toBe(204);
    expect(await entries(garageId)).toHaveLength(0);
    expect(await events('saved_garage.removed')).toHaveLength(0);
  });

  it('removes a garage suspended since it was saved', async () => {
    const { auth, id } = await driver();
    const garageId = await garage();
    await save(auth, garageId);
    await prisma.garage.update({
      data: { status: 'suspended' },
      where: { id: garageId },
    });

    expect((await remove(auth, garageId)).status).toBe(200);
    expect(await rows(id)).toHaveLength(0);
  });

  it('restores the first time when the undo sends it back', async () => {
    const { auth } = await driver();
    const garageId = await garage();
    const saved = await save(auth, garageId, {
      savedAt: '2026-03-04T05:06:07.890Z',
    });
    const removed = await remove(auth, garageId);

    const undone = await save(auth, garageId, {
      savedAt: removed.body.savedAt,
    });

    expect(undone.status).toBe(201);
    expect(undone.body).toEqual(saved.body);
  });

  it("touches only the actor's own row", async () => {
    const one = await driver();
    const other = await driver();
    const garageId = await garage();
    await save(one.auth, garageId);

    expect((await remove(other.auth, garageId)).status).toBe(204);
    expect(await rows(one.id)).toHaveLength(1);
  });
});

// @traces 290-FR-005
describe('reading the saved ids', () => {
  it('answers an empty list for a driver with nothing saved', async () => {
    const { auth } = await driver();

    const res = await ids(auth);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ids: [] });
  });

  it('lists every saved garage, a since suspended one included, and no one else’s', async () => {
    const { auth } = await driver();
    const other = await driver();
    const [a, b, c] = [await garage(), await garage(), await garage()];
    for (const g of [a, b]) await save(auth, g);
    await save(other.auth, c);
    await prisma.garage.update({
      data: { status: 'suspended' },
      where: { id: b },
    });

    const res = await ids(auth);

    expect(res.status).toBe(200);
    expect([...res.body.ids].sort()).toEqual([a, b].sort());
  });
});

// @traces 290-FR-006
// @traces 290-FR-017
describe('who may use the routes', () => {
  const calls = (auth: string | null, garageId: string) => [
    save(auth, garageId),
    remove(auth, garageId),
    ids(auth),
  ];

  it.each(['garage', 'receptionist', 'mechanic', 'admin'] as const)(
    'answers 403 driver_role_required to the %s role',
    async (role) => {
      const id = await account(`staff${randomUUID().slice(0, 8)}`, [role]);
      const garageId = await garage();

      for (const res of await Promise.all(calls(bearer(id, role), garageId))) {
        expect(res.status).toBe(403);
        expect(res.body.code).toBe('driver_role_required');
      }
      expect(await rows(id)).toHaveLength(0);
    },
  );

  it('answers 403 to a driver acting in another role', async () => {
    const id = await account(`both${randomUUID().slice(0, 8)}`, [
      'driver',
      'garage',
    ]);
    const garageId = await garage();

    for (const res of await Promise.all(
      calls(bearer(id, 'garage'), garageId),
    )) {
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('driver_role_required');
    }
    expect(await rows(id)).toHaveLength(0);
  });

  it('answers 401 sign_in_required without a session', async () => {
    const garageId = await garage();

    for (const res of await Promise.all(calls(null, garageId))) {
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('sign_in_required');
    }
    expect(await events('saved_garage.added')).toHaveLength(0);
  });
});

type Fuel = 'petrol' | 'diesel' | 'hybrid' | 'electric';
const CLUJ = { lat: 46.771, lng: 23.624 };

// Names are unique in the catalogue, so a test reuses one already there.
async function brand(name: string) {
  const kept = await prisma.brand.findFirst({ where: { name } });
  if (kept) return kept.id;
  const key = `${name.toLowerCase()}-${randomUUID().slice(0, 8)}`;
  const row = await prisma.brand.create({ data: { key, name, slug: key } });
  return row.id;
}

let made = 0;
async function car(
  ownerId: string,
  brandId: string,
  fuel: Fuel = 'petrol',
  removed = false,
) {
  made += 1;
  // Newest first is by creation time: each car a second after the last.
  const createdAt = new Date(Date.UTC(2026, 0, 1, 0, 0, made));
  return prisma.car.create({
    data: {
      brandId,
      createdAt,
      fuel,
      idempotencyKey: randomUUID(),
      model: 'Model',
      odometerKm: 10_000,
      ownerId,
      removedAt: removed ? new Date() : null,
      year: 2020,
    },
  });
}

async function takes(
  garageId: string,
  brandId: string,
  stance: 'works_on' | 'does_not_take' = 'works_on',
  fuels: Partial<Record<Fuel, boolean>> = {},
) {
  // A refusal ticks no fuel (garage_brand_fuel_check).
  const none = stance === 'does_not_take' && {
    diesel: false,
    electric: false,
    hybrid: false,
    petrol: false,
  };
  await prisma.garageBrand.create({
    data: { brandId, garageId, stance, ...none, ...fuels },
  });
}

async function placed(extra: Record<string, unknown> = {}) {
  slugs += 1;
  const { id } = await prisma.garage.create({
    data: {
      name: `Service ${slugs}`,
      slug: `service-${slugs}`,
      status: 'approved',
      ...extra,
    },
  });
  return id;
}

// Saved a minute apart, the first given oldest.
async function saved(accountId: string, garageIds: string[]) {
  const start = Date.UTC(2026, 5, 1);
  await prisma.savedGarage.createMany({
    data: garageIds.map((garageId, i) => ({
      accountId,
      garageId,
      savedAt: new Date(start + i * 60_000),
    })),
  });
}

const list = (auth: string | null, query = '') => {
  const req = http().get(`/me/saved-garages${query ? `?${query}` : ''}`);
  return auth ? req.set('Authorization', auth) : req;
};
const item = (body: SavedGaragesPageDto, garageId: string) =>
  body.items.find((row) => row.garageId === garageId);

// @traces 291-FR-001
// @traces 291-FR-002
// @traces 291-FR-003
// @traces 291-FR-015
describe('reading the saved garages', () => {
  it('answers an empty page for a driver with nothing saved', async () => {
    const { auth } = await driver();

    const res = await list(auth);

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toEqual({
      items: [],
      nextCursor: null,
      total: 0,
      workingCount: 0,
    });
  });

  // @traces 291-FR-005
  it('records no audit entry for a read', async () => {
    const { auth, id } = await driver();
    const garage = await placed();
    await saved(id, [garage]);
    const before = await prisma.activityLog.count();

    const res = await list(auth);

    expect(res.status).toBe(200);
    expect(await prisma.activityLog.count()).toBe(before);
  });

  it("answers each row with the garage's own fields, newest saved first", async () => {
    const { auth, id } = await driver();
    const older = await placed({
      businessKind: 'company',
      rating: 4.9,
      reviewCount: 31,
    });
    const newer = await placed();
    await saved(id, [older, newer]);

    const res = await list(auth);

    expect(res.status).toBe(200);
    expect(
      res.body.items.map((row: { garageId: string }) => row.garageId),
    ).toEqual([newer, older]);
    expect(item(res.body, older)).toEqual({
      available: true,
      brands: [],
      businessKind: 'company',
      garageId: older,
      name: expect.stringMatching(/^Service /),
      rating: 4.9,
      reviewCount: 31,
      savedAt: '2026-06-01T00:00:00.000Z',
      slug: expect.stringMatching(/^service-/),
    });
    expect(item(res.body, newer)).toMatchObject({
      businessKind: null,
      rating: null,
      reviewCount: 0,
    });
  });

  it('names a brand the garage works on with the car’s fuel ticked', async () => {
    const { auth, id } = await driver();
    const bmw = await brand('BMW');
    await car(id, bmw, 'diesel');
    const yes = await placed();
    const refuses = await placed();
    const unmarked = await placed();
    const unticked = await placed();
    await takes(yes, bmw);
    await takes(refuses, bmw, 'does_not_take');
    await takes(unticked, bmw, 'works_on', { diesel: false });
    await saved(id, [yes, refuses, unmarked, unticked]);

    const res = await list(auth);

    expect(item(res.body, yes)?.brands).toEqual([{ id: bmw, name: 'BMW' }]);
    expect(item(res.body, refuses)?.brands).toEqual([]);
    expect(item(res.body, unmarked)?.brands).toEqual([]);
    expect(item(res.body, unticked)?.brands).toEqual([]);
    expect(res.body.total).toBe(4);
    expect(res.body.workingCount).toBe(1);
  });

  it('names a brand once for two cars of it, counting either car’s fuel', async () => {
    const { auth, id } = await driver();
    const bmw = await brand('BMW');
    await car(id, bmw, 'diesel');
    await car(id, bmw, 'petrol');
    const garageId = await placed();
    await takes(garageId, bmw, 'works_on', { diesel: false });
    await saved(id, [garageId]);

    const res = await list(auth);

    expect(item(res.body, garageId)?.brands).toEqual([
      { id: bmw, name: 'BMW' },
    ]);
  });

  it('orders the brands by the driver’s newest car first', async () => {
    const { auth, id } = await driver();
    const dacia = await brand('Dacia');
    const bmw = await brand('BMW');
    const mini = await brand('Mini');
    await car(id, dacia);
    await car(id, bmw);
    await car(id, mini);
    const garageId = await placed();
    for (const each of [dacia, bmw, mini]) await takes(garageId, each);
    await saved(id, [garageId]);

    const res = await list(auth);

    expect(
      item(res.body, garageId)?.brands.map((b: { name: string }) => b.name),
    ).toEqual(['Mini', 'BMW', 'Dacia']);
  });

  it('leaves out a removed car, and names nothing for a driver with no car', async () => {
    const { auth, id } = await driver();
    const bmw = await brand('BMW');
    await car(id, bmw, 'petrol', true);
    const garageId = await placed();
    await takes(garageId, bmw);
    await saved(id, [garageId]);

    const res = await list(auth);

    expect(item(res.body, garageId)?.brands).toEqual([]);
    expect(res.body.workingCount).toBe(0);
  });

  it('never counts another driver’s cars or shows another driver’s rows', async () => {
    const me = await driver();
    const other = await driver();
    const bmw = await brand('BMW');
    await car(other.id, bmw);
    const mine = await placed();
    const theirs = await placed();
    await takes(mine, bmw);
    await saved(me.id, [mine]);
    await saved(other.id, [mine, theirs]);

    const res = await list(me.auth);

    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).toMatchObject({ brands: [], garageId: mine });
    expect(res.body.total).toBe(1);
  });

  // @traces 291-FR-002
  it('keeps suspended and draft garages, marked not available', async () => {
    const { auth, id } = await driver();
    const approved = await placed();
    const suspended = await placed({ status: 'suspended' });
    const draft = await placed({ status: 'draft' });
    await saved(id, [approved, suspended, draft]);

    const res = await list(auth);

    expect(res.body.total).toBe(3);
    expect(item(res.body, approved)?.available).toBe(true);
    expect(item(res.body, suspended)?.available).toBe(false);
    expect(item(res.body, draft)?.available).toBe(false);
  });
});

// @traces 291-FR-001
// @traces 291-FR-015
describe('paging the saved garages', () => {
  async function many(n: number) {
    const { auth, id } = await driver();
    const garageIds: string[] = [];
    for (let i = 0; i < n; i += 1) garageIds.push(await placed());
    await saved(id, garageIds);
    return { auth, garageIds, id };
  }

  it('answers 20 rows and a cursor, then the rest, counts over the whole list', async () => {
    const { auth, garageIds } = await many(21);

    const first = await list(auth);

    expect(first.body.items).toHaveLength(20);
    expect(first.body.total).toBe(21);
    expect(first.body.nextCursor).toEqual(expect.any(String));
    const second = await list(
      auth,
      `cursor=${encodeURIComponent(first.body.nextCursor)}`,
    );
    expect(second.status).toBe(200);
    expect(
      second.body.items.map((r: { garageId: string }) => r.garageId),
    ).toEqual([garageIds[0]]);
    expect(second.body.nextCursor).toBeNull();
    expect(second.body.total).toBe(21);
  });

  it('orders rows saved at the same time by garage id, newest id first', async () => {
    const { auth, id } = await driver();
    const a = await placed();
    const b = await placed();
    const at = new Date('2026-06-01T00:00:00.000Z');
    await prisma.savedGarage.createMany({
      data: [a, b].map((garageId) => ({
        accountId: id,
        garageId,
        savedAt: at,
      })),
    });

    const res = await list(auth);

    expect(res.body.items.map((r: { garageId: string }) => r.garageId)).toEqual(
      [a, b].sort().reverse(),
    );
  });

  it('keeps paging after the cursor’s own row was removed, skipping nothing', async () => {
    const { auth, garageIds, id } = await many(22);
    const first = await list(auth);
    const last = first.body.items[19].garageId;
    await prisma.savedGarage.delete({
      where: { accountId_garageId: { accountId: id, garageId: last } },
    });

    const second = await list(
      auth,
      `cursor=${encodeURIComponent(first.body.nextCursor)}`,
    );

    expect(second.status).toBe(200);
    expect(
      second.body.items.map((r: { garageId: string }) => r.garageId),
    ).toEqual([garageIds[1], garageIds[0]]);
  });

  it.each([
    ['a cursor that is not base64 JSON', 'not-a-cursor'],
    [
      'a cursor of the wrong shape',
      Buffer.from('{"x":1}').toString('base64url'),
    ],
    [
      'a cursor with a bad time',
      Buffer.from(`{"at":"soon","id":"${randomUUID()}"}`).toString('base64url'),
    ],
    [
      'a cursor with a bad id',
      Buffer.from('{"at":"2026-06-01T00:00:00.000Z","id":"x"}').toString(
        'base64url',
      ),
    ],
  ])('answers 400 invalid_cursor to %s', async (_, cursor) => {
    const { auth } = await driver();

    const res = await list(auth, `cursor=${encodeURIComponent(cursor)}`);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_cursor');
  });

  it('answers 400 to a cursor over 200 characters', async () => {
    const { auth } = await driver();

    const res = await list(auth, `cursor=${'a'.repeat(201)}`);

    expect(res.status).toBe(400);
  });
});

// @traces 291-FR-004
// @traces 291-FR-015
describe('the distance from a place', () => {
  const near = `near=${CLUJ.lat},${CLUJ.lng}`;

  it('answers the km to one decimal with a place, and no distance without one', async () => {
    const { auth, id } = await driver();
    // About 2.4 km north, far beyond any search radius for the second.
    const close = await placed({
      latitude: CLUJ.lat + 0.0216,
      longitude: CLUJ.lng,
    });
    const far = await placed({ latitude: 44.43, longitude: 26.1 });
    const unplaced = await placed();
    await saved(id, [close, far, unplaced]);

    const withPlace = await list(auth, near);
    const without = await list(auth);

    expect(item(withPlace.body, close)?.distanceKm).toBe(2.4);
    expect(item(withPlace.body, far)?.distanceKm).toBeGreaterThan(300);
    expect(item(withPlace.body, unplaced)?.distanceKm).toBeNull();
    expect(item(withPlace.body, close)).not.toHaveProperty('comesToYou');
    for (const row of without.body.items) {
      expect(row).not.toHaveProperty('distanceKm');
      expect(row).not.toHaveProperty('comesToYou');
    }
  });

  it('says whether a mobile mechanic comes to the place, never its distance', async () => {
    const { auth, id } = await driver();
    const mobile = {
      businessKind: 'mobile',
      seatAddress: 'Strada Sediului 1, Cluj-Napoca',
    };
    // 15 km away: inside the 20 km default, outside a 10 km area.
    const away = { latitude: CLUJ.lat + 0.135, longitude: CLUJ.lng };
    const inside = await placed({ ...mobile, ...away });
    const outside = await placed({ ...mobile, ...away, serviceRadiusKm: 10 });
    const seatless = await placed(mobile);
    await saved(id, [inside, outside, seatless]);

    const res = await list(auth, near);

    expect(item(res.body, inside)).toMatchObject({
      comesToYou: true,
      distanceKm: null,
    });
    expect(item(res.body, outside)).toMatchObject({
      comesToYou: false,
      distanceKm: null,
    });
    expect(item(res.body, seatless)).toMatchObject({
      comesToYou: false,
      distanceKm: null,
    });
  });

  it.each([
    ['a place outside Romania', 'near=47.498,19.040'],
    ['a malformed place', 'near=46.771'],
  ])('answers 400 to %s', async (_, query) => {
    const { auth } = await driver();

    const res = await list(auth, query);

    expect(res.status).toBe(400);
  });
});

// @traces 291-FR-001
describe('who may read the saved garages', () => {
  it.each(['garage', 'receptionist', 'mechanic', 'admin'] as const)(
    'answers 403 driver_role_required to the %s role',
    async (role) => {
      const id = await account(`staff${randomUUID().slice(0, 8)}`, [role]);

      const res = await list(bearer(id, role));

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('driver_role_required');
    },
  );

  it('answers 401 sign_in_required without a session', async () => {
    const res = await list(null);

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('sign_in_required');
  });
});
