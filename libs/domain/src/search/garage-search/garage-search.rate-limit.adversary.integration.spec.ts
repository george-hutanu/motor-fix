import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Redis } from 'ioredis';
import request from 'supertest';

import { AuthModule } from '../../auth/auth.module';
import { serialDatabase } from '../../auth/serial-db.testing';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
} from '../../notifications/notifications.testing';
import { ROUTE_LIMITS } from '../../rate-limit/rate-limit.config';
import { SearchModule } from '../search.module';

const redisUrl = redisUrlFor(3);
const { prisma } = fixtures();
const store = new Redis(redisUrl);
serialDatabase(databaseUrl);

let app: INestApplication;
let dacia: string;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [
      AuthModule.register({ databaseUrl, redisUrl, tokenSecret: 'test' }),
      SearchModule,
    ],
  }).compile();
  app = moduleRef.createNestApplication();
  // The API trusts the edge's forwarded address (apps/api bootstrap).
  app.getHttpAdapter().getInstance().set('trust proxy', 'loopback');
  // The API's own pipe options (apps/api bootstrap).
  app.useGlobalPipes(
    new ValidationPipe({
      forbidNonWhitelisted: true,
      transform: true,
      whitelist: true,
    }),
  );
  await app.init();
});

beforeEach(async () => {
  // Every case searches from this one machine: no case spends another's count.
  const counts = await store.keys(`${ROUTE_LIMITS.search.key}:*`);
  if (counts.length) await store.del(...counts);
  await prisma.$executeRawUnsafe('TRUNCATE brand, garage CASCADE');
  dacia = (
    await prisma.brand.create({
      data: { key: 'dacia', name: 'Dacia', slug: 'dacia' },
    })
  ).id;
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
  await store.quit();
});

const search = (address: string, query: Record<string, string> = {}) =>
  request(app.getHttpServer())
    .get('/search/garages')
    .set('X-Forwarded-For', address)
    .query({ brandId: dacia, ...query });

// @traces 1181-FR-001
// @traces 1181-FR-003
describe('GET /search/garages rate limit', () => {
  const spend = async (address: string, count: number, query = {}) => {
    for (let i = 0; i < count; i++)
      expect((await search(address, query)).status).toBe(200);
  };

  it('refuses the call past the limit with a code and the seconds to wait', async () => {
    await spend('203.0.113.10', ROUTE_LIMITS.search.limit);

    const res = await search('203.0.113.10');

    expect(res.status).toBe(429);
    expect(res.body).toMatchObject({ code: 'rate_limited' });
    expect(res.body.retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });

  it('counts log=1 calls like any other', async () => {
    await spend('203.0.113.11', ROUTE_LIMITS.search.limit / 2);
    await spend('203.0.113.11', ROUTE_LIMITS.search.limit / 2, { log: '1' });

    expect((await search('203.0.113.11', { log: '1' })).status).toBe(429);
  });

  it('writes no search log row for a refused log=1 call', async () => {
    await spend('203.0.113.12', ROUTE_LIMITS.search.limit);
    const before = await prisma.searchLog.count();

    const res = await search('203.0.113.12', { log: '1' });

    expect(res.status).toBe(429);
    expect(await prisma.searchLog.count()).toBe(before);
  });

  it('admits another address while the first is refused', async () => {
    await spend('203.0.113.13', ROUTE_LIMITS.search.limit);

    expect((await search('203.0.113.13')).status).toBe(429);
    expect((await search('203.0.113.14')).status).toBe(200);
  });

  it('still refuses an invalid query for its own reason without spending the count', async () => {
    for (let i = 0; i < ROUTE_LIMITS.search.limit + 5; i++)
      expect((await search('203.0.113.15', { brandId: 'nope' })).status).toBe(
        400,
      );

    expect((await search('203.0.113.15')).status).toBe(200);
  });

  it('does not fail on an unparseable forwarded address', async () => {
    const res = await search('not-an-address');

    expect(res.status).toBe(200);
  });

  it('counts an IPv4-mapped IPv6 address as the plain address', async () => {
    await spend('203.0.113.16', ROUTE_LIMITS.search.limit);

    expect((await search('::ffff:203.0.113.16')).status).toBe(429);
  });
});
