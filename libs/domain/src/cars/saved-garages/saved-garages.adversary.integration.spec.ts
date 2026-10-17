import { randomUUID } from 'node:crypto';

import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { SavedGaragesModule } from './saved-garages.module';
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

// @traces 290-FR-002
describe('the savedAt an undo sends', () => {
  it('accepts a time taken just before the call and keeps it', async () => {
    const { auth } = await driver();
    const garageId = await garage();
    const savedAt = new Date().toISOString();

    const res = await save(auth, garageId, { savedAt });

    expect(res.status).toBe(201);
    expect(res.body.savedAt).toBe(savedAt);
  });

  it('keeps the epoch as a far-past time', async () => {
    const { auth, id } = await driver();
    const garageId = await garage();

    const res = await save(auth, garageId, {
      savedAt: '1970-01-01T00:00:00.000Z',
    });

    expect(res.status).toBe(201);
    expect(res.body.savedAt).toBe('1970-01-01T00:00:00.000Z');
    expect((await rows(id))[0].savedAt.getTime()).toBe(0);
  });

  it('answers a year before 1900 with 201 or 400, never a server error', async () => {
    const { auth } = await driver();
    const garageId = await garage();

    const res = await save(auth, garageId, {
      savedAt: '0001-01-01T00:00:00.000Z',
    });

    expect([201, 400]).toContain(res.status);
  });

  it('stores an offset time as the same instant in UTC', async () => {
    const { auth } = await driver();
    const garageId = await garage();

    const res = await save(auth, garageId, {
      savedAt: '2020-01-01T02:00:00+02:00',
    });

    expect(res.status).toBe(201);
    expect(res.body.savedAt).toBe('2020-01-01T00:00:00.000Z');
  });

  it.each([
    'yesterday',
    '',
    ' ',
    '2026-02-30T00:00:00.000Z',
    '2026-13-01T00:00:00.000Z',
    '2026-01-01T25:00:00.000Z',
    'DROP TABLE saved_garage;--',
    '２０２０-01-01T00:00:00.000Z',
  ])('answers 400 for the unparsable %j', async (savedAt) => {
    const { auth, id } = await driver();
    const garageId = await garage();

    const res = await save(auth, garageId, { savedAt });

    expect(res.status).toBe(400);
    expect(await rows(id)).toHaveLength(0);
  });

  it.each([
    ['a number', 1_600_000_000_000],
    ['a boolean', true],
    ['an object', { at: 1 }],
    ['an array', ['2020-01-01T00:00:00.000Z']],
  ])('answers 400 when savedAt is %s', async (_name, savedAt) => {
    const { auth, id } = await driver();
    const garageId = await garage();

    const res = await save(auth, garageId, { savedAt });

    expect(res.status).toBe(400);
    expect(await rows(id)).toHaveLength(0);
  });

  it('answers 400 for a field other than savedAt', async () => {
    const { auth, id } = await driver();
    const garageId = await garage();

    const res = await save(auth, garageId, { accountId: randomUUID() });

    expect(res.status).toBe(400);
    expect(await rows(id)).toHaveLength(0);
  });

  it('answers 400 for a savedAt beside an extra field and stores nothing', async () => {
    const { auth, id } = await driver();
    const garageId = await garage();

    const res = await save(auth, garageId, {
      garageId: randomUUID(),
      savedAt: '2020-01-01T00:00:00.000Z',
    });

    expect(res.status).toBe(400);
    expect(await rows(id)).toHaveLength(0);
  });

  it('answers 422 for a time one minute ahead of the server', async () => {
    const { auth, id } = await driver();
    const garageId = await garage();

    const res = await save(auth, garageId, {
      savedAt: new Date(Date.now() + 60_000).toISOString(),
    });

    expect(res.status).toBe(422);
    expect(res.body.code).toBe('saved_at_in_future');
    expect(await rows(id)).toHaveLength(0);
    expect(await events('saved_garage.added')).toHaveLength(0);
  });

  it('answers 422 for a far-future time written with an offset', async () => {
    const { auth } = await driver();
    const garageId = await garage();

    const res = await save(auth, garageId, {
      savedAt: '2999-01-01T00:00:00+14:00',
    });

    expect(res.status).toBe(422);
    expect(res.body.code).toBe('saved_at_in_future');
  });

  it('answers 422 for a time that is only ahead because of its offset', async () => {
    const { auth } = await driver();
    const garageId = await garage();
    const local = new Date(Date.now() - 60 * 60_000)
      .toISOString()
      .replace(/\.\d+Z$/, '-05:00');

    const res = await save(auth, garageId, { savedAt: local });

    expect(res.status).toBe(422);
  });

  it('stores nothing and writes no entry for a draft garage with a future time', async () => {
    const { auth, id } = await driver();
    const garageId = await garage('draft');

    const res = await save(auth, garageId, {
      savedAt: new Date(Date.now() + 3_600_000).toISOString(),
    });

    expect([404, 422]).toContain(res.status);
    expect(await rows(id)).toHaveLength(0);
    expect(await entries(garageId)).toHaveLength(0);
  });
});

