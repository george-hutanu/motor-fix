import { randomUUID } from 'node:crypto';

import { CURRENT_CONSENT } from '@motor-fix/contracts';
import {
  AccountsService,
  MAINTENANCE,
  type Maintenance,
  signAccessToken,
} from '@motor-fix/domain';
import type { INestApplication } from '@nestjs/common';
import { Client } from 'pg';
import request from 'supertest';

import { apiBoot, TEST_TOKEN_SECRET } from './api-boot.testing';

// @traces 066-FR-001 066-FR-002 066-FR-003 066-FR-005 066-FR-010

const api = apiBoot();
let app: INestApplication;
let db: Client;
let admin: string;

const bearer = (accountId: string) =>
  `Bearer ${signAccessToken({ accountId, role: 'admin' } as never, TEST_TOKEN_SECRET, Date.now())}`;

const get = (path: string, authorization?: string) => {
  const call = request(app.getHttpServer()).get(`/api/v1/admin/${path}`);
  return authorization ? call.set('Authorization', authorization) : call;
};

const audits = async () =>
  Number((await db.query('SELECT count(*) AS n FROM activity_log')).rows[0].n);

beforeAll(async () => {
  app = await api.start();
  db = new Client({
    connectionString:
      process.env['DATABASE_URL'] ?? 'postgresql://localhost:5432/postgres',
  });
  await db.connect();
  const account = await app.get(AccountsService).createAccount({
    consent: CURRENT_CONSENT,
    identity: { method: 'google', subject: `admin-${randomUUID()}` },
    name: 'admin',
    roles: ['admin'],
  });
  admin = bearer(account.id);
}, 120_000);

afterAll(async () => {
  await db.end();
  await api.stop();
});

describe('GET /admin/garages/summary', () => {
  it('answers the listed, waiting and suspended counts, the waiting one equal to the overview', async () => {
    const res = await get('garages/summary', admin);
    const overview = await get('overview', admin);

    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual([
      'listed',
      'suspended',
      'waiting',
    ]);
    for (const value of Object.values(res.body)) {
      expect(Number.isInteger(value) && (value as number) >= 0).toBe(true);
    }
    expect(res.body.waiting).toBe(overview.body.garagesWaiting);
  });

  it('counts a submitted and an in-review file as waiting, an approved, sent-back or rejected one nowhere', async () => {
    const before = (await get('garages/summary', admin)).body;
    for (const status of [
      'submitted',
      'in_review',
      'approved',
      'more_requested',
      'rejected',
    ]) {
      const garage = randomUUID();
      await db.query(
        "INSERT INTO garage (id, name, slug) VALUES ($1, 'Auto Nord', $2)",
        [garage, `g-${garage}`],
      );
      await db.query(
        'INSERT INTO verification_file (id, garage_id, status) VALUES ($1, $2, $3::verification_file_status)',
        [randomUUID(), garage, status],
      );
    }

    const after = (await get('garages/summary', admin)).body;
    const overview = (await get('overview', admin)).body;

    expect(after.waiting).toBe(before.waiting + 2);
    expect(after.waiting).toBe(overview.garagesWaiting);
  });

  it('counts a garage the moment it is suspended', async () => {
    const before = (await get('garages/summary', admin)).body;
    const garage = randomUUID();
    await db.query(
      "INSERT INTO garage (id, name, slug, status) VALUES ($1, 'Auto Sud', $2, 'suspended')",
      [garage, `g-${garage}`],
    );

    const after = (await get('garages/summary', admin)).body;

    expect(after.suspended).toBe(before.suspended + 1);
    expect(after.listed).toBe(before.listed);
  });

  it('asks for a session', async () => {
    expect((await get('garages/summary')).status).toBe(401);
  });
});

describe('GET /admin/garages?status=suspended', () => {
  it('answers the suspended garages, the newest suspension first, with the total', async () => {
    const garage = randomUUID();
    const file = randomUUID();
    // An earlier run on the same database left its garage on this start, which would tie.
    await db.query(
      "DELETE FROM garage WHERE id IN (SELECT garage_id FROM garage_suspension WHERE from_time = '2999-01-01T08:00:00Z')",
    );
    await db.query(
      "INSERT INTO garage (id, name, slug, status, city_key, city_name) VALUES ($1, 'Auto Expres Pantelimon', $2, 'suspended', 'pantelimon', 'Pantelimon')",
      [garage, `g-${garage}`],
    );
    await db.query(
      "INSERT INTO verification_file (id, garage_id, status) VALUES ($1, $2, 'approved')",
      [file, garage],
    );
    // The latest start there can be, so it heads the list.
    await db.query(
      "INSERT INTO garage_suspension (id, garage_id, cause, reason, from_time) VALUES ($1, $2, 'recheck_failed', 'Autorizație RAR expirată pe 12 sept. 2026', '2999-01-01T08:00:00Z')",
      [randomUUID(), garage],
    );

    const res = await get('garages?status=suspended&limit=200', admin);

    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThanOrEqual(res.body.items.length);
    expect(res.body.items[0]).toEqual({
      area: { kind: 'town', name: 'Pantelimon' },
      cancelledBookings: 0,
      cause: 'recheck_failed',
      fileId: file,
      fromTime: '2999-01-01T08:00:00.000Z',
      id: garage,
      name: 'Auto Expres Pantelimon',
      rarVerdict: 'expired',
      reason: 'Autorizație RAR expirată pe 12 sept. 2026',
    });
  });

  it('answers the default page of 20 at most', async () => {
    const res = await get('garages?status=suspended', admin);

    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeLessThanOrEqual(20);
  });

  it('writes nothing to the history', async () => {
    const before = await audits();

    await get('garages?status=suspended', admin);
    await get('garages/summary', admin);

    expect(await audits()).toBe(before);
  });

  it.each([
    '',
    '?status=approved',
    '?status=',
    '?status=suspended&offset=-1',
    '?status=suspended&offset=10001',
    '?status=suspended&limit=0',
    '?status=suspended&limit=201',
    '?status=suspended&limit=abc',
  ])('refuses %s', async (query) => {
    const res = await get(`garages${query}`, admin);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('validation_failed');
  });

  it('asks for a session', async () => {
    expect((await get('garages?status=suspended')).status).toBe(401);
  });
});

describe('both reads in maintenance', () => {
  // @traces 066-FR-005
  it('stay open to an admin while the platform is in maintenance', async () => {
    const maintenance = app.get<Maintenance>(MAINTENANCE, { strict: false });
    const on = jest.spyOn(maintenance, 'on').mockResolvedValue(true);
    try {
      expect((await get('garages/summary', admin)).status).toBe(200);
      expect((await get('garages?status=suspended', admin)).status).toBe(200);
    } finally {
      on.mockRestore();
    }
  });
});
