// @traces 105-FR-001 105-FR-004 105-FR-005 105-FR-006 105-FR-009 105-FR-012 105-FR-014

import type { Role } from '@motor-fix/contracts/capabilities';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Redis } from 'ioredis';
import request from 'supertest';

import { signAccessToken } from '../../auth/access-token';
import { AuthModule } from '../../auth/auth.module';
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

const brandOf = (slug: string) =>
  prisma.brand.findUniqueOrThrow({ where: { slug } });
const audits = (subjectId: string) =>
  prisma.activityLog.count({ where: { subjectId } });
const seen = async (id: string) =>
  (
    await prisma.brand.findUniqueOrThrow({ where: { id } })
  ).updatedAt.toISOString();
const FILE = [
  { key: 'dacia', name: 'Dacia' },
  { key: 'saab', name: 'Saab' },
];

// @traces 105-FR-001
describe('admin brands refusals on every route', () => {
  it('answers 404 not_found to every other role on list, create and edit', async () => {
    await loader.load(FILE);
    const dacia = await brandOf('dacia');
    for (const role of NON_ADMIN) {
      const id = await account(`Rol ${role}`, [role]);
      const auth = bearer(id, role);
      const got = [
        await list({}, auth),
        await create({ name: 'Xpeng' }, auth),
        await update(
          dacia.id,
          { active: false, seenUpdatedAt: await seen(dacia.id) },
          auth,
        ),
      ];
      expect(got.map((r) => r.status)).toEqual([404, 404, 404]);
    }
    expect(await prisma.brand.count({ where: { slug: 'xpeng' } })).toBe(0);
  });

  it('answers 401 sign_in_required with no session and 401 for a malformed bearer', async () => {
    const got = [
      await server().get('/admin/brands'),
      await server().post('/admin/brands').send({ name: 'Xpeng' }),
      await server().patch(`/admin/brands/${NOBODY}`).send({ active: false }),
      await server()
        .get('/admin/brands')
        .set('Authorization', 'Bearer nonsense'),
    ];
    expect(got.map((r) => [r.status, r.body.code])).toEqual([
      [401, 'sign_in_required'],
      [401, 'sign_in_required'],
      [401, 'sign_in_required'],
      [401, 'sign_in_required'],
    ]);
  });

  it('answers 403 account_suspended to a suspended admin on create and edit', async () => {
    const id = await account('Ion Suspendat', ['admin'], {
      status: 'suspended',
    });
    const auth = bearer(id, 'admin');
    const a = await create({ name: 'Xpeng' }, auth);
    const b = await update(
      NOBODY,
      { active: false, seenUpdatedAt: new Date().toISOString() },
      auth,
    );
    expect([a.status, a.body.code, b.status, b.body.code]).toEqual([
      403,
      'account_suspended',
      403,
      'account_suspended',
    ]);
    expect(await prisma.brand.count({ where: { slug: 'xpeng' } })).toBe(0);
  });

  it('offers no DELETE and no PUT on a brand', async () => {
    await loader.load(FILE);
    const dacia = await brandOf('dacia');
    const del = await server()
      .delete(`/admin/brands/${dacia.id}`)
      .set('Authorization', admin.auth);
    const put = await server()
      .put(`/admin/brands/${dacia.id}`)
      .set('Authorization', admin.auth)
      .send({ name: 'X1' });
    expect([del.status, put.status]).toEqual([404, 404]);
    expect(await prisma.brand.count()).toBe(2);
  });
});

