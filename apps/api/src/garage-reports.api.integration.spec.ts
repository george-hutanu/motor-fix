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

const TEXT = 'Mi-au cerut bani pentru o piesă pe care nu au montat-o.';

const account = async (role: 'admin' | 'driver' | 'garage') =>
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

const approvedGarage = async (status = 'approved') => {
  const id = randomUUID();
  await db.query(
    "INSERT INTO garage (id, name, slug, status, approved_at) VALUES ($1, 'g', $2, $3::garage_status, now())",
    [id, `g-${id}`, status],
  );
  await db.query(
    "INSERT INTO verification_file (id, garage_id, status, decided_at) VALUES (gen_random_uuid(), $1, 'approved', now())",
    [id],
  );
  return id;
};

const count = async (garageId: string) =>
  Number(
    (
      await db.query(
        'SELECT count(*) FROM garage_report WHERE garage_id = $1',
        [garageId],
      )
    ).rows[0].count,
  );

const post = (id: string, body: unknown, authorization?: string) => {
  const req = request(app.getHttpServer()).post(
    `/api/v1/garages/${id}/reports`,
  );
  if (authorization) req.set('Authorization', authorization);
  return req.send(body as object);
};

let driver: string;

beforeAll(async () => {
  app = await api.start();
  db = new Client({
    connectionString:
      process.env['DATABASE_URL'] ?? 'postgresql://localhost:5432/postgres',
  });
  await db.connect();
}, 120_000);

beforeEach(async () => {
  driver = bearer(await account('driver'), 'driver');
});

afterAll(async () => {
  await db.end();
  await api.stop();
});

// @traces 312-FR-001 312-FR-002
describe('POST /garages/:id/reports sessions and roles', () => {
  it('answers 401 sign_in_required without a session and stores nothing', async () => {
    const id = await approvedGarage();

    const res = await post(id, { text: TEXT });

    expect([res.status, res.body.code, await count(id)]).toEqual([
      401,
      'sign_in_required',
      0,
    ]);
  });

  it('answers 401 sign_in_required to a malformed bearer token', async () => {
    const id = await approvedGarage();

    const res = await post(id, { text: TEXT }, 'Bearer not.a.token');

    expect([res.status, res.body.code]).toEqual([401, 'sign_in_required']);
  });

  it('answers 404 not_found to an admin account', async () => {
    const id = await approvedGarage();
    const admin = bearer(await account('admin'), 'admin');

    const res = await post(id, { text: TEXT }, admin);

    expect([res.status, res.body.code, await count(id)]).toEqual([
      404,
      'not_found',
      0,
    ]);
  });

  it('answers 404 not_found to the owner of that garage', async () => {
    const id = await approvedGarage();
    const owner = await account('garage');
    await db.query(
      "INSERT INTO garage_member (garage_id, account_id, role) VALUES ($1, $2, 'owner')",
      [id, owner],
    );

    const res = await post(id, { text: TEXT }, bearer(owner, 'garage'));

    expect([res.status, res.body.code, await count(id)]).toEqual([
      404,
      'not_found',
      0,
    ]);
  });
});

// @traces 312-FR-003 312-FR-004
describe('POST /garages/:id/reports the garage id', () => {
  it.each([
    ['not a uuid', 'not-a-uuid'],
    ['a url-encoded space', '%20'],
    ['an sql fragment', "1'%20OR%20'1'='1"],
  ])('answers 404 or 400, never 500, for an id that is %s', async (_, id) => {
    const res = await post(id, { text: TEXT }, driver);

    expect([400, 404]).toContain(res.status);
  });

  it('answers 404 not_found for an unknown garage', async () => {
    const res = await post(randomUUID(), { text: TEXT }, driver);

    expect([res.status, res.body.code]).toEqual([404, 'not_found']);
  });

  it.each(['draft', 'suspended'])(
    'answers 404 not_found for a %s garage',
    async (status) => {
      const id = await approvedGarage(status);

      const res = await post(id, { text: TEXT }, driver);

      expect([res.status, res.body.code, await count(id)]).toEqual([
        404,
        'not_found',
        0,
      ]);
    },
  );
});

