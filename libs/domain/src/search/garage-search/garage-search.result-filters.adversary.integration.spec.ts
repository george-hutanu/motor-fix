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
import { SearchModule } from '../search.module';

const redisUrl = redisUrlFor(3);
const { prisma } = fixtures();
const store = new Redis(redisUrl);
serialDatabase(databaseUrl);

const NEAR = '46.771,23.624';
let app: INestApplication;
let dacia: string;
let seq = 0;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [
      AuthModule.register({ databaseUrl, redisUrl, tokenSecret: 'test' }),
      SearchModule,
    ],
  }).compile();
  app = moduleRef.createNestApplication();
  app.getHttpAdapter().getInstance().set('trust proxy', 'loopback');
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
  await store.flushdb();
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

const list = (query: Record<string, string>) =>
  request(app.getHttpServer())
    .get('/search/garages')
    .query({ brand: 'dacia', near: NEAR, ...query });
const pins = (query: Record<string, string>) =>
  request(app.getHttpServer())
    .get('/search/garages/pins')
    .query({ brand: 'dacia', near: NEAR, ...query });

interface Spec {
  bani?: number | null;
  card?: boolean;
  rating?: number;
  stance?: 'works_on' | 'does_not_take' | null;
  mobile?: boolean;
}

async function garage(name: string, spec: Spec = {}) {
  seq += 1;
  const created = await prisma.garage.create({
    data: {
      labourFromBani: spec.bani ?? null,
      latitude: 46.771 + seq / 10_000,
      longitude: 23.624,
      name,
      paymentCard: spec.card ?? false,
      slug: `${name.toLowerCase().replace(/ /g, '-')}-${seq}`,
      status: 'approved',
      ...(spec.rating !== undefined && {
        rating: spec.rating,
        reviewCount: 2,
      }),
      ...(spec.mobile && {
        businessKind: 'mobile' as const,
        seatAddress: 'Strada Sediului 1, Cluj-Napoca',
        serviceRadiusKm: 30,
      }),
    },
  });
  const stance = spec.stance === undefined ? 'works_on' : spec.stance;
  if (stance) {
    await prisma.garageBrand.create({
      data: {
        brandId: dacia,
        garageId: created.id,
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
  return created.id;
}

const names = (res: request.Response) =>
  res.body.items.map((i: { name: string }) => i.name);

// @traces 1261-FR-002
describe('the price ceiling at the edges', () => {
  it.each([
    [14_949, true],
    [14_950, false],
    [15_000, true],
    [15_049, true],
    [15_050, false],
    [30_049, true],
    [30_050, false],
  ])('a rate of %i bani against 150 lei or 300 lei', async (bani, _) => {
    await garage('Edge', { bani });
    const ceiling = bani > 20_000 ? '300' : '150';
    const fits = bani < Number(ceiling) * 100 + 50;

    const res = await list({ max_price: ceiling });

    expect(names(res)).toEqual(fits ? ['Edge'] : []);
    expect(res.body.total).toBe(fits ? 1 : 0);
  });

  it('leaves out a garage with no rate and one with a zero rate counts as cheap', async () => {
    await garage('None', { bani: null });
    await garage('Zero', { bani: 0 });

    const res = await list({ max_price: '150' });

    expect(names(res)).toEqual(['Zero']);
  });
});

// @traces 1261-FR-003
describe('the minimum rating at the edges', () => {
  it('takes 3.5 and 4.0 exactly and leaves out 3.4 and 3.9', async () => {
    await garage('Low', { rating: 3.4 });
    await garage('Edge', { rating: 3.5 });
    await garage('Just under', { rating: 3.9 });
    await garage('Unreviewed');

    expect(names(await list({ min_rating: '3.5' })).sort()).toEqual([
      'Edge',
      'Just under',
    ]);
    expect(names(await list({ min_rating: '4.0' }))).toEqual([]);
  });

  it('takes a 5.0 garage for every minimum', async () => {
    await garage('Top', { rating: 5 });

    for (const min of ['3.5', '4.0', '4.5']) {
      expect(names(await list({ min_rating: min }))).toEqual(['Top']);
    }
  });
});

// @traces 1261-FR-005 1261-FR-006
describe('filters together with groups, counts and mobile mechanics', () => {
  it('keeps the garages that take the brand first and counts only matches', async () => {
    await garage('Refuses card', { card: true, stance: 'does_not_take' });
    await garage('Unstated card', { card: true, stance: null });
    await garage('Takes card', { card: true });
    await garage('Takes cash');
    await garage('Mobile card', { card: true, mobile: true });

    const res = await list({ card: '1' });

    expect(res.status).toBe(200);
    expect(res.body.counts.worksOn).toBe(2);
    expect(res.body.counts.doesNotTake).toBe(2);
    expect(res.body.total).toBe(4);
    expect(names(res).slice(0, 2).sort()).toEqual([
      'Mobile card',
      'Takes card',
    ]);
    expect(names(res)).not.toContain('Takes cash');
  });

  it('answers all zero and an empty list when nothing matches', async () => {
    await garage('Cash only');

    const res = await list({ card: '1', max_price: '150', min_rating: '4.5' });

    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
    expect(res.body.counts).toEqual({ doesNotTake: 0, worksOn: 0 });
    expect(res.body.total).toBe(0);
    expect(res.body.nextCursor).toBeNull();
  });

  it('counts over every match, not over the page', async () => {
    for (let n = 0; n < 23; n += 1) await garage(`Card ${n}`, { card: true });
    await garage('Cash');

    const res = await list({ card: '1' });

    expect(res.body.items).toHaveLength(20);
    expect(res.body.total).toBe(23);
    expect(res.body.counts.worksOn).toBe(23);
  });

  it('gives the same answer for the same filters asked twice', async () => {
    await garage('Card', { card: true });
    await garage('Cash');

    const first = await list({ card: '1' });
    const second = await list({ card: '1' });

    expect(second.body).toEqual(first.body);
  });

  it('never serves one combination of filters for another', async () => {
    await garage('Card', { bani: 10_000, card: true, rating: 4.5 });
    await garage('Cash', { bani: 40_000, rating: 3.0 });

    expect(names(await list({}))).toHaveLength(2);
    expect(names(await list({ card: '1' }))).toEqual(['Card']);
    expect(names(await list({ max_price: '150' }))).toEqual(['Card']);
    expect(names(await list({ min_rating: '4.5' }))).toEqual(['Card']);
    expect(names(await list({}))).toHaveLength(2);
    expect(names(await list({ max_price: '300' }))).toEqual(['Card']);
  });
});

// @traces 1261-FR-009
describe('the cursor under filters', () => {
  const seed = async () => {
    for (let n = 0; n < 25; n += 1) {
      await garage(`Both ${n}`, { bani: 10_000, card: true, rating: 4.5 });
    }
  };

  it('continues a filtered page with the same filters and gives the rest', async () => {
    await seed();
    const first = await list({ card: '1', max_price: '150' });
    const second = await list({
      card: '1',
      cursor: first.body.nextCursor,
      max_price: '150',
    });

    expect(second.status).toBe(200);
    expect(second.body.items).toHaveLength(5);
    expect(new Set([...names(first), ...names(second)]).size).toBe(25);
  });

  it.each([
    ['one added', { card: '1' }, { card: '1', min_rating: '4.0' }],
    ['one removed', { card: '1', min_rating: '4.0' }, { card: '1' }],
    ['one changed', { max_price: '150' }, { max_price: '200' }],
    ['all removed', { card: '1' }, {}],
    ['all added', {}, { card: '1' }],
    ['rating swapped for price', { min_rating: '4.0' }, { max_price: '150' }],
  ])('refuses a cursor with a filter %s', async (_, made, used) => {
    await seed();
    const first = await list(made);
    expect(first.body.nextCursor).toEqual(expect.any(String));

    const res = await list({ ...used, cursor: first.body.nextCursor });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_cursor');
  });

  it('accepts a cursor made with no filter and used with none', async () => {
    await seed();
    const first = await list({});
    const second = await list({ cursor: first.body.nextCursor });

    expect(second.status).toBe(200);
    expect(second.body.items).toHaveLength(5);
  });

  it('names the bad filter rather than the stale cursor', async () => {
    const res = await list({ cursor: 'c3RhbGU', min_rating: '4' });

    expect(res.status).toBe(400);
    expect(res.body.code).not.toBe('invalid_cursor');
    expect(JSON.stringify(res.body.message)).toContain('min_rating');
  });
});

// @traces 1261-FR-001 1261-FR-006
describe('ids mode under filters', () => {
  it('answers only the ids that match and the search totals', async () => {
    const card = await garage('Card', { card: true });
    const cash = await garage('Cash');
    await garage('Other card', { card: true });

    const res = await list({ card: '1', ids: [card, cash].join(',') });

    expect(res.status).toBe(200);
    expect(names(res)).toEqual(['Card']);
    expect(res.body.total).toBe(2);
    expect(res.body.nextCursor).toBeNull();
  });

  it('answers an empty list when no id matches', async () => {
    const cash = await garage('Cash');

    const res = await list({ card: '1', ids: cash });

    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
  });
});

// @traces 1261-FR-007
describe('the pins under filters', () => {
  it('marks every garage found and counts the matches like the list', async () => {
    await garage('Card', { bani: 10_000, card: true, rating: 4.5 });
    await garage('Cash', { bani: 10_000, rating: 4.5 });
    await garage('No rate', { card: true, rating: 4.5 });
    await garage('Refuses', {
      bani: 10_000,
      card: true,
      rating: 4.5,
      stance: 'does_not_take',
    });
    const query = { card: '1', max_price: '150', min_rating: '4.5' };

    const res = await pins(query);
    const listed = await list(query);

    expect(res.status).toBe(200);
    expect(res.body.pins).toHaveLength(4);
    expect(
      res.body.pins.filter((p: { matches: boolean }) => p.matches),
    ).toHaveLength(2);
    expect(res.body.total).toBe(listed.body.total);
    expect(res.body.total).toBe(2);
  });

  it('marks every pin true with no filter', async () => {
    await garage('Card', { card: true });
    await garage('Cash');

    const res = await pins({});

    expect(res.body.pins.map((p: { matches: boolean }) => p.matches)).toEqual([
      true,
      true,
    ]);
    expect(res.body.total).toBe(2);
  });

  it('marks the mobile mechanic by the same rules', async () => {
    await garage('Mobile', { card: true, mobile: true });

    const res = await pins({ card: '1' });

    expect(res.body.pins.map((p: { matches: boolean }) => p.matches)).toEqual([
      true,
    ]);
  });

  it('answers no matches but all the pins when nothing matches', async () => {
    await garage('Cash');

    const res = await pins({ card: '1' });

    expect(res.body.pins).toHaveLength(1);
    expect(res.body.pins[0].matches).toBe(false);
    expect(res.body.total).toBe(0);
  });

  it('never serves a pin answer cached under other filters', async () => {
    await garage('Card', { card: true });

    expect((await pins({})).body.pins[0].matches).toBe(true);
    expect((await pins({ card: '1' })).body.pins[0].matches).toBe(true);
    await prisma.garage.updateMany({ data: { paymentCard: false } });
    await store.flushdb();
    expect((await pins({ card: '1' })).body.pins[0].matches).toBe(false);
  });

  it.each([
    ['max_price', '0'],
    ['max_price', '1000000000000'],
    ['min_rating', '5.0'],
    ['card', '１'],
  ])('answers 400 to %s=%s', async (key, value) => {
    expect((await pins({ [key]: value })).status).toBe(400);
  });

  it.each(['max_price=', 'card=&brand=dacia', 'min_rating=%00'])(
    'answers 400 to an empty or nul value in %s',
    async (suffix) => {
      const res = await request(app.getHttpServer()).get(
        `/search/garages/pins?brand=dacia&${suffix}`,
      );
      expect(res.status).toBe(400);
    },
  );
});
