import { randomUUID } from 'node:crypto';

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
