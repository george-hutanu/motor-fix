import { randomUUID } from 'node:crypto';

import { CURRENT_CONSENT } from '@motor-fix/contracts';
import { type INestApplication, Logger, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Redis } from 'ioredis';
import { Pool } from 'pg';
import request from 'supertest';

import { WarmModule } from './warm.module';
import { AuditService } from '../../audit/audit.service';
import { AccountsService } from '../../auth/accounts.service';
import { AUTH_REDIS } from '../../auth/attempts';
import { AuthModule } from '../../auth/auth.module';
import type { Role } from '../../auth/capabilities';
import * as password from '../../auth/password/password';
import { PRISMA } from '../../auth/prisma';
import { serialDatabase } from '../../auth/serial-db.testing';
import { HOME_WARM, type HomeWarmer } from '../../auth/sign-in.service';
import { CarsModule } from '../../cars/my-cars/cars/cars.module';
import { CarsService } from '../../cars/my-cars/cars/cars.service';
import { noEvents } from '../../events/event.port';
import { redisUrlFor } from '../../notifications/notifications.testing';
import { QuotesModule } from '../../quotes/quotes.module';
import { databaseUrl, quotesWorld } from '../../quotes/quotes.testing';

const redisUrl = redisUrlFor(10);
const tokenSecret = 'test-secret';
const PASSWORD = 'parola-de-test';
const world = quotesWorld();
const { prisma } = world;
const redis = new Redis(redisUrl);
const accounts = new AccountsService(prisma, new AuditService(), noEvents);
serialDatabase(databaseUrl);

let hash: string;

beforeAll(async () => {
  hash = await password.hashPassword(PASSWORD);
});

afterAll(async () => {
  await prisma.$disconnect();
  redis.disconnect();
});

beforeEach(async () => {
  await world.reset();
  await prisma.$executeRawUnsafe('TRUNCATE outbox_event');
  const keys = [
    ...(await redis.keys('v1:driver-home:*')),
    ...(await redis.keys('v1:garage-home:*')),
    ...(await redis.keys('v1:tag:warm:*')),
    ...(await redis.keys('auth:fail:*')),
  ];
  if (keys.length) await redis.del(...keys);
});

afterEach(() => jest.restoreAllMocks());

