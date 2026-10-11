import { type INestApplication, Logger, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Redis } from 'ioredis';
import request from 'supertest';

import { ProfileViewsModule } from './profile-views.module';
import { signAccessToken } from '../../auth/access-token';
import { AuthModule } from '../../auth/auth.module';
import type { Role } from '../../auth/capabilities';
import { serialDatabase } from '../../auth/serial-db.testing';
import { redisUrlFor } from '../../notifications/notifications.testing';
import { databaseUrl, quotesWorld } from '../../quotes/quotes.testing';

const redisUrl = redisUrlFor(6);
const tokenSecret = 'test';
const world = quotesWorld();
const { prisma } = world;
serialDatabase(databaseUrl);

const CHROME =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile Safari/604.1';

async function boot(url = redisUrl) {
  const moduleRef = await Test.createTestingModule({
    imports: [
      AuthModule.register({ databaseUrl, redisUrl: url, tokenSecret }),
      ProfileViewsModule,
    ],
  }).compile();
  const nest = moduleRef.createNestApplication();
  nest.useGlobalPipes(
    new ValidationPipe({
      forbidNonWhitelisted: true,
      transform: true,
      whitelist: true,
    }),
  );
  await nest.init();
  return nest;
}

let app: INestApplication;
let redis: Redis;

beforeAll(async () => {
  app = await boot();
  redis = new Redis(redisUrl);
});

afterAll(async () => {
  await app.close();
  await redis.quit();
  await prisma.$disconnect();
});

beforeEach(async () => {
  jest.useRealTimers();
  await world.reset();
  await redis.flushdb();
});

afterEach(() => jest.useRealTimers());

// Only Date is faked: Redis, HTTP and the timers keep real time. The instants
// sit in the future so an expiry set from them is never already past.
const at = (iso: string) =>
  jest
    .useFakeTimers({
      doNotFake: [
        'nextTick',
        'setImmediate',
        'clearImmediate',
        'setTimeout',
        'clearTimeout',
        'setInterval',
        'clearInterval',
        'queueMicrotask',
        'hrtime',
        'performance',
      ],
    })
    .setSystemTime(new Date(iso));

const bearer = (accountId: string, role: Role) =>
  `Bearer ${signAccessToken({ accountId, role }, tokenSecret)}`;

function view(
  garageId: string,
  {
    agent = CHROME,
    auth,
    body = {},
  }: { agent?: string | null; auth?: string; body?: unknown } = {},
) {
  const call = request(app.getHttpServer()).post(`/garages/${garageId}/views`);
  if (agent !== null) call.set('User-Agent', agent);
  if (auth) call.set('Authorization', auth);
  return call.send(body as object);
}

const total = (garageId: string, day: string) =>
  redis.pfcount(`insights:pv:${garageId}:${day}`);
const bySource = (garageId: string, day: string, source: string) =>
  redis.pfcount(`insights:pv:${garageId}:${day}:${source}`);
const pvKeys = async () => (await redis.keys('insights:pv:*')).sort();
const counterKeys = async () =>
  (await pvKeys()).filter(
    (key) =>
      !key.startsWith('insights:pv:secret:') &&
      !key.startsWith('insights:pv:address:'),
  );

async function garage(status: 'approved' | 'draft' | 'suspended' = 'approved') {
  const row = await world.garage(`Service ${status}`);
  if (status === 'approved') return row;
  return prisma.garage.update({ data: { status }, where: { id: row.id } });
}

