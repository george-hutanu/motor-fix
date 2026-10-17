import { randomUUID } from 'node:crypto';

import { CURRENT_CONSENT } from '@motor-fix/contracts';
import { AccountsService, signAccessToken } from '@motor-fix/domain';
import type { INestApplication } from '@nestjs/common';
import { Client } from 'pg';
import request from 'supertest';

import { apiBoot, TEST_TOKEN_SECRET } from './api-boot.testing';

// @traces 301-FR-001 301-FR-002 301-FR-006

const api = apiBoot();
let app: INestApplication;
let db: Client;
let admin: string;

const bearer = (accountId: string) =>
  `Bearer ${signAccessToken({ accountId, role: 'admin' } as never, TEST_TOKEN_SECRET, Date.now())}`;

const get = (query: string, authorization?: string) => {
  const call = request(app.getHttpServer()).get(
    `/api/v1/admin/verification-queue${query}`,
  );
  return authorization ? call.set('Authorization', authorization) : call;
};

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

describe('GET /admin/verification-queue', () => {
  it('answers a page of waiting files, oldest first, with the total', async () => {
    const garage = randomUUID();
    const file = randomUUID();
    await db.query(
      "INSERT INTO garage (id, name, slug, city_key, city_name) VALUES ($1, 'Auto Vest Motors', $2, 'bucuresti', 'București')",
      [garage, `g-${garage}`],
    );
    // The oldest sending there can be, so it heads the queue.
    await db.query(
      "INSERT INTO verification_file (id, garage_id, status, submitted_at) VALUES ($1, $2, 'submitted', '2000-01-03T10:00:00Z')",
      [file, garage],
    );

    const res = await get('?limit=200', admin);

    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThanOrEqual(res.body.items.length);
    expect(res.body.items[0]).toMatchObject({
      area: { kind: 'town', name: 'București' },
      brands: 0,
      flagged: true,
      garageId: garage,
      garageName: 'Auto Vest Motors',
      id: file,
      lamp: 'amber',
      status: 'submitted',
      submittedAt: '2000-01-03T10:00:00.000Z',
      summary: { en: expect.any(String), ro: expect.any(String) },
    });
  });

  it.each([
    '?offset=-1',
    '?offset=10001',
    '?limit=0',
    '?limit=201',
    '?limit=abc',
  ])('refuses %s', async (query) => {
    const res = await get(query, admin);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('validation_failed');
  });

  it('asks for a session', async () => {
    const res = await get('');

    expect(res.status).toBe(401);
  });
});
