import { randomUUID } from 'node:crypto';

import { CURRENT_CONSENT } from '@motor-fix/contracts';
import { AccountsService, signAccessToken } from '@motor-fix/domain';
import type { INestApplication } from '@nestjs/common';
import { Client } from 'pg';
import request from 'supertest';

import { apiBoot, TEST_TOKEN_SECRET } from './api-boot.testing';
import { openApiDocument } from './bootstrap';

const api = apiBoot();

const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;
type Method = (typeof METHODS)[number];

// The story that adds an admin route that changes data adds its row here: a
// body a signed-in admin can send and get a 2xx for. A logged read sets
// `entries: 1`; every other GET must leave the admin's history unchanged.
const FIXTURES: Record<
  string,
  { body?: (admin: string) => object; entries?: number }
> = {
  'POST /api/v1/admin/live/test': { body: (admin) => ({ accountId: admin }) },
  'POST /api/v1/admin/news': {
    body: () => ({
      text: { en: 'News text', ro: 'Text știre' },
      title: { en: 'News', ro: 'Știre' },
    }),
  },
  'POST /api/v1/admin/notifications/test': {
    body: (admin) => ({ accountIds: [admin] }),
  },
};

const db = new Client({
  connectionString:
    process.env['DATABASE_URL'] ?? 'postgresql://localhost:5432/postgres',
});
let app: INestApplication;
let admin: string;
let authorization: string;

const routes = async () => {
  const paths = Object.entries(openApiDocument(app).paths);
  return paths
    .filter(([path]) => path.startsWith('/api/v1/admin/'))
    .flatMap(([path, item]) =>
      METHODS.filter((method) => method in item).map(
        (method) => `${method.toUpperCase()} ${path}`,
      ),
    );
};

const entries = async () =>
  Number(
    (
      await db.query(
        'SELECT count(*) AS n FROM activity_log WHERE actor_id = $1',
        [admin],
      )
    ).rows[0].n,
  );

// What is wrong with one route's call, if anything: its answer, or how many
// entries the admin gained by it.
const check = async (route: string) => {
  const [method, path] = route.split(' ') as [string, string];
  const fixture = FIXTURES[route];
  const changes = method !== 'GET';
  if (changes && !fixture?.body) return `${route}: no fixture`;
  const before = await entries();
  const res = await request(app.getHttpServer())
    [method.toLowerCase() as Method](path)
    .set('Authorization', authorization)
    .send(fixture?.body?.(admin) ?? {});
  const gained = (await entries()) - before;
  if (res.status < 200 || res.status > 299) {
    return `${route}: answered ${res.status}`;
  }
  const expected = changes ? gained >= 1 : gained === (fixture?.entries ?? 0);
  return expected ? undefined : `${route}: left ${gained} entries`;
};

// One call at a time, so no other call's entry is counted.
const callEach = async () => {
  const problems: string[] = [];
  for (const route of await routes()) {
    const problem = await check(route);
    if (problem) problems.push(problem);
  }
  return problems;
};

beforeAll(async () => {
  app = await api.start();
  await db.connect();
  // The news route sends once a month; a run before this one already did.
  await db.query('DELETE FROM news_send');
  admin = (
    await app.get(AccountsService).createAccount({
      consent: CURRENT_CONSENT,
      identity: { method: 'google', subject: `admin-${randomUUID()}` },
      name: 'Ana',
      roles: ['admin'],
    })
  ).id;
  authorization = `Bearer ${signAccessToken({ accountId: admin, role: 'admin' }, TEST_TOKEN_SECRET, Date.now())}`;
}, 120_000);

afterAll(async () => {
  await db.end();
  await api.stop();
});

describe('every admin route', () => {
  it('leaves an entry by the admin when it changes data, and none when it reads', async () => {
    expect(await callEach()).toEqual([]);
  });

  it('is listed, so a new one is called without editing the check', async () => {
    expect(await routes()).toEqual(
      expect.arrayContaining([
        'GET /api/v1/admin/overview',
        ...Object.keys(FIXTURES),
      ]),
    );
  });
});
