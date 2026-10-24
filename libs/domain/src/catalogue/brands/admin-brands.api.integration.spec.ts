import { randomUUID } from 'node:crypto';

import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Redis } from 'ioredis';
import request from 'supertest';

import { BRANDS } from './brands';
import { signAccessToken } from '../../auth/access-token';
import { AUTH_REDIS } from '../../auth/attempts';
import { AuthModule } from '../../auth/auth.module';
import type { Role } from '../../auth/capabilities';
import { serialDatabase } from '../../auth/serial-db.testing';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
} from '../../notifications/notifications.testing';
import { BrandLoader } from '../brand-loader';
import { CatalogueModule } from '../catalogue.module';

const redisUrl = redisUrlFor(3);
const tokenSecret = 'test-secret';
const { account, prisma, reset } = fixtures();
const redis = new Redis(redisUrl);
serialDatabase(databaseUrl);

const NON_ADMIN = ['driver', 'garage', 'receptionist', 'mechanic'] as const;
const NOBODY = '00000000-0000-4000-8000-000000000000';

let app: INestApplication;
let loader: BrandLoader;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [
      AuthModule.register({ databaseUrl, redisUrl, tokenSecret }),
      CatalogueModule,
    ],
  }).compile();
  app = moduleRef.createNestApplication();
  // The API's own pipe options (apps/api bootstrap).
  app.useGlobalPipes(
    new ValidationPipe({
      forbidNonWhitelisted: true,
      transform: true,
      whitelist: true,
    }),
  );
  await app.init();
  loader = app.get(BrandLoader);
});

afterAll(async () => {
  await app.close();
  redis.disconnect();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await reset();
  await prisma.$executeRawUnsafe('TRUNCATE brand CASCADE');
  await redis.incr('brands:version');
});

const bearer = (accountId: string, role: Role) =>
  `Bearer ${signAccessToken({ accountId, role }, tokenSecret)}`;

const server = () => request(app.getHttpServer());

let admin: { id: string; auth: string };
beforeEach(async () => {
  const id = await account('Ana Admin', ['admin']);
  admin = { auth: bearer(id, 'admin'), id };
});

const list = (query: Record<string, string> = {}, auth = admin.auth) =>
  server().get('/admin/brands').query(query).set('Authorization', auth);

const create = (body: object, auth = admin.auth) =>
  server().post('/admin/brands').set('Authorization', auth).send(body);

const update = (id: string, body: object, auth = admin.auth) =>
  server().patch(`/admin/brands/${id}`).set('Authorization', auth).send(body);

const publicNames = async (q = '') =>
  (await server().get('/brands').query({ q })).body.items.map(
    (item: { name: string }) => item.name,
  );

const row = (id: string) => prisma.brand.findUniqueOrThrow({ where: { id } });

const seen = async (id: string) => (await row(id)).updatedAt.toISOString();

// The entries an admin wrote; the loader's own are actor `system`.
const entries = (subjectId: string) =>
  prisma.activityLog.findMany({
    orderBy: [{ at: 'asc' }, { field: 'asc' }],
    select: {
      action: true,
      actorId: true,
      actorRole: true,
      field: true,
      newValue: true,
      oldValue: true,
      subjectType: true,
    },
    where: { actorRole: 'admin', subjectId },
  });

const brandOf = (slug: string) =>
  prisma.brand.findUniqueOrThrow({ where: { slug } });

// A driver's Škoda and a garage that works on it, and one that does not.
async function references(brandId: string) {
  const owner = await account('Dan Șofer', ['driver']);
  const car = await prisma.car.create({
    data: {
      brandId,
      fuel: 'diesel',
      idempotencyKey: randomUUID(),
      model: 'Octavia',
      odometerKm: 120_000,
      ownerId: owner,
      year: 2018,
    },
  });
  const works = await prisma.garage.create({
    data: { name: 'Atelier Dinamo', slug: `dinamo-${randomUUID()}` },
  });
  const refuses = await prisma.garage.create({
    data: { name: 'Service Nord', slug: `nord-${randomUUID()}` },
  });
  await prisma.garageBrand.createMany({
    data: [
      { brandId, garageId: works.id, stance: 'works_on' },
      {
        brandId,
        diesel: false,
        electric: false,
        garageId: refuses.id,
        hybrid: false,
        petrol: false,
        stance: 'does_not_take',
      },
    ],
  });
  return { car, works };
}

