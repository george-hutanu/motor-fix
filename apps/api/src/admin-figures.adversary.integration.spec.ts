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

const newCity = () => {
  const key = `adv-${randomUUID().slice(0, 8)}`;
  return { key, name: `Adv ${key.slice(4)}` };
};

const DAY = 86_400_000;

const garage = async (
  city: { key: string; name: string } | null,
  approvedDaysAgo: number | null,
  status: 'approved' | 'draft' | 'suspended' = 'approved',
) => {
  const id = randomUUID();
  await db.query(
    `INSERT INTO garage (id, name, slug, status, approved_at, city_key, city_name)
     VALUES ($1, 'g', $2, $3::garage_status, $4, $5, $6)`,
    [
      id,
      `g-${id}`,
      status,
      approvedDaysAgo === null
        ? null
        : new Date(Date.now() - approvedDaysAgo * DAY),
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

// @traces 163-FR-002
describe('the period range at its edges', () => {
  it('leaves a garage approved eight days ago out of 7d and inside 30d', async () => {
    const city = newCity();
    await garage(city, 8);

    const week = await get(`/api/v1/admin/overview?city=${city.key}&period=7d`);
    const month = await get(
      `/api/v1/admin/overview?city=${city.key}&period=30d`,
    );

    expect(week.body.garagesApprovedInPeriod).toBe(0);
    expect(month.body.garagesApprovedInPeriod).toBe(1);
  });

  it('leaves a garage approved forty days ago out of today, 7d and 30d and inside 12m', async () => {
    const city = newCity();
    await garage(city, 40);

    const counts = [];
    for (const period of ['today', '7d', '30d', '12m']) {
      const res = await get(
        `/api/v1/admin/overview?city=${city.key}&period=${period}`,
      );
      counts.push(res.body.garagesApprovedInPeriod);
    }

    expect(counts).toEqual([0, 0, 0, 1]);
  });

  it('leaves a garage approved four hundred days ago out of every period', async () => {
    const city = newCity();
    await garage(city, 400);

    const res = await get(`/api/v1/admin/overview?city=${city.key}&period=12m`);

    expect(res.body.garagesApprovedInPeriod).toBe(0);
    expect(res.body.garagesListed).toBe(1);
  });

  it('refuses the key of a city holding only suspended and draft garages', async () => {
    const city = newCity();
    await garage(city, 0, 'suspended');
    await garage(city, null, 'draft');

    const res = await get(`/api/v1/admin/overview?city=${city.key}&period=7d`);

    expect(res.status).toBe(400);
  });

  it('adds nothing for a suspended garage to the whole country in the period', async () => {
    const before = await get('/api/v1/admin/overview?period=7d');
    await garage(newCity(), 0, 'suspended');
    const after = await get('/api/v1/admin/overview?period=7d');

    expect(after.body.garagesApprovedInPeriod).toBe(
      before.body.garagesApprovedInPeriod,
    );
  });

  it('gives the active drivers the same number for every period', async () => {
    const counts = [];
    for (const period of ['default', 'today', '7d', '30d', 'month', '12m']) {
      const res = await get(`/api/v1/admin/overview?period=${period}`);
      counts.push(res.body.activeDrivers);
    }

    expect(new Set(counts).size).toBe(1);
  });

  it('carries no period-start figure for today', async () => {
    const res = await get('/api/v1/admin/overview?period=today');

    expect(res.body).not.toHaveProperty('activeDriversPeriodStart');
    expect(res.body.garagesApprovedInPeriod).toEqual(expect.any(Number));
  });
});

// @traces 163-FR-003 163-FR-004
describe('the cities at their edges', () => {
  it('leaves a city with only a suspended garage out of the list and refuses its key', async () => {
    const city = newCity();
    await garage(city, 1, 'suspended');

    const list = await get('/api/v1/admin/overview');
    const read = await get(`/api/v1/admin/overview?city=${city.key}`);

    expect(
      list.body.cities.some((c: { key: string }) => c.key === city.key),
    ).toBe(false);
    expect(read.status).toBe(400);
  });

  it('counts a garage with no city under the whole country and in no city', async () => {
    const before = await get('/api/v1/admin/overview');
    await garage(null, 1);
    const after = await get('/api/v1/admin/overview');

    expect(after.body.garagesListed).toBe(before.body.garagesListed + 1);
    expect(after.body.cities.slice(1)).toEqual(before.body.cities.slice(1));
  });

  it('orders the cities by approved garages, highest first, ties by name', async () => {
    const small = newCity();
    const big = newCity();
    await garage(small, 1);
    await garage(big, 1);
    await garage(big, 2);

    const { cities } = (await get('/api/v1/admin/overview')).body;
    const counts = cities.slice(1).map((c: { garages: number }) => c.garages);

    expect(cities[0].key).toBe('all');
    expect(counts).toEqual([...counts].sort((a, b) => b - a));
    const keys = cities.map((c: { key: string }) => c.key);
    expect(keys.indexOf(big.key)).toBeLessThan(keys.indexOf(small.key));
  });

  it('carries the city waiting count for a city and none for the whole country', async () => {
    const city = newCity();
    await garage(city, 1);

    const one = await get(`/api/v1/admin/overview?city=${city.key}`);
    const all = await get('/api/v1/admin/overview?city=all');

    expect(one.body.cityGaragesWaiting).toBe(0);
    expect(all.body).not.toHaveProperty('cityGaragesWaiting');
  });

  it('answers the same twice, and the same for an explicit all', async () => {
    const a = await get('/api/v1/admin/overview');
    const b = await get('/api/v1/admin/overview?city=all&period=default');

    expect(b.body).toEqual(a.body);
  });

  it('counts garages of a city only in that city, not in another', async () => {
    const one = newCity();
    const two = newCity();
    await garage(one, 1);
    await garage(one, 2);
    await garage(two, 1);

    const res = await get(`/api/v1/admin/overview?city=${two.key}`);

    expect(res.body.garagesListed).toBe(1);
  });
});

// @traces 163-FR-001
describe('malformed queries', () => {
  it.each([
    ['an empty city', 'city='],
    ['an empty period', 'period='],
    ['an upper-case period', 'period=TODAY'],
    ['an upper-case city', 'city=ALL'],
    ['a city with a leading hyphen', 'city=-abc'],
    ['a city with a double hyphen', 'city=a--b'],
    ['a city with a trailing hyphen', 'city=abc-'],
    ['a city with a diacritic', 'city=bucure%C8%99ti'],
    ['a city with a path in it', 'city=../etc'],
    ['two cities', 'city=all&city=bucuresti'],
    ['two periods', 'period=7d&period=30d'],
    ['a period as an array', 'period[]=7d'],
    ['a city as an object', 'city[a]=b'],
    ['a city of exactly 81 characters', `city=${'a'.repeat(81)}`],
    ['a numeric period', 'period=7'],
    ['a period with trailing space', 'period=7d%20'],
  ])('refuses %s with validation_failed', async (_, query) => {
    const res = await get(`/api/v1/admin/overview?${query}`);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('validation_failed');
    expect(res.body).not.toHaveProperty('garagesListed');
  });

  it.each([
    ['an empty city', 'city='],
    ['two cities', 'city=all&city=x'],
    ['an unknown field', 'days=7'],
    ['a city with a double hyphen', 'city=a--b'],
  ])('refuses %s on the growth read', async (_, query) => {
    const res = await get(`/api/v1/admin/growth?${query}`);

    expect(res.status).toBe(400);
  });

  it('refuses a missing session with 401, not figures', async () => {
    const res = await request(app.getHttpServer()).get(
      '/api/v1/admin/overview',
    );

    expect(res.status).toBe(401);
  });

  it('answers the growth read for all the same as for no city', async () => {
    const a = await get('/api/v1/admin/growth');
    const b = await get('/api/v1/admin/growth?city=all');

    expect(b.body).toEqual(a.body);
    expect(a.body.months).toHaveLength(12);
  });

  it('hides both reads from a driver, with any query', async () => {
    const driver = bearer(await account('driver'), 'driver');

    const overview = await get('/api/v1/admin/overview?period=7d', driver);
    const growth = await get('/api/v1/admin/growth?city=zzz', driver);

    expect([overview.status, growth.status]).toEqual([404, 404]);
  });
});
