import { randomUUID } from 'node:crypto';

import { CURRENT_CONSENT } from '@motor-fix/contracts';
import { AccountsService, signAccessToken } from '@motor-fix/domain';
import type { INestApplication } from '@nestjs/common';
import { Client } from 'pg';
import request from 'supertest';

import { apiBoot, TEST_TOKEN_SECRET } from './api-boot.testing';

const api = apiBoot();
let app: INestApplication;
let db: Client;

const REASON = 'Autorizație RAR expirată pe 12 sept. 2026';

type Role = 'admin' | 'driver' | 'garage' | 'receptionist' | 'mechanic';

const account = async (role: Role) =>
  (
    await app.get(AccountsService).createAccount({
      consent: CURRENT_CONSENT,
      identity: { method: 'google', subject: `${role}-${randomUUID()}` },
      name: role,
      roles: [role],
    })
  ).id;

const bearer = (accountId: string, role: Role) =>
  `Bearer ${signAccessToken({ accountId, role } as never, TEST_TOKEN_SECRET, Date.now())}`;

const garage = async (status = 'approved') => {
  const id = randomUUID();
  await db.query(
    "INSERT INTO garage (id, name, slug, status, approved_at) VALUES ($1, 'Atelier Dinamo', $2, $3::garage_status, now())",
    [id, `dinamo-${id}`, status],
  );
  return id;
};

const statusOf = async (id: string) =>
  (await db.query('SELECT status FROM garage WHERE id = $1', [id])).rows[0]
    ?.status as string;

const suspensions = async (id: string) =>
  Number(
    (
      await db.query(
        'SELECT count(*) FROM garage_suspension WHERE garage_id = $1',
        [id],
      )
    ).rows[0].count,
  );

const suspend = (id: string, body: unknown, authorization?: string) => {
  const req = request(app.getHttpServer()).post(
    `/api/v1/admin/garages/${id}/suspend`,
  );
  if (authorization) req.set('Authorization', authorization);
  return req.send(body as object);
};

let admin: string;

beforeAll(async () => {
  app = await api.start();
  db = new Client({
    connectionString:
      process.env['DATABASE_URL'] ?? 'postgresql://localhost:5432/postgres',
  });
  await db.connect();
}, 120_000);

beforeEach(async () => {
  admin = bearer(await account('admin'), 'admin');
});

afterAll(async () => {
  await db.end();
  await api.stop();
});

// @traces 049-FR-005 049-FR-015
describe('POST /admin/garages/:id/suspend', () => {
  it('suspends an approved garage for an admin and answers the suspension', async () => {
    const id = await garage();

    const res = await suspend(
      id,
      { cause: 'recheck_failed', reason: REASON },
      admin,
    );

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      cause: 'recheck_failed',
      fromTime: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T.*Z$/),
      garageId: id,
      id: expect.any(String),
      reason: REASON,
    });
    expect(await statusOf(id)).toBe('suspended');
  });

  it('trims the reason before it is stored', async () => {
    const id = await garage();

    const res = await suspend(
      id,
      { cause: 'admin', reason: `  ${REASON}  ` },
      admin,
    );

    expect([res.status, res.body.reason]).toEqual([200, REASON]);
  });

  it('answers 409 garage_already_suspended the second time', async () => {
    const id = await garage();
    await suspend(id, { cause: 'admin', reason: REASON }, admin);

    const res = await suspend(id, { cause: 'admin', reason: REASON }, admin);

    expect([res.status, res.body.code, await suspensions(id)]).toEqual([
      409,
      'garage_already_suspended',
      1,
    ]);
  });

  it('answers 409 garage_not_approved for a draft garage', async () => {
    const id = await garage('draft');

    const res = await suspend(id, { cause: 'admin', reason: REASON }, admin);

    expect([res.status, res.body.code, await statusOf(id)]).toEqual([
      409,
      'garage_not_approved',
      'draft',
    ]);
  });

  it('answers 404 not_found for an unknown garage', async () => {
    const res = await suspend(
      randomUUID(),
      { cause: 'admin', reason: REASON },
      admin,
    );

    expect([res.status, res.body.code]).toEqual([404, 'not_found']);
  });

  it('answers 401 sign_in_required without a session', async () => {
    const id = await garage();

    const res = await suspend(id, { cause: 'admin', reason: REASON });

    expect([res.status, res.body.code, await statusOf(id)]).toEqual([
      401,
      'sign_in_required',
      'approved',
    ]);
  });

  it.each(['driver', 'garage', 'receptionist', 'mechanic'] as const)(
    'answers 404 with no garage data to a %s',
    async (role) => {
      const id = await garage();
      const accountId = await account(role);
      if (role === 'garage' || role === 'receptionist') {
        await db.query(
          'INSERT INTO garage_member (garage_id, account_id, role) VALUES ($1, $2, $3::garage_member_role)',
          [id, accountId, role === 'garage' ? 'owner' : 'receptionist'],
        );
      }
      if (role === 'mechanic') {
        await db.query(
          "INSERT INTO mechanic (id, garage_id, account_id, name) VALUES (gen_random_uuid(), $1, $2, 'Vlad')",
          [id, accountId],
        );
      }

      const res = await suspend(
        id,
        { cause: 'admin', reason: REASON },
        bearer(accountId, role),
      );

      expect(res.status).toBe(404);
      expect(JSON.stringify(res.body)).not.toContain('Atelier Dinamo');
      expect(res.body).not.toHaveProperty('garageId');
      expect(await statusOf(id)).toBe('approved');
    },
  );

  it.each([
    ['an empty body', {}],
    ['a cause outside the four', { cause: 'unpaid', reason: REASON }],
    ['no cause', { reason: REASON }],
    ['no reason', { cause: 'admin' }],
    ['a blank reason', { cause: 'admin', reason: '   ' }],
    ['an empty reason', { cause: 'admin', reason: '' }],
    ['a number for the reason', { cause: 'admin', reason: 42 }],
    ['an array for the reason', { cause: 'admin', reason: [REASON] }],
    ['a reason of 201 characters', { cause: 'admin', reason: 'a'.repeat(201) }],
    [
      'a field it does not take',
      { cause: 'admin', reason: REASON, until: 'x' },
    ],
  ])('answers 400 validation_failed for %s', async (_, body) => {
    const id = await garage();

    const res = await suspend(id, body, admin);

    expect([res.status, res.body.code, await statusOf(id)]).toEqual([
      400,
      'validation_failed',
      'approved',
    ]);
  });

  it('takes a reason of exactly 200 characters', async () => {
    const id = await garage();

    const res = await suspend(
      id,
      { cause: 'admin', reason: 'a'.repeat(200) },
      admin,
    );

    expect(res.status).toBe(200);
  });
});
