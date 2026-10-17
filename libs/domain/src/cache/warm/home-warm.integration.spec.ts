import { randomUUID } from 'node:crypto';

import { CURRENT_CONSENT } from '@motor-fix/contracts';
import { countedMetrics, counterTotal } from '@motor-fix/observability/testing';
import {
  type BeforeApplicationShutdown,
  type INestApplication,
  Logger,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Redis } from 'ioredis';
import request from 'supertest';

import { WarmModule } from './warm.module';
import { AuditService } from '../../audit/audit.service';
import { signAccessToken } from '../../auth/access-token';
import { AccountsService } from '../../auth/accounts.service';
import { AUTH_REDIS } from '../../auth/attempts';
import { AuthModule } from '../../auth/auth.module';
import type { Role } from '../../auth/capabilities';
import * as password from '../../auth/password/password';
import { PRISMA } from '../../auth/prisma';
import { serialDatabase } from '../../auth/serial-db.testing';
import { HOME_WARM } from '../../auth/sign-in.service';
import { CarsModule } from '../../cars/my-cars/cars/cars.module';
import { CarsService } from '../../cars/my-cars/cars/cars.service';
import { noEvents } from '../../events/event.port';
import { QuotesModule } from '../../quotes/quotes.module';
import { databaseUrl, quotesWorld } from '../../quotes/quotes.testing';
import { cacheKey } from '../cache.service';
import { purgeAudience } from '../purge';

const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
const tokenSecret = 'test-secret';
const PASSWORD = 'parola-de-test';
const HOUR = 3_600_000;
const reader = countedMetrics();
const world = quotesWorld();
const { prisma } = world;
const redis = new Redis(redisUrl);
const accounts = new AccountsService(prisma, new AuditService(), noEvents);
serialDatabase(databaseUrl);

let hash: string;
let app: INestApplication;

async function start(redisAt = redisUrl) {
  const moduleRef = await Test.createTestingModule({
    imports: [
      AuthModule.register({ databaseUrl, redisUrl: redisAt, tokenSecret }),
      CarsModule,
      QuotesModule,
      WarmModule,
    ],
  }).compile();
  const nest = moduleRef.createNestApplication();
  nest.useGlobalPipes(
    new ValidationPipe({
      forbidNonWhitelisted: true,
      transform: true,
      whitelist: true,
    }),
  );
  await nest.init();
  return nest;
}

beforeAll(async () => {
  hash = await password.hashPassword(PASSWORD);
  app = await start();
});

afterAll(async () => {
  await app?.close();
  await prisma.$disconnect();
  redis.disconnect();
});

const warmKeys = () =>
  Promise.all([
    redis.keys('v1:driver-home:*'),
    redis.keys('v1:garage-home:*'),
  ]).then(([driver, garage]) => [...driver, ...garage]);