async function start() {
  const moduleRef = await Test.createTestingModule({
    imports: [
      AuthModule.register({ databaseUrl, redisUrl, tokenSecret }),
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

async function driver() {
  const andrei = await person(['driver']);
  const car = await world.car(andrei.id, 'B123ABC');
  await world.request(andrei.id, { carId: car.id });
  return andrei;
}

async function owner() {
  const garage = await world.garage('Atelier Dinamo');
  const boss = await person(['garage']);
  await prisma.garageMember.create({
    data: { accountId: boss.id, garageId: garage.id, role: 'owner' },
  });
  const asked = await world.account('Maria Pop');
  const waiting = await world.request(asked);
  await world.recipient(waiting.id, garage.id, 'waiting');
  return { ...boss, garage };
}

const signIn = (email: string, server: INestApplication) =>
  request(server.getHttpServer())
    .post('/auth/sign-in')
    .send({ email, password: PASSWORD });

// A few round trips to Redis: long enough for a shutdown that is not waiting
// for anything to have returned its stores.
async function settle() {
  for (let round = 0; round < 3; round++) await redis.ping();
}

// Records what the app does to its stores, in order: every entry a warm
// stored, the Redis store being returned, the database disconnecting. A warm's
// store is held open until its owner (an account or a garage) is let through.
function watch(nest: INestApplication) {
  const order: string[] = [];
  const store: Redis = nest.get(AUTH_REDIS);
  const evaluate = store.eval.bind(store);
  const letThrough = new Set<string>();
  const held: { owner: string; go: () => void }[] = [];
  const arrivals: (() => void)[] = [];
  let everyone = false;

  jest.spyOn(store, 'eval').mockImplementation((...args) => {
    const key = args
      .map(String)
      .find((arg) => /^v1:(driver|garage)-home:/.test(arg));
    if (!key || !String(args[0]).includes('ZADD')) return evaluate(...args);
    const who = key.split(':')[2] ?? '';
    const run = () =>
      evaluate(...args).then((reply) => {
        order.push(`stored ${who}`);
        return reply;
      });
    if (everyone || letThrough.has(who)) return run();
    return new Promise<unknown>((resolve, reject) => {
      held.push({ go: () => run().then(resolve, reject), owner: who });
      for (const arrived of arrivals) arrived();
    });
  });
  const quit = store.quit.bind(store);
  jest.spyOn(store, 'quit').mockImplementation(() => {
    order.push('redis closed');
    return quit();
  });
  const disconnect = store.disconnect.bind(store);
  jest.spyOn(store, 'disconnect').mockImplementation(() => {
    order.push('redis closed');
    disconnect();
  });
  const database = nest.get(PRISMA);
  const end = database.$disconnect.bind(database);
  jest.spyOn(database, '$disconnect').mockImplementation(() => {
    order.push('database closed');
    return end();
  });

  const release = (who: string) => {
    letThrough.add(who);
    const mine = held.filter((h) => h.owner === who);
    held.splice(0, held.length, ...held.filter((h) => h.owner !== who));
    for (const h of mine) h.go();
  };
  return {
    closed: () => order.filter((event) => event.endsWith(' closed')),
    holding: (owners: string[]) =>
      new Promise<void>((resolve) => {
        const check = () =>
          owners.every((o) => held.some((h) => h.owner === o));
        if (check()) resolve();
        else arrivals.push(() => check() && resolve());
      }),
    order,
    release,
    releaseAll: () => {
      everyone = true;
      for (const h of held.splice(0)) h.go();
    },
    stored: () =>
      order.filter((e) => e.startsWith('stored ')).map((e) => e.slice(7)),
  };
}

// Every connection the application's pools are asked for.
const poolCalls = () => {
  const calls = { count: 0 };
  const pool = Pool.prototype as unknown as Record<
    string,
    (...args: unknown[]) => unknown
  >;
  for (const method of ['connect', 'query']) {
    const real = pool[method] as (...args: unknown[]) => unknown;
    jest.spyOn(pool, method).mockImplementation(function (
      this: unknown,
      ...args: unknown[]
    ) {
      calls.count += 1;
      return real.apply(this, args);
    });
  }
  return calls;
};

// @traces 1348-FR-005
describe('the app’s shutdown with sign-in warms in flight', () => {
  it('waits for every warm in flight, drivers and a garage alike, before either store closes', async () => {
    const app = await start();
    const seen = watch(app);
    let closing: Promise<void> | undefined;
    try {
      const drivers = [await driver(), await driver(), await driver()];
      const boss = await owner();
      for (const d of drivers) {
        expect((await signIn(d.email, app)).status).toBe(200);
      }
      expect((await signIn(boss.email, app)).status).toBe(200);
      const everyone = [...drivers.map((d) => d.id), boss.garage.id];
      await seen.holding(everyone);

      closing = app.close();
      for (const d of drivers) seen.release(d.id);
      await settle();

      expect(seen.closed()).toEqual([]);

      seen.release(boss.garage.id);
      await closing;

      const closedAt = seen.order.findIndex((e) => e.endsWith(' closed'));
      expect(seen.order).toContain('database closed');
      expect(new Set(seen.stored())).toEqual(new Set(everyone));
      expect(
        seen.order.slice(closedAt).filter((e) => e.startsWith('stored')),
      ).toEqual([]);
    } finally {
      seen.releaseAll();
      await (closing ?? app.close());
    }
  });

  it('waits for warms started on the warm service itself, two for one account, before either store closes', async () => {
    const app = await start();
    const seen = watch(app);
    const warmer: HomeWarmer = app.get(HOME_WARM);
    let closing: Promise<void> | undefined;
    try {
      const andrei = await driver();
      const warms = [
        warmer.homes(andrei.id, 'driver'),
        warmer.homes(andrei.id, 'driver'),
      ];
      await seen.holding([andrei.id]);

      closing = app.close();
      await settle();

      expect(seen.closed()).toEqual([]);

      seen.release(andrei.id);
      await closing;

      await expect(Promise.all(warms)).resolves.toEqual([undefined, undefined]);
      const closedAt = seen.order.findIndex((e) => e.endsWith(' closed'));
      expect(seen.stored()).toContain(andrei.id);
      expect(closedAt).toBeGreaterThan(
        seen.order.lastIndexOf(`stored ${andrei.id}`),
      );
    } finally {
      seen.releaseAll();
      await (closing ?? app.close());
    }
  });

  it('closes both stores at once when no warm ever ran', async () => {
    const app = await start();
    const seen = watch(app);

    await expect(app.close()).resolves.toBeUndefined();

    expect(seen.closed()).toContain('database closed');
    expect(seen.closed()).toContain('redis closed');
  });

  it('still closes, after the failed warm has logged that it was skipped, when a warm’s read fails', async () => {
    const app = await start();
    const seen = watch(app);
    const messages: string[] = [];
    for (const level of ['log', 'warn', 'error', 'debug', 'verbose'] as const) {
      jest
        .spyOn(Logger.prototype, level)
        .mockImplementation((...args: unknown[]) => {
          messages.push(args.map(String).join(' '));
        });
    }
    const reading = Promise.withResolvers<void>();
    const held = Promise.withResolvers<void>();
    jest.spyOn(app.get(CarsService), 'list').mockImplementation(async () => {
      reading.resolve();
      await held.promise;
      throw new Error('database gone');
    });
    let closing: Promise<void> | undefined;
    try {
      const andrei = await driver();
      expect((await signIn(andrei.email, app)).status).toBe(200);
      await reading.promise;

      closing = app.close();
      await settle();

      expect(seen.closed()).toEqual([]);

      held.resolve();
      await expect(closing).resolves.toBeUndefined();

      expect(messages.some((m) => m.includes('cache warm skipped'))).toBe(true);
      expect(seen.closed()).toContain('database closed');
    } finally {
      held.resolve();
      seen.releaseAll();
      await (closing ?? app.close());
    }
  });

  it('warms nothing and touches neither store when asked after the app has closed', async () => {
    const app = await start();
    const store: Redis = app.get(AUTH_REDIS);
    const evaluate = jest.spyOn(store, 'eval');
    const list = jest.spyOn(app.get(CarsService), 'list');
    const warmer: HomeWarmer = app.get(HOME_WARM);
    const andrei = await driver();
    const boss = await owner();
    const calls = poolCalls();
    expect((await signIn(andrei.email, app)).status).toBe(200);
    await app.close();
    expect(calls.count).toBeGreaterThan(0);
    const before = {
      database: calls.count,
      reads: list.mock.calls.length,
      redis: evaluate.mock.calls.length,
    };

    await expect(warmer.homes(andrei.id, 'driver')).resolves.toBeUndefined();
    await expect(warmer.homes(boss.id, 'garage')).resolves.toBeUndefined();
    await expect(warmer.homes(randomUUID(), 'driver')).resolves.toBeUndefined();

    expect({
      database: calls.count,
      reads: list.mock.calls.length,
      redis: evaluate.mock.calls.length,
    }).toEqual(before);
  });
});
