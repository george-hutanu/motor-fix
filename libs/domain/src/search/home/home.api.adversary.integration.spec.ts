import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AuthModule } from '../../auth/auth.module';
import { serialDatabase } from '../../auth/serial-db.testing';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
} from '../../notifications/notifications.testing';
import { SearchModule } from '../search.module';

const redisUrl = redisUrlFor(3);
const { prisma } = fixtures();
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

beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE brand, garage CASCADE');
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

const http = () => request(app.getHttpServer());
const home = (query: string) => http().get(`/home?${query}`);
const popular = (query = '') => http().get(`/brands/popular?${query}`);

async function brand(
  slug: string,
  popularity: number | null,
  active = true,
  name = slug,
) {
  return (
    await prisma.brand.create({
      data: { active, key: slug, name, popularity, slug },
    })
  ).id;
}

async function garage(
  slug: string,
  status: 'draft' | 'approved' | 'suspended',
  brandId?: string,
  stance?: 'works_on' | 'does_not_take',
) {
  const { id } = await prisma.garage.create({
    data: { name: slug, slug, status },
  });
  if (brandId && stance) {
    await prisma.garageBrand.create({
      data: {
        brandId,
        garageId: id,
        stance,
        ...(stance === 'does_not_take' && {
          diesel: false,
          electric: false,
          hybrid: false,
          petrol: false,
        }),
      },
    });
  }
}

describe('GET /home against hostile queries', () => {
  it.each([
    ['a repeated brand', 'brand=dacia&brand=bmw'],
    ['a brand in capitals', 'brand=Dacia'],
    ['an encoded control character', 'brand=da%00cia'],
    ['an encoded newline', 'brand=dacia%0A'],
    ['an accented brand', 'brand=dacia%C3%A0'],
    ['a trailing space', 'brand=dacia%20'],
    ['an empty brand with a place', 'brand=&near=44,26'],
    ['a repeated place', 'brand=dacia&near=44,26&near=45,27'],
    ['a place without a longitude', 'brand=dacia&near=44'],
    ['an infinite place', 'brand=dacia&near=Infinity,0'],
    ['an empty place', 'brand=dacia&near='],
    ['a brand of 61 characters', `brand=${'a'.repeat(61)}`],
    ['a stray field', 'brand=dacia&limit=3'],
    ['a bracketed object brand', 'brand[slug]=dacia'],
  ])('answers 400 for %s', async (_, query) => {
    await brand('dacia', 7);

    const res = await home(query);

    expect(res.status).toBe(400);
  });

  it('answers 404 rather than 400 for a well-formed slug of 60 characters that no brand holds', async () => {
    const res = await home(`brand=${'a'.repeat(60)}`);

    expect(res.status).toBe(404);
  });

  it('answers 404 for an unknown brand even with a valid place', async () => {
    const res = await home('brand=lada&near=44.43,26.10');

    expect(res.status).toBe(404);
  });

  it('answers 400 for a bad place before it looks the brand up', async () => {
    const res = await home('brand=lada&near=999,0');

    expect(res.status).toBe(400);
  });

  it('does not set a public cache header on a refusal', async () => {
    const res = await home('brand=');

    expect(res.headers['cache-control']).not.toBe('public, max-age=60');
  });
});

