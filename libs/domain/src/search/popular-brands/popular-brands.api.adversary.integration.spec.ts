import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { signAccessToken } from '../../auth/access-token';
import { AUTH_REDIS } from '../../auth/attempts';
import { AuthModule } from '../../auth/auth.module';
import { serialDatabase } from '../../auth/serial-db.testing';
import { PUBLIC_POLICY } from '../../cache/http-cache/http-cache.interceptor';
import { purgeTags } from '../../cache/purge';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
} from '../../notifications/notifications.testing';
import { SearchModule } from '../search.module';

const redisUrl = redisUrlFor(3);
const { account, prisma } = fixtures();
serialDatabase(databaseUrl);

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

let driver: string;
let other: string;
let carNo = 0;

beforeEach(async () => {
  await purgeTags(app.get(AUTH_REDIS), ['search']);
  await prisma.$executeRawUnsafe('TRUNCATE brand, garage, account CASCADE');
  driver = await account('ana');
  other = await account('bob');
  carNo = 0;
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

const bearerFor = (accountId: string) =>
  `Bearer ${signAccessToken({ accountId, role: 'driver' }, 'test')}`;

const popular = (query: Record<string, string> = {}, as?: string) => {
  const req = request(app.getHttpServer()).get('/brands/popular').query(query);
  return as ? req.set('Authorization', bearerFor(as)) : req;
};

async function brand(
  name: string,
  popularity: number | null,
  active = true,
): Promise<string> {
  return (
    await prisma.brand.create({
      data: {
        active,
        key: name.toLowerCase(),
        name,
        popularity,
        slug: name.toLowerCase(),
      },
    })
  ).id;
}

async function car(
  ownerId: string,
  brandId: string,
  createdAt: string,
  removedAt?: string,
) {
  carNo += 1;
  await prisma.car.create({
    data: {
      brandId,
      createdAt: new Date(createdAt),
      fuel: 'petrol',
      idempotencyKey: `k${carNo}`,
      model: 'M',
      odometerKm: 1,
      ownerId,
      removedAt: removedAt ? new Date(removedAt) : null,
      year: 2020,
    },
  });
}

const names = (body: { name: string }[]) => body.map((b) => b.name);

describe('GET /brands/popular for a signed-in driver, hostile data', () => {
  // @traces 007-brand-headline-FR-014
  it('puts the oldest car first, whatever the order the cars were inserted in', async () => {
    const [a, b, c] = [
      await brand('Aaa', 1),
      await brand('Bbb', 2),
      await brand('Ccc', 3),
    ];
    await brand('Ddd', 4);
    await car(driver, c, '2024-03-01T00:00:00Z');
    await car(driver, a, '2024-01-01T00:00:00Z');
    await car(driver, b, '2024-02-01T00:00:00Z');

    const res = await popular({}, driver);

    expect(names(res.body)).toEqual(['Aaa', 'Bbb', 'Ccc', 'Ddd']);
    const unpopularFirst = await popular({ limit: '3' }, driver);
    expect(names(unpopularFirst.body)).toEqual(['Aaa', 'Bbb', 'Ccc']);
  });

  it('lists a brand held by two cars once, at its oldest car’s place', async () => {
    const dacia = await brand('Dacia', 5);
    const kia = await brand('Kia', 6);
    await brand('Bmw', 1);
    await car(driver, dacia, '2024-01-01T00:00:00Z');
    await car(driver, kia, '2024-02-01T00:00:00Z');
    await car(driver, dacia, '2024-03-01T00:00:00Z');

    const res = await popular({}, driver);

    expect(names(res.body)).toEqual(['Dacia', 'Kia', 'Bmw']);
  });

  it('leaves out a removed car’s brand and a retired brand', async () => {
    const gone = await brand('Gone', 1);
    const retired = await brand('Retired', 2, false);
    const kept = await brand('Kept', 3);
    await brand('Other', 4);
    await car(driver, gone, '2024-01-01T00:00:00Z', '2024-02-01T00:00:00Z');
    await car(driver, retired, '2024-01-02T00:00:00Z');
    await car(driver, kept, '2024-01-03T00:00:00Z');

    const res = await popular({}, driver);

    expect(names(res.body)).toEqual(['Kept', 'Gone', 'Other']);
  });

  it('keeps a brand whose only removed car is joined by a live one', async () => {
    const dacia = await brand('Dacia', 5);
    await brand('Bmw', 1);
    await car(driver, dacia, '2024-01-01T00:00:00Z', '2024-02-01T00:00:00Z');
    await car(driver, dacia, '2024-03-01T00:00:00Z');

    expect(names((await popular({}, driver)).body)).toEqual(['Dacia', 'Bmw']);
  });

  it('answers only the first eight of ten own brands and no popular brand', async () => {
    const ids: string[] = [];
    for (let n = 1; n <= 10; n++) ids.push(await brand(`Own${n}`, 20 + n));
    await brand('Hot', 1);
    for (const [n, id] of ids.entries())
      await car(
        driver,
        id,
        `2024-01-${String(n + 1).padStart(2, '0')}T00:00:00Z`,
      );

    const res = await popular({}, driver);

    expect(names(res.body)).toEqual(
      Array.from({ length: 8 }, (_, n) => `Own${n + 1}`),
    );
  });

  it('caps at limit one with the oldest own brand', async () => {
    const dacia = await brand('Dacia', 5);
    const kia = await brand('Kia', 6);
    await brand('Bmw', 1);
    await car(driver, kia, '2024-02-01T00:00:00Z');
    await car(driver, dacia, '2024-01-01T00:00:00Z');

    expect(names((await popular({ limit: '1' }, driver)).body)).toEqual([
      'Dacia',
    ]);
  });

  it('moves an own brand out of the popular eight without duplicating it and fills the eighth', async () => {
    const ids: string[] = [];
    for (let n = 1; n <= 9; n++) ids.push(await brand(`Pop${n}`, n));
    await car(driver, ids[8], '2024-01-01T00:00:00Z');

    const res = await popular({}, driver);

    expect(names(res.body)).toEqual([
      'Pop9',
      'Pop1',
      'Pop2',
      'Pop3',
      'Pop4',
      'Pop5',
      'Pop6',
      'Pop7',
    ]);
  });

  it('answers a driver with no car what a visitor gets, still private', async () => {
    await brand('Bmw', 1);
    await brand('Mini', 2);

    const res = await popular({}, driver);

    expect(names(res.body)).toEqual(['Bmw', 'Mini']);
    expect(res.headers['cache-control']).toBe('private, no-cache');
  });

  it('never shows another driver’s cars', async () => {
    const dacia = await brand('Dacia', 5);
    await brand('Bmw', 1);
    await car(other, dacia, '2024-01-01T00:00:00Z');

    const res = await popular({}, driver);

    expect(names(res.body)).toEqual(['Bmw', 'Dacia']);
  });

  it('carries the your form on a driver’s own tile', async () => {
    await prisma.brand.create({
      data: {
        key: 'bmw',
        name: 'BMW',
        popularity: 9,
        roPossessive: 'BMW‑ul tău',
        slug: 'bmw',
      },
    });
    const bmw = (await prisma.brand.findFirstOrThrow()).id;
    await brand('Aaa', 1);
    await car(driver, bmw, '2024-01-01T00:00:00Z');

    const res = await popular({}, driver);

    expect(res.body[0]).toEqual(
      expect.objectContaining({ name: 'BMW', roPossessive: 'BMW‑ul tău' }),
    );
  });
});

describe('GET /brands/popular caching across callers', () => {
  // @traces 007-brand-headline-FR-016
  it('serves a driver their own list after a visitor warmed the cache', async () => {
    const dacia = await brand('Dacia', 5);
    await brand('Bmw', 1);
    await car(driver, dacia, '2024-01-01T00:00:00Z');
    const visitor = await popular();

    const mine = await popular({}, driver);

    expect(names(visitor.body)).toEqual(['Bmw', 'Dacia']);
    expect(visitor.headers['cache-control']).toBe(PUBLIC_POLICY);
    expect(names(mine.body)).toEqual(['Dacia', 'Bmw']);
    expect(mine.headers['cache-control']).toBe('private, no-cache');
  });

  it('serves a visitor the popular list after a driver asked first', async () => {
    const dacia = await brand('Dacia', 5);
    await brand('Bmw', 1);
    await car(driver, dacia, '2024-01-01T00:00:00Z');
    await popular({}, driver);

    const visitor = await popular();

    expect(names(visitor.body)).toEqual(['Bmw', 'Dacia']);
    expect(visitor.headers['cache-control']).toBe(PUBLIC_POLICY);
  });

  it('keeps two drivers apart', async () => {
    const dacia = await brand('Dacia', 5);
    const kia = await brand('Kia', 6);
    await brand('Bmw', 1);
    await car(driver, dacia, '2024-01-01T00:00:00Z');
    await car(other, kia, '2024-01-01T00:00:00Z');

    const a = await popular({}, driver);
    const b = await popular({}, other);

    expect(names(a.body)[0]).toBe('Dacia');
    expect(names(b.body)[0]).toBe('Kia');
  });

  it('shows a driver a car added after their first read', async () => {
    const dacia = await brand('Dacia', 5);
    await brand('Bmw', 1);
    await popular({}, driver);
    await car(driver, dacia, '2024-01-01T00:00:00Z');

    expect(names((await popular({}, driver)).body)).toEqual(['Dacia', 'Bmw']);
  });

  it('never marks a driver’s refused limit public', async () => {
    const res = await popular({ limit: '0' }, driver);

    expect(res.status).toBe(400);
    expect(String(res.headers['cache-control'] ?? '')).not.toContain('public');
  });

  it('answers a driver for an unknown extra query field with 400', async () => {
    const res = await popular({ limit: '3', of: 'x' }, driver);

    expect(res.status).toBe(400);
  });

  it.each(['Bearer ', 'Basic abc', 'bearer'])(
    'treats the header %j as a visitor, publicly cached',
    async (value) => {
      await brand('Bmw', 1);

      const res = await request(app.getHttpServer())
        .get('/brands/popular')
        .set('Authorization', value);

      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe(PUBLIC_POLICY);
    },
  );

  it('treats a token signed with another secret as a visitor', async () => {
    await brand('Bmw', 1);
    const token = signAccessToken(
      { accountId: driver, role: 'driver' },
      'other-secret',
    );

    const res = await request(app.getHttpServer())
      .get('/brands/popular')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe(PUBLIC_POLICY);
  });
});
