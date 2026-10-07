import { randomUUID } from 'node:crypto';

import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { GaragesModule } from './garages.module';
import { signAccessToken } from '../auth/access-token';
import { AuthModule } from '../auth/auth.module';
import type { Role } from '../auth/capabilities';
import { serialDatabase } from '../auth/serial-db.testing';
import { NotificationsModule } from '../notifications/notifications.module';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
  testConfig,
} from '../notifications/notifications.testing';

// @traces 040-FR-008 040-FR-009 040-FR-010 040-FR-011 040-FR-012

const redisUrl = redisUrlFor(3);
const tokenSecret = 'test-secret';
const { account, prisma, reset } = fixtures();
serialDatabase(databaseUrl);

let app: NestExpressApplication;
let since: Date;

beforeAll(async () => {
  const email = testConfig('http://127.0.0.1:9');
  const auth = AuthModule.register({ databaseUrl, redisUrl, tokenSecret });
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
  app.useGlobalPipes(
    new ValidationPipe({
      forbidNonWhitelisted: true,
      transform: true,
      whitelist: true,
    }),
  );
  await app.init();
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await reset();
  await prisma.$executeRawUnsafe('TRUNCATE brand CASCADE');
  const [{ at }] = await prisma.$queryRaw<
    { at: Date }[]
  >`SELECT clock_timestamp() AS at`;
  since = at;
});

const http = () => request(app.getHttpServer());
const bearer = (accountId: string, role: Role) =>
  `Bearer ${signAccessToken({ accountId, role }, tokenSecret)}`;

async function brand(
  name: string,
  popularity: number | null = null,
  active = true,
) {
  const key = `${name.toLowerCase()}-${randomUUID()}`;
  return prisma.brand.create({
    data: { active, key, name, popularity, slug: key },
  });
}

async function world(status: 'draft' | 'approved' = 'approved') {
  const nord = await prisma.garage.create({
    data: { name: 'Service Auto Nord', slug: `nord-${randomUUID()}`, status },
  });
  const mihai = await account('mihai', ['garage']);
  await prisma.garageMember.create({
    data: { accountId: mihai, garageId: nord.id, role: 'owner' },
  });
  return {
    bmw: await brand('BMW', 2),
    mini: await brand('Mini', 1),
    nord,
    owner: bearer(mihai, 'garage'),
    tesla: await brand('Tesla'),
  };
}

type World = Awaited<ReturnType<typeof world>>;

const put = (w: World, body: unknown, as: string | null = w.owner) => {
  const req = http()
    .put(`/garages/${w.nord.id}/brands`)
    .send(body as object);
  return as ? req.set('Authorization', as) : req;
};

const rows = (w: World) =>
  prisma.garageBrand.count({ where: { garageId: w.nord.id } });
const events = () =>
  prisma.outboxEvent.findMany({
    orderBy: { id: 'asc' },
    where: { createdAt: { gte: since }, kind: 'garage.updated' },
  });
const audits = () =>
  prisma.activityLog.count({ where: { at: { gte: since } } });