// @traces 290-FR-002
describe('saving twice', () => {
  it('answers 201 then 200 with the same body and one entry and one event', async () => {
    const { auth, id } = await driver();
    const garageId = await garage();

    const first = await save(auth, garageId);
    const second = await save(auth, garageId);
    const third = await save(auth, garageId, {});

    expect([first.status, second.status, third.status]).toEqual([
      201, 200, 200,
    ]);
    expect(second.body).toEqual(first.body);
    expect(third.body).toEqual(first.body);
    expect(await rows(id)).toHaveLength(1);
    expect(await entries(garageId)).toHaveLength(1);
    expect(await events('saved_garage.added')).toHaveLength(1);
  });

  it('keeps one row, one entry and one event across twenty simultaneous saves', async () => {
    const { auth, id } = await driver();
    const garageId = await garage();

    const answers = await Promise.all(
      Array.from({ length: 20 }, () => save(auth, garageId)),
    );

    expect(answers.filter((r) => r.status === 201)).toHaveLength(1);
    expect(answers.filter((r) => r.status === 200)).toHaveLength(19);
    expect(new Set(answers.map((r) => r.body.savedAt)).size).toBe(1);
    expect(await rows(id)).toHaveLength(1);
    expect(await entries(garageId)).toHaveLength(1);
    expect(await events('saved_garage.added')).toHaveLength(1);
  });

  it('lets two drivers save the same garage as two rows', async () => {
    const a = await driver();
    const b = await driver();
    const garageId = await garage();

    const [one, two] = await Promise.all([
      save(a.auth, garageId),
      save(b.auth, garageId),
    ]);

    expect([one.status, two.status]).toEqual([201, 201]);
    expect(await rows(a.id)).toHaveLength(1);
    expect(await rows(b.id)).toHaveLength(1);
  });

  it('answers 201 again for a save after a removal', async () => {
    const { auth } = await driver();
    const garageId = await garage();
    await save(auth, garageId);
    await remove(auth, garageId);

    const res = await save(auth, garageId);

    expect(res.status).toBe(201);
    expect(await events('saved_garage.added')).toHaveLength(2);
  });
});

// @traces 290-FR-004
describe('removing what was never saved', () => {
  it('answers 204 with an empty body and writes nothing for an approved garage', async () => {
    const { auth, id } = await driver();
    const garageId = await garage();

    const res = await remove(auth, garageId);

    expect(res.status).toBe(204);
    expect(res.text).toBe('');
    expect(await rows(id)).toHaveLength(0);
    expect(await entries(garageId)).toHaveLength(0);
    expect(await events('saved_garage.removed')).toHaveLength(0);
  });

  it.each(['draft', 'suspended'] as const)(
    'answers 204 for a %s garage',
    async (status) => {
      const { auth } = await driver();
      const garageId = await garage(status);

      const res = await remove(auth, garageId);

      expect(res.status).toBe(204);
    },
  );

  it('answers 204 for an id no garage has', async () => {
    const { auth } = await driver();

    const res = await remove(auth, randomUUID());

    expect(res.status).toBe(204);
  });

  it('answers 200 then 204 then 204 for three removals in a row', async () => {
    const { auth } = await driver();
    const garageId = await garage();
    await save(auth, garageId);

    const statuses = [
      (await remove(auth, garageId)).status,
      (await remove(auth, garageId)).status,
      (await remove(auth, garageId)).status,
    ];

    expect(statuses).toEqual([200, 204, 204]);
    expect(await events('saved_garage.removed')).toHaveLength(1);
  });

  it('answers 200 once and 204 for the rest of ten simultaneous removals', async () => {
    const { auth, id } = await driver();
    const garageId = await garage();
    await save(auth, garageId);

    const answers = await Promise.all(
      Array.from({ length: 10 }, () => remove(auth, garageId)),
    );

    expect(answers.filter((r) => r.status === 200)).toHaveLength(1);
    expect(answers.filter((r) => r.status === 204)).toHaveLength(9);
    expect(await rows(id)).toHaveLength(0);
    expect(
      (await entries(garageId)).filter((e) => e.action === 'delete'),
    ).toHaveLength(1);
    expect(await events('saved_garage.removed')).toHaveLength(1);
  });

  it('does not remove another driver’s row for the same garage', async () => {
    const a = await driver();
    const b = await driver();
    const garageId = await garage();
    await save(a.auth, garageId);

    const res = await remove(b.auth, garageId);

    expect(res.status).toBe(204);
    expect(await rows(a.id)).toHaveLength(1);
  });
});