// @traces 143-FR-001 143-FR-002 143-FR-003
describe('a visit to an approved garage', () => {
  it('counts one visitor once a day however often they open it', async () => {
    at('2030-06-14T08:00:00Z');
    const g = await garage();

    for (let i = 0; i < 3; i++) {
      const res = await view(g.id);
      expect(res.status).toBe(204);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.text).toBe('');
    }

    expect(await total(g.id, '2030-06-14')).toBe(1);
  });

  it('counts another visitor apart', async () => {
    at('2030-06-14T08:00:00Z');
    const g = await garage();

    await view(g.id, { agent: CHROME });
    await view(g.id, { agent: SAFARI });

    expect(await total(g.id, '2030-06-14')).toBe(2);
  });

  it('counts a visit just after midnight in Bucharest on the next day', async () => {
    const g = await garage();
    at('2030-06-14T20:59:00Z');
    await view(g.id);
    at('2030-06-14T21:10:00Z');
    await view(g.id);

    expect(await total(g.id, '2030-06-14')).toBe(1);
    expect(await total(g.id, '2030-06-15')).toBe(1);
  });

  it('counts a signed-in driver on two devices once', async () => {
    at('2030-06-14T08:00:00Z');
    const g = await garage();
    const driver = await world.account('Andrei');

    await view(g.id, { agent: CHROME, auth: bearer(driver, 'driver') });
    await view(g.id, { agent: SAFARI, auth: bearer(driver, 'driver') });

    expect(await total(g.id, '2030-06-14')).toBe(1);
  });

  it('counts a bad or expired session as a visitor, not a refusal', async () => {
    at('2030-06-14T08:00:00Z');
    const g = await garage();

    const res = await view(g.id, { auth: 'Bearer not-a-token' });

    expect(res.status).toBe(204);
    expect(await total(g.id, '2030-06-14')).toBe(1);
  });

  it('answers a visitor with no agent and counts nothing', async () => {
    at('2030-06-14T08:00:00Z');
    const g = await garage();

    const res = await view(g.id, { agent: null });

    expect(res.status).toBe(204);
    expect(await counterKeys()).toEqual([]);
  });
});

// @traces 143-FR-005
describe('views the garage and the platform make themselves', () => {
  async function team() {
    const g = await garage();
    const owner = await world.account('Owner', ['garage']);
    const desk = await world.account('Desk', ['receptionist']);
    const hand = await world.account('Hand', ['mechanic']);
    await prisma.garageMember.createMany({
      data: [
        { accountId: owner, garageId: g.id, role: 'owner' },
        { accountId: desk, garageId: g.id, role: 'receptionist' },
      ],
    });
    await prisma.mechanic.create({
      data: { accountId: hand, garageId: g.id, name: 'Hand' },
    });
    return { desk, g, hand, owner };
  }

  it('does not count the owner, the receptionist or a mechanic of the garage', async () => {
    at('2030-06-14T08:00:00Z');
    const { desk, g, hand, owner } = await team();

    for (const auth of [
      bearer(owner, 'garage'),
      bearer(desk, 'receptionist'),
      bearer(hand, 'mechanic'),
    ]) {
      expect((await view(g.id, { auth })).status).toBe(204);
    }

    expect(await counterKeys()).toEqual([]);
  });

  it('does not count a member who is browsing as a driver', async () => {
    at('2030-06-14T08:00:00Z');
    const g = await garage();
    const owner = await world.account('Owner', ['garage', 'driver']);
    await prisma.garageMember.create({
      data: { accountId: owner, garageId: g.id, role: 'owner' },
    });

    await view(g.id, { auth: bearer(owner, 'driver') });

    expect(await counterKeys()).toEqual([]);
  });

  it('does not count an admin', async () => {
    at('2030-06-14T08:00:00Z');
    const g = await garage();
    const admin = await world.account('Admin', ['admin']);

    expect((await view(g.id, { auth: bearer(admin, 'admin') })).status).toBe(
      204,
    );
    expect(await counterKeys()).toEqual([]);
  });

  it('counts the owner of another garage like any visitor', async () => {
    at('2030-06-14T08:00:00Z');
    const { g } = await team();
    const other = await garage();
    const rival = await world.account('Rival', ['garage']);
    await prisma.garageMember.create({
      data: { accountId: rival, garageId: other.id, role: 'owner' },
    });

    await view(g.id, { auth: bearer(rival, 'garage') });

    expect(await total(g.id, '2030-06-14')).toBe(1);
  });
});

// @traces 143-FR-006
describe('a view from a bot', () => {
  it('answers it and counts nothing', async () => {
    at('2030-06-14T08:00:00Z');
    const g = await garage();

    const res = await view(g.id, {
      agent: 'Mozilla/5.0 (compatible; Googlebot/2.1)',
    });

    expect(res.status).toBe(204);
    expect(await counterKeys()).toEqual([]);
  });
});

