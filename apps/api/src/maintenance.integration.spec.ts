import { randomUUID } from 'node:crypto';

import { CURRENT_CONSENT } from '@motor-fix/contracts';
import {
  AccountsService,
  AuthModule,
  MAINTENANCE,
  type Maintenance,
  NotificationsService,
  OutboxRelayModule,
  PlatformRulesModule,
  signAccessToken,
} from '@motor-fix/domain';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Redis } from 'ioredis';
import { Client } from 'pg';
import request from 'supertest';

import { apiBoot, TEST_TOKEN_SECRET } from './api-boot.testing';
import { openApiDocument } from './bootstrap';

const api = apiBoot();

// Every route that answers as usual while the platform is in maintenance.
const OPEN = [
  'GET /api/v1/auth/oauth/apple',
  'GET /api/v1/auth/oauth/google',
  'GET /api/v1/auth/oauth/google/callback',
  'GET /api/v1/auth/oauth/pending',
  'GET /api/v1/auth/providers',
  'GET /api/v1/live',
  'GET /api/v1/live/public',
  'GET /api/v1/platform-status',
  'GET /health/live',
  'GET /health/ready',
  'POST /api/v1/auth/oauth/apple/callback',
  'POST /api/v1/auth/oauth/complete',
  'POST /api/v1/auth/phone-code',
  'POST /api/v1/auth/phone-sign-in',
  'POST /api/v1/auth/refresh',
  'POST /api/v1/auth/sign-in',
  'POST /api/v1/auth/sign-out',
  'POST /api/v1/auth/sign-out-everywhere',
];

const SOME_ID = '00000000-0000-4000-8000-000000000000';
const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;
type Method = (typeof METHODS)[number];
const PASSWORD = 'o-parola-lunga';

const databaseUrl =
  process.env['DATABASE_URL'] ?? 'postgresql://localhost:5432/postgres';
const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
type Role = 'admin' | 'driver' | 'garage';

const db = new Client({ connectionString: databaseUrl });

let app: INestApplication;
let routes: { method: Method; path: string; route: string }[];
let sent: jest.SpyInstance;

beforeAll(async () => {
  sent = jest
    .spyOn(NotificationsService.prototype, 'sendAccountEmail')
    .mockResolvedValue(undefined);
  app = await api.start();
  await db.connect();
  routes = Object.entries(openApiDocument(app).paths).flatMap(([path, item]) =>
    METHODS.filter((method) => method in item).map((method) => {
      const concrete = path.replace(/\{[^}]+\}/g, SOME_ID);
      return {
        method,
        path: concrete,
        route: `${method.toUpperCase()} ${concrete}`,
      };
    }),
  );
}, 120_000);

afterAll(async () => {
  try {
    await stored(false);
    await db.end();
    await api.stop();
  } finally {
    sent.mockRestore();
  }
});

beforeEach(() => stored(false));

async function stored(on: boolean) {
  await db.query(
    `UPDATE platform_rule SET value = $1::jsonb WHERE key = 'maintenance_mode'`,
    [JSON.stringify(on)],
  );
  await app.get<Maintenance>(MAINTENANCE, { strict: false }).set(on);
}

async function bearer(roles: Role[], role: Role) {
  const { id } = await app.get(AccountsService).createAccount({
    consent: CURRENT_CONSENT,
    identity: { method: 'google', subject: `${role}-${randomUUID()}` },
    name: 'Andrei',
    roles,
  });
  return `Bearer ${signAccessToken({ accountId: id, role }, TEST_TOKEN_SECRET)}`;
}

const call = (method: Method, path: string, authorization?: string) => {
  // An open public stream never ends; a malformed query answers at once.
  const target = path.endsWith('/live/public') ? `${path}?garages=x` : path;
  const req = request(app.getHttpServer())[method](target).send({});
  return authorization ? req.set('Authorization', authorization) : req;
};

const refused = (res: request.Response) =>
  res.status === 503 &&
  res.body?.code === 'maintenance' &&
  res.headers['retry-after'] === '300';

describe('every route while the platform is in maintenance', () => {
  it('lists more routes than the open ones, so the walk means something', () => {
    expect(routes.length).toBeGreaterThan(OPEN.length);
  });

  it.each<[string, Role | undefined]>([
    ['a visitor', undefined],
    ['a driver', 'driver'],
    ['a garage owner', 'garage'],
  ])('refuses %s on every route but the open ones', async (_, role) => {
    const authorization = role && (await bearer([role], role));
    await stored(true);

    const answered: string[] = [];
    for (const { method, path, route } of routes) {
      if (OPEN.includes(route)) continue;
      if (!refused(await call(method, path, authorization))) {
        answered.push(route);
      }
    }

    expect(answered).toEqual([]);
  });

  it('never refuses an admin', async () => {
    const admin = await bearer(['admin'], 'admin');
    await stored(true);

    const refusedAdmin: string[] = [];
    for (const { method, path, route } of routes) {
      // The signed-in stream stays open; it is covered by the open list.
      if (route === 'GET /api/v1/live') continue;
      const res = await call(method, path, admin);
      if (res.body?.code === 'maintenance') refusedAdmin.push(route);
    }

    expect(refusedAdmin).toEqual([]);
  });

  it('answers the open routes as when maintenance is off', async () => {
    const visitor = async () => {
      const statuses: Record<string, number> = {};
      for (const { method, path, route } of routes) {
        if (!OPEN.includes(route) || route === 'GET /api/v1/platform-status')
          continue;
        statuses[route] = (await call(method, path)).status;
      }
      return statuses;
    };
    const off = await visitor();
    await stored(true);
    const on = await visitor();

    expect(Object.keys(on).sort()).toEqual(
      OPEN.filter((r) => r !== 'GET /api/v1/platform-status'),
    );
    expect(on).toEqual(off);
    expect(Object.values(on)).not.toContain(503);
  });

  it('keeps the e-mail provider callbacks open', async () => {
    await stored(true);
    const res = await request(app.getHttpServer())
      .post('/webhooks/brevo')
      .send({});

    expect(res.body?.code).not.toBe('maintenance');
  });

  it('writes nothing for a refused change', async () => {
    const count = async () =>
      Number(
        (await db.query('SELECT count(*) AS n FROM listing_draft')).rows[0].n,
      );
    const before = await count();
    await stored(true);

    const res = await request(app.getHttpServer())
      .post('/api/v1/listing-drafts')
      .send({ email: `draft-${randomUUID()}@example.test` });

    expect(refused(res)).toBe(true);
    expect(await count()).toBe(before);
  });
});

