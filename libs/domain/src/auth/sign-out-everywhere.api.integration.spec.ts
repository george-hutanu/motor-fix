import { Logger, ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { Redis } from 'ioredis';
import request from 'supertest';

import { AccountsService } from './accounts.service';
import { AuthModule } from './auth.module';
import type { Role } from './capabilities';
import * as password from './password';
import { createPrisma } from './prisma';
import { serialDatabase } from './serial-db.testing';
import { AuditService } from '../audit/audit.service';
import { EVENT_PORT, type EventPort, noEvents } from '../events/event.port';

const databaseUrl =
  process.env['DATABASE_URL'] ?? 'postgresql://localhost:5432/postgres';
const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
const tokenSecret = 'test-secret';
const PASSWORD = 'parola-de-test';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const prisma = createPrisma(databaseUrl);
const redis = new Redis(redisUrl);
const accounts = new AccountsService(prisma, new AuditService(), noEvents);
serialDatabase(databaseUrl);

let hash: string;
let events: EventPort = noEvents;

async function start(redisAt = redisUrl) {
  const moduleRef = await Test.createTestingModule({
    imports: [
      AuthModule.register({ databaseUrl, redisUrl: redisAt, tokenSecret }),
    ],
  })
    .overrideProvider(EVENT_PORT)
    .useValue({ record: (tx, event) => events.record(tx, event) } as EventPort)
    .compile();
  const nest = moduleRef.createNestApplication<NestExpressApplication>();
  nest.set('trust proxy', 'loopback');
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

let app: NestExpressApplication;

beforeAll(async () => {
  hash = await password.hashPassword(PASSWORD);
  app = await start();
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
  redis.disconnect();
});

beforeEach(async () => {
  events = noEvents;
  await prisma.$executeRawUnsafe('TRUNCATE account, garage CASCADE');
  const keys = await redis.keys('auth:fail:*');
  if (keys.length) await redis.del(...keys);
});

let addresses = 0;
const address = () => `198.51.100.${++addresses % 250}`;

async function person(email: string, roles: Role[] = ['driver']) {
  const { id } = await accounts.createAccount({
    email,
    identity: { method: 'password', passwordHash: hash, subject: email },
    name: email.split('@')[0] ?? 'x',
    roles,
  });
  return id;
}

function setCookie(res: request.Response): string | undefined {
  const header = res.headers['set-cookie'] as unknown as string[] | undefined;
  return header?.find((c) => c.startsWith('mf_refresh='));
}

const cookieValue = (res: request.Response) =>
  setCookie(res)?.split(';')[0]?.slice('mf_refresh='.length) ?? '';

async function session(email: string, server = app) {
  const res = await request(server.getHttpServer())
    .post('/auth/sign-in')
    .set('X-Forwarded-For', address())
    .send({ email, password: PASSWORD });
  expect(res.status).toBe(200);
  return cookieValue(res);
}

const call = (path: string, cookie?: string, server = app) => {
  const req = request(server.getHttpServer()).post(`/auth/${path}`);
  return cookie ? req.set('Cookie', `mf_refresh=${cookie}`) : req;
};
const everywhere = (cookie?: string, server = app) =>
  call('sign-out-everywhere', cookie, server);
const refresh = (cookie?: string) => call('refresh', cookie);

const CLEARED = /^mf_refresh=;.*Expires=Thu, 01 Jan 1970/;

const entries = (accountId: string) =>
  prisma.activityLog.findMany({ where: { subjectId: accountId } });

describe('signing out on all devices', () => {
  it('ends every session of the account, clears the cookie and answers 204', async () => {
    const id = await person('andrei@example.test');
    const phone = await session('andrei@example.test');
    const laptop = await session('andrei@example.test');

    const res = await everywhere(phone);

    expect(res.status).toBe(204);
    expect(setCookie(res)).toMatch(CLEARED);
    expect(await prisma.refreshToken.count({ where: { accountId: id } })).toBe(
      0,
    );
    expect((await refresh(phone)).status).toBe(401);
    expect((await refresh(laptop)).status).toBe(401);
  });

  it('deletes every push device of the account and no other', async () => {
    const id = await person('andrei@example.test');
    const other = await person('ioana@example.test');
    const cookie = await session('andrei@example.test');
    const device = (accountId: string, n: number) =>
      prisma.pushSubscription.create({
        data: {
          accountId,
          auth: 'a',
          endpoint: `https://push.example.test/${n}`,
          p256dh: 'p',
        },
      });
    await device(id, 1);
    await device(id, 2);
    await device(other, 3);

    await everywhere(cookie);

    const left = await prisma.pushSubscription.findMany();
    expect(left.map((d) => d.accountId)).toEqual([other]);
  });

  it("leaves another account's sessions alone", async () => {
    await person('andrei@example.test');
    await person('ioana@example.test');
    const andrei = await session('andrei@example.test');
    const ioana = await session('ioana@example.test');

    await everywhere(andrei);

    expect((await refresh(ioana)).status).toBe(200);
  });

  it.each(['driver', 'garage', 'mechanic', 'admin'] as const)(
    'works the same for a %s',
    async (role) => {
      const id = await person(`${role}@example.test`, [role]);
      const one = await session(`${role}@example.test`);
      const two = await session(`${role}@example.test`);

      expect((await everywhere(one)).status).toBe(204);

      expect(
        await prisma.refreshToken.count({ where: { accountId: id } }),
      ).toBe(0);
      expect((await refresh(two)).status).toBe(401);
    },
  );

  it('writes one "signed out on all devices" entry to the audit history', async () => {
    const id = await person('andrei@example.test');
    const before = await entries(id);
    const phone = await session('andrei@example.test');

    await everywhere(phone);

    // findMany has no order: tell the new entry by its id, not its place.
    const seen = new Set(before.map((entry) => entry.id));
    const added = (await entries(id)).filter((entry) => !seen.has(entry.id));
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({
      action: 'delete',
      actorId: id,
      actorRole: 'driver',
      kind: 'signed_out_everywhere',
      subjectId: id,
      subjectType: 'account',
    });
  });

  it('records account.signed_out_everywhere with the change, and ends nothing when that fails', async () => {
    const id = await person('andrei@example.test');
    const recorded: unknown[] = [];
    events = {
      record: async (_tx, event) => {
        recorded.push(event);
      },
    };
    expect(
      (await everywhere(await session('andrei@example.test'))).status,
    ).toBe(204);
    expect(recorded).toEqual([
      {
        audience: { accountId: id, type: 'account' },
        kind: 'account.signed_out_everywhere',
        payload: { accountId: id },
        subjectId: id,
      },
    ]);

    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    events = {
      record: async () => {
        throw new Error('outbox down');
      },
    };
    const phone = await session('andrei@example.test');
    const before = (await entries(id)).length;

    expect((await everywhere(phone)).status).toBe(500);
    expect(await prisma.refreshToken.count({ where: { accountId: id } })).toBe(
      1,
    );
    expect(await entries(id)).toHaveLength(before);
    jest.restoreAllMocks();
  });

  it('writes nothing to the audit history for a sign-out on this device', async () => {
    const id = await person('andrei@example.test');
    const before = (await entries(id)).length;
    const phone = await session('andrei@example.test');

    expect((await call('sign-out', phone)).status).toBe(204);

    expect(await entries(id)).toHaveLength(before);
  });

  it("tells the account's open dashboards on the live channel", async () => {
    const id = await person('andrei@example.test');
    const phone = await session('andrei@example.test');
    const listener = new Redis(redisUrl);
    // Channels are shared by every Redis database: keep this account's only.
    const heard: unknown[] = [];
    listener.on('message', (_channel: string, message: string) => {
      if (message.includes(id)) heard.push(JSON.parse(message));
    });
    await listener.subscribe('live:events');
    try {
      await everywhere(phone);
      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(heard).toEqual([
        {
          audience: [`account:${id}`],
          event: {
            at: expect.any(String),
            id: expect.any(String),
            kind: 'session.revoked',
          },
        },
      ]);
      const { event } = heard[0] as { event: { at: string; id: string } };
      expect(event.id).toMatch(UUID);
      expect(event.id).not.toBe(id);
      expect(Number.isNaN(Date.parse(event.at))).toBe(false);
    } finally {
      listener.disconnect();
    }
  });

  it.each([
    ['no cookie', undefined],
    ['an unknown token', 'A'.repeat(43)],
    ['a malformed token', 'not-a-token'],
  ])(
    'answers 401 sign_in_required for %s and clears the cookie',
    async (_, cookie) => {
      await person('andrei@example.test');
      const laptop = await session('andrei@example.test');

      const res = await everywhere(cookie);

      expect(res.status).toBe(401);
      expect(res.body.code).toBe('sign_in_required');
      expect(setCookie(res)).toMatch(CLEARED);
      expect((await refresh(laptop)).status).toBe(200);
    },
  );

  it('answers 401 for an expired token and revokes nothing', async () => {
    const id = await person('andrei@example.test');
    const old = await session('andrei@example.test');
    const laptop = await session('andrei@example.test');
    const [first] = await prisma.refreshToken.findMany({
      orderBy: { createdAt: 'asc' },
      where: { accountId: id },
    });
    await prisma.refreshToken.update({
      data: { expiresAt: new Date(Date.now() - 1000) },
      where: { id: first?.id ?? '' },
    });

    expect((await everywhere(old)).status).toBe(401);
    expect((await refresh(laptop)).status).toBe(200);
  });

  it('answers 401 for a token reused after the grace, closing only its own family as a renewal would', async () => {
    const id = await person('andrei@example.test');
    const stale = await session('andrei@example.test');
    const laptop = await session('andrei@example.test');
    expect((await refresh(stale)).status).toBe(200);
    await prisma.refreshToken.updateMany({
      data: { usedAt: new Date(Date.now() - 60_000) },
      where: { accountId: id, usedAt: { not: null } },
    });

    expect((await everywhere(stale)).status).toBe(401);

    expect((await refresh(laptop)).status).toBe(200);
  });

  it('is harmless a second time', async () => {
    await person('andrei@example.test');
    const phone = await session('andrei@example.test');

    expect((await everywhere(phone)).status).toBe(204);
    const again = await everywhere(phone);

    expect(again.status).toBe(401);
    expect(setCookie(again)).toMatch(CLEARED);
  });

  it('still ends every session when Redis does not answer, and logs the unsent message', async () => {
    const id = await person('andrei@example.test');
    const down = await start('redis://127.0.0.1:1');
    let logged: () => void = () => undefined;
    const unsent = new Promise<void>((resolve) => {
      logged = resolve;
    });
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation((message: unknown) => {
        if (String(message).startsWith('session.revoked not sent')) logged();
      });
    try {
      const phone = await session('andrei@example.test', down);
      const laptop = await session('andrei@example.test', down);

      expect((await everywhere(phone, down)).status).toBe(204);

      expect(
        await prisma.refreshToken.count({ where: { accountId: id } }),
      ).toBe(0);
      expect((await refresh(laptop)).status).toBe(401);
      // The publish is not awaited by the call: wait for it before closing.
      await unsent;
    } finally {
      warn.mockRestore();
      await down.close();
    }
  }, 30_000);
});
