import { randomUUID } from 'node:crypto';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Redis } from 'ioredis';
import request from 'supertest';

import { AdminAccountsModule } from './admin-accounts.module';
import { AdminAccountsService, SUMMARY_KEY } from './admin-accounts.service';
import { signAccessToken } from '../../auth/access-token';
import { AuthModule } from '../../auth/auth.module';
import type { Role } from '../../auth/capabilities';
import { serialDatabase } from '../../auth/serial-db.testing';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
} from '../../notifications/notifications.testing';

const redisUrl = redisUrlFor(9);
const tokenSecret = 'test-secret';
const { account, prisma, reset } = fixtures();
serialDatabase(databaseUrl);

const NOW = new Date('2026-10-08T12:00:00.000Z');
const DAY = 86_400_000;
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY);

const redis = new Redis(redisUrl);
const service = new AdminAccountsService(prisma, redis);
let app: INestApplication;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [
      AuthModule.register({ databaseUrl, redisUrl, tokenSecret }),
      AdminAccountsModule,
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

afterAll(async () => {
  await app.close();
  redis.disconnect();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await reset();
  await redis.del(SUMMARY_KEY);
});

const adminAuth = async () =>
  `Bearer ${signAccessToken(
    { accountId: await account('Admin', ['admin']), role: 'admin' as Role },
    tokenSecret,
  )}`;

const get = (path: string, auth: string) =>
  request(app.getHttpServer()).get(path).set('Authorization', auth);

const person = async (
  name: string,
  roles: Role[],
  created: Date,
  status?: 'active' | 'suspended' | 'deleted',
) => {
  const id = await account(name, roles, { status });
  await prisma.account.update({
    data: { createdAt: created },
    where: { id },
  });
  return id;
};

const garage = (name: string, status: 'draft' | 'approved' = 'draft') =>
  prisma.garage.create({
    data: { name, slug: `g-${randomUUID()}`, status },
  });

const b64 = (text: string) => Buffer.from(text).toString('base64url');

describe('hostile cursors over HTTP', () => {
  it.each([
    ['padding left on', `${b64(`${NOW.toISOString()}|${randomUUID()}`)}==`],
    ['a second separator', b64(`${NOW.toISOString()}|${randomUUID()}|x`)],
    ['an empty string', ''],
    ['an impossible date', b64(`2026-13-45T99:00:00.000Z|${randomUUID()}`)],
    ['a sql fragment', b64(`${NOW.toISOString()}|'; DROP TABLE accounts;--`)],
    ['only a separator', b64('|')],
    ['unicode', encodeURIComponent('é|ß|☃')],
  ])('answers 400 invalid_cursor to %s', async (_label, cursor) => {
    const res = await get(
      `/admin/accounts?cursor=${cursor}`,
      await adminAuth(),
    );

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_cursor');
  });

  it('refuses a cursor past 200 characters with a 400 invalid_cursor', async () => {
    const res = await get(
      `/admin/accounts?cursor=${'A'.repeat(201)}`,
      await adminAuth(),
    );

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_cursor');
  });

  it('refuses a cursor given twice with a 400', async () => {
    const one = b64(`${NOW.toISOString()}|${randomUUID()}`);
    const res = await get(
      `/admin/accounts?cursor=${one}&cursor=${one}`,
      await adminAuth(),
    );

    expect(res.status).toBe(400);
  });

  it('answers what follows a cursor far in the future with the newest accounts', async () => {
    await person('Vechi', ['driver'], daysAgo(5));
    const res = await get(
      `/admin/accounts?cursor=${b64(`9999-12-31T23:59:59.999Z|${randomUUID()}`)}`,
      await adminAuth(),
    );

    expect(res.status).toBe(200);
    expect(res.body.items.map((i: { name: string }) => i.name)).toEqual([
      'Admin',
      'Vechi',
    ]);
  });

  it('answers an empty page, not an error, to a cursor before every account', async () => {
    await person('Vechi', ['driver'], daysAgo(5));
    const res = await get(
      `/admin/accounts?cursor=${b64(`1970-01-01T00:00:00.000Z|${randomUUID()}`)}`,
      await adminAuth(),
    );

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ items: [], nextCursor: null });
  });
});