// @traces 143-FR-007
describe('the source a view names', () => {
  it.each(['search', 'map', 'home', 'shared_link', 'saved', 'profile_direct'])(
    'counts %s under its own name and in the total',
    async (source) => {
      at('2030-06-14T08:00:00Z');
      const g = await garage();

      await view(g.id, { body: { source } });

      expect(await total(g.id, '2030-06-14')).toBe(1);
      expect(await bySource(g.id, '2030-06-14', source)).toBe(1);
    },
  );

  it.each([
    ['no source', {}],
    ['an unknown source', { source: 'newsletter' }],
    ['an over-long source', { source: 'x'.repeat(5000) }],
    ['a number', { source: 7 }],
  ])('counts %s as a direct visit', async (_, body) => {
    at('2030-06-14T08:00:00Z');
    const g = await garage();

    expect((await view(g.id, { body })).status).toBe(204);

    expect(await bySource(g.id, '2030-06-14', 'profile_direct')).toBe(1);
    expect(await counterKeys()).toEqual([
      `insights:pv:${g.id}:2030-06-14`,
      `insights:pv:${g.id}:2030-06-14:profile_direct`,
    ]);
  });

  it('counts one visitor once in the total when they arrive from two places', async () => {
    at('2030-06-14T08:00:00Z');
    const g = await garage();

    await view(g.id, { body: { source: 'search' } });
    await view(g.id, { body: { source: 'home' } });

    expect(await total(g.id, '2030-06-14')).toBe(1);
    expect(await bySource(g.id, '2030-06-14', 'search')).toBe(1);
    expect(await bySource(g.id, '2030-06-14', 'home')).toBe(1);
  });

  it.each([
    ['a list', ['search']],
    ['another field', { garage: 'x', source: 'search' }],
  ])('refuses a body that is %s and counts nothing', async (_, body) => {
    at('2030-06-14T08:00:00Z');
    const g = await garage();

    const res = await view(g.id, { body });

    expect(res.status).toBe(400);
    expect(await counterKeys()).toEqual([]);
  });
});

// @traces 143-FR-002
describe('a garage nobody may see', () => {
  it.each(['draft', 'suspended'] as const)(
    'answers not found for a %s garage and counts nothing',
    async (status) => {
      at('2030-06-14T08:00:00Z');
      const g = await garage(status);

      const res = await view(g.id);

      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ code: 'not_found' });
      expect(await counterKeys()).toEqual([]);
    },
  );

  it('answers not found for an id no garage has', async () => {
    const res = await view('00000000-0000-4000-8000-000000000000');

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: 'not_found' });
  });

  it('answers not found for an id that is not a garage id at all', async () => {
    const res = await view('not-a-uuid');

    expect(res.status).toBe(404);
    expect(await counterKeys()).toEqual([]);
  });

  it('answers not found to the garage owner too, while the garage is a draft', async () => {
    const g = await garage('draft');
    const owner = await world.account('Owner', ['garage']);
    await prisma.garageMember.create({
      data: { accountId: owner, garageId: g.id, role: 'owner' },
    });

    expect((await view(g.id, { auth: bearer(owner, 'garage') })).status).toBe(
      404,
    );
  });
});

// @traces 143-FR-010
describe('too many views from one address', () => {
  it('refuses the sixty-first in a minute with the seconds to wait', async () => {
    const g = await garage();

    for (let i = 0; i < 60; i++) {
      expect((await view(g.id, { agent: `${CHROME} ${i}` })).status).toBe(204);
    }
    const refused = await view(g.id);

    expect(refused.status).toBe(429);
    expect(refused.body).toMatchObject({
      code: 'profile_views_rate_limited',
      retryAfterSeconds: expect.any(Number),
    });
    expect(refused.body.retryAfterSeconds).toBeGreaterThan(0);
    expect(refused.body.retryAfterSeconds).toBeLessThanOrEqual(60);
    expect(refused.headers['retry-after']).toBe(
      String(refused.body.retryAfterSeconds),
    );
  });

  it('counts refused views too, so a draft garage is limited the same way', async () => {
    const g = await garage('draft');

    for (let i = 0; i < 60; i++) {
      expect((await view(g.id)).status).toBe(404);
    }

    expect((await view(g.id)).status).toBe(429);
  });

  it('keeps the throttle under the counter prefix and out of the address itself', async () => {
    const g = await garage();

    await view(g.id);

    const throttle = (await pvKeys()).filter((key) =>
      key.startsWith('insights:pv:address:'),
    );
    expect(throttle).toHaveLength(1);
    expect(throttle[0]).toMatch(/^insights:pv:address:[0-9a-f]{64}$/);
  });
});

