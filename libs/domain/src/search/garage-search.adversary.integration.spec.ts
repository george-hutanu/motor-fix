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

async function garage(
  name: string,
  stance: Stance,
  brandId = bmw,
  status: 'approved' | 'suspended' | 'draft' = 'approved',
  id?: string,
) {
  const created = await prisma.garage.create({
    data: {
      ...(id ? { id } : {}),
      name,
      slug: `g-${randomUUID()}`,
      status,
      ...(status === 'approved' ? { approvedAt: new Date() } : {}),
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
  it('answers an empty list with zero counts when no garage exists', async () => {
    const res = await search({ brandId: bmw });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      counts: { doesNotTake: 0, worksOn: 0 },
      items: [],
      nextCursor: null,
      total: 0,
    });
  });

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

  it('reads 25 takers and 25 refusers as all takers first without repeat or skip', async () => {
    for (let i = 0; i < 25; i += 1) {
      await garage(`Z taker ${pad(i)}`, 'works_on');
      await garage(`A refuser ${pad(i)}`, i % 2 ? 'does_not_take' : 'unstated');
    }

    const pages = await readAll(bmw);
    const all = pages.flatMap((p) => p.items);

    expect(pages.map((p) => p.items.length)).toEqual([20, 20, 10]);
    expect(all.slice(0, 25).map((g) => g.name)).toEqual(
      Array.from({ length: 25 }, (_, i) => `Z taker ${pad(i)}`),
    );
    expect(all.slice(25).map((g) => g.name)).toEqual(
      Array.from({ length: 25 }, (_, i) => `A refuser ${pad(i)}`),
    );
    expect(new Set(all.map((g) => g.id)).size).toBe(50);
  });

  it('keeps the counts the same on every page', async () => {
    for (let i = 0; i < 30; i += 1) {
      await garage(`T${pad(i)}`, 'works_on');
    }
    for (let i = 0; i < 18; i += 1) {
      await garage(`R${pad(i)}`, 'does_not_take');
    }

    const pages = (await readAll(bmw)) as unknown as {
      counts: unknown;
      total: number;
    }[];

    expect(pages).toHaveLength(3);
    for (const page of pages) {
      expect(page.counts).toEqual({ doesNotTake: 18, worksOn: 30 });
      expect(page.total).toBe(48);
    }
  });

  it('settles same-name garages by id across a page boundary', async () => {
    const ids = Array.from({ length: 25 }, () => randomUUID()).sort();
    for (const id of [...ids].reverse()) {
      await garage('Same Name', 'works_on', bmw, 'approved', id);
    }

    const all = (await readAll(bmw)).flatMap((p) => p.items);

    expect(all.map((g) => g.id)).toEqual(ids);
  });

  it('pages through names with quotes, percent, backslash and non-ASCII characters', async () => {
    const names = [
      `Ana "Ș" & Fiii`,
      `O'Brien % _ \\ Auto`,
      '日本 Auto',
      'Ünal Garaj',
      'Zed\u0000-less',
    ].map((n) => n.replace('\u0000', ''));
    for (let i = 0; i < 22; i += 1) {
      await garage(`${names[i % names.length]} ${pad(i)}`, 'works_on');
    }

    const all = (await readAll(bmw)).flatMap((p) => p.items);

    expect(all).toHaveLength(22);
    expect(new Set(all.map((g) => g.id)).size).toBe(22);
  });

  it('never lists a suspended or draft garage and never counts it', async () => {
    await garage('Approved taker', 'works_on');
    await garage('Suspended taker', 'works_on', bmw, 'suspended');
    await garage('Draft taker', 'works_on', bmw, 'draft');
    await garage('Suspended unmarked', 'unstated', bmw, 'suspended');

    const res = await search({ brandId: bmw });

    expect(res.body.items.map((g: { name: string }) => g.name)).toEqual([
      'Approved taker',
    ]);
    expect(res.body.counts).toEqual({ doesNotTake: 0, worksOn: 1 });
    expect(res.body.total).toBe(1);
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

  it('answers a retired brand like any other', async () => {
    await prisma.brand.update({ data: { active: false }, where: { id: bmw } });
    await garage('Still here', 'works_on');

    const res = await search({ brandId: bmw });

    expect(res.status).toBe(200);
    expect(res.body.counts).toEqual({ doesNotTake: 0, worksOn: 1 });
  });

  it('carries only id, name, slug and stance on a listed garage', async () => {
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
      'id',
      'name',
      'slug',
      'stance',
    ]);
    expect(Object.keys(res.body).sort()).toEqual([
      'counts',
      'items',
      'nextCursor',
      'total',
    ]);
  });

  it('answers the same twice and writes nothing', async () => {
    await garage('Alfa', 'works_on');
    const before = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
      'SELECT (SELECT count(*) FROM garage) + (SELECT count(*) FROM garage_brand) AS n',
    );

    const first = await search({ brandId: bmw });
    const second = await search({ brandId: bmw });
    const after = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
      'SELECT (SELECT count(*) FROM garage) + (SELECT count(*) FROM garage_brand) AS n',
    );

    expect(second.body).toEqual(first.body);
    expect(after[0].n).toBe(before[0].n);
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

    async function realCursor(brandId = bmw) {
      for (let i = 0; i < 21; i += 1) {
        await garage(`G${pad(i)}`, 'works_on', brandId);
      }
      const res = await search({ brandId });
      return res.body.nextCursor as string;
    }

    it('refuses a cursor issued for another brand with invalid_cursor', async () => {
      const cursor = await realCursor(bmw);

      const res = await search({ brandId: tesla, cursor });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('invalid_cursor');
    });

    it('refuses a real cursor whose group is replaced', async () => {
      const cursor = await realCursor();
      const body = JSON.parse(Buffer.from(cursor, 'base64url').toString());
      const groupKey = Object.keys(body).find(
        (k) =>
          (typeof body[k] === 'string' &&
            /^(works|other|refus)/i.test(body[k])) ||
          k === 'group' ||
          k === 'g',
      );
      expect(groupKey).toBeDefined();

      const res = await search({
        brandId: bmw,
        cursor: encode({ ...body, [groupKey as string]: 'bogus' }),
      });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('invalid_cursor');
    });

    it('refuses a real cursor with its group removed', async () => {
      const cursor = await realCursor();
      const body = JSON.parse(Buffer.from(cursor, 'base64url').toString());
      const { group, g, ...rest } = body;

      const res = await search({ brandId: bmw, cursor: encode(rest) });

      expect(group ?? g).toBeDefined();
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('invalid_cursor');
    });

    it('refuses a real cursor whose last id is not a uuid', async () => {
      const cursor = await realCursor();
      const body = JSON.parse(Buffer.from(cursor, 'base64url').toString());
      const idKey = Object.keys(body).find(
        (k) => body[k] !== bmw && /^[0-9a-f-]{36}$/.test(String(body[k])),
      );
      expect(idKey).toBeDefined();

      const res = await search({
        brandId: bmw,
        cursor: encode({ ...body, [idKey as string]: 'not-a-uuid' }),
      });

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

      expect([400, 404]).toContain(res.status);
      expect(res.body.code).toBe(
        res.status === 404 ? 'not_found' : 'invalid_cursor',
      );
    });
  });
});
