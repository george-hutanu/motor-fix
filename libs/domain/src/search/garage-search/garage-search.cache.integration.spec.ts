import { inMemory } from '@motor-fix/observability/testing';
import { type INestApplication, Logger, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { metrics } from '@opentelemetry/api';
import { MeterProvider } from '@opentelemetry/sdk-metrics';
import { type Command, Redis } from 'ioredis';
import request from 'supertest';

import { dropSearches } from './garage-search.cache';
import { AUTH_REDIS } from '../../auth/attempts';
import { AuthModule } from '../../auth/auth.module';
import { serialDatabase } from '../../auth/serial-db.testing';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
} from '../../notifications/notifications.testing';
import { SearchModule } from '../search.module';

const { metricReader } = inMemory();
metrics.setGlobalMeterProvider(new MeterProvider({ readers: [metricReader] }));

const redisUrl = redisUrlFor(10);
const { prisma } = fixtures();
serialDatabase(databaseUrl);

const GENERATION = 'garage-search-gen:v1';
const NEAR = '46.771,23.624';

let app: INestApplication;
let appRedis: Redis;
const other = new Redis(redisUrl);
let dacia: string;
let garageId: string;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [
      AuthModule.register({ databaseUrl, redisUrl, tokenSecret: 'test' }),
      SearchModule,
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
  appRedis = app.get(AUTH_REDIS);
});

beforeEach(async () => {
  jest.restoreAllMocks();
  await prisma.$executeRawUnsafe('TRUNCATE brand, garage CASCADE');
  dacia = (
    await prisma.brand.create({
      data: { key: 'dacia', name: 'Dacia', slug: 'dacia' },
    })
  ).id;
  garageId = (
    await prisma.garage.create({
      data: {
        latitude: 46.771,
        longitude: 23.624,
        name: 'Alfa Service',
        slug: 'alfa-service',
        status: 'approved',
      },
    })
  ).id;
  await prisma.garageBrand.create({
    data: { brandId: dacia, garageId, stance: 'works_on' },
  });
});

afterAll(async () => {
  await app.close();
  other.disconnect();
  await prisma.$disconnect();
});

const search = (query: Record<string, string>) =>
  request(app.getHttpServer()).get('/search/garages').query(query);

// Changed behind the API's back: no event, so only a cache miss sees it.
const rename = (name: string) =>
  prisma.garage.update({ data: { name }, where: { id: garageId } });

const generation = async () => (await other.get(GENERATION)) ?? '0';
const entries = () => other.keys(`garage-search:v1:*:${dacia}:*`);
const pins = (query: Record<string, string>) =>
  request(app.getHttpServer()).get('/search/garages/pins').query(query);
// Moved behind the API's back: no event, so only a cache miss sees it.
const move = (latitude: number) =>
  prisma.garage.update({ data: { latitude }, where: { id: garageId } });

async function cacheCounts() {
  const { resourceMetrics } = await metricReader.collect();
  const found = resourceMetrics.scopeMetrics
    .flatMap((scope) => scope.metrics)
    .find((metric) => metric.descriptor.name === 'motorfix_search_cache_total');
  const counts = Object.fromEntries(
    (found?.dataPoints ?? []).map((point) => [
      point.attributes['outcome'] as string,
      point.value as number,
    ]),
  );
  return {
    fallback: counts['fallback'] ?? 0,
    hit: counts['hit'] ?? 0,
    miss: counts['miss'] ?? 0,
  };
}

const since = async (before: Awaited<ReturnType<typeof cacheCounts>>) => {
  const now = await cacheCounts();
  return {
    fallback: now.fallback - before.fallback,
    hit: now.hit - before.hit,
    miss: now.miss - before.miss,
  };
};

