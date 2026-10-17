import { randomUUID } from 'node:crypto';

import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { SavedGaragesModule } from './saved-garages.module';
import { signAccessToken } from '../../auth/access-token';
import { AuthModule } from '../../auth/auth.module';
import type { Role } from '../../auth/capabilities';
import { serialDatabase } from '../../auth/serial-db.testing';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
} from '../../notifications/notifications.testing';

const redisUrl = redisUrlFor(15);
const tokenSecret = 'test-secret';
const { account, prisma, reset } = fixtures();
serialDatabase(databaseUrl);

let app: NestExpressApplication;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [
      AuthModule.register({ databaseUrl, redisUrl, tokenSecret }),
      SavedGaragesModule,
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
});

afterEach(() => {
  jest.restoreAllMocks();
});

const http = () => request(app.getHttpServer());
const bearer = (accountId: string, role: Role) =>
  `Bearer ${signAccessToken({ accountId, role }, tokenSecret)}`;

let slugs = 0;
async function placed(extra: Record<string, unknown> = {}) {
  slugs += 1;
  const { id } = await prisma.garage.create({
    data: {
      name: `Service ${slugs}`,
      slug: `adv-${randomUUID().slice(0, 8)}`,
      status: 'approved',
      ...extra,
    },
  });
  return id;
}

async function driver() {
  const id = await account(`sofer${randomUUID().slice(0, 8)}`, ['driver']);
  return { auth: bearer(id, 'driver'), id };
}

type Fuel = 'petrol' | 'diesel' | 'hybrid' | 'electric';
async function brand(name: string) {
  const kept = await prisma.brand.findFirst({ where: { name } });
  if (kept) return kept.id;
  const key = `${name.toLowerCase()}-${randomUUID().slice(0, 8)}`;
  return (await prisma.brand.create({ data: { key, name, slug: key } })).id;
}
let made = 0;
async function car(ownerId: string, brandId: string, fuel: Fuel = 'petrol') {
  made += 1;
  return prisma.car.create({
    data: {
      brandId,
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, made)),
      fuel,
      idempotencyKey: randomUUID(),
      model: 'Model',
      odometerKm: 10_000,
      ownerId,
      year: 2020,
    },
  });
}
async function works(
  garageId: string,
  brandId: string,
  fuels: Partial<Record<Fuel, boolean>> = {},
) {
  await prisma.garageBrand.create({
    data: { brandId, garageId, stance: 'works_on', ...fuels },
  });
}

const list = (auth: string | null, query = '') => {
  const req = http().get(`/me/saved-garages${query ? `?${query}` : ''}`);
  return auth ? req.set('Authorization', auth) : req;
};
const forged = (at: string, id: string) =>
  Buffer.from(JSON.stringify({ at, id })).toString('base64url');

// @traces 291-FR-001
describe('the saved list cursor under attack', () => {
  it('walks 45 rows saved at one instant in three pages, each row once', async () => {
    const { auth, id } = await driver();
    const at = new Date(Date.UTC(2026, 5, 1));
    const garageIds: string[] = [];
    for (let i = 0; i < 45; i++) garageIds.push(await placed());
    await prisma.savedGarage.createMany({
      data: garageIds.map((garageId) => ({
        accountId: id,
        garageId,
        savedAt: at,
      })),
    });

    const seen: string[] = [];
    let cursor: string | null = null;
    const sizes: number[] = [];
    do {
      const res = await list(
        auth,
        cursor ? `cursor=${encodeURIComponent(cursor)}` : '',
      );
      expect(res.status).toBe(200);
      sizes.push(res.body.items.length);
      seen.push(...res.body.items.map((r: { garageId: string }) => r.garageId));
      cursor = res.body.nextCursor;
    } while (cursor);

    expect(sizes).toEqual([20, 20, 5]);
    expect(new Set(seen).size).toBe(45);
    expect(seen).toEqual([...garageIds].sort().reverse());
  });

  it('answers a null nextCursor for exactly twenty rows', async () => {
    const { auth, id } = await driver();
    const ids: string[] = [];
    for (let i = 0; i < 20; i++) ids.push(await placed());
    await prisma.savedGarage.createMany({
      data: ids.map((garageId, i) => ({
        accountId: id,
        garageId,
        savedAt: new Date(Date.UTC(2026, 5, 1, 0, i)),
      })),
    });

    const res = await list(auth);

    expect(res.body.items).toHaveLength(20);
    expect(res.body.nextCursor).toBeNull();
    expect(res.body.total).toBe(20);
  });

  it.each([['a five digit year', '99999-01-01T00:00:00.000Z']])(
    'answers 400 invalid_cursor to %s, a time this route never gave out',
    async (_, at) => {
      const { auth } = await driver();

      const res = await list(
        auth,
        `cursor=${encodeURIComponent(forged(at, randomUUID()))}`,
      );

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('invalid_cursor');
    },
  );

  it('answers 400 invalid_cursor to a cursor whose fields are numbers or arrays', async () => {
    const { auth } = await driver();

    for (const body of [
      { at: 1, id: 2 },
      { at: ['2026-06-01T00:00:00.000Z'], id: [randomUUID()] },
      { at: null, id: null },
    ]) {
      const cursor = Buffer.from(JSON.stringify(body)).toString('base64url');
      const res = await list(auth, `cursor=${cursor}`);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('invalid_cursor');
    }
  });

  it('answers 400 and never a server error to two cursor parameters', async () => {
    const { auth } = await driver();

    const res = await list(auth, 'cursor=a&cursor=b');

    expect(res.status).toBe(400);
  });

  it('answers 400 to a limit parameter the route does not take', async () => {
    const { auth } = await driver();

    const res = await list(auth, 'limit=1');

    expect(res.status).toBe(400);
  });
});