// @traces 312-FR-005
describe('POST /garages/:id/reports the body', () => {
  it.each([
    ['an empty body', {}],
    ['a null text', { text: null }],
    ['a number', { text: 1234567890 }],
    ['an array', { text: [TEXT] }],
    ['an object', { text: { value: TEXT } }],
    ['19 characters', { text: 'a'.repeat(19) }],
    ['1001 characters', { text: 'a'.repeat(1001) }],
    ['an array body', [TEXT]],
    ['a prototype key', JSON.parse(`{"text":"${TEXT}","__proto__":{"x":1}}`)],
  ])('answers 400 validation_failed for %s', async (_, body) => {
    const id = await approvedGarage();

    const res = await post(id, body, driver);

    expect([res.status, res.body.code, await count(id)]).toEqual([
      400,
      'validation_failed',
      0,
    ]);
  });

  it.each([
    ['spaces', ' '.repeat(40)],
    ['newlines', '\n'.repeat(40)],
  ])('takes a text of only %s, counted as written', async (_, text) => {
    const id = await approvedGarage();

    const res = await post(id, { text }, driver);

    expect([res.status, await count(id)]).toEqual([201, 1]);
  });

  it('takes exactly 20 characters', async () => {
    const id = await approvedGarage();

    const res = await post(id, { text: 'a'.repeat(20) }, driver);

    expect(res.status).toBe(201);
  });

  it('takes exactly 1000 characters', async () => {
    const id = await approvedGarage();

    const res = await post(id, { text: 'a'.repeat(1000) }, driver);

    expect(res.status).toBe(201);
  });

  it('counts a 4-byte emoji as one character', async () => {
    const id = await approvedGarage();

    const res = await post(id, { text: '🔧'.repeat(20) }, driver);

    expect(res.status).toBe(201);
  });

  it('stores the text verbatim, with its markup', async () => {
    const id = await approvedGarage();
    const text = `  <script>alert(1)</script> ${TEXT}\n`;

    const res = await post(id, { text }, driver);

    const row = await db.query('SELECT text FROM garage_report WHERE id = $1', [
      res.body.id,
    ]);
    expect([res.status, row.rows[0]?.text]).toEqual([201, text]);
  });

  it('refuses a field the contract does not name', async () => {
    const id = await approvedGarage();

    const res = await post(
      id,
      { reporterId: randomUUID(), status: 'closed', text: TEXT },
      driver,
    );

    expect([res.status, res.body.code, await count(id)]).toEqual([
      400,
      'validation_failed',
      0,
    ]);
  });

  it('answers 415 unsupported_media_type to a form post', async () => {
    const id = await approvedGarage();

    const res = await request(app.getHttpServer())
      .post(`/api/v1/garages/${id}/reports`)
      .set('Authorization', driver)
      .type('form')
      .send({ text: TEXT });

    expect([res.status, res.body.code, await count(id)]).toEqual([
      415,
      'unsupported_media_type',
      0,
    ]);
  });
});

// @traces 312-FR-006 312-FR-007
describe('POST /garages/:id/reports the answer', () => {
  it('answers 201 with an id and an ISO createdAt only', async () => {
    const id = await approvedGarage();

    const res = await post(id, { text: TEXT }, driver);

    expect(res.status).toBe(201);
    expect(Object.keys(res.body).sort()).toEqual(['createdAt', 'id']);
    expect(res.body.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(new Date(res.body.createdAt).toISOString()).toBe(res.body.createdAt);
  });

  it('answers 409 garage_already_reported to the same driver twice', async () => {
    const id = await approvedGarage();
    await post(id, { text: TEXT }, driver);

    const res = await post(id, { text: TEXT }, driver);

    expect([res.status, res.body.code, await count(id)]).toEqual([
      409,
      'garage_already_reported',
      1,
    ]);
  });

  it('keeps one report when the same driver posts twice at once', async () => {
    const id = await approvedGarage();

    const answers = await Promise.all([
      post(id, { text: TEXT }, driver),
      post(id, { text: TEXT }, driver),
    ]);

    expect([answers.map((a) => a.status).sort(), await count(id)]).toEqual([
      [201, 409],
      1,
    ]);
  });

  it('answers 429 too_many_reports on the sixth garage in a day', async () => {
    const statuses: number[] = [];
    let last: { body: { code?: string } } = { body: {} };
    for (let n = 0; n < 6; n += 1) {
      last = await post(await approvedGarage(), { text: TEXT }, driver);
      statuses.push((last as unknown as { status: number }).status);
    }

    expect([statuses, last.body.code]).toEqual([
      [201, 201, 201, 201, 201, 429],
      'too_many_reports',
    ]);
  });

  it('answers 404 on GET, which the route does not offer', async () => {
    const id = await approvedGarage();

    const res = await request(app.getHttpServer())
      .get(`/api/v1/garages/${id}/reports`)
      .set('Authorization', driver);

    expect(res.status).toBe(404);
  });
});