// The admin brand routes against real PostgreSQL and Valkey.
// @traces 105-FR-021
describe('GET /admin/brands', () => {
  // @traces 105-FR-002
  it('lists every brand, active and retired, with its counts, by folded name', async () => {
    await loader.load([
      { key: 'skoda', name: 'Škoda', popularity: 2 },
      { key: 'dacia', name: 'Dacia', popularity: 1 },
      { key: 'saab', name: 'Saab' },
    ]);
    await loader.load([
      { key: 'skoda', name: 'Škoda', popularity: 2 },
      { key: 'dacia', name: 'Dacia', popularity: 1 },
    ]);
    const skoda = await brandOf('skoda');
    await references(skoda.id);

    const res = await list();

    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([
      expect.objectContaining({ cars: 0, garages: 0, name: 'Dacia' }),
      expect.objectContaining({ name: 'Saab', state: 'retired' }),
      {
        cars: 1,
        garages: 1,
        id: skoda.id,
        name: 'Škoda',
        slug: 'skoda',
        state: 'active',
        updatedAt: skoda.updatedAt.toISOString(),
        updatedBy: null,
      },
    ]);
  });

  // @traces 105-FR-003
  it.each(['sko', 'SKODA', 'škoda'])('finds Škoda alone for %s', async (q) => {
    await loader.load(BRANDS);

    const res = await list({ q });

    expect(res.body.items.map((b: { name: string }) => b.name)).toEqual([
      'Škoda',
    ]);
  });

  // @traces 105-FR-003
  it('answers the whole list for an empty search and 400 for one over 40 characters', async () => {
    await loader.load(BRANDS);

    const all = await list({ q: '' });
    const long = await list({ q: 'a'.repeat(41) });

    expect(all.body.items).toHaveLength(BRANDS.length);
    expect(long.status).toBe(400);
  });

  // @traces 105-FR-001
  it.each(NON_ADMIN)('answers 404 to a %s', async (role) => {
    await loader.load(BRANDS);

    const auth = bearer(await account(`Cont ${role}`, [role]), role);

    expect((await list({}, auth)).status).toBe(404);
    expect((await create({ name: 'Xpeng' }, auth)).status).toBe(404);
    expect(
      (
        await update(
          (
            await brandOf('dacia')
          ).id,
          { active: false, seenUpdatedAt: new Date().toISOString() },
          auth,
        )
      ).status,
    ).toBe(404);
    expect(await prisma.brand.count({ where: { name: 'Xpeng' } })).toBe(0);
  });

  // @traces 105-FR-001
  it('answers 401 with no session and 403 to a suspended admin', async () => {
    const suspended = await account('Ion Suspendat', ['admin'], {
      status: 'suspended',
    });

    const none = await server().get('/admin/brands');
    const refused = await list({}, bearer(suspended, 'admin'));

    expect([none.status, none.body.code]).toEqual([401, 'sign_in_required']);
    expect([refused.status, refused.body.code]).toEqual([
      403,
      'account_suspended',
    ]);
  });
});

