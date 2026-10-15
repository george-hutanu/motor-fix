import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Redis } from 'ioredis';
import request from 'supertest';

import { SearchModule } from './search.module';
import { AuthModule } from '../auth/auth.module';
import { serialDatabase } from '../auth/serial-db.testing';
import { purgeTags } from '../cache/purge';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
} from '../notifications/notifications.testing';

const redisUrl = redisUrlFor(3);
const { prisma } = fixtures();
serialDatabase(databaseUrl);
const other = new Redis(redisUrl);

let app: INestApplication;

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
});

beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE brand, garage CASCADE');
  await purgeTags(other, ['search']);
  await prisma.brand.create({
    data: { key: 'dacia', name: 'Dacia', popularity: 7, slug: 'dacia' },
  });
});

afterAll(async () => {
  await app.close();
  other.disconnect();
  await prisma.$disconnect();
});

const get = (path: string, query: Record<string, string> = {}) =>
  request(app.getHttpServer()).get(path).query(query);

const renameDacia = () =>
  prisma.brand.update({
    data: { name: 'Dacia nouă' },
    where: { slug: 'dacia' },
  });

// @traces 1182-FR-008
describe('the brand Home answer through the cache service', () => {
  it('answers the second read from the cache, keyed by brand and place, tagged search', async () => {
    const first = await get('/home', { brand: 'dacia' });
    await get('/home', { brand: 'dacia', near: '44.43251,26.10389' });
    await renameDacia();

    const second = await get('/home', { brand: 'dacia' });

    expect(second.body).toEqual(first.body);
    expect(second.body.brand.name).toBe('Dacia');
    expect((await other.smembers('v1:tag:search')).sort()).toEqual(
      ['v1:home:dacia:-', 'v1:home:dacia:44.433,26.104'].sort(),
    );
    const ttl = await other.pttl('v1:home:dacia:-');
    expect(ttl).toBeGreaterThan(54_000 + 590_000);
    expect(ttl).toBeLessThanOrEqual(66_000 + 600_000);
  });

  it('reads again once the search tag is purged', async () => {
    await get('/home', { brand: 'dacia' });
    await renameDacia();
    await purgeTags(other, ['search']);

    expect((await get('/home', { brand: 'dacia' })).body.brand.name).toBe(
      'Dacia nouă',
    );
  });

  it('keeps an unknown brand’s 404 out of the cache', async () => {
    expect((await get('/home', { brand: 'tesla' })).status).toBe(404);
    expect(await other.exists('v1:home:tesla:-')).toBe(0);
  });
});

// @traces 1182-FR-004 1182-FR-008
describe('the popular tiles through the cache service', () => {
  it('answers the second read from the cache, keyed by limit, tagged search', async () => {
    const first = await get('/brands/popular', { limit: '3' });
    await renameDacia();

    const second = await get('/brands/popular', { limit: '3' });

    expect(second.body).toEqual(first.body);
    expect(await other.smembers('v1:tag:search')).toEqual([
      'v1:popular-brands:3',
    ]);
  });

  it('remembers an empty list for 60 seconds', async () => {
    await prisma.$executeRawUnsafe('TRUNCATE brand, garage CASCADE');

    expect((await get('/brands/popular', { limit: '2' })).body).toEqual([]);

    const ttl = await other.pttl('v1:popular-brands:2');
    expect(ttl).toBeGreaterThan(50_000);
    expect(ttl).toBeLessThanOrEqual(66_000);
  });
});
