import { randomUUID } from 'node:crypto';

import { CURRENT_CONSENT } from '@motor-fix/contracts';
import {
  AccountsService,
  MAINTENANCE,
  type Maintenance,
  signAccessToken,
} from '@motor-fix/domain';
import { countedMetrics, counterTotal } from '@motor-fix/observability/testing';
import type { INestApplication } from '@nestjs/common';
import { Redis } from 'ioredis';
import { Client } from 'pg';
import request from 'supertest';

import { apiBoot, TEST_TOKEN_SECRET } from './api-boot.testing';

// @traces 280-FR-010 280-FR-011 280-FR-012 280-FR-013 280-FR-020 280-FR-022

const SUPPORT = 'support@example.test';
const reader = countedMetrics();
const outcome = (name: string) =>
  counterTotal(reader, 'motorfix_support_messages_total', { outcome: name });

const api = apiBoot();
let app: INestApplication;
let db: Client;
let saved: string | undefined;

const BODY = {
  email: 'ana@example.test',
  language: 'ro',
  message: 'Nu pot vedea cererea trimisă ieri.',
  name: 'Ana Pop',
  topic: 'account',
};

// Each test writes from its own documentation address (RFC 5737), so the
// hourly counts never meet.
let address = 0;
const nextAddress = () => {
  address += 1;
  return `198.51.100.${address}`;
};

const send = (from: string, body: object, authorization?: string) => {
  const req = request(app.getHttpServer())
    .post('/api/v1/support/messages')
    .set('X-Forwarded-For', from);
  if (authorization) req.set('Authorization', authorization);
  return req.send(body);
};

const account = async (role: 'admin' | 'driver' | 'garage') => {
  const { id } = await app.get(AccountsService).createAccount({
    consent: CURRENT_CONSENT,
    identity: { method: 'google', subject: `${role}-${randomUUID()}` },
    name: role,
    roles: [role],
  });
  return {
    bearer: `Bearer ${signAccessToken({ accountId: id, role } as never, TEST_TOKEN_SECRET, Date.now())}`,
    id,
  };
};

const stored = async () =>
  Number(
    (await db.query('SELECT count(*) FROM support_message')).rows[0].count,
  );

beforeAll(async () => {
  saved = process.env['SUPPORT_EMAIL'];
  process.env['SUPPORT_EMAIL'] = SUPPORT;
  app = await api.start();
  db = new Client({
    connectionString:
      process.env['DATABASE_URL'] ?? 'postgresql://localhost:5432/postgres',
  });
  await db.connect();
  // The hourly counts of an earlier run of this file would refuse this one.
  const redis = new Redis(process.env['REDIS_URL'] ?? 'redis://localhost:6379');
  const keys = await redis.keys('support:*');
  if (keys.length > 0) await redis.del(...keys);
  await redis.quit();
}, 120_000);

beforeEach(() => db.query('TRUNCATE support_message, support_reference'));

afterAll(async () => {
  if (saved === undefined) delete process.env['SUPPORT_EMAIL'];
  else process.env['SUPPORT_EMAIL'] = saved;
  await db.end();
  await api.stop();
});