describe('PUT /garages/:garageId/brands under hostile input', () => {
  it('accepts a note of 140 emoji and refuses 141', async () => {
    const w = await world();

    const ok = await put(w, { brandNote: '😀'.repeat(140), brands: [] });
    expect(ok.status).toBe(200);
    expect(ok.body.brandNote).toBe('😀'.repeat(140));

    const over = await put(w, { brandNote: '😀'.repeat(141), brands: [] });
    expect(over.status).toBe(400);
    const stored = await prisma.garage.findUniqueOrThrow({
      where: { id: w.nord.id },
    });
    expect(stored.brandNote).toBe('😀'.repeat(140));
  });

  it('accepts a phrase of 60 emoji and refuses 61', async () => {
    const w = await world();

    const ok = await put(w, { brands: [], refusalPhrase: '😀'.repeat(60) });
    expect(ok.status).toBe(200);

    const over = await put(w, { brands: [], refusalPhrase: '😀'.repeat(61) });
    expect(over.status).toBe(400);
  });

  it('counts the limit after trimming, not before', async () => {
    const w = await world();

    const res = await put(w, {
      brandNote: `   ${'a'.repeat(140)}   `,
      brands: [],
      refusalPhrase: `\t${'b'.repeat(60)}\n`,
    });

    expect(res.status).toBe(200);
    expect(res.body.brandNote).toBe('a'.repeat(140));
    expect(res.body.refusalPhrase).toBe('b'.repeat(60));
  });

  it('clears an earlier note and phrase when they are blank, null or left out', async () => {
    const w = await world();
    const seed = () =>
      put(w, { brandNote: 'note', brands: [], refusalPhrase: 'phrase' });

    for (const clearing of [
      { brandNote: '   ', brands: [], refusalPhrase: '' },
      { brandNote: null, brands: [], refusalPhrase: null },
      { brands: [] },
    ]) {
      await seed();
      const res = await put(w, clearing);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ brandNote: null, refusalPhrase: null });
    }
  });

  it.each([
    ['a string for brands', { brands: 'bmw' }],
    ['null for brands', { brands: null }],
    ['an object for brands', { brands: {} }],
    ['a null item', { brands: [null] }],
    ['a string item', { brands: ['bmw'] }],
    ['a number for the note', { brandNote: 7, brands: [] }],
    ['an array for the phrase', { brands: [], refusalPhrase: ['a'] }],
    ['an extra top-level field', { brands: [], status: 'approved' }],
    ['an extra field on an item', { brands: [{ brandId: 'x', extra: 1 }] }],
  ])('answers 400 to %s', async (_, body) => {
    const w = await world();

    const res = await put(w, body);

    expect(res.status).toBe(400);
  });

  it('answers 400 to an extra field on a valid item and changes nothing', async () => {
    const w = await world();

    const res = await put(w, {
      brands: [{ brandId: w.bmw.id, extra: true, stance: 'works_on' }],
    });

    expect(res.status).toBe(400);
    expect(await rows(w)).toBe(0);
  });

  it('answers 400 to a body that is not JSON and to an array body', async () => {
    const w = await world();

    const text = await http()
      .put(`/garages/${w.nord.id}/brands`)
      .set('Authorization', w.owner)
      .set('Content-Type', 'application/json')
      .send('{"brands": [');
    const array = await put(w, []);

    expect(text.status).toBe(400);
    expect(array.status).toBe(400);
  });

  it('answers 400 to a garage id that is not a uuid', async () => {
    const w = await world();

    const res = await http()
      .put('/garages/not-a-uuid/brands')
      .set('Authorization', w.owner)
      .send({ brands: [] });

    expect(res.status).toBe(400);
  });

  it('treats uppercase brand ids as the same brand when listed twice', async () => {
    const w = await world();

    const res = await put(w, {
      brands: [
        { brandId: w.bmw.id, stance: 'works_on' },
        { brandId: w.bmw.id.toUpperCase(), stance: 'does_not_take' },
      ],
    });

    expect(res.status).toBe(400);
    expect(await rows(w)).toBe(0);
  });

  it('refuses the whole write when a bad brand follows a good one', async () => {
    const w = await world();
    await put(w, {
      brands: [{ brandId: w.tesla.id, stance: 'does_not_take' }],
    });
    const before = await events();

    const res = await put(w, {
      brandNote: 'new note',
      brands: [
        { brandId: w.bmw.id, stance: 'works_on' },
        { brandId: randomUUID(), stance: 'works_on' },
      ],
    });

    expect(res.status).toBe(400);
    const stored = await prisma.garageBrand.findMany({
      where: { garageId: w.nord.id },
    });
    expect(stored.map((r) => [r.brandId, r.stance])).toEqual([
      [w.tesla.id, 'does_not_take'],
    ]);
    const garage = await prisma.garage.findUniqueOrThrow({
      where: { id: w.nord.id },
    });
    expect(garage.brandNote).toBeNull();
    expect(await events()).toHaveLength(before.length);
  });

  it('answers 400 rather than a server error for five hundred unknown brands', async () => {
    const w = await world();
    const brands = Array.from({ length: 500 }, () => ({
      brandId: randomUUID(),
      stance: 'works_on',
    }));

    const res = await put(w, { brands });

    expect(res.status).toBe(400);
  });

  it('writes a retired brand and keeps it in the answer and the public read', async () => {
    const w = await world();
    const lada = await brand('Lada', 3, false);

    const res = await put(w, {
      brands: [{ brandId: lada.id, stance: 'works_on' }],
    });

    expect(res.status).toBe(200);
    expect(res.body.worksOn.map((b: { name: string }) => b.name)).toEqual([
      'Lada',
    ]);
    const read = await http().get(`/garages/${w.nord.slug}`);
    expect(read.status).toBe(200);
    expect(read.body.worksOn.map((b: { name: string }) => b.name)).toEqual([
      'Lada',
    ]);
  });
});