describe('GET /home counts', () => {
  it('counts only the answers for the asked brand', async () => {
    const dacia = await brand('dacia', 7, true, 'Dacia');
    const bmw = await brand('bmw', 1, true, 'BMW');
    await garage('a', 'approved', dacia, 'works_on');
    await garage('b', 'approved', bmw, 'works_on');
    await garage('c', 'approved', bmw, 'works_on');

    const res = await home('brand=dacia');

    expect(res.body).toMatchObject({ takers: 1, total: 3 });
  });

  it('counts a garage once when it answers for many brands', async () => {
    const dacia = await brand('dacia', 7, true, 'Dacia');
    const bmw = await brand('bmw', 1, true, 'BMW');
    const { id } = await prisma.garage.create({
      data: { name: 'x', slug: 'x', status: 'approved' },
    });
    await prisma.garageBrand.createMany({
      data: [
        { brandId: dacia, garageId: id, stance: 'works_on' },
        { brandId: bmw, garageId: id, stance: 'works_on' },
      ],
    });

    const res = await home('brand=dacia');

    expect(res.body).toMatchObject({ takers: 1, total: 1 });
  });

  it('counts a suspended garage nowhere', async () => {
    const dacia = await brand('dacia', 7, true, 'Dacia');
    await garage('s', 'suspended', dacia, 'works_on');
    await garage('a', 'approved', dacia, 'works_on');

    const res = await home('brand=dacia');

    expect(res.body).toMatchObject({ takers: 1, total: 1 });
  });

  it('keeps takers at most total with every garage taking the brand', async () => {
    const dacia = await brand('dacia', 7, true, 'Dacia');
    for (const s of ['a', 'b', 'c']) {
      await garage(s, 'approved', dacia, 'works_on');
    }

    const res = await home('brand=dacia');

    expect(res.body).toMatchObject({ takers: 3, total: 3 });
  });

  it('answers a brand without a popularity rank with a null rank', async () => {
    await brand('lada', null, true, 'Lada');

    const res = await home('brand=lada');

    expect(res.status).toBe(200);
    expect(res.body.brand).toMatchObject({ name: 'Lada', slug: 'lada' });
    expect(res.body.brand.popularity ?? null).toBeNull();
  });

  it('answers the same twice and writes no garage row', async () => {
    const dacia = await brand('dacia', 7, true, 'Dacia');
    await garage('a', 'approved', dacia, 'works_on');
    const before = await prisma.garage.count();

    const first = await home('brand=dacia');
    const second = await home('brand=dacia');

    expect(second.body).toEqual(first.body);
    expect(await prisma.garage.count()).toBe(before);
  });

  it('answers a visitor with an invalid bearer token the same as no token', async () => {
    await brand('dacia', 7, true, 'Dacia');

    const res = await home('brand=dacia').set(
      'Authorization',
      'Bearer nonsense',
    );

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('public, max-age=60');
  });

  it('answers a thousand approved garages with the right totals', async () => {
    const dacia = await brand('dacia', 7, true, 'Dacia');
    await prisma.garage.createMany({
      data: Array.from({ length: 1000 }, (_, i) => ({
        name: `g${i}`,
        slug: `g${i}`,
        status: 'approved' as const,
      })),
    });
    const rows = await prisma.garage.findMany({ select: { id: true } });
    await prisma.garageBrand.createMany({
      data: rows.slice(0, 400).map((r) => ({
        brandId: dacia,
        garageId: r.id,
        stance: 'works_on' as const,
      })),
    });

    const res = await home('brand=dacia');

    expect(res.body).toMatchObject({ takers: 400, total: 1000 });
  });
});

describe('GET /brands/popular', () => {
  it('orders by rank, then unranked by name, and drops retired brands', async () => {
    await brand('zeta', null, true, 'Zeta');
    await brand('alpha', null, true, 'Alpha');
    await brand('second', 2, true, 'Second');
    await brand('first', 1, true, 'First');
    await brand('gone', 1, false, 'Gone');

    const res = await popular();

    expect(res.status).toBe(200);
    expect(res.body.map((b: { slug: string }) => b.slug)).toEqual([
      'first',
      'second',
      'alpha',
      'zeta',
    ]);
  });

  it('breaks a tie of ranks by name', async () => {
    await brand('b', 4, true, 'Bravo');
    await brand('a', 4, true, 'Alpha');

    const res = await popular();

    expect(res.body.map((b: { name: string }) => b.name)).toEqual([
      'Alpha',
      'Bravo',
    ]);
  });

  it('answers an empty list, not an error, with no active brand', async () => {
    await brand('gone', 1, false);

    const res = await popular();

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('answers eight of fifteen by default and twelve at the cap', async () => {
    for (let i = 1; i <= 15; i++) {
      await brand(`b${String(i).padStart(2, '0')}`, i);
    }

    expect((await popular()).body).toHaveLength(8);
    expect((await popular('limit=12')).body).toHaveLength(12);
    expect((await popular('limit=1')).body).toHaveLength(1);
  });

  it('answers all the brands when the limit is above their number', async () => {
    await brand('a', 1);
    await brand('b', 2);

    const res = await popular('limit=12');

    expect(res.body).toHaveLength(2);
  });

  it('answers a shorter list as a prefix of a longer one', async () => {
    for (let i = 1; i <= 10; i++) {
      await brand(`b${String(i).padStart(2, '0')}`, i);
    }

    const three = (await popular('limit=3')).body;
    const nine = (await popular('limit=9')).body;

    expect(nine.slice(0, 3)).toEqual(three);
  });

  it.each([
    'limit=-1',
    'limit=abc',
    'limit=',
    'limit=1&limit=2',
    'limit=3&sort=name',
    'limit[a]=1',
  ])('answers 400 for %s', async (query) => {
    await brand('a', 1);

    const res = await popular(query);

    expect(res.status).toBe(400);
  });

  it('gives the same list to a visitor and to a caller with a bad token', async () => {
    await brand('a', 1);
    await brand('b', 2);

    const visitor = await popular();
    const odd = await popular().set('Authorization', 'Bearer nonsense');

    expect(odd.status).toBe(200);
    expect(odd.body).toEqual(visitor.body);
  });

  it('answers each brand with exactly id, name, slug and popularity', async () => {
    const id = await brand('a', 1, true, 'A');

    const res = await popular();

    expect(res.body).toEqual([{ id, name: 'A', popularity: 1, slug: 'a' }]);
  });
});
