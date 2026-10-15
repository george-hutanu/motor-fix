import { randomUUID } from 'node:crypto';

import { inMemory } from '@motor-fix/observability/testing';
import { Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { metrics } from '@opentelemetry/api';
import { MeterProvider } from '@opentelemetry/sdk-metrics';
import { type Command, Redis } from 'ioredis';
import request from 'supertest';

import { AUTH_REDIS } from '../../auth/attempts';
import { AuthModule } from '../../auth/auth.module';
import { serialDatabase } from '../../auth/serial-db.testing';
import { purgeTags } from '../../cache/purge';
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

const { metricReader } = inMemory();
metrics.setGlobalMeterProvider(new MeterProvider({ readers: [metricReader] }));

const redisUrl = redisUrlFor(2);
const { prisma, reset } = fixtures();
serialDatabase(databaseUrl);

let app: NestExpressApplication;
let appRedis: Redis;
const other = new Redis(redisUrl);

beforeAll(async () => {
  const email = testConfig('http://127.0.0.1:9');
  const auth = AuthModule.register({
    databaseUrl,
    redisUrl,
    tokenSecret: 'test-secret',
  });
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
  await app.init();
  appRedis = app.get(AUTH_REDIS);
});

afterAll(async () => {
  await app.close();
  other.disconnect();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await reset();
  jest.restoreAllMocks();
});

const read = (slug: string, query: Record<string, string> = {}) =>
  request(app.getHttpServer()).get(`/garages/${slug}`).query(query);

const garageOf = (status: 'approved' | 'suspended' = 'approved') =>
  prisma.garage.create({
    data: { name: 'Service Auto Militari', slug: `m-${randomUUID()}`, status },
  });

const rename = (id: string, name: string) =>
  prisma.garage.update({ data: { name }, where: { id } });

const entry = (slug: string, brand = '-') => `v1:profile:${slug}:${brand}`;

async function counts() {
  const { resourceMetrics } = await metricReader.collect();
  const found = resourceMetrics.scopeMetrics
    .flatMap((scope) => scope.metrics)
    .find((metric) => metric.descriptor.name === 'motorfix_cache_total');
  const by = Object.fromEntries(
    (found?.dataPoints ?? [])
      .filter((point) => point.attributes['kind'] === 'profile')
      .map((point) => [point.attributes['outcome'], point.value as number]),
  );
  return {
    hit: by['hit'] ?? 0,
    miss: by['miss'] ?? 0,
    negative: by['negative'] ?? 0,
  };
}

// @traces 1182-FR-004 1182-FR-007
describe('the profile through the cache service', () => {
  it('stores a miss under the slug and brand, tagged with the garage', async () => {
    const garage = await garageOf();
    const before = await counts();

    expect((await read(garage.slug)).status).toBe(200);

    const stored = JSON.parse((await other.get(entry(garage.slug))) ?? 'null');
    expect(stored.v).toMatchObject({
      id: garage.id,
      name: 'Service Auto Militari',
    });
    expect(await other.smembers(`v1:tag:garage:${garage.id}`)).toEqual([
      entry(garage.slug),
    ]);
    expect((await counts()).miss - before.miss).toBe(1);
  });

  it('answers the second read from the cache', async () => {
    const garage = await garageOf();
    await read(garage.slug);
    const before = await counts();

    await rename(garage.id, 'Nume nou');
    const res = await read(garage.slug);

    expect(res.body.name).toBe('Service Auto Militari');
    expect((await counts()).hit - before.hit).toBe(1);
  });

  it('keeps each brand in context in its own entry', async () => {
    const slug = `dacia-${randomUUID()}`;
    await prisma.brand.create({
      data: { key: slug, name: `Dacia ${slug}`, slug },
    });
    const garage = await garageOf();

    await read(garage.slug);
    const withBrand = await read(garage.slug, { brand: slug });
    await read(garage.slug, { brand: 'made-up-brand' });

    expect(withBrand.body.brand).toMatchObject({
      slug,
      stance: 'does_not_take',
    });
    expect((await other.smembers(`v1:tag:garage:${garage.id}`)).sort()).toEqual(
      [entry(garage.slug), entry(garage.slug, slug)].sort(),
    );
  });

  it('reads PostgreSQL again once the garage’s tag is purged', async () => {
    const garage = await garageOf();
    await read(garage.slug);

    await rename(garage.id, 'Nume nou');
    await purgeTags(other, [`garage:${garage.id}`]);

    expect((await read(garage.slug)).body.name).toBe('Nume nou');
  });

  it('drops a slug the garage gave up when its change is purged', async () => {
    const garage = await garageOf();
    await read(garage.slug);
    const renamed = `renamed-${randomUUID()}`;
    await prisma.garage.update({
      data: { slug: renamed },
      where: { id: garage.id },
    });
    await purgeTags(other, [`garage:${garage.id}`]);

    expect((await read(garage.slug)).status).toBe(404);
    expect((await read(renamed)).status).toBe(200);
  });

  it('remembers an unknown slug’s 404 for 60 seconds, untagged', async () => {
    const unknown = `nobody-${randomUUID()}`;
    expect((await read(unknown)).status).toBe(404);
    await prisma.garage.create({
      data: { name: 'Prea târziu', slug: unknown, status: 'approved' },
    });
    const before = await counts();

    const again = await read(unknown);

    expect([again.status, again.body.code]).toEqual([404, 'not_found']);
    expect((await counts()).negative - before.negative).toBe(1);
    expect(await other.pttl(entry(unknown))).toBeLessThanOrEqual(66_000);
  });

  it('keeps the verdict on a garage that exists out of the cache, so a restore shows at once', async () => {
    const garage = await garageOf('suspended');
    expect((await read(garage.slug)).status).toBe(410);
    expect(await other.exists(entry(garage.slug))).toBe(0);

    await prisma.garage.update({
      data: { status: 'approved' },
      where: { id: garage.id },
    });

    expect((await read(garage.slug)).status).toBe(200);
  });

  it('answers a slug holding a control character 404 without a cache call', async () => {
    expect((await read('bad%07slug')).status).toBe(404);
    expect((await read('bad%07slug')).status).toBe(404);

    expect(await other.exists(entry('bad\u0007slug'))).toBe(0);
  });

  it('answers from PostgreSQL while Redis is down, warning once per outage', async () => {
    const garage = await garageOf();
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const outageWarnings = () =>
      warn.mock.calls.filter(([message]) =>
        /cache unavailable/i.test(String(message)),
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

    const first = await read(garage.slug);
    const second = await read(garage.slug);
    expect([first.status, second.status]).toEqual([200, 200]);
    expect(first.body.name).toBe('Service Auto Militari');
    expect(outageWarnings()).toBe(1);

    down = false;
    expect((await read(garage.slug)).status).toBe(200);
    down = true;
    expect((await read(garage.slug)).status).toBe(200);
    expect(outageWarnings()).toBe(2);
  });
});