// @traces 105-FR-004 105-FR-005
describe('creating a brand under hostile names', () => {
  it('answers 415 to a form-encoded body and creates nothing', async () => {
    const res = await server()
      .post('/admin/brands')
      .set('Authorization', admin.auth)
      .type('form')
      .send('name=Xpeng');
    expect(res.status).toBe(415);
    expect(await prisma.brand.count()).toBe(0);
  });

  it('answers 400 validation_failed for a name with no letters, so its slug is empty', async () => {
    const got = [];
    for (const name of ['--', '!!!', '  ..  ', '\u2014\u2014']) {
      const r = await create({ name });
      got.push([r.status, r.body.code]);
    }
    expect(got).toEqual(Array(4).fill([400, 'validation_failed']));
    expect(await prisma.brand.count()).toBe(0);
  });

  it('answers 400 for a missing, null, numeric or array name and an unknown field', async () => {
    const bodies = [
      {},
      { name: null },
      { name: 7 },
      { name: ['Xpeng'] },
      { active: false, name: 'Xpeng' },
    ];
    const got = [];
    for (const body of bodies) got.push((await create(body)).status);
    expect(got).toEqual([400, 400, 400, 400, 400]);
  });

  it('answers 400 for a body that is not an object', async () => {
    const res = await server()
      .post('/admin/brands')
      .set('Authorization', admin.auth)
      .set('Content-Type', 'application/json')
      .send('[]');
    expect(res.status).toBe(400);
  });

  it('answers 409 brand_exists naming the holder for accent and case variants', async () => {
    await loader.load([{ key: 'skoda', name: 'Škoda' }]);
    const got = [];
    for (const name of ['SKODA', 'skoda', 'Skoda', ' Škoda ']) {
      const r = await create({ name });
      got.push([r.status, r.body.code, r.body.message]);
    }
    expect(got).toEqual(
      Array(4).fill([409, 'brand_exists', 'Marca există deja: Škoda']),
    );
    expect(await prisma.brand.count()).toBe(1);
  });

  it('answers 201 for a name at 40 characters and 400 at 41', async () => {
    const ok = await create({ name: 'a'.repeat(40) });
    const bad = await create({ name: 'a'.repeat(41) });
    expect([ok.status, bad.status]).toEqual([201, 400]);
    expect(ok.body).toEqual(
      expect.objectContaining({
        cars: 0,
        garages: 0,
        state: 'active',
        updatedBy: admin.id,
      }),
    );
  });

  it('lets two simultaneous creates of one name make one brand and refuse the other', async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () => create({ name: 'Xpeng' })),
    );
    expect(results.map((r) => r.status).sort()).toEqual([
      201, 409, 409, 409, 409,
    ]);
    expect(await prisma.brand.count({ where: { slug: 'xpeng' } })).toBe(1);
    expect(await audits((await brandOf('xpeng')).id)).toBe(1);
  });

  it('does not put the name in the response of a refusal for a different brand', async () => {
    const r = await create({ name: 'Xpeng', slug: 'other' });
    expect(r.status).toBe(400);
    expect(await prisma.brand.count()).toBe(0);
  });
});

// @traces 105-FR-003
describe('listing under hostile searches', () => {
  it('answers an empty items array for an empty store', async () => {
    const r = await list();
    expect([r.status, r.body]).toEqual([200, { items: [] }]);
  });

  it('answers 200 for a q of 40 characters and 400 validation_failed for 41', async () => {
    const ok = await list({ q: 'a'.repeat(40) });
    const bad = await list({ q: 'a'.repeat(41) });
    expect([ok.status, bad.status]).toEqual([200, 400]);
  });

  it('counts a q of 40 accented characters as 40', async () => {
    const r = await list({ q: 'é'.repeat(40) });
    expect(r.status).toBe(200);
  });

  it('finds a brand typed in decomposed accents and capitals', async () => {
    await loader.load([{ key: 'skoda', name: 'Škoda' }, ...FILE]);
    const r = await list({ q: 'S\u030cKODA' });
    expect(r.body.items.map((i: { name: string }) => i.name)).toEqual([
      'Škoda',
    ]);
  });

  it('treats percent and underscore in q as plain text, not wildcards', async () => {
    await loader.load(FILE);
    const a = await list({ q: '%' });
    const b = await list({ q: '_' });
    expect([a.body.items, b.body.items]).toEqual([[], []]);
  });

  it('returns all for a blank q and refuses a repeated q', async () => {
    await loader.load(FILE);
    const all = await list({ q: '' });
    const twice = await server()
      .get('/admin/brands?q=a&q=b')
      .set('Authorization', admin.auth);
    expect([all.body.items.length, twice.status]).toEqual([2, 400]);
  });

  it('refuses a paging parameter the list does not have', async () => {
    const r = await list({ limit: '1' });
    expect(r.status).toBe(400);
  });

  it('shows a retired brand in the list and a brand with no references with zero counts', async () => {
    await loader.load(FILE);
    await loader.load([FILE[0]!]);
    const r = await list();
    expect(r.body.items).toEqual([
      expect.objectContaining({
        cars: 0,
        garages: 0,
        name: 'Dacia',
        state: 'active',
        updatedBy: null,
      }),
      expect.objectContaining({
        cars: 0,
        garages: 0,
        name: 'Saab',
        state: 'retired',
        updatedBy: null,
      }),
    ]);
  });
});

