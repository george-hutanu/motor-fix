import { inMemory } from '@motor-fix/observability/testing';
import { type INestApplication, Logger, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { metrics } from '@opentelemetry/api';
import { MeterProvider } from '@opentelemetry/sdk-metrics';
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

const { metricReader } = inMemory();
metrics.setGlobalMeterProvider(new MeterProvider({ readers: [metricReader] }));

const CHROME =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

async function outcomes() {
  const { resourceMetrics } = await metricReader.collect();
  const found = resourceMetrics.scopeMetrics
    .flatMap((scope) => scope.metrics)
    .find(
      (metric) => metric.descriptor.name === 'motorfix_profile_views_total',
    );
  return Object.fromEntries(
    (found?.dataPoints ?? []).map((point) => [
      point.attributes['outcome'] as string,
      point.value as number,
    ]),
  );
}

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
  await world.reset();
  await redis.flushdb();
});

const bearer = (accountId: string, role: 'garage' | 'admin' | 'driver') =>
  `Bearer ${signAccessToken({ accountId, role }, tokenSecret)}`;

function post(
  server: INestApplication,
  id: string,
  { agent = CHROME, auth }: { agent?: string | null; auth?: string } = {},
) {
  const call = request(server.getHttpServer()).post(`/garages/${id}/views`);
  if (agent !== null) call.set('User-Agent', agent);
  if (auth) call.set('Authorization', auth);
  return call.send({});
}

async function delta(run: () => Promise<unknown>) {
  const before = await outcomes();
  await run();
  const after = await outcomes();
  const change: Record<string, number> = {};
  for (const key of Object.keys(after)) {
    const n = after[key] - (before[key] ?? 0);
    if (n !== 0) change[key] = n;
  }
  return change;
}

// @traces 143-FR-014
describe('the outcome a beacon is counted under', () => {
  it('is accepted for a visitor who is counted', async () => {
    const g = await world.garage('Atelier Dinamo');

    expect(await delta(() => post(app, g.id))).toEqual({ accepted: 1 });
  });

  it('is not_found for a draft garage', async () => {
    const g = await world.garage('Atelier Dinamo');
    await prisma.garage.update({
      data: { status: 'draft' },
      where: { id: g.id },
    });

    expect(await delta(() => post(app, g.id))).toEqual({ not_found: 1 });
  });

  it('is not_found for a suspended garage', async () => {
    const g = await world.garage('Atelier Dinamo');
    await prisma.garage.update({
      data: { status: 'suspended' },
      where: { id: g.id },
    });

    expect(await delta(() => post(app, g.id))).toEqual({ not_found: 1 });
  });

  it('is not_found for an id that is not a uuid', async () => {
    expect(await delta(() => post(app, 'not-an-id'))).toEqual({ not_found: 1 });
  });

  it('is bot for a crawler', async () => {
    const g = await world.garage('Atelier Dinamo');

    expect(
      await delta(() => post(app, g.id, { agent: 'Googlebot/2.1' })),
    ).toEqual({ bot: 1 });
  });

  it('is no_key when the browser string is missing', async () => {
    const g = await world.garage('Atelier Dinamo');

    expect(await delta(() => post(app, g.id, { agent: null }))).toEqual({
      no_key: 1,
    });
  });

  it('is staff for the garage owner and for an admin', async () => {
    const g = await world.garage('Atelier Dinamo');
    const owner = await world.account('Owner', ['garage']);
    await prisma.garageMember.create({
      data: { accountId: owner, garageId: g.id, role: 'owner' },
    });
    const admin = await world.account('Admin', ['admin']);

    expect(
      await delta(async () => {
        await post(app, g.id, { auth: bearer(owner, 'garage') });
        await post(app, g.id, { auth: bearer(admin, 'admin') });
      }),
    ).toEqual({ staff: 2 });
  });

  it('is throttled for the sixty-first beacon from one address and counts it once', async () => {
    const g = await world.garage('Atelier Dinamo');
    for (let i = 0; i < 60; i++)
      await post(app, g.id, { agent: `${CHROME} ${i}` });

    expect(
      await delta(() => post(app, g.id, { agent: `${CHROME} 60` })),
    ).toEqual({ throttled: 1 });
  });

  it('is throttled, not not_found, for the sixty-first beacon at a draft garage', async () => {
    const g = await world.garage('Atelier Dinamo');
    await prisma.garage.update({
      data: { status: 'draft' },
      where: { id: g.id },
    });
    for (let i = 0; i < 60; i++) await post(app, g.id);

    expect(await delta(() => post(app, g.id))).toEqual({ throttled: 1 });
  });

  it('is counted once as bot when a signed-in owner sends a bot agent', async () => {
    const g = await world.garage('Atelier Dinamo');
    const owner = await world.account('Owner', ['garage']);
    await prisma.garageMember.create({
      data: { accountId: owner, garageId: g.id, role: 'owner' },
    });

    const change = await delta(() =>
      post(app, g.id, { agent: 'curl/8', auth: bearer(owner, 'garage') }),
    );

    expect(Object.values(change).reduce((a, b) => a + b, 0)).toBe(1);
  });
});

// @traces 143-FR-009 143-FR-014
describe('the outcome of a beacon while Redis is down', () => {
  let down: INestApplication;

  beforeAll(async () => {
    down = await boot('redis://127.0.0.1:1');
  });

  afterAll(async () => {
    await down.close();
  });

  it('is lost and never accepted', async () => {
    const error = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const g = await world.garage('Atelier Dinamo');

    const change = await delta(() => post(down, g.id));

    error.mockRestore();
    expect(change).toEqual({ lost: 1 });
  }, 20_000);
});