// @traces 291-FR-004
describe('the place under attack', () => {
  it.each([
    ['not numbers', 'near=a,b'],
    ['three numbers', 'near=46.771,23.624,1'],
    ['an empty value', 'near='],
    ['a space inside', 'near=46.771, 23.624'],
    ['NaN', 'near=NaN,NaN'],
    ['Infinity', 'near=Infinity,Infinity'],
    [
      'a SQL fragment',
      `near=${encodeURIComponent('46.7;DROP TABLE garage;--,23.6')}`,
    ],
    ['latitude below the box', 'near=43.49,25'],
    ['longitude above the box', 'near=45,30.5'],
    ['the north pole', 'near=90,0'],
    ['two near parameters', 'near=46.771,23.624&near=46.8,23.7'],
  ])('answers 400 to %s', async (_, query) => {
    const { auth } = await driver();

    const res = await list(auth, query);

    expect(res.status).toBe(400);
  });

  it('answers 200 for the corners of the box', async () => {
    const { auth } = await driver();

    for (const query of [
      'near=43.6,20.2',
      'near=48.3,29.7',
      'near=43.7,20.3',
      'near=48.2,29.6',
    ]) {
      const res = await list(auth, query);
      expect(res.status).toBe(200);
    }
  });

  it('answers a distance of 0 for a garage at the place itself', async () => {
    const { auth, id } = await driver();
    const here = await placed({ latitude: 46.771, longitude: 23.624 });
    await prisma.savedGarage.create({
      data: { accountId: id, garageId: here },
    });

    const res = await list(auth, 'near=46.771,23.624');

    expect(res.body.items[0].distanceKm).toBe(0);
  });

  it('applies no radius: a garage 600 km away still comes back with its distance', async () => {
    const { auth, id } = await driver();
    const far = await placed({ latitude: 43.8, longitude: 28.5 });
    await prisma.savedGarage.create({ data: { accountId: id, garageId: far } });

    const res = await list(auth, 'near=48.2,22.0');

    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].distanceKm).toBeGreaterThan(500);
  });
});

// @traces 291-FR-003
describe('the brands under attack', () => {
  it('names a brand when only one of two cars of it has the fuel ticked, and places it by the first car of that brand', async () => {
    const { auth, id } = await driver();
    const bmw = await brand('BMW');
    const dacia = await brand('Dacia');
    await car(id, bmw, 'diesel');
    await car(id, dacia, 'petrol');
    await car(id, bmw, 'petrol');
    const g = await placed();
    await works(g, bmw, { diesel: true, petrol: false });
    await works(g, dacia, { petrol: true });
    await prisma.savedGarage.create({ data: { accountId: id, garageId: g } });

    const res = await list(auth);

    expect(
      res.body.items[0].brands.map((b: { name: string }) => b.name),
    ).toEqual(['Dacia', 'BMW']);
  });

  it('names no brand for a driver whose only car is of a brand the garage ticked for another fuel', async () => {
    const { auth, id } = await driver();
    const bmw = await brand('BMW');
    await car(id, bmw, 'electric');
    const g = await placed();
    await works(g, bmw, { diesel: true, electric: false, petrol: true });
    await prisma.savedGarage.create({ data: { accountId: id, garageId: g } });

    const res = await list(auth);

    expect(res.body.items[0].brands).toEqual([]);
    expect(res.body.workingCount).toBe(0);
  });

  it('keeps the counts over the whole list while the page holds twenty', async () => {
    const { auth, id } = await driver();
    const bmw = await brand('BMW');
    await car(id, bmw, 'petrol');
    const ids: string[] = [];
    for (let i = 0; i < 30; i++) {
      const g = await placed();
      if (i % 3 === 0) await works(g, bmw, { petrol: true });
      ids.push(g);
    }
    await prisma.savedGarage.createMany({
      data: ids.map((garageId, i) => ({
        accountId: id,
        garageId,
        savedAt: new Date(Date.UTC(2026, 5, 1, 0, i)),
      })),
    });

    const res = await list(auth);

    expect(res.body.items).toHaveLength(20);
    expect(res.body.total).toBe(30);
    expect(res.body.workingCount).toBe(10);
  });
});

// @traces 291-FR-001
describe('the answer headers', () => {
  it('sends Cache-Control no-store on a page and on an empty page', async () => {
    const { auth, id } = await driver();
    const empty = await list(auth);
    const g = await placed();
    await prisma.savedGarage.create({ data: { accountId: id, garageId: g } });
    const full = await list(auth);

    expect(empty.headers['cache-control']).toBe('no-store');
    expect(full.headers['cache-control']).toBe('no-store');
  });

  it('answers 401 before 400 to a visitor with a bad place and a bad cursor', async () => {
    const res = await list(null, 'near=0,0&cursor=zzz');

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('sign_in_required');
  });

  it('answers 403 before 400 to a garage account with a bad place', async () => {
    const id = await account(`staff${randomUUID().slice(0, 8)}`, ['garage']);

    const res = await list(bearer(id, 'garage'), 'near=0,0');

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('driver_role_required');
  });
});
