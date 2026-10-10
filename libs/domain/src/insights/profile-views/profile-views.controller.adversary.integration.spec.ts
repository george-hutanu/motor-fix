import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Redis } from 'ioredis';
import request from 'supertest';

import { ProfileViewsModule } from './profile-views.module';
import { signAccessToken } from '../../auth/access-token';
import { AuthModule } from '../../auth/auth.module';
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

let app: INestApplication;
let redis: Redis;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [
      AuthModule.register({ databaseUrl, redisUrl, tokenSecret }),
      ProfileViewsModule,
    ],
  }).compile();
  app = moduleRef.createNestApplication();
  app.useGlobalPipes(
    new ValidationPipe({
      forbidNonWhitelisted: true,
      transform: true,
      whitelist: true,
    }),
  );
  await app.init();
  redis = new Redis(redisUrl);
});

afterAll(async () => {
  await app.close();
  await redis.quit();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await world.reset();
  await redis.flushdb();
});

const counters = async () =>
  (await redis.keys('insights:pv:*'))
    .filter(
      (key) =>
        !key.startsWith('insights:pv:secret:') &&
        !key.startsWith('insights:pv:address:'),
    )
    .sort();

const totalOf = async (garageId: string) => {
  const keys = (await counters()).filter(
    (key) => key.split(':').length === 4 && key.includes(garageId),
  );
  return keys.length === 0 ? 0 : redis.pfcount(...keys);
};

function post(garageId: string, agent: string | null = CHROME) {
  const call = request(app.getHttpServer()).post(`/garages/${garageId}/views`);
  if (agent !== null) call.set('User-Agent', agent);
  return call;
}

// @traces 143-FR-001
describe('a beacon the browser sends in its own way', () => {
  it('is answered 204 and counted as direct when it has no body at all', async () => {
    const g = await world.garage('Atelier Dinamo');

    const res = await post(g.id);

    expect(res.status).toBe(204);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(await totalOf(g.id)).toBe(1);
    expect(
      (await counters()).some((key) => key.endsWith(':profile_direct')),
    ).toBe(true);
  });

  it('is answered 204 and counted as direct when the source is null', async () => {
    const g = await world.garage('Atelier Dinamo');

    const res = await post(g.id).send({ source: null });

    expect(res.status).toBe(204);
    expect(
      (await counters()).some((key) => key.endsWith(':profile_direct')),
    ).toBe(true);
  });

  it.each([
    ['an empty list', []],
    ['a number', 7],
    ['a string', '"home"'],
  ])('refuses %s as the body with 400 and counts nothing', async (_, body) => {
    const g = await world.garage('Atelier Dinamo');

    const res = await post(g.id)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(body));

    expect(res.status).toBe(400);
    expect(await counters()).toEqual([]);
  });

  it('refuses a body that is not JSON with 400 and counts nothing', async () => {
    const g = await world.garage('Atelier Dinamo');

    const res = await post(g.id)
      .set('Content-Type', 'application/json')
      .send('{"source":');

    expect(res.status).toBe(400);
    expect(await counters()).toEqual([]);
  });
});

// @traces 143-FR-007
describe('a source made to look like a name', () => {
  it.each(['__proto__', 'constructor', 'profile_directx', 'Search', 'ѕearch'])(
    'counts %s under the direct counter only',
    async (source) => {
      const g = await world.garage('Atelier Dinamo');

      const res = await post(g.id).send({ source });

      expect(res.status).toBe(204);
      const keys = await counters();
      expect(keys).toHaveLength(2);
      expect(keys.some((key) => key.endsWith(':profile_direct'))).toBe(true);
    },
  );
});

// @traces 143-FR-003
describe('one visitor and one garage', () => {
  it('counts twenty beacons sent at once as one view', async () => {
    const g = await world.garage('Atelier Dinamo');

    const results = await Promise.all(
      Array.from({ length: 20 }, () => post(g.id).send({ source: 'home' })),
    );

    expect(results.map((r) => r.status)).toEqual(Array(20).fill(204));
    expect(await totalOf(g.id)).toBe(1);
  });

  it('counts a garage id written in capitals under the same counter as in lower case', async () => {
    const g = await world.garage('Atelier Dinamo');

    await post(g.id.toLowerCase()).send({});
    const res = await post(g.id.toUpperCase()).send({});

    expect(res.status).toBe(204);
    expect(
      (await counters()).filter((key) => key !== key.toLowerCase()),
    ).toEqual([]);
    expect(await totalOf(g.id.toLowerCase())).toBe(1);
  });

  it('counts a very long agent and an accented one once each when repeated', async () => {
    const g = await world.garage('Atelier Dinamo');
    const long = `Mozilla/5.0 ${'x'.repeat(8000)}`;

    await post(g.id, long).send({});
    await post(g.id, long).send({});
    await post(g.id, 'Mozilla/5.0 (é)').send({});
    await post(g.id, 'Mozilla/5.0 (é)').send({});

    expect(await totalOf(g.id)).toBe(2);
  });

  it('keeps counting a garage that was approved and is now suspended only up to the suspension', async () => {
    const g = await world.garage('Atelier Dinamo');
    await post(g.id).send({});
    await prisma.garage.update({
      data: { status: 'suspended' },
      where: { id: g.id },
    });

    const res = await post(g.id, `${CHROME} other`).send({});

    expect(res.status).toBe(404);
    expect(await totalOf(g.id)).toBe(1);
  });
});

// @traces 143-FR-006
describe('a signed-in visitor with a bot agent', () => {
  it('is dropped with 204 and counted nowhere', async () => {
    const g = await world.garage('Atelier Dinamo');
    const driver = await world.account('Andrei');
    const token = signAccessToken(
      { accountId: driver, role: 'driver' },
      tokenSecret,
    );

    const res = await post(g.id, 'curl/8.4.0')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(204);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(await counters()).toEqual([]);
  });
});

// @traces 143-FR-010
describe('the limit of sixty a minute', () => {
  it('counts sixty distinct visitors and never the sixty-first', async () => {
    const g = await world.garage('Atelier Dinamo');

    for (let i = 0; i < 60; i++) {
      expect((await post(g.id, `${CHROME} ${i}`).send({})).status).toBe(204);
    }
    const refused = await post(g.id, `${CHROME} 60`).send({});

    expect(refused.status).toBe(429);
    expect(await totalOf(g.id)).toBe(60);
  });

  it('refuses the sixty-first even for an id that is no garage', async () => {
    for (let i = 0; i < 60; i++) {
      await post('00000000-0000-4000-8000-000000000000').send({});
    }

    const res = await post('00000000-0000-4000-8000-000000000000').send({});

    expect(res.status).toBe(429);
    expect(res.body).toMatchObject({ code: 'profile_views_rate_limited' });
  });

  it('sets the wait in the header as whole seconds', async () => {
    const g = await world.garage('Atelier Dinamo');
    for (let i = 0; i < 60; i++) await post(g.id, `${CHROME} ${i}`).send({});

    const res = await post(g.id).send({});

    expect(res.headers['retry-after']).toMatch(/^[1-9][0-9]?$/);
  });
});
