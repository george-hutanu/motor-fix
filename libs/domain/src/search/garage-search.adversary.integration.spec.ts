import { randomUUID } from 'node:crypto';

import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { SearchModule } from './search.module';
import { AuthModule } from '../auth/auth.module';
import { serialDatabase } from '../auth/serial-db.testing';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
} from '../notifications/notifications.testing';

const redisUrl = redisUrlFor(3);
const { prisma } = fixtures();
serialDatabase(databaseUrl);

let app: INestApplication;
let bmw: string;
let tesla: string;

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
  bmw = (
    await prisma.brand.create({
      data: { key: 'bmw', name: 'BMW', slug: 'bmw' },
    })
  ).id;
  tesla = (
    await prisma.brand.create({
      data: { key: 'tesla', name: 'Tesla', slug: 'tesla' },
    })
  ).id;
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

const search = (query: Record<string, string | string[]>) =>
  request(app.getHttpServer()).get('/search/garages').query(query);

type Stance = 'works_on' | 'does_not_take' | 'unstated';

async function garage(name: string, stance: Stance, brandId = bmw) {
  const created = await prisma.garage.create({
    data: {
      approvedAt: new Date(),
      name,
      slug: `g-${randomUUID()}`,
      status: 'approved',
    },
  });
  if (stance !== 'unstated') {
    await prisma.garageBrand.create({
      data: {
        brandId,
        garageId: created.id,
        stance,
        ...(stance === 'does_not_take'
          ? { diesel: false, electric: false, hybrid: false, petrol: false }
          : {}),
      },
    });
  }
  return created;
}

const pad = (n: number) => String(n).padStart(3, '0');

async function readAll(brandId: string) {
  const pages: { items: { id: string; name: string; stance: Stance }[] }[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 20; i += 1) {
    const res = await search({ brandId, ...(cursor ? { cursor } : {}) });
    expect(res.status).toBe(200);
    pages.push(res.body);
    if (res.body.nextCursor === null) {
      return pages;
    }
    cursor = res.body.nextCursor;
  }
  throw new Error('paging did not end');
}