// @traces 267-FR-009 267-FR-010 267-FR-011
describe('the search cache', () => {
  it('keeps a page for 60 seconds under the generation, brand, place, radius and cursor', async () => {
    const gen = await generation();

    const res = await search({ brand: 'dacia', near: NEAR });

    expect(res.status).toBe(200);
    const key = `garage-search:v1:${gen}:page:${dacia}:${NEAR}:25:-:-`;
    expect(JSON.parse((await other.get(key)) as string)).toEqual(res.body);
    const ttl = await other.ttl(key);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(60);
  });

  it('keys a search without a place by a dash, and the place by its rounded text', async () => {
    const gen = await generation();

    await search({ brandId: dacia }).expect(200);
    await search({ brandId: dacia, near: '46.771004,23.623996' }).expect(200);

    expect((await entries()).sort()).toEqual(
      [
        `garage-search:v1:${gen}:page:${dacia}:-:25:-:-`,
        `garage-search:v1:${gen}:page:${dacia}:${NEAR}:25:-:-`,
      ].sort(),
    );
  });

  it('answers the same request again from the cache, by slug or by id, with log or without', async () => {
    const before = await cacheCounts();
    const first = await search({ brand: 'dacia', log: '1', near: NEAR });
    await rename('Nume nou');

    const again = await search({ brand: 'dacia', near: NEAR });
    const byId = await search({ brandId: dacia, near: NEAR, radius: '25' });

    expect(again.body).toEqual(first.body);
    expect(byId.body).toEqual(first.body);
    expect(again.body.items[0].name).toBe('Alfa Service');
    expect(await entries()).toHaveLength(1);
    expect(await since(before)).toEqual({ fallback: 0, hit: 2, miss: 1 });
  });

  it('reads PostgreSQL for another radius or place', async () => {
    await search({ brand: 'dacia', near: NEAR }).expect(200);
    await rename('Nume nou');

    const wider = await search({ brand: 'dacia', near: NEAR, radius: '50' });
    const nowhere = await search({ brand: 'dacia' });

    expect(wider.body.items[0].name).toBe('Nume nou');
    expect(nowhere.body.items[0].name).toBe('Nume nou');
  });

  it('never caches an ids read', async () => {
    const before = await cacheCounts();
    await search({ brand: 'dacia', ids: garageId }).expect(200);
    await rename('Nume nou');

    const again = await search({ brand: 'dacia', ids: garageId });

    expect(again.body.items[0].name).toBe('Nume nou');
    expect(await entries()).toEqual([]);
    expect(await since(before)).toEqual({ fallback: 0, hit: 0, miss: 0 });
  });
});

// @traces 267-FR-010
describe('dropping the cached searches', () => {
  it.each([
    [[`garage:x`, `public:garage:x`]],
    [['public:search']],
    [['garage:x', 'public:search:brand-id']],
    [[`public:garage:a`, `public:garage:b`, 'public:search']],
  ])('advances the generation once for an audience %p', async (audience) => {
    const before = Number(await generation());

    await dropSearches(other, audience);

    expect(Number(await generation())).toBe(before + 1);
  });

  it.each([
    [['garage:x']],
    [['account:x', 'admin']],
    [['public:mechanic:x']],
    [[]],
  ])('leaves the generation for an audience %p', async (audience) => {
    const before = await generation();

    await dropSearches(other, audience);

    expect(await generation()).toBe(before);
  });

  it('makes the next search read PostgreSQL', async () => {
    await search({ brand: 'dacia', near: NEAR }).expect(200);
    await rename('Nume nou');

    await dropSearches(other, [`public:garage:${garageId}`]);

    expect(
      (await search({ brand: 'dacia', near: NEAR })).body.items[0].name,
    ).toBe('Nume nou');
  });
});

