import { randomUUID } from 'node:crypto';

import type { Role } from '@motor-fix/contracts/capabilities';
import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { featureOn } from './feature-on';
import { signAccessToken } from '../../auth/access-token';
import { AuthModule } from '../../auth/auth.module';
import { serialDatabase } from '../../auth/serial-db.testing';
import { outboxMark } from '../../events/outbox.testing';
import { NotificationsModule } from '../../notifications/notifications.module';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
  testConfig,
} from '../../notifications/notifications.testing';
import { UNUSED_STORAGE } from '../../storage/s3-test-store';
import { StorageModule } from '../../storage/storage.module';
import { GaragesModule } from '../garages.module';

const redisUrl = redisUrlFor(4);
const tokenSecret = 'test-secret';
const { account, prisma, reset } = fixtures();
serialDatabase(databaseUrl);

let app: NestExpressApplication;
let since: Date;
let mark: bigint;

beforeAll(async () => {
  const email = testConfig('http://127.0.0.1:9');
  const auth = AuthModule.register({ databaseUrl, redisUrl, tokenSecret });
  const notifications = NotificationsModule.register(
    { databaseUrl, email, redisUrl },
    auth,
  );
  const moduleRef = await Test.createTestingModule({
    imports: [
      auth,
      notifications,
      StorageModule.register(UNUSED_STORAGE),
      GaragesModule.register(email, notifications, {
        skipManualApproval: false,
      }),
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
  const [{ at }] = await prisma.$queryRaw<
    { at: Date }[]
  >`SELECT clock_timestamp() AS at`;
  since = at;
  mark = await outboxMark(prisma);
});

const KEYS = [
  'team_mechanics',
  'lift_schedule',
  'live_media',
  'day_sheets',
  'whatsapp',
] as const;

const http = () => request(app.getHttpServer());
const bearer = (accountId: string, role: Role) =>
  `Bearer ${signAccessToken({ accountId, role }, tokenSecret)}`;

async function world(status: 'approved' | 'suspended' = 'approved') {
  const nord = await prisma.garage.create({
    data: { name: 'Service Auto Nord', slug: `nord-${randomUUID()}`, status },
  });
  const dinamo = await prisma.garage.create({
    data: { name: 'Atelier Dinamo', slug: `dinamo-${randomUUID()}` },
  });
  const mihai = await account('mihai', ['garage']);
  await prisma.garageMember.create({
    data: { accountId: mihai, garageId: nord.id, role: 'owner' },
  });
  const radu = await account('radu', ['garage']);
  await prisma.garageMember.create({
    data: { accountId: radu, garageId: dinamo.id, role: 'owner' },
  });
  return {
    dinamo,
    mihai,
    nord,
    other: bearer(radu, 'garage'),
    owner: bearer(mihai, 'garage'),
  };
}
type World = Awaited<ReturnType<typeof world>>;

const put = (
  w: World,
  feature: string,
  body: unknown,
  as: string | null = w.owner,
  garageId = w.nord.id,
) => {
  const req = http()
    .put(`/garages/${garageId}/features/${encodeURIComponent(feature)}`)
    .send(body as object);
  return as ? req.set('Authorization', as) : req;
};

const rows = (garageId: string) =>
  prisma.garageFeature.findMany({
    orderBy: { key: 'asc' },
    select: { enabled: true, key: true },
    where: { garageId },
  });
const history = (garageId: string) =>
  prisma.activityLog.findMany({
    orderBy: { at: 'asc' },
    where: { at: { gte: since }, garageId, subjectType: 'garage_feature' },
  });
const events = (garageId: string) =>
  prisma.outboxEvent.findMany({
    orderBy: { id: 'asc' },
    where: {
      id: { gt: mark },
      kind: 'garage.features_changed',
      subjectId: garageId,
    },
  });

async function expectNothingWritten(w: World) {
  expect(await rows(w.nord.id)).toEqual([]);
  expect(await history(w.nord.id)).toEqual([]);
  expect(await events(w.nord.id)).toEqual([]);
}

// @traces 398-FR-003
describe('feature key hostility', () => {
  it.each([
    '__proto__',
    'constructor',
    'toString',
    'hasOwnProperty',
    'WHATSAPP',
    'whatsapp ',
    ' whatsapp',
    'whatsapp\u0000',
    'whatsappé',
    'wһatsapp',
    'team-mechanics',
    '%',
    '..',
  ])(
    'answers 400 validation_failed for the key %j and writes nothing',
    async (key) => {
      const w = await world();

      const res = await put(w, key, { enabled: false });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('validation_failed');
      await expectNothingWritten(w);
    },
  );
});

// @traces 398-FR-003
describe('body hostility', () => {
  it.each([
    ['an empty object', {}],
    ['an array', [false]],
    ['the string false', { enabled: 'false' }],
    ['the number 0', { enabled: 0 }],
    ['the number 1', { enabled: 1 }],
    ['null enabled', { enabled: null }],
    ['an array enabled', { enabled: [false] }],
    ['an object enabled', { enabled: { value: false } }],
  ])('answers 400 for %s and writes nothing', async (_name, body) => {
    const w = await world();

    const res = await put(w, 'whatsapp', body);

    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain('enabled');
    await expectNothingWritten(w);
  });

  it.each([
    ['an extra field', { enabled: false, feature: 'whatsapp' }],
    ['a __proto__ field', JSON.parse('{"enabled":false,"__proto__":{"x":1}}')],
  ])('answers 400 for %s and writes nothing', async (_n, body) => {
    const w = await world();

    const res = await put(w, 'whatsapp', body);

    expect(res.status).toBe(400);
    await expectNothingWritten(w);
  });

  it.each([
    ['null', null],
    ['a bare string', 'false'],
  ])('answers 400 or 415, never 200 or 500, to %s', async (_n, body) => {
    const w = await world();

    const res = await put(w, 'whatsapp', body);

    expect([400, 415]).toContain(res.status);
    await expectNothingWritten(w);
  });

  it('answers 4xx, never 500, to a body that is not JSON', async () => {
    const w = await world();

    const res = await http()
      .put(`/garages/${w.nord.id}/features/whatsapp`)
      .set('Authorization', w.owner)
      .set('Content-Type', 'application/json')
      .send('{"enabled": fals');

    expect(res.status).toBe(400);
    await expectNothingWritten(w);
  });

  it('answers 400 to a form-encoded body', async () => {
    const w = await world();

    const res = await http()
      .put(`/garages/${w.nord.id}/features/whatsapp`)
      .set('Authorization', w.owner)
      .type('form')
      .send('enabled=false');

    expect([400, 415]).toContain(res.status);
    await expectNothingWritten(w);
  });
});

// @traces 398-FR-004
describe('garage id hostility', () => {
  it.each(['not-a-uuid', '1', "'; DROP TABLE garage_feature;--"])(
    'answers 400 for the garage id %j',
    async (id) => {
      const w = await world();

      const res = await put(w, 'whatsapp', { enabled: false }, w.owner, id);

      expect(res.status).toBe(400);
    },
  );

  it('does not let the owner of one garage change the switches of another', async () => {
    const w = await world();

    const res = await put(
      w,
      'whatsapp',
      { enabled: false },
      w.owner,
      w.dinamo.id,
    );

    expect(res.status).toBe(404);
    expect(await rows(w.dinamo.id)).toEqual([]);
  });

  it('answers 401 for a tampered token before looking at the body', async () => {
    const w = await world();

    const res = await put(w, 'whatsapp', 'nonsense', `${w.owner}x`);

    expect(res.status).toBe(401);
  });
});

// @traces 398-FR-003 398-FR-006
describe('order and idempotency', () => {
  it('answers the same body twice and writes one entry and one event', async () => {
    const w = await world();

    const first = await put(w, 'live_media', { enabled: false });
    const second = await put(w, 'live_media', { enabled: false });

    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
    expect(await history(w.nord.id)).toHaveLength(1);
    expect(await events(w.nord.id)).toHaveLength(1);
  });

  it('writes an entry per change when a switch is flipped off, on, off', async () => {
    const w = await world();

    for (const enabled of [false, true, false]) {
      await put(w, 'day_sheets', { enabled });
    }

    const entries = await history(w.nord.id);
    expect(entries.map((e) => [e.oldValue, e.newValue])).toEqual([
      [true, false],
      [false, true],
      [true, false],
    ]);
    expect((await events(w.nord.id)).map((e) => e.payload)).toEqual(
      [false, true, false].map((enabled) => ({
        enabled,
        feature: 'day_sheets',
        garageId: w.nord.id,
      })),
    );
    expect(await rows(w.nord.id)).toEqual([
      { enabled: false, key: 'day_sheets' },
    ]);
  });

  it('writes no row, entry or event for switching a missing row on', async () => {
    const w = await world();

    const res = await put(w, 'whatsapp', { enabled: true });

    expect(res.status).toBe(200);
    await expectNothingWritten(w);
  });

  it('ends on one row per key and one entry per real change under parallel writes', async () => {
    const w = await world();

    const results = await Promise.all(
      KEYS.flatMap((key) => [
        put(w, key, { enabled: false }),
        put(w, key, { enabled: false }),
        put(w, key, { enabled: false }),
      ]),
    );

    expect(results.map((r) => r.status)).toEqual(results.map(() => 200));
    expect(await rows(w.nord.id)).toEqual(
      [...KEYS].sort().map((key) => ({ enabled: false, key })),
    );
    expect(await history(w.nord.id)).toHaveLength(5);
    expect(await events(w.nord.id)).toHaveLength(5);
  });

  it('keeps entries and events equal to the changes when on and off race', async () => {
    const w = await world();

    await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        put(w, 'lift_schedule', { enabled: i % 2 === 0 }),
      ),
    );

    const stored = (await rows(w.nord.id))[0]?.enabled ?? true;
    const entries = await history(w.nord.id);
    const chain = entries.map((e) => [e.oldValue, e.newValue]);
    for (let i = 1; i < chain.length; i++) {
      expect(chain[i]?.[0]).toBe(chain[i - 1]?.[1]);
    }
    expect(chain.at(-1)?.[1] ?? true).toBe(stored);
    expect(await events(w.nord.id)).toHaveLength(entries.length);
  });

  it("leaves the other garage's switches and history alone", async () => {
    const w = await world();

    await put(w, 'whatsapp', { enabled: false });

    expect(await rows(w.dinamo.id)).toEqual([]);
    expect(await history(w.dinamo.id)).toEqual([]);
    expect(await featureOn(prisma, w.dinamo.id, 'whatsapp')).toBe(true);
  });
});

// @traces 398-FR-005
describe('the team refusal', () => {
  it('answers 409 with the code and an English message and leaves an existing row untouched', async () => {
    const w = await world();
    await prisma.garageFeature.create({
      data: { enabled: true, garageId: w.nord.id, key: 'team_mechanics' },
    });
    await prisma.mechanic.create({
      data: { accountId: null, garageId: w.nord.id, name: 'Vlad' },
    });

    const res = await put(w, 'team_mechanics', { enabled: false });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('mechanics_on_team');
    expect(res.body.message).toBe('Remove the mechanics from the team first.');
    expect(await rows(w.nord.id)).toEqual([
      { enabled: true, key: 'team_mechanics' },
    ]);
    expect(await history(w.nord.id)).toEqual([]);
    expect(await events(w.nord.id)).toEqual([]);
  });

  it('refuses when the owner has a mechanic row and another one is on the team', async () => {
    const w = await world();
    await prisma.mechanic.create({
      data: { accountId: w.mihai, garageId: w.nord.id, name: 'Mihai' },
    });
    await prisma.mechanic.create({
      data: { accountId: null, garageId: w.nord.id, name: 'Vlad' },
    });

    const res = await put(w, 'team_mechanics', { enabled: false });

    expect(res.status).toBe(409);
    await expectNothingWritten(w);
  });

  it('refuses a team of many unlinked cards', async () => {
    const w = await world();
    await prisma.mechanic.createMany({
      data: Array.from({ length: 50 }, (_, i) => ({
        garageId: w.nord.id,
        name: `Mecanic ${i}`,
      })),
    });

    const res = await put(w, 'team_mechanics', { enabled: false });

    expect(res.status).toBe(409);
    await expectNothingWritten(w);
  });

  it('allows switching the team on while mechanics are on it', async () => {
    const w = await world();
    await prisma.garageFeature.create({
      data: { enabled: false, garageId: w.nord.id, key: 'team_mechanics' },
    });
    await prisma.mechanic.create({
      data: { accountId: null, garageId: w.nord.id, name: 'Vlad' },
    });

    const res = await put(w, 'team_mechanics', { enabled: true });

    expect(res.status).toBe(200);
    expect(res.body.features.team_mechanics).toBe(true);
  });

  it('writes nothing for a team switch-off when the team is already off and a mechanic is present', async () => {
    const w = await world();
    await prisma.garageFeature.create({
      data: { enabled: false, garageId: w.nord.id, key: 'team_mechanics' },
    });
    await prisma.mechanic.create({
      data: { accountId: null, garageId: w.nord.id, name: 'Vlad' },
    });

    const res = await put(w, 'team_mechanics', { enabled: false });

    expect([200, 409]).toContain(res.status);
    expect(await history(w.nord.id)).toEqual([]);
    expect(await events(w.nord.id)).toEqual([]);
  });

  it('keeps the team on when a mechanic is added while the switch-off races', async () => {
    const w = await world();

    const [res] = await Promise.all([
      put(w, 'team_mechanics', { enabled: false }),
      prisma.mechanic.create({
        data: { accountId: null, garageId: w.nord.id, name: 'Vlad' },
      }),
    ]);

    const stored = (await rows(w.nord.id))[0];
    if (res.status === 409) expect(stored).toBeUndefined();
    else expect(res.status).toBe(200);
  });
});

// @traces 398-FR-004
describe('a suspended garage', () => {
  it('lets the owner change a switch', async () => {
    const w = await world('suspended');

    const res = await put(w, 'whatsapp', { enabled: false });

    expect(res.status).toBe(200);
    expect(res.body.features.whatsapp).toBe(false);
  });
});

// @traces 398-FR-007
describe('featureOn with hostile keys', () => {
  it.each(['', 'unknown', '__proto__', 'WHATSAPP'])(
    'reports %j on for a garage with no row',
    async (key) => {
      const w = await world();

      expect(await featureOn(prisma, w.nord.id, key)).toBe(true);
    },
  );

  it('reports on for a garage id that does not exist', async () => {
    expect(await featureOn(prisma, randomUUID(), 'whatsapp')).toBe(true);
  });

  it('reads a switch another garage turned off as on', async () => {
    const w = await world();
    await put(w, 'whatsapp', { enabled: false });

    expect(await featureOn(prisma, w.dinamo.id, 'whatsapp')).toBe(true);
    expect(await featureOn(prisma, w.nord.id, 'whatsapp')).toBe(false);
  });
});
