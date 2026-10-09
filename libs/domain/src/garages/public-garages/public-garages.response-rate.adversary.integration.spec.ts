import { randomUUID } from 'node:crypto';

import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AuthModule } from '../../auth/auth.module';
import { serialDatabase } from '../../auth/serial-db.testing';
import { NotificationsModule } from '../../notifications/notifications.module';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
  testConfig,
} from '../../notifications/notifications.testing';
import { GaragesModule } from '../garages.module';

const redisUrl = redisUrlFor(2);
const { prisma, reset } = fixtures();
serialDatabase(databaseUrl);

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
      GaragesModule.register(email, notifications, {
        skipManualApproval: false,
      }),
    ],
  }).compile();
  app = moduleRef.createNestApplication<NestExpressApplication>();
  await app.init();
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await reset();
  await prisma.$executeRawUnsafe('TRUNCATE brand CASCADE');
});

const read = (slug: string) =>
  request(app.getHttpServer()).get(`/garages/${slug}`);

async function garage(
  stats?: { lifetime: number; requests: number; rate: number | null },
  status: 'approved' | 'suspended' = 'approved',
) {
  const created = await prisma.garage.create({
    data: {
      name: 'Atelier Dinamo',
      slug: `dinamo-${randomUUID()}`,
      status,
    },
  });
  if (stats) {
    await prisma.garageResponseStats.create({
      data: {
        answeredWithinDay30d: stats.rate === null ? 0 : stats.requests,
        computedAt: new Date(),
        garageId: created.id,
        lifetimeRequests: stats.lifetime,
        rate: stats.rate,
        requests30d: stats.requests,
      },
    });
  }
  return created;
}

// @traces 384-FR-008 384-FR-009
describe('the response rate on the public profile', () => {
  it('answers the rate without a rate field being absent at 0 percent', async () => {
    const g = await garage({ lifetime: 10, rate: 0, requests: 4 });

    const res = await read(g.slug);

    expect(res.status).toBe(200);
    expect(res.body.responseRate).toEqual({ rate: 0, state: 'rate' });
  });

  it('answers 100 percent as a rate', async () => {
    const g = await garage({ lifetime: 25, rate: 100, requests: 25 });

    expect((await read(g.slug)).body.responseRate).toEqual({
      rate: 100,
      state: 'rate',
    });
  });

  it('answers new, with no rate key, below ten lifetime requests', async () => {
    const g = await garage({ lifetime: 9, rate: 80, requests: 9 });

    const res = await read(g.slug);

    expect(res.body.responseRate).toEqual({ state: 'new' });
    expect(Object.keys(res.body.responseRate)).toEqual(['state']);
  });

  it('answers none, with no rate key, when nothing was counted in 30 days', async () => {
    const g = await garage({ lifetime: 10, rate: null, requests: 0 });

    const res = await read(g.slug);

    expect(res.body.responseRate).toEqual({ state: 'none' });
    expect(Object.keys(res.body.responseRate)).toEqual(['state']);
  });

  it('answers new for an approved garage the night has not reached', async () => {
    const g = await garage();

    expect((await read(g.slug)).body.responseRate).toEqual({ state: 'new' });
  });

  it('still answers 410 and no rate for a suspended garage that had a row', async () => {
    const g = await garage(
      { lifetime: 30, rate: 90, requests: 20 },
      'suspended',
    );

    const res = await read(g.slug);

    expect(res.status).toBe(410);
    expect(res.body.responseRate).toBeUndefined();
  });

  it('answers the same rate twice, the second time from the cache', async () => {
    const g = await garage({ lifetime: 12, rate: 58, requests: 12 });

    const first = await read(g.slug);
    const second = await read(g.slug);

    expect([first.body.responseRate, second.body.responseRate]).toEqual([
      { rate: 58, state: 'rate' },
      { rate: 58, state: 'rate' },
    ]);
  });
});