describe('signing in while the platform is in maintenance', () => {
  async function signedUp(email: string) {
    await request(app.getHttpServer())
      .post('/api/v1/auth/sign-up')
      .send({
        consent: CURRENT_CONSENT,
        email,
        language: 'ro',
        name: 'Ana Pop',
        password: PASSWORD,
      })
      .expect(201);
    return (await db.query('SELECT id FROM account WHERE email = $1', [email]))
      .rows[0].id as string;
  }

  const signIn = (email: string) =>
    request(app.getHttpServer())
      .post('/api/v1/auth/sign-in')
      .send({ email, password: PASSWORD, remember: false });

  it('opens a session for an admin and none for anyone else', async () => {
    const driver = `driver-${randomUUID()}@example.test`;
    const admin = `admin-${randomUUID()}@example.test`;
    await signedUp(driver);
    const adminId = await signedUp(admin);
    await db.query(
      `INSERT INTO account_role (account_id, role) VALUES ($1, 'admin')`,
      [adminId],
    );
    await stored(true);

    const refusedDriver = await signIn(driver);
    const opened = await signIn(admin);

    expect(refusedDriver.status).toBe(503);
    expect(refusedDriver.body).toMatchObject({ code: 'maintenance' });
    expect(refusedDriver.body.accessToken).toBeUndefined();
    expect(opened.status).toBe(200);
    expect(opened.body.accessToken).toEqual(expect.any(String));
  });

  it("leaves a driver's session working once maintenance ends", async () => {
    const driver = await bearer(['driver'], 'driver');
    await stored(true);
    expect(refused(await call('get', '/api/v1/me', driver))).toBe(true);

    await stored(false);
    expect((await call('get', '/api/v1/me', driver)).status).toBe(200);
  });
});

describe('the switch across copies of the api', () => {
  async function copy(redisAt: string) {
    const moduleRef = await Test.createTestingModule({
      imports: [
        AuthModule.register({
          databaseUrl,
          redisUrl: redisAt,
          tokenSecret: TEST_TOKEN_SECRET,
        }),
        PlatformRulesModule.register({ production: false }),
      ],
    }).compile();
    const other = moduleRef.createNestApplication();
    await other.init();
    return other;
  }

  const status = async (on: INestApplication) =>
    (await request(on.getHttpServer()).get('/platform-status')).body;

  it("follows an admin's switch on another copy at its next call", async () => {
    const other = await copy(redisUrl);
    try {
      expect(await status(other)).toEqual({ maintenance: false });
      const res = await request(app.getHttpServer())
        .patch('/api/v1/admin/platform-rules/maintenance_mode')
        .set('Authorization', await bearer(['admin'], 'admin'))
        .send({ seen: false, value: true });
      expect(res.status).toBe(200);

      expect(await status(other)).toEqual({ maintenance: true });
    } finally {
      await other.close();
    }
  });

  it('reads the stored rule when the fast store does not answer', async () => {
    await stored(true);
    const other = await copy('redis://localhost:1');
    try {
      expect(await status(other)).toEqual({ maintenance: true });
    } finally {
      await other.close();
    }
  }, 30_000);
});

describe('the background work while the platform is in maintenance', () => {
  it('still relays committed events to the live streams', async () => {
    const relay = await Test.createTestingModule({
      imports: [OutboxRelayModule.register({ databaseUrl, redisUrl })],
    }).compile();
    const listener = new Redis(redisUrl);
    const heard = new Promise<string>((resolve) =>
      listener.on('message', (_, message: string) => {
        if (message.includes('platform_rule.changed')) resolve(message);
      }),
    );
    await listener.subscribe('live:events');
    const worker = relay.createNestApplication();
    try {
      const admin = await bearer(['admin'], 'admin');
      const saved = await request(app.getHttpServer())
        .patch('/api/v1/admin/platform-rules/maintenance_mode')
        .set('Authorization', admin)
        .send({ seen: false, value: true });
      expect(saved.status).toBe(200);
      await worker.init();

      expect(JSON.parse(await heard).event).toMatchObject({
        id: 'maintenance_mode',
        kind: 'platform_rule.changed',
      });
    } finally {
      await worker.close();
      listener.disconnect();
    }
  }, 30_000);
});
