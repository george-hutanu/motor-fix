import { randomUUID } from 'node:crypto';

import { inMemory } from '@motor-fix/observability/testing';
import { Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { metrics } from '@opentelemetry/api';
import { MeterProvider } from '@opentelemetry/sdk-metrics';
import { Redis } from 'ioredis';

import { warmCache } from './warm-up';
import { AuthModule } from '../../auth/auth.module';
import { serialDatabase } from '../../auth/serial-db.testing';
import { GaragesModule } from '../../garages/garages.module';
import { PublicGaragesService } from '../../garages/public-garages/public-garages';
import { NotificationsModule } from '../../notifications/notifications.module';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
  testConfig,
} from '../../notifications/notifications.testing';
import { SearchModule } from '../../search/search.module';
import { UNUSED_STORAGE } from '../../storage/s3-test-store';
import { StorageModule } from '../../storage/storage.module';
import { purgeTags } from '../purge';

const { metricReader } = inMemory();
metrics.setGlobalMeterProvider(new MeterProvider({ readers: [metricReader] }));

const redisUrl = redisUrlFor(4);
const { prisma } = fixtures();
serialDatabase(databaseUrl);
const other = new Redis(redisUrl);

let app: NestExpressApplication;

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
      SearchModule,
    ],
  }).compile();
  app = moduleRef.createNestApplication<NestExpressApplication>();
  await app.init();
}, 60_000);

afterAll(async () => {
  await app.close();
  other.disconnect();
  await prisma.$disconnect();
});

let slugs: string[];

beforeEach(async () => {
  jest.restoreAllMocks();
  await prisma.$executeRawUnsafe('TRUNCATE brand, garage CASCADE');
  await purgeTags(other, ['search']);
  await prisma.brand.createMany({
    data: ['dacia', 'ford'].map((slug, n) => ({
      key: slug,
      name: slug,
      popularity: n + 1,
      slug,
    })),
  });
  const day = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
  slugs = [];
  // 203 approved garages: the first three have views, the rest are ordered by
  // when they were approved.
  for (let n = 0; n < 203; n += 1) {
    const slug = `w${n}-${randomUUID()}`;
    slugs.push(slug);
    const garage = await prisma.garage.create({
      data: {
        approvedAt: new Date(Date.UTC(2026, 0, 1) + n * 60_000),
        name: slug,
        slug,
        status: 'approved',
      },
    });
    if (n < 3) {
      await prisma.garageDailyFigures.create({
        data: {
          day,
          garageId: garage.id,
          profileViews: 10 - n,
          writtenAt: new Date(),
        },
      });
    }
  }
}, 60_000);

async function warmed() {
  const { resourceMetrics } = await metricReader.collect();
  const found = resourceMetrics.scopeMetrics
    .flatMap((scope) => scope.metrics)
    .find((metric) => metric.descriptor.name === 'motorfix_cache_total');
  return Object.fromEntries(
    (found?.dataPoints ?? [])
      .filter((point) => point.attributes['outcome'] === 'warm')
      .map((point) => [point.attributes['kind'], point.value as number]),
  );
}

const profileWarm = (slug: string) => other.exists(`v1:profile:${slug}:-`);

// @traces 1182-FR-013
describe('warming the cache after a deploy', () => {
  it('warms the 200 most-read profiles and the brand pages once per release', async () => {
    const release = `rel-${randomUUID()}`;
    const before = await warmed();

    await warmCache(app, release);

    const after = await warmed();
    expect((after['profile'] ?? 0) - (before['profile'] ?? 0)).toBe(200);
    expect(
      (after['popular-brands'] ?? 0) - (before['popular-brands'] ?? 0),
    ).toBe(1);
    expect((after['home'] ?? 0) - (before['home'] ?? 0)).toBe(2);
    expect(await profileWarm(slugs[0] as string)).toBe(1);
    expect(await profileWarm(slugs[2] as string)).toBe(1);
    // Past the three with views, the most recently approved come first.
    expect(await profileWarm(slugs[202] as string)).toBe(1);
    expect(await profileWarm(slugs[3] as string)).toBe(0);
    expect(await other.exists('v1:home:dacia:-', 'v1:home:ford:-')).toBe(2);

    const read = jest.spyOn(PublicGaragesService.prototype, 'bySlug');
    await warmCache(app, release);
    expect(read).not.toHaveBeenCalled();
    expect(await other.pttl(`v1:warm:${release}`)).toBeGreaterThan(86_000_000);
  }, 60_000);

  it('warms nothing without a release', async () => {
    const read = jest.spyOn(PublicGaragesService.prototype, 'bySlug');

    await warmCache(app, 'dev');

    expect(read).not.toHaveBeenCalled();
  });

  it('skips the reads that fail, with one warning, and warms the rest', async () => {
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    jest
      .spyOn(PublicGaragesService.prototype, 'bySlug')
      .mockRejectedValue(new Error('database gone'));

    await expect(
      warmCache(app, `rel-${randomUUID()}`),
    ).resolves.toBeUndefined();

    expect(
      warn.mock.calls.filter(([m]) => /warm-up/.test(String(m))),
    ).toHaveLength(1);
    expect(await other.exists('v1:home:dacia:-', 'v1:home:ford:-')).toBe(2);
  });
});