// @traces 290-FR-002
describe('ids that are not garages', () => {
  it.each([
    'not-a-uuid',
    '123',
    'ids',
    '00000000-0000-0000-0000-00000000000g',
    '%E2%9C%93',
    `${randomUUID()}%20`,
  ])('answers 400 to save and remove for %s', async (bad) => {
    const { auth } = await driver();

    for (const res of [
      await http().put(`/me/saved-garages/${bad}`).set('Authorization', auth),
      await http()
        .delete(`/me/saved-garages/${bad}`)
        .set('Authorization', auth),
    ]) {
      expect(res.status).toBe(400);
    }
  });

  it('answers 404 with no garage name for an unknown id', async () => {
    const { auth } = await driver();
    const known = await garage('draft');
    const name = (
      await prisma.garage.findUniqueOrThrow({ where: { id: known } })
    ).name;

    const draft = await save(auth, known);
    const unknown = await save(auth, randomUUID());

    for (const res of [draft, unknown]) {
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('not_found');
      expect(JSON.stringify(res.body)).not.toContain(name);
      expect(JSON.stringify(res.body)).not.toContain(known);
    }
    expect(draft.body).toEqual(unknown.body);
  });
});

// @traces 290-FR-006
describe('roles on every route', () => {
  it('answers 403 rather than 404 to a staff account for a draft and an unknown garage', async () => {
    const id = await account(`staff${randomUUID().slice(0, 8)}`, ['garage']);
    const auth = bearer(id, 'garage');

    for (const garageId of [await garage('draft'), randomUUID()]) {
      const res = await save(auth, garageId);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('driver_role_required');
    }
  });

  it('answers 403 to a token claiming driver for an account that is not a driver', async () => {
    const id = await account(`staff${randomUUID().slice(0, 8)}`, ['garage']);
    const garageId = await garage();

    const res = await save(bearer(id, 'driver'), garageId);

    expect([401, 403]).toContain(res.status);
    expect(await rows(id)).toHaveLength(0);
  });

  it('answers 401 for a garbage bearer token on every route', async () => {
    const garageId = await garage();

    for (const res of [
      await http().put(path(garageId)).set('Authorization', 'Bearer nope'),
      await http().delete(path(garageId)).set('Authorization', 'Bearer nope'),
      await http()
        .get('/me/saved-garages/ids')
        .set('Authorization', 'Bearer nope'),
    ])
      expect(res.status).toBe(401);
  });

  it('answers 401 rather than 400 to a visitor with a bad id', async () => {
    const res = await save(null, 'not-a-uuid');

    expect(res.status).toBe(401);
  });
});

// @traces 290-FR-005
describe('the ids read', () => {
  it('lists three hundred saved garages, each once', async () => {
    const { auth, id } = await driver();
    const created = await Promise.all(
      Array.from({ length: 300 }, () => garage()),
    );
    await prisma.savedGarage.createMany({
      data: created.map((garageId) => ({ accountId: id, garageId })),
    });

    const res = await ids(auth);

    expect(res.status).toBe(200);
    expect([...res.body.ids].sort()).toEqual([...created].sort());
  });

  it('drops a garage after its removal and brings it back after the undo', async () => {
    const { auth } = await driver();
    const garageId = await garage();
    const saved = await save(auth, garageId);
    await remove(auth, garageId);
    const gone = await ids(auth);

    await save(auth, garageId, { savedAt: saved.body.savedAt });
    const back = await ids(auth);

    expect(gone.body).toEqual({ ids: [] });
    expect(back.body).toEqual({ ids: [garageId] });
  });

  it('sends no cache validator that would let a browser reuse the answer', async () => {
    const { auth } = await driver();

    const res = await ids(auth);

    expect(res.headers['cache-control'] ?? '').not.toMatch(/max-age=[1-9]/);
    expect(res.headers['cache-control'] ?? '').not.toMatch(/public/);
  });

  it('answers 304 never to a repeated read with the previous etag', async () => {
    const { auth } = await driver();
    const garageId = await garage();
    const first = await ids(auth);
    await save(auth, garageId);

    const second = await http()
      .get('/me/saved-garages/ids')
      .set('Authorization', auth)
      .set('If-None-Match', first.headers['etag'] ?? '"none"');

    expect(second.status).toBe(200);
    expect(second.body).toEqual({ ids: [garageId] });
  });
});