describe('POST /admin/brands', () => {
  // @traces 105-FR-004 105-FR-009 105-FR-010
  it('adds an active brand under the slug of its name, owned by the admin', async () => {
    await loader.load(BRANDS);
    expect(await publicNames('xpeng')).toEqual([]);

    const res = await create({ name: '  Xpeng ' });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      cars: 0,
      garages: 0,
      id: expect.any(String),
      name: 'Xpeng',
      slug: 'xpeng',
      state: 'active',
      updatedAt: expect.any(String),
      updatedBy: admin.id,
    });
    expect(await row(res.body.id)).toMatchObject({
      active: true,
      key: 'xpeng',
      popularity: null,
      roPossessive: null,
      updatedBy: admin.id,
    });
    expect(await publicNames('xpeng')).toEqual(['Xpeng']);
    expect(
      await prisma.garageBrand.count({ where: { brandId: res.body.id } }),
    ).toBe(0);
    expect(await entries(res.body.id)).toEqual([
      {
        action: 'create',
        actorId: admin.id,
        actorRole: 'admin',
        field: null,
        newValue: expect.objectContaining({ name: 'Xpeng', slug: 'xpeng' }),
        oldValue: null,
        subjectType: 'brand',
      },
    ]);
  });

  // @traces 105-FR-005
  it.each(['Skoda', 'ŠKODA', 'škoda', ' Škoda '])(
    'refuses %s as Škoda already there',
    async (name) => {
      await loader.load(BRANDS);
      const before = await prisma.brand.count();

      const res = await create({ name });

      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({
        code: 'brand_exists',
        message: 'Marca există deja: Škoda',
      });
      expect(await prisma.brand.count()).toBe(before);
    },
  );

  // @traces 105-FR-005
  it('refuses the name of a retired brand', async () => {
    await loader.load([{ key: 'saab', name: 'Saab' }]);
    await loader.load([]);

    const res = await create({ name: 'SAAB' });

    expect([res.status, res.body.message]).toEqual([
      409,
      'Marca există deja: Saab',
    ]);
  });

  // @traces 105-FR-004 105-FR-005
  it.each([
    ['a name of one character', 'X'],
    ['a name of 41 characters', 'a'.repeat(41)],
    ['a name whose slug is empty', '!!!'],
    ['a name whose slug is one character', 'Ö!'],
  ])('answers 400 to %s', async (_, name) => {
    const res = await create({ name });

    expect(res.status).toBe(400);
    expect(await prisma.brand.count()).toBe(0);
  });

  // @traces 105-FR-005
  it('lets one of two simultaneous adds through and refuses the other', async () => {
    const answers = await Promise.all([
      create({ name: 'Xpeng' }),
      create({ name: 'XPENG' }),
    ]);

    expect(answers.map((res) => res.status).sort()).toEqual([201, 409]);
    expect(await prisma.brand.count()).toBe(1);
  });

  // @traces 105-FR-009 105-FR-014
  it('shows the new brand on a search whose list was cached before', async () => {
    await loader.load(BRANDS);
    await publicNames();

    await create({ name: 'Xpeng' });

    expect(await publicNames('xpe')).toEqual(['Xpeng']);
  });
});

