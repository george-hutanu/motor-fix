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

const approvedGarage = (status: 'approved' | 'suspended' = 'approved') =>
  prisma.garage.create({
    data: { name: 'Service Auto Militari', slug: `m-${randomUUID()}`, status },
  });

const rename = (id: string, name: string) =>
  prisma.garage.update({ data: { name }, where: { id } });

const drop = async (id: string) => {
  await other.incr(`garage-profile-gen:v4:${id}`);
  await other.del(`garage-profile:v4:${id}`);
};

async function counts() {
  const { resourceMetrics } = await metricReader.collect();
  const found = resourceMetrics.scopeMetrics
    .flatMap((scope) => scope.metrics)
    .find(
      (metric) =>
        metric.descriptor.name === 'motorfix_garage_profile_cache_total',
    );
  const by = Object.fromEntries(
    (found?.dataPoints ?? []).map((point) => [
      point.attributes['outcome'],
      point.value as number,
    ]),
  );
  return { hit: by['hit'] ?? 0, miss: by['miss'] ?? 0 };
}

// @traces 307-FR-006 307-FR-007
describe('the profile cache', () => {
  it('writes the answer on a miss, for ten minutes at most', async () => {
    const garage = await approvedGarage();
    const before = await counts();

    expect((await read(garage.slug)).status).toBe(200);

    const stored = await other.hget(`garage-profile:v4:${garage.id}`, '-');
    expect(JSON.parse(stored ?? 'null')).toMatchObject({
      id: garage.id,
      name: 'Service Auto Militari',
    });
    expect(await other.get(`garage-profile-slug:v4:${garage.slug}`)).toBe(
      garage.id,
    );
    for (const key of [
      `garage-profile:v4:${garage.id}`,
      `garage-profile-slug:v4:${garage.slug}`,
    ]) {
      const ttl = await other.ttl(key);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(600);
    }
    expect((await counts()).miss - before.miss).toBe(1);
  });

  it('answers the second read from the cache', async () => {
    const garage = await approvedGarage();
    await read(garage.slug);
    const before = await counts();

    await rename(garage.id, 'Nume nou');
    const res = await read(garage.slug);

    expect(res.body.name).toBe('Service Auto Militari');
    expect((await counts()).hit - before.hit).toBe(1);
  });

  it('counts a slug pointer the garage gave up as one miss, not a hit', async () => {
    const garage = await approvedGarage();
    await read(garage.slug);
    const renamed = `renamed-${randomUUID()}`;
    await prisma.garage.update({
      data: { slug: renamed },
      where: { id: garage.id },
    });
    await read(renamed);
    const before = await counts();

    expect((await read(garage.slug)).status).toBe(404);

    const after = await counts();
    expect(after.hit - before.hit).toBe(0);
    expect(after.miss - before.miss).toBe(1);
  });

  it('keeps each brand in context in its own field', async () => {
    const slug = `dacia-${randomUUID()}`;
    await prisma.brand.create({
      data: { key: slug, name: `Dacia ${slug}`, slug },
    });
    const garage = await approvedGarage();

    await read(garage.slug);
    await read(garage.slug, { brand: slug });

    expect(
      (await other.hkeys(`garage-profile:v4:${garage.id}`)).sort(),
    ).toEqual(['-', slug].sort());
    const withBrand = JSON.parse(
      (await other.hget(`garage-profile:v4:${garage.id}`, slug)) ?? 'null',
    );
    expect(withBrand.brand).toMatchObject({ slug, stance: 'does_not_take' });
  });

  it('reads PostgreSQL again once the profile is dropped', async () => {
    const garage = await approvedGarage();
    await read(garage.slug);

    await rename(garage.id, 'Nume nou');
    await drop(garage.id);

    expect((await read(garage.slug)).body.name).toBe('Nume nou');
  });

  it('never caches a 404 or a 410', async () => {
    const unknown = `nobody-${randomUUID()}`;
    const suspended = await approvedGarage('suspended');

    expect((await read(unknown)).status).toBe(404);
    expect((await read(suspended.slug)).status).toBe(410);

    expect(await other.exists(`garage-profile-slug:v4:${unknown}`)).toBe(0);
    expect(
      await other.exists(
        `garage-profile-slug:v4:${suspended.slug}`,
        `garage-profile:v4:${suspended.id}`,
      ),
    ).toBe(0);
  });

  it('leaves nothing cached when a drop lands while a read is under way', async () => {
    const garage = await approvedGarage();
    const send = appRedis.sendCommand.bind(appRedis);
    jest
      .spyOn(appRedis, 'sendCommand')
      .mockImplementation((command: Command, ...rest) => {
        const sent = send(command, ...rest);
        const key = String(command.args[0] ?? '');
        if (
          command.name !== 'get' ||
          !key.startsWith('garage-profile-gen:v4:')
        ) {
          return sent;
        }
        return Promise.resolve(sent).then(async (value) => {
          await drop(garage.id);
          return value;
        });
      });

    expect((await read(garage.slug)).status).toBe(200);
    jest.restoreAllMocks();

    expect(await other.exists(`garage-profile:v4:${garage.id}`)).toBe(0);
    await rename(garage.id, 'Nume nou');
    expect((await read(garage.slug)).body.name).toBe('Nume nou');
  });

  it('answers from PostgreSQL while Redis is down, warning once per outage', async () => {
    const garage = await approvedGarage();
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const outageWarnings = () =>
      warn.mock.calls.filter(([message]) =>
        /garage profile cache/i.test(String(message)),
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
    expect(outageWarnings()).toBe(1);

    down = true;
    expect((await read(garage.slug)).status).toBe(200);
    expect(outageWarnings()).toBe(2);
  });
});