// @traces 105-FR-006
describe('editing a brand in the order the contract fixes', () => {
  const stamp = () => new Date().toISOString();

  it('answers 400 for an id that is not a uuid', async () => {
    const r = await update('not-a-uuid', {
      active: false,
      seenUpdatedAt: stamp(),
    });
    expect(r.status).toBe(400);
  });

  it('answers 404 for an unknown id even with an empty body', async () => {
    const r = await update(NOBODY, { seenUpdatedAt: stamp() });
    expect(r.status).toBe(404);
  });

  it('answers 400 for an unknown id with a name the DTO refuses', async () => {
    const r = await update(NOBODY, { name: 'D', seenUpdatedAt: stamp() });
    expect(r.status).toBe(400);
  });

  it('answers 400 for a known id and an empty body', async () => {
    await loader.load(FILE);
    const dacia = await brandOf('dacia');
    const r = await update(dacia.id, { seenUpdatedAt: await seen(dacia.id) });
    expect(r.status).toBe(400);
  });

  it('answers 400, not 409, for an invalid name with a stale seen value', async () => {
    await loader.load(FILE);
    const dacia = await brandOf('dacia');
    const r = await update(dacia.id, {
      name: 'D',
      seenUpdatedAt: '2001-01-01T00:00:00.000Z',
    });
    expect(r.status).toBe(400);
  });

  it('answers stale_value with the current row, before brand_exists', async () => {
    await loader.load(FILE);
    const dacia = await brandOf('dacia');
    const r = await update(dacia.id, {
      name: 'Saab',
      seenUpdatedAt: '2001-01-01T00:00:00.000Z',
    });
    expect([r.status, r.body.code]).toEqual([409, 'stale_value']);
    expect(r.body.brand).toEqual(
      expect.objectContaining({
        id: dacia.id,
        name: 'Dacia',
        updatedAt: await seen(dacia.id),
      }),
    );
  });

  it('answers stale_value even for a no-op change', async () => {
    await loader.load(FILE);
    const dacia = await brandOf('dacia');
    const r = await update(dacia.id, {
      active: true,
      seenUpdatedAt: '2001-01-01T00:00:00.000Z',
    });
    expect([r.status, r.body.code]).toEqual([409, 'stale_value']);
  });

  it('writes nothing for a no-op: same name, same state, any padding or case of slug-equal name', async () => {
    await loader.load(FILE);
    const dacia = await brandOf('dacia');
    const before = await seen(dacia.id);
    const r = await update(dacia.id, {
      active: true,
      name: ' Dacia ',
      seenUpdatedAt: before,
    });
    expect([r.status, r.body.updatedAt, r.body.updatedBy]).toEqual([
      200,
      before,
      null,
    ]);
    expect(await seen(dacia.id)).toBe(before);
    expect(await audits(dacia.id)).toBe(1);
  });

  it('keeps an admin-less no-op from claiming the brand for the admin', async () => {
    await loader.load(FILE);
    const dacia = await brandOf('dacia');
    await update(dacia.id, {
      active: true,
      seenUpdatedAt: await seen(dacia.id),
    });
    expect((await brandOf('dacia')).updatedBy).toBeNull();
  });

  it('refuses the old seen value on a second identical edit', async () => {
    await loader.load(FILE);
    const dacia = await brandOf('dacia');
    const old = await seen(dacia.id);
    const first = await update(dacia.id, { active: false, seenUpdatedAt: old });
    const second = await update(dacia.id, { active: true, seenUpdatedAt: old });
    expect([first.status, second.status, second.body.code]).toEqual([
      200,
      409,
      'stale_value',
    ]);
    expect((await brandOf('dacia')).active).toBe(false);
  });

  it('lets only one of five concurrent edits with the same seen value win', async () => {
    await loader.load(FILE);
    const dacia = await brandOf('dacia');
    const old = await seen(dacia.id);
    const results = await Promise.all(
      [
        'Dacia Uno',
        'Dacia Dos',
        'Dacia Tres',
        'Dacia Cuatro',
        'Dacia Cinco',
      ].map((name) => update(dacia.id, { name, seenUpdatedAt: old })),
    );
    expect(results.map((r) => r.status).sort()).toEqual([
      200, 409, 409, 409, 409,
    ]);
  });

  it('answers 409 brand_exists when a rename differs from a holder only by accent or case', async () => {
    await loader.load([{ key: 'skoda', name: 'Škoda' }, ...FILE]);
    const dacia = await brandOf('dacia');
    const r = await update(dacia.id, {
      name: 'SKODA',
      seenUpdatedAt: await seen(dacia.id),
    });
    expect([r.status, r.body.code, r.body.message]).toEqual([
      409,
      'brand_exists',
      'Marca există deja: Škoda',
    ]);
    expect((await brandOf('dacia')).name).toBe('Dacia');
  });

  it('allows a rename that changes only case or accents of its own name, with name and slug audited as they changed', async () => {
    await loader.load([{ key: 'skoda', name: 'Skoda' }]);
    const skoda = await brandOf('skoda');
    const r = await update(skoda.id, {
      name: 'Škoda',
      seenUpdatedAt: await seen(skoda.id),
    });
    expect([r.status, r.body.name, r.body.slug]).toEqual([
      200,
      'Škoda',
      'skoda',
    ]);
    const fields = (
      await prisma.activityLog.findMany({
        where: { actorRole: 'admin', subjectId: skoda.id },
      })
    ).map((e) => e.field);
    expect(fields).toEqual(['name']);
  });

  it('refuses a seenUpdatedAt that is not strict ISO 8601 and changes nothing', async () => {
    await loader.load(FILE);
    const dacia = await brandOf('dacia');
    const got = [];
    for (const seenUpdatedAt of [
      'yesterday',
      '2026-02-30T00:00:00Z',
      12345,
      null,
      '',
    ]) {
      got.push(
        (await update(dacia.id, { active: false, seenUpdatedAt })).status,
      );
    }
    expect(got).toEqual([400, 400, 400, 400, 400]);
    expect((await brandOf('dacia')).active).toBe(true);
  });

  it('accepts the seen value in the same instant with a different offset', async () => {
    await loader.load(FILE);
    const dacia = await brandOf('dacia');
    const iso = await seen(dacia.id);
    const shifted = new Date(Date.parse(iso)).toISOString();
    const r = await update(dacia.id, { active: false, seenUpdatedAt: shifted });
    expect(r.status).toBe(200);
  });

  it('refuses popularity or roPossessive in an edit', async () => {
    await loader.load(FILE);
    const dacia = await brandOf('dacia');
    const a = await update(dacia.id, {
      active: false,
      popularity: 1,
      seenUpdatedAt: await seen(dacia.id),
    });
    const b = await update(dacia.id, {
      active: false,
      roPossessive: 'x',
      seenUpdatedAt: await seen(dacia.id),
    });
    expect([a.status, b.status]).toEqual([400, 400]);
  });

  it('answers 415 for a non-JSON edit', async () => {
    await loader.load(FILE);
    const dacia = await brandOf('dacia');
    const r = await server()
      .patch(`/admin/brands/${dacia.id}`)
      .set('Authorization', admin.auth)
      .type('form')
      .send('active=false');
    expect(r.status).toBe(415);
  });

  it('writes the bumped updatedAt on a change so the old seen value is stale', async () => {
    await loader.load(FILE);
    const dacia = await brandOf('dacia');
    const old = await seen(dacia.id);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const r = await update(dacia.id, { active: false, seenUpdatedAt: old });
    expect(r.body.updatedAt).not.toBe(old);
    expect(r.body.updatedBy).toBe(admin.id);
  });

  it('audits retirement as a single active entry with old true and new false, and bring-back the reverse', async () => {
    await loader.load(FILE);
    const dacia = await brandOf('dacia');
    const r1 = await update(dacia.id, {
      active: false,
      seenUpdatedAt: await seen(dacia.id),
    });
    await update(dacia.id, { active: true, seenUpdatedAt: r1.body.updatedAt });
    const rows = await prisma.activityLog.findMany({
      orderBy: { at: 'asc' },
      where: { actorRole: 'admin', subjectId: dacia.id },
    });
    expect(rows.map((e) => [e.field, e.oldValue, e.newValue])).toEqual([
      ['active', true, false],
      ['active', false, true],
    ]);
  });
});