describe('PATCH /admin/brands/{id}', () => {
  // The file with Mercedes-Benz under its short name, for the story's rename.
  const FILE = BRANDS.map((brand) =>
    brand.key === 'mercedes-benz' ? { ...brand, name: 'Mercedes' } : brand,
  );
  let mercedes: { id: string };
  beforeEach(async () => {
    await loader.load(FILE);
    mercedes = await brandOf('mercedes');
  });

  // @traces 105-FR-006 105-FR-010
  it('renames a brand keeping its id and what points to it', async () => {
    const { car, works } = await references(mercedes.id);

    const res = await update(mercedes.id, {
      name: 'Mercedes-Benz',
      seenUpdatedAt: await seen(mercedes.id),
    });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      cars: 1,
      garages: 1,
      id: mercedes.id,
      name: 'Mercedes-Benz',
      slug: 'mercedes-benz',
      updatedBy: admin.id,
    });
    expect(
      (await prisma.car.findUniqueOrThrow({ where: { id: car.id } })).brandId,
    ).toBe(mercedes.id);
    expect(
      await prisma.garageBrand.count({
        where: { brandId: mercedes.id, garageId: works.id },
      }),
    ).toBe(1);
    expect(await publicNames('merc')).toEqual(['Mercedes-Benz']);
    expect(await entries(mercedes.id)).toEqual([
      expect.objectContaining({
        action: 'update',
        actorId: admin.id,
        actorRole: 'admin',
        field: 'name',
        newValue: 'Mercedes-Benz',
        oldValue: 'Mercedes',
        subjectType: 'brand',
      }),
      expect.objectContaining({
        field: 'slug',
        newValue: 'mercedes-benz',
        oldValue: 'mercedes',
      }),
    ]);
  });

  // @traces 105-FR-006
  it('renames a brand to an accent or case variant of its own name', async () => {
    const res = await update(mercedes.id, {
      name: 'MERCEDES',
      seenUpdatedAt: await seen(mercedes.id),
    });

    expect([res.status, res.body.name, res.body.slug]).toEqual([
      200,
      'MERCEDES',
      'mercedes',
    ]);
  });

  // @traces 105-FR-005
  it('refuses a rename onto the slug of another brand, active or retired', async () => {
    await loader.load(FILE.filter((brand) => brand.key !== 'dacia'));

    const active = await update(mercedes.id, {
      name: 'Skoda',
      seenUpdatedAt: await seen(mercedes.id),
    });
    const retired = await update(mercedes.id, {
      name: 'DACIA',
      seenUpdatedAt: await seen(mercedes.id),
    });

    expect([active.status, active.body.message]).toEqual([
      409,
      'Marca există deja: Škoda',
    ]);
    expect([retired.status, retired.body.code]).toEqual([409, 'brand_exists']);
    expect((await row(mercedes.id)).name).toBe('Mercedes');
  });

  // @traces 105-FR-006
  it('refuses a save on a value the admin no longer sees, with the current row', async () => {
    const first = await seen(mercedes.id);
    await update(mercedes.id, { name: 'Mercedes-Benz', seenUpdatedAt: first });

    const late = await update(mercedes.id, {
      active: false,
      seenUpdatedAt: first,
    });

    expect(late.status).toBe(409);
    expect(late.body).toMatchObject({
      brand: { id: mercedes.id, name: 'Mercedes-Benz', state: 'active' },
      code: 'stale_value',
    });
    expect((await row(mercedes.id)).active).toBe(true);
  });

  // @traces 105-FR-006
  it('lets one of two saves on the same seen value through', async () => {
    const value = await seen(mercedes.id);

    const answers = await Promise.all([
      update(mercedes.id, { name: 'Mercedes-Benz', seenUpdatedAt: value }),
      update(mercedes.id, { active: false, seenUpdatedAt: value }),
    ]);

    expect(answers.map((res) => res.status).sort()).toEqual([200, 409]);
  });

  // @traces 105-FR-006
  it('checks the id, then the body, then the seen value, then the no-op', async () => {
    const value = await seen(mercedes.id);
    const old = new Date(Date.parse(value) - 60_000).toISOString();

    const unknown = await update(NOBODY, {
      active: false,
      seenUpdatedAt: value,
    });
    const malformed = await update('not-a-uuid', {
      active: false,
      seenUpdatedAt: value,
    });
    const empty = await update(mercedes.id, { seenUpdatedAt: value });
    const staleNoop = await update(mercedes.id, {
      active: true,
      seenUpdatedAt: old,
    });

    expect([unknown.status, unknown.body.code]).toEqual([404, 'not_found']);
    expect(malformed.status).toBe(400);
    expect(empty.status).toBe(400);
    expect([staleNoop.status, staleNoop.body.code]).toEqual([
      409,
      'stale_value',
    ]);
  });

  // @traces 105-FR-006 105-FR-010
  it('writes nothing for a save that changes nothing', async () => {
    const before = await row(mercedes.id);

    const res = await update(mercedes.id, {
      active: true,
      name: 'Mercedes',
      seenUpdatedAt: before.updatedAt.toISOString(),
    });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name: 'Mercedes', updatedBy: null });
    expect(await row(mercedes.id)).toEqual(before);
    expect(await entries(mercedes.id)).toEqual([]);
  });

  // @traces 105-FR-008 105-FR-010
  it('retires a brand out of public search, keeping what points to it, and brings it back', async () => {
    const { car } = await references(mercedes.id);

    const retired = await update(mercedes.id, {
      active: false,
      seenUpdatedAt: await seen(mercedes.id),
    });

    expect([retired.status, retired.body.state]).toEqual([200, 'retired']);
    expect(await publicNames('merc')).toEqual([]);
    expect(
      (
        await prisma.car.findUniqueOrThrow({
          include: { brand: true },
          where: { id: car.id },
        })
      ).brand.name,
    ).toBe('Mercedes');
    expect((await list({ q: 'merc' })).body.items).toEqual([
      expect.objectContaining({ cars: 1, garages: 1, state: 'retired' }),
    ]);

    const back = await update(mercedes.id, {
      active: true,
      seenUpdatedAt: retired.body.updatedAt,
    });

    expect([back.status, back.body.state]).toEqual([200, 'active']);
    expect(await publicNames('merc')).toEqual(['Mercedes']);
    expect(await entries(mercedes.id)).toEqual([
      expect.objectContaining({
        field: 'active',
        newValue: false,
        oldValue: true,
      }),
      expect.objectContaining({
        field: 'active',
        newValue: true,
        oldValue: false,
      }),
    ]);
  });

  // @traces 105-FR-006 105-FR-010
  it('writes nothing when retiring a retired brand', async () => {
    const retired = await update(mercedes.id, {
      active: false,
      seenUpdatedAt: await seen(mercedes.id),
    });

    const again = await update(mercedes.id, {
      active: false,
      seenUpdatedAt: retired.body.updatedAt,
    });

    expect([again.status, again.body.updatedAt]).toEqual([
      200,
      retired.body.updatedAt,
    ]);
    expect(await entries(mercedes.id)).toHaveLength(1);
  });

  // @traces 105-FR-007
  it('has no route that deletes a brand', async () => {
    const res = await server()
      .delete(`/admin/brands/${mercedes.id}`)
      .set('Authorization', admin.auth);

    expect(res.status).toBe(404);
    expect(await prisma.brand.count({ where: { id: mercedes.id } })).toBe(1);
  });

  // @traces 105-FR-012
  it('keeps an admin rename through the next boot of the brand file', async () => {
    await update(mercedes.id, {
      name: 'Mercedes AMG',
      seenUpdatedAt: await seen(mercedes.id),
    });

    await loader.load(FILE);

    expect((await row(mercedes.id)).name).toBe('Mercedes AMG');
  });

  const TEN = Array.from({ length: 10 }, (_, lap) => lap + 1);

  // @traces 105-FR-014
  it.each(TEN)(
    'never caches the list a search read before an admin change (lap %i)',
    async () => {
      const cache = app.get<Redis>(AUTH_REDIS);
      await redis.incr('brands:version');
      let raced = false;
      // The search has read PostgreSQL; the admin's rename commits and drops the
      // cache before the search writes what it read.
      const write = jest
        .spyOn(cache, 'set')
        .mockImplementationOnce(async (...args: Parameters<Redis['set']>) => {
          write.mockRestore();
          raced = true;
          await update(mercedes.id, {
            name: 'Mercedes-Benz',
            seenUpdatedAt: await seen(mercedes.id),
          });
          return cache.set(...args);
        });

      expect(await publicNames('merc')).toEqual(['Mercedes']);
      expect(raced).toBe(true);
      expect(await publicNames('merc')).toEqual(['Mercedes-Benz']);
    },
  );

  // @traces 105-FR-014
  it.each(TEN)(
    'never caches the list a search read before a loader change (lap %i)',
    async () => {
      const cache = app.get<Redis>(AUTH_REDIS);
      await redis.incr('brands:version');
      let raced = false;
      // The search has read PostgreSQL; the file's rename commits and drops the
      // cache before the search writes what it read.
      const write = jest
        .spyOn(cache, 'set')
        .mockImplementationOnce(async (...args: Parameters<Redis['set']>) => {
          write.mockRestore();
          raced = true;
          await loader.load(BRANDS);
          return cache.set(...args);
        });

      expect(await publicNames('merc')).toEqual(['Mercedes']);
      expect(raced).toBe(true);
      expect(await publicNames('merc')).toEqual(['Mercedes-Benz']);
    },
  );
});
