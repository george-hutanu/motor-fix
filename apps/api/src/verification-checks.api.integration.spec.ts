import { randomUUID } from 'node:crypto';

import { CURRENT_CONSENT } from '@motor-fix/contracts';
import { AccountsService, signAccessToken } from '@motor-fix/domain';
import type { INestApplication } from '@nestjs/common';
import { Client } from 'pg';
import request from 'supertest';

import { apiBoot, TEST_TOKEN_SECRET } from './api-boot.testing';

// @traces 300-FR-003 300-FR-009 300-FR-010 300-FR-011

const api = apiBoot();
let app: INestApplication;
let db: Client;

const account = async (role: 'admin' | 'driver') =>
  (
    await app.get(AccountsService).createAccount({
      consent: CURRENT_CONSENT,
      identity: { method: 'google', subject: `${role}-${randomUUID()}` },
      name: role,
      roles: [role],
    })
  ).id;

const bearer = (accountId: string, role: string) =>
  `Bearer ${signAccessToken({ accountId, role } as never, TEST_TOKEN_SECRET, Date.now())}`;

// A file in `status` with its 8 checks, as a submission leaves it.
const file = async (status = 'submitted') => {
  const garage = randomUUID();
  const id = randomUUID();
  await db.query("INSERT INTO garage (id, name, slug) VALUES ($1, 'g', $2)", [
    garage,
    `g-${garage}`,
  ]);
  await db.query(
    'INSERT INTO verification_file (id, garage_id, status) VALUES ($1, $2, $3::verification_file_status)',
    [id, garage, status],
  );
  await db.query(
    'INSERT INTO verification_check (id, file_id, kind) SELECT gen_random_uuid(), $1, k FROM unnest(enum_range(NULL::verification_check_kind)) AS k',
    [id],
  );
  return id;
};

const put = (id: string, kind: string, body: object, authorization: string) =>
  request(app.getHttpServer())
    .put(`/api/v1/admin/verification-files/${id}/checks/${kind}`)
    .set('Authorization', authorization)
    .send(body);

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

describe('PUT /admin/verification-files/:id/checks/:kind', () => {
  it('records the check and answers with it, the summary and the activities', async () => {
    const id = await file();

    const res = await put(
      id,
      'rar',
      { detail: 'Autorizație găsită în registru', result: 'ok' },
      admin,
    );

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      check: {
        automatic: false,
        detail: 'Autorizație găsită în registru',
        kind: 'rar',
        result: 'ok',
      },
      rarActivities: [],
      summary: {
        en: 'RAR licence checked',
        ro: 'Autorizație RAR verificată',
      },
    });
    expect(typeof res.body.check.recordedAt).toBe('string');
    expect(typeof res.body.check.recordedBy).toBe('string');
  });

  it('stores the activities list sent with the activities check', async () => {
    const id = await file();

    const res = await put(
      id,
      'activities',
      { activities: ['mechanics', 'brakes'], result: 'ok' },
      admin,
    );

    expect(res.status).toBe(200);
    expect(res.body.rarActivities).toEqual(['mechanics', 'brakes']);
  });

  it('answers 409 on a decided file', async () => {
    const id = await file('approved');

    const res = await put(id, 'rar', { result: 'ok' }, admin);

    expect([res.status, res.body.code, res.body.detail]).toEqual([
      409,
      'verification_file_decided',
      'Dosarul e deja decis',
    ]);
  });

  it('answers 422 for a kind outside the 8', async () => {
    const res = await put(await file(), 'insurance', { result: 'ok' }, admin);

    expect([res.status, res.body.code]).toEqual([
      422,
      'verification_check_kind_unknown',
    ]);
  });

  it.each([
    ['a warning without a detail', 'photos', { result: 'warning' }],
    ['a detail over 200', 'rar', { detail: 'x'.repeat(201), result: 'ok' }],
    ['an unknown result', 'rar', { result: 'great' }],
    ['an unknown activity', 'activities', { activities: ['x'], result: 'ok' }],
    ['a list on rar', 'rar', { activities: ['brakes'], result: 'ok' }],
  ])('answers 400 validation_failed for %s', async (_, kind, body) => {
    const res = await put(await file(), kind, body, admin);

    expect([res.status, res.body.code]).toEqual([400, 'validation_failed']);
  });

  it('answers 404 for an unknown file and to a driver', async () => {
    expect(
      (await put(randomUUID(), 'rar', { result: 'ok' }, admin)).status,
    ).toBe(404);
    const driver = bearer(await account('driver'), 'driver');
    expect(
      (await put(await file(), 'rar', { result: 'ok' }, driver)).status,
    ).toBe(404);
  });
});