describe('PUT /garages/:garageId/brands effects', () => {
  it('replaces a taken brand with a refused one and a whole set with an empty one', async () => {
    const w = await world();
    await put(w, {
      brands: [
        { brandId: w.bmw.id, stance: 'works_on' },
        { brandId: w.mini.id, stance: 'works_on' },
      ],
    });

    const flip = await put(w, {
      brands: [{ brandId: w.bmw.id, stance: 'does_not_take' }],
    });
    expect(flip.body.worksOn).toEqual([]);
    expect(flip.body.doesNotTake.map((b: { id: string }) => b.id)).toEqual([
      w.bmw.id,
    ]);

    const empty = await put(w, { brands: [] });
    expect(empty.body).toEqual({
      brandNote: null,
      doesNotTake: [],
      refusalPhrase: null,
      worksOn: [],
    });
    expect(await rows(w)).toBe(0);
  });

  it('writing the same set again adds no audit entry and no event', async () => {
    const w = await world();
    const body = {
      brandNote: 'note',
      brands: [
        { brandId: w.bmw.id, stance: 'works_on' },
        { brandId: w.tesla.id, stance: 'does_not_take' },
      ],
      refusalPhrase: 'phrase',
    };
    await put(w, body);
    const entries = await audits();
    const sent = (await events()).length;

    const again = await put(w, {
      ...body,
      brandNote: '  note  ',
      brands: [...body.brands].reverse(),
    });

    expect(again.status).toBe(200);
    expect(await audits()).toBe(entries);
    expect(await events()).toHaveLength(sent);
    expect(sent).toBe(1);
  });

  it('addresses a text-only change to the garage without any brand search', async () => {
    const w = await world();
    await put(w, { brands: [{ brandId: w.bmw.id, stance: 'works_on' }] });

    await put(w, {
      brandNote: 'only the note',
      brands: [{ brandId: w.bmw.id, stance: 'works_on' }],
    });

    const sent = await events();
    expect(sent).toHaveLength(2);
    expect(sent[1].payload).toMatchObject({ brandIds: [], fields: ['brands'] });
    expect([...sent[1].audience].sort()).toEqual(
      [`garage:${w.nord.id}`, `public:garage:${w.nord.id}`].sort(),
    );
  });

  it('addresses only the brands that changed', async () => {
    const w = await world();
    await put(w, {
      brands: [
        { brandId: w.bmw.id, stance: 'works_on' },
        { brandId: w.mini.id, stance: 'works_on' },
      ],
    });

    await put(w, {
      brands: [
        { brandId: w.bmw.id, stance: 'works_on' },
        { brandId: w.tesla.id, stance: 'works_on' },
      ],
    });

    const [, second] = await events();
    expect((second.payload as { brandIds: string[] }).brandIds.sort()).toEqual(
      [w.mini.id, w.tesla.id].sort(),
    );
    expect(second.audience).toEqual(
      expect.arrayContaining([
        `public:search:${w.mini.id}`,
        `public:search:${w.tesla.id}`,
      ]),
    );
    expect(second.audience).not.toContain(`public:search:${w.bmw.id}`);
  });

  it('keeps the status of a garage that is not approved yet', async () => {
    const w = await world('draft');

    const res = await put(w, {
      brands: [{ brandId: w.bmw.id, stance: 'works_on' }],
    });

    expect(res.status).toBe(200);
    const garage = await prisma.garage.findUniqueOrThrow({
      where: { id: w.nord.id },
    });
    expect(garage.status).toBe('draft');
  });

  it('serialises two simultaneous writes so one whole set wins', async () => {
    const w = await world();
    const a = {
      brands: [
        { brandId: w.bmw.id, stance: 'works_on' },
        { brandId: w.mini.id, stance: 'works_on' },
      ],
    };
    const b = { brands: [{ brandId: w.tesla.id, stance: 'does_not_take' }] };

    const [ra, rb] = await Promise.all([put(w, a), put(w, b)]);

    expect([ra.status, rb.status]).toEqual([200, 200]);
    const stored = (
      await prisma.garageBrand.findMany({ where: { garageId: w.nord.id } })
    )
      .map((r) => r.brandId)
      .sort();
    const wholeA = [w.bmw.id, w.mini.id].sort();
    expect([wholeA, [w.tesla.id]]).toContainEqual(stored);
  });

  it('answers a missing session 401 even for a malformed body', async () => {
    const w = await world();

    const anonymous = await put(w, { brands: 'x' }, null);

    expect(anonymous.status).toBe(401);
  });
});