describe('GET /search/garages under attack', () => {
  it('answers exactly 20 garages in one page with no next cursor', async () => {
    for (let i = 0; i < 20; i += 1) {
      await garage(`G${pad(i)}`, 'works_on');
    }

    const res = await search({ brandId: bmw });

    expect(res.body.items).toHaveLength(20);
    expect(res.body.nextCursor).toBeNull();
    expect(res.body.total).toBe(20);
  });

  it('answers 21 garages as a page of 20 and a page of 1', async () => {
    for (let i = 0; i < 21; i += 1) {
      await garage(`G${pad(i)}`, 'works_on');
    }

    const pages = await readAll(bmw);

    expect(pages.map((p) => p.items.length)).toEqual([20, 1]);
    expect(pages[1].items[0].name).toBe('G020');
  });

  it('ends a group exactly on a page boundary without skipping the other group', async () => {
    for (let i = 0; i < 20; i += 1) {
      await garage(`T${pad(i)}`, 'works_on');
    }
    await garage('A first refuser', 'does_not_take');

    const pages = await readAll(bmw);

    expect(pages.map((p) => p.items.length)).toEqual([20, 1]);
    expect(pages[1].items[0].stance).toBe('does_not_take');
  });

  it('pages through names with quotes, percent, backslash and non-ASCII characters', async () => {
    const names = [
      `Ana "Ș" & Fiii`,
      `O'Brien % _ \\ Auto`,
      '日本 Auto',
      'Ünal Garaj',
      'Zed-less',
    ];
    for (let i = 0; i < 22; i += 1) {
      await garage(`${names[i % names.length]} ${pad(i)}`, 'works_on');
    }

    const all = (await readAll(bmw)).flatMap((p) => p.items);

    expect(all).toHaveLength(22);
    expect(new Set(all.map((g) => g.id)).size).toBe(22);
  });

  it('does not let another brand answer leak into the stance', async () => {
    await garage('Works on Tesla only', 'works_on', tesla);
    await garage('Refuses Tesla only', 'does_not_take', tesla);

    const res = await search({ brandId: bmw });

    expect(res.body.items.map((g: { stance: string }) => g.stance)).toEqual([
      'unstated',
      'unstated',
    ]);
    expect(res.body.counts).toEqual({ doesNotTake: 2, worksOn: 0 });
  });

  it('reports does_not_take and unstated each on its own garage', async () => {
    await garage('A refuses', 'does_not_take');
    await garage('B silent', 'unstated');

    const res = await search({ brandId: bmw });

    expect(
      res.body.items.map((g: { name: string; stance: string }) => [
        g.name,
        g.stance,
      ]),
    ).toEqual([
      ['A refuses', 'does_not_take'],
      ['B silent', 'unstated'],
    ]);
  });

  it('carries only the garage, its stance and its public brand answer on a listed garage', async () => {
    await prisma.garage.create({
      data: {
        brandNote: 'a note',
        name: 'Noted',
        refusalPhrase: 'sorry',
        slug: 'noted',
        status: 'approved',
      },
    });

    const res = await search({ brandId: bmw });

    expect(Object.keys(res.body.items[0]).sort()).toEqual([
      'brandNote',
      'doesNotTake',
      'id',
      'name',
      'refusalPhrase',
      'slug',
      'stance',
      'worksOn',
    ]);
    expect(res.body.items[0]).toMatchObject({
      brandNote: 'a note',
      refusalPhrase: 'sorry',
    });
    expect(Object.keys(res.body).sort()).toEqual([
      'counts',
      'items',
      'nextCursor',
      'total',
    ]);
  });

  it('accepts an upper-case brand uuid', async () => {
    const res = await search({ brandId: bmw.toUpperCase() });

    expect(res.status).toBe(200);
  });

  it.each([
    ['a repeated brandId', () => ({ brandId: [bmw, bmw] })],
    ['a repeated cursor', () => ({ brandId: bmw, cursor: ['a', 'b'] })],
    ['a nil-looking non-uuid', () => ({ brandId: 'null' })],
    ['an empty brandId', () => ({ brandId: '' })],
    ['a uuid with trailing junk', () => ({ brandId: `${bmw}x` })],
    ['a uuid with a SQL tail', () => ({ brandId: `${bmw}' OR '1'='1` })],
  ])('answers 400 to %s', async (_, query) => {
    const res = await search(query());

    expect(res.status).toBe(400);
  });

  describe('cursors', () => {
    const encode = (value: unknown) =>
      Buffer.from(JSON.stringify(value)).toString('base64url');

    async function realCursor() {
      for (let i = 0; i < 21; i += 1) {
        await garage(`G${pad(i)}`, 'works_on');
      }
      const res = await search({ brandId: bmw });
      return res.body.nextCursor as string;
    }

    it('refuses a real cursor with its group removed', async () => {
      const cursor = await realCursor();
      const { g, ...rest } = JSON.parse(
        Buffer.from(cursor, 'base64url').toString(),
      );

      const res = await search({ brandId: bmw, cursor: encode(rest) });

      expect(g).toBe('works_on');
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('invalid_cursor');
    });

    it.each([
      [
        'valid base64url that is not JSON',
        Buffer.from('hello').toString('base64url'),
      ],
      ['JSON null', encode(null)],
      ['a JSON array', encode([1, 2, 3])],
      ['a JSON number', encode(7)],
      ['an empty object', encode({})],
      [
        'an object with numbers for strings',
        encode({ brandId: 1, group: 1, id: 1, name: 1 }),
      ],
      ['plain base64 with padding and plus signs', '+++/==='],
      ['a unicode string', 'ăîșțâ'],
      ['exactly 200 characters of junk', 'a'.repeat(200)],
    ])('refuses %s with invalid_cursor', async (_, cursor) => {
      const res = await search({ brandId: bmw, cursor });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('invalid_cursor');
    });

    it('refuses a forged cursor naming this brand but no valid position', async () => {
      const res = await search({
        brandId: bmw,
        cursor: encode({ brandId: bmw, group: 'works_on' }),
      });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('invalid_cursor');
    });

    it('answers 404 not_found, not a cursor error, for an unknown brand with a junk cursor', async () => {
      const res = await search({ brandId: randomUUID(), cursor: 'junk' });

      expect(res.status).toBe(404);
      expect(res.body.code).toBe('not_found');
    });
  });
});