describe('page boundaries over HTTP', () => {
  it('carries no next cursor with exactly twenty accounts', async () => {
    const auth = await adminAuth();
    for (let n = 0; n < 19; n++)
      await person(`C${n}`, ['driver'], daysAgo(n + 1));

    const res = await get('/admin/accounts', auth);

    expect(res.body.items).toHaveLength(20);
    expect(res.body.nextCursor).toBeNull();
  });

  it('carries a next cursor with twenty-one accounts and a page with the last one', async () => {
    const auth = await adminAuth();
    for (let n = 0; n < 20; n++)
      await person(`C${n}`, ['driver'], daysAgo(n + 1));

    const first = await get('/admin/accounts', auth);
    const second = await get(
      `/admin/accounts?cursor=${first.body.nextCursor}`,
      auth,
    );

    expect(first.body.items).toHaveLength(20);
    expect(first.body.nextCursor).toEqual(expect.any(String));
    expect(second.body.items).toHaveLength(1);
    expect(second.body.nextCursor).toBeNull();
  });

  it('answers the same page twice for the same cursor', async () => {
    const auth = await adminAuth();
    for (let n = 0; n < 30; n++)
      await person(`C${n}`, ['driver'], daysAgo(n + 1));
    const first = await get('/admin/accounts', auth);
    const url = `/admin/accounts?cursor=${first.body.nextCursor}`;

    expect((await get(url, auth)).body).toEqual((await get(url, auth)).body);
  });

  it('leaves out deleted accounts and never carries personal fields', async () => {
    const auth = await adminAuth();
    await person('Șters', ['driver'], daysAgo(1), 'deleted');
    await person('Ștefan Ünïcode ☃', ['driver'], daysAgo(2), 'suspended');

    const res = await get('/admin/accounts', auth);
    const text = JSON.stringify(res.body);

    expect(res.body.items.map((i: { name: string }) => i.name)).toEqual([
      'Admin',
      'Ștefan Ünïcode ☃',
    ]);
    expect(text).not.toContain('@example.test');
    expect(text).not.toMatch(/"(email|phone|plate)"/);
  });
});

describe('which role decides the row', () => {
  it('lets the garage role win over the mechanic role', async () => {
    const id = await person('Dublu', ['mechanic', 'garage'], daysAgo(40));
    const owned = await garage('Al Patronului');
    const employer = await garage('Al Angajatorului');
    await prisma.garageMember.create({
      data: { accountId: id, garageId: owned.id, role: 'owner' },
    });
    await prisma.mechanic.create({
      data: { accountId: id, garageId: employer.id, name: 'Dublu' },
    });

    const item = (await service.page(undefined, NOW)).items.find(
      (i) => i.id === id,
    );

    expect(item).toMatchObject({
      garageName: 'Al Patronului',
      roles: ['garage', 'mechanic'],
    });
  });

  it('keeps an account under seven days old on its age even when suspended', async () => {
    const id = await person(
      'Nou suspendat',
      ['garage'],
      daysAgo(3),
      'suspended',
    );

    const item = (await service.page(undefined, NOW)).items.find(
      (i) => i.id === id,
    );

    expect(item?.count).toEqual({ kind: 'age', value: 3 });
  });

  it('reads a role with no garage as a null garage name, not an error', async () => {
    const owner = await person('Fără service', ['garage'], daysAgo(30));
    const mech = await person('Fără card', ['mechanic'], daysAgo(31));
    const rec = await person('Fără membru', ['receptionist'], daysAgo(32));

    const items = (await service.page(undefined, NOW)).items;

    for (const id of [owner, mech, rec]) {
      expect(items.find((i) => i.id === id)?.garageName).toBeNull();
    }
  });
});

describe('the totals under hostile cache and edges', () => {
  it.each([
    ['an empty object', '{}'],
    [
      'strings for numbers',
      '{"activeDrivers":"1","garagesListed":"2","mechanics":"3"}',
    ],
    [
      'a negative count',
      '{"activeDrivers":-1,"garagesListed":0,"mechanics":0}',
    ],
    ['null', 'null'],
  ])('counts again when the kept copy is %s', async (_label, kept) => {
    await redis.set(SUMMARY_KEY, kept, 'EX', 60);

    expect(await service.summary(NOW)).toEqual({
      activeDrivers: 0,
      garagesListed: 0,
      mechanics: 0,
    });
  });

  it('counts a driver last active exactly 30 days ago on the same side as the overview', async () => {
    const inside = await person('Aproape', ['driver'], daysAgo(100));
    const outside = await person('Departe', ['driver'], daysAgo(100));
    await prisma.account.update({
      data: { lastActiveAt: daysAgo(29.99) },
      where: { id: inside },
    });
    await prisma.account.update({
      data: { lastActiveAt: daysAgo(30.01) },
      where: { id: outside },
    });

    expect((await service.summary(NOW)).activeDrivers).toBe(1);
  });

  it('does not count a suspended driver or a deleted one as active', async () => {
    for (const status of ['suspended', 'deleted'] as const) {
      const id = await person(`S-${status}`, ['driver'], daysAgo(100), status);
      await prisma.account.update({
        data: { lastActiveAt: daysAgo(1) },
        where: { id },
      });
    }

    expect((await service.summary(NOW)).activeDrivers).toBe(0);
  });

  it('answers the same totals to two calls in a row over HTTP', async () => {
    const auth = await adminAuth();
    const first = await get('/admin/accounts/summary', auth);
    const second = await get('/admin/accounts/summary', auth);

    expect(second.body).toEqual(first.body);
  });
});