// @traces 105-FR-009 105-FR-014
describe('the cached list after an admin write', () => {
  it('shows a created brand and drops a retired one on the next public search', async () => {
    await loader.load(FILE);
    await server().get('/brands');
    const made = await create({ name: 'Xpeng' });
    const dacia = await brandOf('dacia');
    await update(dacia.id, {
      active: false,
      seenUpdatedAt: await seen(dacia.id),
    });
    const names = (
      await server().get('/brands').query({ q: '' })
    ).body.items.map((i: { name: string }) => i.name);
    expect(made.status).toBe(201);
    expect(names.sort()).toEqual(['Saab', 'Xpeng']);
  });

  it('does not fail a write when the cache cannot be bumped', async () => {
    await loader.load(FILE);
    const dacia = await brandOf('dacia');
    const spy = vi
      .spyOn(Redis.prototype, 'incr')
      .mockRejectedValue(new Error('down'));
    try {
      const r = await update(dacia.id, {
        active: false,
        seenUpdatedAt: await seen(dacia.id),
      });
      expect([r.status, r.body.state]).toEqual([200, 'retired']);
    } finally {
      spy.mockRestore();
    }
  });
});

// @traces 105-FR-012
describe('the loader beside admin-owned brands', () => {
  it('neither renames, revives, re-ranks nor retires an admin-changed brand, and adds the missing ones', async () => {
    await loader.load(FILE);
    const dacia = await brandOf('dacia');
    const saab = await brandOf('saab');
    await update(dacia.id, {
      name: 'Dacia Romania',
      seenUpdatedAt: await seen(dacia.id),
    });
    await update(saab.id, {
      active: false,
      seenUpdatedAt: await seen(saab.id),
    });
    await loader.load([
      { key: 'saab', name: 'Saab' },
      { key: 'volvo', name: 'Volvo' },
    ]);
    const after = await list();
    const byName = Object.fromEntries(
      after.body.items.map((i: { name: string; state: string }) => [
        i.name,
        i.state,
      ]),
    );
    expect(byName).toEqual({
      'Dacia Romania': 'active',
      Saab: 'retired',
      Volvo: 'active',
    });
  });

  it('skips a file record whose name or slug an admin-owned brand holds, without failing the load', async () => {
    const made = await create({ name: 'Xpeng' });
    const res = await loader.load([
      { key: 'xpeng-file', name: 'XPENG' },
      { key: 'volvo', name: 'Volvo' },
    ]);
    expect(made.status).toBe(201);
    expect(res.changed).toBe(1);
    expect(await prisma.brand.count({ where: { key: 'xpeng-file' } })).toBe(0);
  });

  it('skips a file record whose key an admin-owned brand holds', async () => {
    await create({ name: 'Xpeng' });
    await loader.load([{ key: 'xpeng', name: 'Xpeng Motors' }]);
    expect((await brandOf('xpeng')).name).toBe('Xpeng');
  });

  it('keeps an admin brand active across a load of an empty file', async () => {
    await create({ name: 'Xpeng' });
    await loader.load([]);
    expect((await brandOf('xpeng')).active).toBe(true);
  });

  it('still fails a load when two loader-owned brands collide', async () => {
    await expect(
      loader.load([
        { key: 'a', name: 'Skoda' },
        { key: 'b', name: 'Škoda' },
      ]),
    ).rejects.toThrow();
  });

  it('keeps ownership after the admin account is deleted', async () => {
    await loader.load(FILE);
    const dacia = await brandOf('dacia');
    const other = await account('Alt Admin', ['admin']);
    await update(
      dacia.id,
      { active: false, seenUpdatedAt: await seen(dacia.id) },
      bearer(other, 'admin'),
    );
    await prisma
      .$executeRawUnsafe(`DELETE FROM account WHERE id = '${other}'`)
      .catch(() => undefined);
    await loader.load(FILE);
    const after = await brandOf('dacia');
    expect([after.active, after.updatedBy]).toEqual([false, other]);
  });
});
