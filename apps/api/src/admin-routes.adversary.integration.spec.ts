import { randomUUID } from 'node:crypto';

import { CURRENT_CONSENT } from '@motor-fix/contracts';
import { AccountsService, signAccessToken } from '@motor-fix/domain';
import type { INestApplication } from '@nestjs/common';
import { Client } from 'pg';
import request from 'supertest';

import { apiBoot, TEST_TOKEN_SECRET } from './api-boot.testing';

const api = apiBoot();
const URL = '/api/v1/admin/overview';
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

const waiting = async (admin: string) =>
  (
    await request(app.getHttpServer())
      .get(URL)
      .set('Authorization', bearer(admin, 'admin'))
  ).body.garagesWaiting as number;

const file = async (status: string, garage?: string) => {
  const id = garage ?? randomUUID();
  if (!garage)
    await db.query("INSERT INTO garage (id, name, slug) VALUES ($1, 'g', $2)", [
      id,
      `g-${id}`,
    ]);
  await db.query(
    'INSERT INTO verification_file (id, garage_id, status) VALUES ($1, $2, $3::verification_file_status)',
    [randomUUID(), id, status],
  );
  return id;
};

beforeAll(async () => {
  app = await api.start();
  db = new Client({
    connectionString:
      process.env['DATABASE_URL'] ?? 'postgresql://localhost:5432/postgres',
  });
  await db.connect();
}, 120_000);

afterAll(async () => {
  await db.end();
  await api.stop();
});

describe('the admin overview count', () => {
  it('counts submitted and in_review files and no other status', async () => {
    const admin = await account('admin');
    const before = await waiting(admin);
    for (const status of ['approved', 'more_requested', 'rejected'])
      await file(status);

    expect(await waiting(admin)).toBe(before);

    await file('submitted');
    await file('in_review');

    expect(await waiting(admin)).toBe(before + 2);
  });

  it('counts a garage once when an older file was rejected and a new one waits', async () => {
    const admin = await account('admin');
    const before = await waiting(admin);
    const garage = await file('rejected');
    await file('submitted', garage);

    expect(await waiting(admin)).toBe(before + 1);
  });

  it('answers the same count twice in a row and reads the database each call', async () => {
    const admin = await account('admin');
    const first = await waiting(admin);
    expect(await waiting(admin)).toBe(first);

    await file('submitted');

    expect(await waiting(admin)).toBe(first + 1);
  });

  // The overview takes `city` and `period` only; the global pipe
  // refuses any other field, so a forged count never reaches the answer.
  it('refuses a query field it does not take, answering no figure', async () => {
    const res = await request(app.getHttpServer())
      .get(`${URL}?garagesWaiting=999&role=driver`)
      .set('Authorization', bearer(await account('admin'), 'admin'));

    expect([res.status, res.body?.code]).toEqual([400, 'validation_failed']);
    expect(res.body).not.toHaveProperty('garagesWaiting');
  });
});

describe('the admin overview refuses what is not an admin session', () => {
  it('answers not_found to a driver account whose token claims the admin role', async () => {
    const res = await request(app.getHttpServer())
      .get(URL)
      .set('Authorization', bearer(await account('driver'), 'admin'));

    expect([res.status, res.body?.code]).toEqual([404, 'not_found']);
  });

  it('answers sign_in_required to a malformed or foreign-signed token', async () => {
    const foreign = `Bearer ${signAccessToken(
      { accountId: await account('admin'), role: 'admin' } as never,
      'another-secret-another-secret-another',
      Date.now(),
    )}`;
    for (const authorization of [
      'Bearer ',
      'Bearer not.a.token',
      'Basic abc',
      foreign,
    ]) {
      const res = await request(app.getHttpServer())
        .get(URL)
        .set('Authorization', authorization);

      expect([authorization, res.status, res.body?.code]).toEqual([
        authorization,
        401,
        'sign_in_required',
      ]);
    }
  });

  it('answers sign_in_required to an expired token', async () => {
    const id = await account('admin');
    const old = signAccessToken(
      { accountId: id, role: 'admin' } as never,
      TEST_TOKEN_SECRET,
      Date.now() - 24 * 60 * 60 * 1000,
    );
    const res = await request(app.getHttpServer())
      .get(URL)
      .set('Authorization', `Bearer ${old}`);

    expect([res.status, res.body?.code]).toEqual([401, 'sign_in_required']);
  });

  it('answers 404 not_found to a driver for the overview with a trailing slash', async () => {
    const res = await request(app.getHttpServer())
      .get(`${URL}/`)
      .set('Authorization', bearer(await account('driver'), 'driver'));

    expect([res.status, res.body?.code]).toEqual([404, 'not_found']);
  });

  it('gives a driver the same code, status and title as a path that does not exist', async () => {
    const authorization = bearer(await account('driver'), 'driver');
    const real = await request(app.getHttpServer())
      .get(URL)
      .set('Authorization', authorization);
    const missing = await request(app.getHttpServer())
      .get('/api/v1/admin/does-not-exist')
      .set('Authorization', authorization);

    const shape = ({ code, status, title, type }: Record<string, unknown>) => ({
      code,
      status,
      title,
      type,
    });

    expect(shape(real.body)).toEqual(shape(missing.body));
  });
});