describe('POST /support/messages', () => {
  it('stores a visitor’s message and answers its reference', async () => {
    const before = await outcome('stored');

    const res = await send(nextAddress(), BODY);

    expect(res.status).toBe(201);
    expect(res.body.reference).toMatch(/^MF-\d{4}-\d{6}$/);
    expect(await stored()).toBe(1);
    expect(await outcome('stored')).toBe(before + 1);
    const { rows } = await db.query(
      'SELECT role, account_id, support_email_status FROM support_message',
    );
    expect(rows).toEqual([
      { account_id: null, role: 'visitor', support_email_status: 'pending' },
    ]);
  });

  it('takes a signed-in sender’s role and account from the session', async () => {
    const garage = await account('garage');

    const res = await send(nextAddress(), BODY, garage.bearer);

    expect(res.status).toBe(201);
    const { rows } = await db.query(
      'SELECT role, account_id FROM support_message',
    );
    expect(rows).toEqual([{ account_id: garage.id, role: 'garage' }]);
  });

  it('refuses a role in the body', async () => {
    const res = await send(nextAddress(), { ...BODY, role: 'admin' });

    expect([res.status, res.body.code]).toEqual([400, 'validation_failed']);
    expect(await stored()).toBe(0);
  });

  it.each([
    ['name', ''],
    ['email', 'not-an-address'],
    ['topic', 'billing'],
    ['message', 'prea scurt'],
    ['language', 'de'],
  ])('answers 400 for a bad %s, counted as invalid', async (field, value) => {
    const before = await outcome('invalid');

    const res = await send(nextAddress(), { ...BODY, [field]: value });

    expect([res.status, res.body.code]).toEqual([400, 'validation_failed']);
    expect(await stored()).toBe(0);
    expect(await outcome('invalid')).toBe(before + 1);
  });

  it('answers a filled trap like a success and stores nothing', async () => {
    const before = await outcome('trap');

    const res = await send(nextAddress(), {
      ...BODY,
      website: 'https://spam.test',
    });

    expect(res.status).toBe(201);
    expect(res.body.reference).toMatch(/^MF-\d{4}-\d{6}$/);
    expect(await stored()).toBe(0);
    expect(await outcome('trap')).toBe(before + 1);
  });

  it('refuses the 6th call from one address in the hour, before validation', async () => {
    const from = nextAddress();
    for (let i = 0; i < 5; i++) {
      expect((await send(from, { ...BODY, name: '' })).status).toBe(400);
    }
    const before = await outcome('refused_limit');

    const res = await send(from, BODY);

    expect([res.status, res.body.code]).toEqual([429, 'too_many_messages']);
    expect(res.body.retryAfterSeconds).toBeGreaterThan(0);
    expect(Number(res.headers['retry-after'])).toBe(res.body.retryAfterSeconds);
    expect(await stored()).toBe(0);
    expect(await outcome('refused_limit')).toBe(before + 1);
  });

  it('refuses the 6th call from one account across addresses', async () => {
    const driver = await account('driver');
    for (let i = 0; i < 5; i++) {
      expect((await send(nextAddress(), BODY, driver.bearer)).status).toBe(201);
    }

    const res = await send(nextAddress(), BODY, driver.bearer);

    expect([res.status, res.body.code]).toEqual([429, 'too_many_messages']);
    expect(await stored()).toBe(5);
  });

  it('refuses a visitor while maintenance is on, and lets an admin write', async () => {
    const maintenance = app.get<Maintenance>(MAINTENANCE, { strict: false });
    const on = jest.spyOn(maintenance, 'on').mockResolvedValue(true);
    try {
      const visitor = await send(nextAddress(), BODY);
      const admin = await account('admin');
      const allowed = await send(nextAddress(), BODY, admin.bearer);

      expect([visitor.status, visitor.body.code]).toEqual([503, 'maintenance']);
      expect(allowed.status).toBe(201);
      expect(await stored()).toBe(1);
    } finally {
      on.mockRestore();
    }
  });
});

describe('GET /support/contact', () => {
  it('answers the configured address', async () => {
    const res = await request(app.getHttpServer()).get(
      '/api/v1/support/contact',
    );

    expect([res.status, res.body]).toEqual([200, { email: SUPPORT }]);
  });

  it('stays open while maintenance is on', async () => {
    const maintenance = app.get<Maintenance>(MAINTENANCE, { strict: false });
    const on = jest.spyOn(maintenance, 'on').mockResolvedValue(true);
    try {
      const res = await request(app.getHttpServer()).get(
        '/api/v1/support/contact',
      );

      expect([res.status, res.body]).toEqual([200, { email: SUPPORT }]);
    } finally {
      on.mockRestore();
    }
  });
});