// @traces 267-FR-011
describe('the search with Redis unavailable', () => {
  it('answers from PostgreSQL the same answer, counts the fallback and warns once per outage', async () => {
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const outageWarnings = () =>
      warn.mock.calls.filter(([message]) =>
        /search cache/i.test(String(message)),
      ).length;
    const send = appRedis.sendCommand.bind(appRedis);
    let down = true;
    jest
      .spyOn(appRedis, 'sendCommand')
      .mockImplementation((command: Command, ...rest) => {
        if (!down) return send(command, ...rest);
        command.reject(new Error('connect ECONNREFUSED 127.0.0.1:6379'));
        return command.promise;
      });
    const before = await cacheCounts();

    const first = await search({ brand: 'dacia', near: NEAR });
    const second = await search({ brand: 'dacia', log: '1', near: NEAR });
    expect([first.status, second.status]).toEqual([200, 200]);
    expect(outageWarnings()).toBe(1);
    expect(await since(before)).toEqual({ fallback: 2, hit: 0, miss: 0 });

    down = false;
    const up = await search({ brand: 'dacia', near: NEAR });
    expect(up.body).toEqual(first.body);
    expect(second.body).toEqual(first.body);
    expect(outageWarnings()).toBe(1);

    down = true;
    expect((await search({ brand: 'dacia', near: NEAR })).status).toBe(200);
    expect(outageWarnings()).toBe(2);
  });
});

const BBOX = '46.7,23.5,46.85,23.75';

// @traces 269-FR-019
describe('the search cache for the map pins', () => {
  it('keeps the pins for 60 seconds under their own kind, beside the page of the same search', async () => {
    const gen = await generation();

    const page = await search({ brand: 'dacia', near: NEAR });
    const res = await pins({ brand: 'dacia', near: NEAR });

    expect(res.status).toBe(200);
    const key = `garage-search:v1:${gen}:pins:${dacia}:${NEAR}:25:-:-`;
    expect(JSON.parse((await other.get(key)) as string)).toEqual(res.body);
    expect(
      JSON.parse(
        (await other.get(
          `garage-search:v1:${gen}:page:${dacia}:${NEAR}:25:-:-`,
        )) as string,
      ),
    ).toEqual(page.body);
    const ttl = await other.ttl(key);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(60);
  });

  it('keys a box by its rounded canonical text, and leaves the radius at its default', async () => {
    const gen = await generation();

    await pins({ bbox: '46.70004,23.5,46.85,23.75', brandId: dacia }).expect(
      200,
    );
    await pins({ bbox: BBOX, brandId: dacia, radius: '50' }).expect(200);

    expect(await entries()).toEqual([
      `garage-search:v1:${gen}:pins:${dacia}:-:25:${BBOX}:-`,
    ]);
  });

  it('answers the same pins again from the cache, by slug or by id', async () => {
    const before = await cacheCounts();
    const first = await pins({ brand: 'dacia', near: NEAR });
    await move(46.772);

    const again = await pins({ brandId: dacia, near: NEAR });

    expect(again.body).toEqual(first.body);
    expect(again.body.pins[0].lat).toBe(46.771);
    expect(await since(before)).toEqual({ fallback: 0, hit: 1, miss: 1 });
  });

  it('drops the pins and the pages on a public garage event', async () => {
    await search({ brand: 'dacia', near: NEAR }).expect(200);
    await pins({ brand: 'dacia', near: NEAR }).expect(200);
    await move(46.772);
    await rename('Nume nou');

    await dropSearches(other, [`public:garage:${garageId}`]);

    expect((await pins({ brand: 'dacia', near: NEAR })).body.pins[0].lat).toBe(
      46.772,
    );
    expect(
      (await search({ brand: 'dacia', near: NEAR })).body.items[0].name,
    ).toBe('Nume nou');
  });

  it('answers the pins from PostgreSQL while Redis is unavailable', async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest
      .spyOn(appRedis, 'sendCommand')
      .mockImplementation((command: Command) => {
        command.reject(new Error('connect ECONNREFUSED 127.0.0.1:6379'));
        return command.promise;
      });
    const before = await cacheCounts();

    const res = await pins({ brand: 'dacia', near: NEAR });

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(await since(before)).toEqual({ fallback: 1, hit: 0, miss: 0 });
  });
});
