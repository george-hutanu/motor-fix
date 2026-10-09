import { randomUUID } from 'node:crypto';

import { CURRENT_CONSENT } from '@motor-fix/contracts';
import { AccountsService, signAccessToken } from '@motor-fix/domain';
import type { INestApplication } from '@nestjs/common';
import { Client } from 'pg';
import request from 'supertest';

import { apiBoot, TEST_TOKEN_SECRET } from './api-boot.testing';

// @traces 163-FR-001 163-FR-002 163-FR-003 163-FR-004 163-FR-006 163-FR-012

const api = apiBoot();
let app: INestApplication;
let db: Client;
let admin: string;

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

// The database is shared with the other API specs, so each city is new.
const newCity = () => {
  const key = `oras-${randomUUID().slice(0, 8)}`;
  return { key, name: `Oraș ${key.slice(5)}` };
};

const garage = async (
  city: { key: string; name: string } | null,
  status: 'approved' | 'draft' = 'approved',
) => {
  const id = randomUUID();
  await db.query(
    `INSERT INTO garage (id, name, slug, status, approved_at, city_key, city_name)
     VALUES ($1, 'g', $2, $3::garage_status, $4, $5, $6)`,
    [
      id,
      `g-${id}`,
      status,
      status === 'approved' ? new Date() : null,
      city?.key ?? null,
      city?.name ?? null,
    ],
  );
  return id;
};

const get = (path: string, authorization = admin) =>
  request(app.getHttpServer()).get(path).set('Authorization', authorization);

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

describe('GET /admin/overview with a city and a period', () => {
  it('lists the cities with listed garages after the whole country', async () => {
    const city = newCity();
    await garage(city);
    await garage(city);
    await garage(city, 'draft');

    const res = await get('/api/v1/admin/overview');

    expect(res.status).toBe(200);
    expect(res.body.cities[0]).toMatchObject({
      key: 'all',
      name: 'România',
    });
    expect(res.body.cities).toContainEqual({ garages: 2, ...city });
  });

  it("answers a city's own figures, its garages waiting and no active drivers of its own", async () => {
    const city = newCity();
    await garage(city);
    await garage(newCity());

    const res = await get(`/api/v1/admin/overview?city=${city.key}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      activeDrivers: 0,
      cityGaragesWaiting: 0,
      garagesListed: 1,
    });
    expect(Number.isInteger(res.body.garagesWaiting)).toBe(true);
    expect(res.body).not.toHaveProperty('activeDriversMonthStart');
    expect(res.body).not.toHaveProperty('garagesApprovedInPeriod');
  });

  it.each(['today', '7d', '30d', 'month', '12m'])(
    'counts the garages first approved in the period %s',
    async (period) => {
      const city = newCity();
      await garage(city);

      const res = await get(
        `/api/v1/admin/overview?city=${city.key}&period=${period}`,
      );

      expect(res.status).toBe(200);
      expect(res.body.garagesApprovedInPeriod).toBe(1);
    },
  );

  it('answers the default as before, without the period figure or the city waiting', async () => {
    const res = await get('/api/v1/admin/overview?city=all&period=default');

    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('garagesApprovedInPeriod');
    expect(res.body).not.toHaveProperty('cityGaragesWaiting');
  });

  it.each([
    ['an unknown city', 'city=nowhere-at-all'],
    ['a city key out of shape', 'city=Cluj%20Napoca'],
    ['a city key too long', `city=${'a'.repeat(81)}`],
    ['an unknown period', 'period=week'],
    ['an unknown field', 'county=cluj'],
  ])('refuses %s', async (_, query) => {
    const res = await get(`/api/v1/admin/overview?${query}`);

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'validation_failed', status: 400 });
  });

  it('names the city as the unknown field', async () => {
    const res = await get('/api/v1/admin/overview?city=nowhere-at-all');

    expect(res.body.errors).toEqual([{ code: 'unknown', field: 'city' }]);
  });

  it('hides the route from a non-admin, whatever the query', async () => {
    const res = await get(
      '/api/v1/admin/overview?city=Bad%20Key&period=week',
      bearer(await account('driver'), 'driver'),
    );

    expect(res.status).toBe(404);
  });
});

describe('GET /admin/growth with a city', () => {
  it("reads the city's months, its own month live and none with active drivers", async () => {
    const city = newCity();
    await garage(city);

    const res = await get(`/api/v1/admin/growth?city=${city.key}`);

    expect(res.status).toBe(200);
    expect(res.body.months).toHaveLength(12);
    expect(res.body.months.at(-1)).toStrictEqual({
      garagesListed: 1,
      month: expect.stringMatching(/^\d{4}-\d{2}$/),
    });
    for (const month of res.body.months) {
      expect(month).not.toHaveProperty('activeDrivers');
    }
  });

  it('refuses an unknown city', async () => {
    const res = await get('/api/v1/admin/growth?city=nowhere-at-all');

    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual([{ code: 'unknown', field: 'city' }]);
  });

  it('refuses a period, which growth does not take', async () => {
    const res = await get('/api/v1/admin/growth?period=7d');

    expect(res.status).toBe(400);
  });
});