beforeEach(async () => {
  await world.reset();
  await prisma.$executeRawUnsafe('TRUNCATE outbox_event');
  const keys = [
    ...(await warmKeys()),
    ...(await redis.keys('v1:tag:warm:*')),
    ...(await redis.keys('auth:fail:*')),
  ];
  if (keys.length) await redis.del(...keys);
  jest.restoreAllMocks();
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until(what: string, check: () => Promise<boolean>) {
  const deadline = performance.now() + 5000;
  while (!(await check())) {
    if (performance.now() > deadline) {
      throw new Error(`timed out waiting for ${what}`);
    }
    await sleep(20);
  }
}

const stored = (...keys: string[]) =>
  until(
    keys.join(', '),
    async () => (await redis.exists(...keys)) === keys.length,
  );

async function person(roles: Role[]) {
  const email = `${randomUUID()}@example.test`;
  const { id } = await accounts.createAccount({
    consent: CURRENT_CONSENT,
    email,
    identity: { method: 'password', passwordHash: hash, subject: email },
    name: 'Andrei Ion Marin',
    roles,
  });
  return { email, id };
}

const signIn = (email: string, secret = PASSWORD, server = app) =>
  request(server.getHttpServer())
    .post('/auth/sign-in')
    .send({ email, password: secret });

const bearer = (accountId: string, role: Role) =>
  `Bearer ${signAccessToken({ accountId, role }, tokenSecret)}`;

const get = (path: string, auth?: string, server = app) => {
  const call = request(server.getHttpServer()).get(path);
  return auth ? call.set('Authorization', auth) : call;
};

const counted = (kind: string, outcome: string) =>
  counterTotal(reader, 'motorfix_cache_total', { kind, outcome });

async function counting(run: () => Promise<unknown>) {
  const names = ['driver-home', 'garage-home'].flatMap((kind) =>
    ['warm', 'hit', 'miss', 'fallback'].map((outcome) => [kind, outcome]),
  );
  const read = () =>
    Promise.all(names.map(([kind, outcome]) => counted(kind, outcome)));
  const before = await read();
  await run();
  const after = await read();
  return Object.fromEntries(
    names
      .map(([kind, outcome], n) => [
        `${kind} ${outcome}`,
        (after[n] ?? 0) - (before[n] ?? 0),
      ])
      .filter(([, value]) => value !== 0),
  );
}

const cookieOf = (res: request.Response) =>
  (res.headers['set-cookie'] as unknown as string[] | undefined)
    ?.find((c) => c.startsWith('mf_refresh='))
    ?.split(';')[0]
    ?.slice('mf_refresh='.length) ?? '';

// What the outbox relay does first with each event: the purge by audience.
async function relay() {
  const rows = await prisma.outboxEvent.findMany({ orderBy: { id: 'asc' } });
  for (const row of rows) await purgeAudience(redis, row.audience);
  await prisma.$executeRawUnsafe('TRUNCATE outbox_event');
  return rows;
}

const driverKeys = (accountId: string) => [
  cacheKey('driver-home', accountId, 'cars'),
  cacheKey('driver-home', accountId, 'requests'),
];

const garageKeys = (garageId: string) =>
  (['waiting', 'quoted', 'closed'] as const).map((status) =>
    cacheKey('garage-home', garageId, status),
  );

// A driver with two cars and one request still open.
async function driver() {
  const andrei = await person(['driver']);
  const first = await world.car(andrei.id, 'B123ABC');
  await world.car(andrei.id, 'CJ12XYZ');
  const open = await world.request(andrei.id, { carId: first.id });
  return { ...andrei, car: first, open };
}

// A garage owner with one request waiting and one quoted.
async function owner() {
  const garage = await world.garage('Atelier Dinamo');
  const boss = await person(['garage']);
  await prisma.garageMember.create({
    data: { accountId: boss.id, garageId: garage.id, role: 'owner' },
  });
  const asked = await world.account('Maria Pop');
  const waiting = await world.request(asked);
  await world.recipient(waiting.id, garage.id, 'waiting');
  const quoted = await world.request(asked);
  await world.quote(quoted.id, garage.id);
  return { ...boss, garage, waiting };
}

// @traces 1169-FR-002 1169-FR-003 1169-FR-005 1169-FR-010 1169-FR-011
describe('a driver’s sign-in', () => {
  it('warms the car and request lists, and the first reads take them', async () => {
    const andrei = await driver();
    const auth = bearer(andrei.id, 'driver');

    const warmed = await counting(async () => {
      const res = await signIn(andrei.email);
      expect(res.status).toBe(200);
      expect(res.headers['cache-tag']).toBeUndefined();
      await stored(...driverKeys(andrei.id));
    });
    expect(warmed).toEqual({ 'driver-home warm': 2 });
    for (const key of driverKeys(andrei.id)) {
      expect(await redis.pttl(key)).toBeLessThanOrEqual(99_000);
    }

    let first: request.Response[] = [];
    const taken = await counting(async () => {
      first = await Promise.all([get('/cars', auth), get('/requests', auth)]);
    });
    expect(taken).toEqual({ 'driver-home hit': 2 });
    expect(await redis.exists(...driverKeys(andrei.id))).toBe(0);
    for (const res of first) {
      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe('private, no-cache');
      expect(res.headers['cache-tag']).toBeUndefined();
    }
    expect(first[0]?.body.items).toHaveLength(2);
    expect(first[1]?.body.items).toHaveLength(1);

    let again: request.Response[] = [];
    const missed = await counting(async () => {
      again = await Promise.all([get('/cars', auth), get('/requests', auth)]);
    });
    expect(missed).toEqual({ 'driver-home miss': 2 });
    expect(again.map((res) => res.body)).toEqual(first.map((res) => res.body));
    expect(again[0]?.headers['cache-control']).toBe('private, no-cache');
  });

  it('never answers the entry to a cursor read, another account or a visitor', async () => {
    const andrei = await driver();
    const other = await person(['driver']);
    await signIn(andrei.email);
    await stored(...driverKeys(andrei.id));

    const page = await get(
      `/requests?cursor=${andrei.open.id}`,
      bearer(andrei.id, 'driver'),
    );
    const theirs = await get('/cars', bearer(other.id, 'driver'));
    const visitor = await get('/cars');
    const visitorRequests = await get('/requests');

    expect(page.status).toBe(200);
    expect(page.body.items).toEqual([]);
    expect(theirs.status).toBe(200);
    expect(theirs.body).toEqual({ items: [] });
    expect(visitor.status).toBe(401);
    expect(visitor.body.code).toBe('sign_in_required');
    expect(visitorRequests.status).toBe(401);
    expect(await redis.exists(...driverKeys(andrei.id))).toBe(2);
  });

  it('warms nothing for an unknown e-mail or a wrong password, which answer alike', async () => {
    const andrei = await driver();
    const fails = async () => (await redis.keys('auth:fail:*')).length;

    const unknown = await signIn(`${randomUUID()}@example.test`);
    const wrong = await signIn(andrei.email, 'not-the-password');

    expect([unknown.status, wrong.status]).toEqual([401, 401]);
    expect(unknown.body).toEqual(wrong.body);
    expect(wrong.body.code).toBe('invalid_credentials');
    expect(await fails()).toBeGreaterThan(0);
    await sleep(300);
    expect(await warmKeys()).toEqual([]);
  });

  it('warms nothing for an admin, a role switch or a renewal', async () => {
    const admin = await person(['admin']);
    expect((await signIn(admin.email)).status).toBe(200);
    const both = await person(['driver', 'garage']);
    await prisma.account.update({
      data: { lastRole: 'driver' },
      where: { id: both.id },
    });
    const garage = await world.garage('Atelier Dinamo');
    await prisma.garageMember.create({
      data: { accountId: both.id, garageId: garage.id, role: 'owner' },
    });
    const signedIn = await signIn(both.email);
    await stored(...driverKeys(both.id));
    await redis.del(...driverKeys(both.id));

    const switched = await request(app.getHttpServer())
      .post('/auth/roles/switch')
      .set('Cookie', `mf_refresh=${cookieOf(signedIn)}`)
      .send({ role: 'garage' });
    const renewed = await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', `mf_refresh=${cookieOf(switched)}`);

    expect([switched.status, renewed.status]).toEqual([200, 200]);
    await sleep(300);
    expect(await warmKeys()).toEqual([]);
  });

  it('signs in and reads from the database while Redis is down', async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const down = await start('redis://127.0.0.1:1');
    try {
      const andrei = await driver();

      const res = await signIn(andrei.email, PASSWORD, down);
      const cars = await get('/cars', bearer(andrei.id, 'driver'), down);

      expect(res.status).toBe(200);
      expect(cars.status).toBe(200);
      expect(cars.body.items).toHaveLength(2);
    } finally {
      await down.close();
    }
  });
});

// @traces 1169-FR-002 1169-FR-004 1169-FR-005 1169-FR-011
describe('a garage owner’s sign-in', () => {
  it('warms the waiting, quoted and closed lists, each taken once by the owner', async () => {
    const boss = await owner();
    const auth = bearer(boss.id, 'garage');

    const warmed = await counting(async () => {
      expect((await signIn(boss.email)).status).toBe(200);
      await stored(...garageKeys(boss.garage.id));
    });
    expect(warmed).toEqual({ 'garage-home warm': 3 });
    expect(await warmKeys()).toHaveLength(3);

    const read = () =>
      Promise.all(
        ['waiting', 'quoted', 'closed'].map((status) =>
          get(`/garage/requests?status=${status}`, auth),
        ),
      );
    let first: request.Response[] = [];
    const taken = await counting(async () => {
      first = await read();
    });
    expect(taken).toEqual({ 'garage-home hit': 3 });
    expect(first.map((res) => res.status)).toEqual([200, 200, 200]);
    expect(first[0]?.body.items).toHaveLength(1);
    expect(first[1]?.body.items).toHaveLength(1);
    expect(first[0]?.headers['cache-control']).toBe('private, no-cache');

    let again: request.Response[] = [];
    const missed = await counting(async () => {
      again = await read();
    });
    expect(missed).toEqual({ 'garage-home miss': 3 });
    expect(again.map((res) => res.body)).toEqual(first.map((res) => res.body));
  });

  it('never answers the owner’s entry to the staff, a read without status or a cursor read', async () => {
    const boss = await owner();
    const desk = await person(['receptionist']);
    const fixer = await person(['mechanic']);
    await prisma.garageMember.create({
      data: {
        accountId: desk.id,
        garageId: boss.garage.id,
        role: 'receptionist',
      },
    });
    await prisma.mechanic.create({
      data: {
        accountId: fixer.id,
        canAnswerQuotes: true,
        garageId: boss.garage.id,
        name: 'Fixer',
      },
    });
    await signIn(boss.email);
    await stored(...garageKeys(boss.garage.id));

    const reads = await Promise.all([
      get('/garage/requests?status=waiting', bearer(desk.id, 'receptionist')),
      get('/garage/requests?status=quoted', bearer(fixer.id, 'mechanic')),
      get('/garage/requests', bearer(boss.id, 'garage')),
      get(
        `/garage/requests?status=waiting&cursor=${boss.waiting.id}`,
        bearer(boss.id, 'garage'),
      ),
    ]);

    expect(reads.map((res) => res.status)).toEqual([200, 200, 200, 200]);
    expect(await redis.exists(...garageKeys(boss.garage.id))).toBe(3);
  });

  it('warms nothing for a garage account without a garage, which still signs in', async () => {
    const alone = await person(['garage']);

    expect((await signIn(alone.email)).status).toBe(200);
    await sleep(300);
    expect(await warmKeys()).toEqual([]);
  });
});

// @traces 1348-FR-005
describe('the app’s shutdown', () => {
  function deferred() {
    let resolve = () => {};
    const promise = new Promise<void>((done) => {
      resolve = done;
    });
    return { promise, resolve };
  }

  it('waits for the warm in flight before the stores close, and starts none while it waits', async () => {
    const second = await start();
    const held = deferred();
    const listCalled = deferred();
    const storesClosing = deferred();
    const waitBegan = deferred();
    const order: string[] = [];
    let closing: Promise<void> | undefined;
    try {
      const andrei = await driver();
      const list = jest
        .spyOn(second.get(CarsService), 'list')
        .mockImplementation(async () => {
          listCalled.resolve();
          await held.promise;
          return { items: [] };
        });
      const database = second.get(PRISMA);
      const disconnect = database.$disconnect.bind(database);
      jest.spyOn(database, '$disconnect').mockImplementation(() => {
        order.push('disconnect');
        storesClosing.resolve();
        return disconnect();
      });
      const store: Redis = second.get(AUTH_REDIS);
      const evaluate = store.eval.bind(store);
      jest.spyOn(store, 'eval').mockImplementation((...args) => {
        const script = String(args[0]);
        order.push(
          script.includes('ZADD')
            ? 'store'
            : script.includes("'DEL'")
              ? 'release'
              : 'eval',
        );
        return evaluate(...args);
      });
      // Wrapped only where the warm has the hook: a wrapper of its own would
      // hand Nest a shutdown hook the warm lacks, and the race would pass.
      const warm: Partial<BeforeApplicationShutdown> = second.get(HOME_WARM);
      const wait = warm.beforeApplicationShutdown?.bind(warm);
      if (wait) {
        jest
          .spyOn(warm as BeforeApplicationShutdown, 'beforeApplicationShutdown')
          .mockImplementation((signal) => {
            waitBegan.resolve();
            return wait(signal);
          });
      }

      expect((await signIn(andrei.email, PASSWORD, second)).status).toBe(200);
      await listCalled.promise;
      closing = second.close();

      expect(
        await Promise.race([
          storesClosing.promise.then(() => 'stores closed'),
          waitBegan.promise.then(() => 'warm waited'),
        ]),
      ).toBe('warm waited');

      const later = await person(['driver']);
      expect((await signIn(later.email, PASSWORD, second)).status).toBe(200);

      held.resolve();
      await closing;

      expect(list).toHaveBeenCalledTimes(1);
      expect(await redis.exists(...driverKeys(later.id))).toBe(0);
      const disconnected = order.indexOf('disconnect');
      expect(disconnected).toBeGreaterThan(order.lastIndexOf('store'));
      expect(disconnected).toBeGreaterThan(order.lastIndexOf('release'));
      expect(order.slice(disconnected + 1)).toEqual([]);
    } finally {
      held.resolve();
      await (closing ?? second.close());
    }
  });
});

// @traces 1169-FR-006
describe('a write before the home read it', () => {
  it('evicts the car list, and the next read has the change', async () => {
    const andrei = await driver();
    const auth = bearer(andrei.id, 'driver');
    await signIn(andrei.email);
    await stored(...driverKeys(andrei.id));

    const edit = await request(app.getHttpServer())
      .patch(`/cars/${andrei.car.id}`)
      .set('Authorization', auth)
      .send({ model: 'Clubman', version: andrei.car.updatedAt.toISOString() });
    expect(edit.status).toBe(200);
    await relay();

    expect(await redis.exists(driverKeys(andrei.id)[0] ?? '')).toBe(0);
    const outcomes = await counting(async () => {
      const cars = await get('/cars', auth);
      expect(
        cars.body.items.find((car: { id: string }) => car.id === andrei.car.id)
          .model,
      ).toBe('Clubman');
    });
    expect(outcomes).toEqual({ 'driver-home miss': 1 });
  });

  it('evicts the driver’s requests and the garage’s lists when a quote is sent', async () => {
    const andrei = await driver();
    const boss = await owner();
    await world.recipient(andrei.open.id, boss.garage.id, 'waiting');
    await signIn(andrei.email);
    await signIn(boss.email);
    await stored(...driverKeys(andrei.id), ...garageKeys(boss.garage.id));

    const sent = await request(app.getHttpServer())
      .post('/quotes')
      .set('Authorization', bearer(boss.id, 'garage'))
      .set('Idempotency-Key', randomUUID())
      .send({
        durationMinutes: 120,
        fromLei: 650,
        requestId: andrei.open.id,
        slot: new Date(Date.now() + 48 * HOUR).toISOString(),
        toLei: 800,
      });
    expect(sent.status).toBe(201);
    await relay();

    expect(await redis.exists(driverKeys(andrei.id)[1] ?? '')).toBe(0);
    expect(await redis.exists(...garageKeys(boss.garage.id))).toBe(0);
    const requests = await get('/requests', bearer(andrei.id, 'driver'));
    expect(requests.body.items[0]).toMatchObject({
      id: andrei.open.id,
      quotesCount: 1,
    });
  });

  it('evicts the garage’s lists but no driver list on a decline', async () => {
    const andrei = await driver();
    const boss = await owner();
    await world.recipient(andrei.open.id, boss.garage.id, 'waiting');
    await signIn(andrei.email);
    await signIn(boss.email);
    await stored(...driverKeys(andrei.id), ...garageKeys(boss.garage.id));

    const declined = await request(app.getHttpServer())
      .post(`/garage/requests/${andrei.open.id}/decline`)
      .set('Authorization', bearer(boss.id, 'garage'))
      .send({ reason: 'fully_booked' });
    expect(declined.status).toBe(200);
    await relay();

    expect(await redis.exists(...garageKeys(boss.garage.id))).toBe(0);
    expect(await redis.exists(...driverKeys(andrei.id))).toBe(2);
  });
});

// @traces 1169-FR-003 1169-FR-005
describe('the warmed car list', () => {
  it('is the full record the car card shows, the same as the database answers', async () => {
    const andrei = await driver();
    const auth = bearer(andrei.id, 'driver');
    await signIn(andrei.email);
    const [cars] = driverKeys(andrei.id);
    await stored(cars ?? '');

    const entry = JSON.parse(String(await redis.get(cars ?? ''))).v;
    const taken = await get('/cars', auth);
    const fresh = await get('/cars', auth);

    expect(taken.body).toEqual(entry);
    expect(fresh.body).toEqual(entry);
    expect(Object.keys(entry.items[0]).sort()).toEqual(
      [
        'brandId',
        'brandName',
        'createdAt',
        'engine',
        'fuel',
        'id',
        'itpUntil',
        'model',
        'nextServiceKm',
        'odometerKm',
        'plate',
        'rcaUntil',
        'rovinietaUntil',
        'updatedAt',
        'year',
      ].sort(),
    );
  });
});