// @traces 143-FR-009 143-FR-004
describe('what a view leaves in Redis', () => {
  it('keeps every counter until the Bucharest midnight that ends two days later', async () => {
    at('2030-06-14T08:00:00Z');
    const g = await garage();

    await view(g.id, { body: { source: 'home' } });

    const expiry = new Date('2030-06-16T21:00:00Z').getTime() / 1000;
    for (const key of await counterKeys()) {
      expect(Number(await redis.call('EXPIRETIME', key))).toBe(expiry);
    }
    expect(await counterKeys()).toHaveLength(2);
  });

  it('does not move the expiry when the day is counted again', async () => {
    at('2030-06-14T08:00:00Z');
    const g = await garage();
    await view(g.id, { agent: CHROME });
    const key = `insights:pv:${g.id}:2030-06-14`;
    await redis.expireat(
      key,
      new Date('2030-06-16T20:00:00Z').getTime() / 1000,
    );

    await view(g.id, { agent: SAFARI });

    expect(Number(await redis.call('EXPIRETIME', key))).toBe(
      new Date('2030-06-16T20:00:00Z').getTime() / 1000,
    );
  });

  it('holds only distinct-count counters, the day secret and the throttle', async () => {
    at('2030-06-14T08:00:00Z');
    const g = await garage();
    const driver = await world.account('Andrei');

    await view(g.id, { body: { source: 'search' } });
    await view(g.id, { agent: SAFARI, auth: bearer(driver, 'driver') });

    const keys = await pvKeys();
    const secrets = keys.filter((k) => k.startsWith('insights:pv:secret:'));
    expect(secrets).toEqual(['insights:pv:secret:2030-06-14']);
    for (const key of await counterKeys()) {
      expect(await redis.type(key)).toBe('string');
      expect((await redis.getrange(key, 0, 3)).toString()).toBe('HYLL');
    }
    const everything = (
      await Promise.all(keys.map((key) => redis.dump(key)))
    ).join('');
    expect(everything).not.toContain(driver);
    expect(everything).not.toContain('Safari');
    expect(everything).not.toContain('127.0.0.1');
  });

  // @traces 143-FR-004
  it('keeps one secret for the day, discarded when the Bucharest day ends', async () => {
    at('2030-06-14T08:00:00Z');
    const g = await garage();

    await view(g.id, { agent: CHROME });
    const first = await redis.get('insights:pv:secret:2030-06-14');
    await view(g.id, { agent: SAFARI });

    expect(first).toBeTruthy();
    expect(await redis.get('insights:pv:secret:2030-06-14')).toBe(first);
    expect(
      Number(await redis.call('EXPIRETIME', 'insights:pv:secret:2030-06-14')),
    ).toBe(new Date('2030-06-14T21:00:00Z').getTime() / 1000);
  });

  it('gives the same visitor a new key on the next day', async () => {
    const g = await garage();
    at('2030-06-14T08:00:00Z');
    await view(g.id);
    at('2030-06-15T08:00:00Z');
    await view(g.id);

    expect(await redis.get('insights:pv:secret:2030-06-15')).not.toBe(
      await redis.get('insights:pv:secret:2030-06-14'),
    );
  });
});

// @traces 143-FR-015
describe('what a view does not do', () => {
  it('writes no activity, no outbox event and no notification', async () => {
    at('2030-06-14T08:00:00Z');
    const g = await garage();
    const driver = await world.account('Andrei');
    const before = {
      activity: await prisma.activityLog.count(),
      notifications: await prisma.notification.count(),
      outbox: await prisma.outboxEvent.count(),
    };

    await view(g.id);
    await view(g.id, { auth: bearer(driver, 'driver') });

    expect({
      activity: await prisma.activityLog.count(),
      notifications: await prisma.notification.count(),
      outbox: await prisma.outboxEvent.count(),
    }).toEqual(before);
  });
});

// @traces 143-FR-009
describe('a view while Redis is down', () => {
  let down: INestApplication;

  beforeAll(async () => {
    down = await boot('redis://127.0.0.1:1');
  });

  afterAll(async () => {
    await down.close();
  });

  it('is answered as usual and logged once, naming no visitor', async () => {
    const error = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const g = await garage();

    const res = await request(down.getHttpServer())
      .post(`/garages/${g.id}/views`)
      .set('User-Agent', CHROME)
      .send({ source: 'search' });

    expect(res.status).toBe(204);
    const lines = error.mock.calls.map((call) => call.map(String).join(' '));
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain('127.0.0.1');
    expect(lines[0]).not.toContain('Chrome');
    expect(lines[0]).not.toMatch(/[0-9a-f]{64}/);
    error.mockRestore();
  }, 20_000);
});
