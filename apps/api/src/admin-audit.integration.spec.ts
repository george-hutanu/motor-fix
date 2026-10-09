import { randomUUID } from 'node:crypto';

import { CURRENT_CONSENT } from '@motor-fix/contracts';
import {
  AccountsService,
  StorageService,
  signAccessToken,
} from '@motor-fix/domain';
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
// `entries: 1`; every other GET must leave the admin's history unchanged. A
// route with path parameters gives `path`, which makes what it acts on.
const FIXTURES: Record<
  string,
  {
    body?: (admin: string) => object;
    entries?: number;
    path?: () => Promise<string>;
  }
> = {
  'GET /api/v1/admin/platform-rule-changes': {
    path: async () =>
      '/api/v1/admin/platform-rule-changes?key=reviews_only_after_confirmed_job',
  },
  'GET /api/v1/admin/verification-files/{id}/documents/{documentId}/pages/{n}/download-url':
    {
      entries: 1,
      path: async () => {
        const { file, id } = (
          await db.query(
            `WITH g AS (INSERT INTO garage (id, name, slug)
               VALUES (gen_random_uuid(), 'Audit', $1) RETURNING id),
             f AS (INSERT INTO verification_file (id, garage_id)
               SELECT gen_random_uuid(), id FROM g RETURNING id)
             INSERT INTO legal_document (verification_file_id, kind, pages)
             SELECT id, 'rar_authorisation', ARRAY['legal_document/audit/page']
             FROM f RETURNING verification_file_id AS file, id`,
            [`audit-${randomUUID()}`],
          )
        ).rows[0] as { file: string; id: string };
        await app
          .get(StorageService)
          .putObject(
            'legal_document/audit/page',
            Buffer.from('%PDF-1.7'),
            'application/pdf',
          );
        return `/api/v1/admin/verification-files/${file}/documents/${id}/pages/1/download-url`;
      },
    },
  'PATCH /api/v1/admin/platform-rules/{key}': {
    body: () => ({ seen: false, value: true }),
    path: async () => {
      await db.query(
        `UPDATE platform_rule SET value = 'false'::jsonb
         WHERE key = 'maintenance_mode'`,
      );
      return '/api/v1/admin/platform-rules/maintenance_mode';
    },
  },
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
  'POST /api/v1/admin/platform-rule-changes': {
    body: () => ({
      key: 'reviews_only_after_confirmed_job',
      reason: 'Testăm recenziile din profil.',
    }),
    path: async () => {
      await clearRequests();
      return '/api/v1/admin/platform-rule-changes';
    },
  },
  'POST /api/v1/admin/platform-rule-changes/{id}/approve': {
    body: () => ({}),
    path: async () =>
      `/api/v1/admin/platform-rule-changes/${await waiting(randomUUID())}/approve`,
  },
  'POST /api/v1/admin/platform-rule-changes/{id}/cancel': {
    body: () => ({}),
    path: async () =>
      `/api/v1/admin/platform-rule-changes/${await waiting(admin)}/cancel`,
  },
  'POST /api/v1/admin/platform-rule-changes/{id}/refuse': {
    body: () => ({}),
    path: async () =>
      `/api/v1/admin/platform-rule-changes/${await waiting(randomUUID())}/refuse`,
  },
  'PUT /api/v1/admin/verification-files/{id}/checks/{kind}': {
    body: () => ({ detail: 'CUI activ', result: 'ok' }),
    path: async () => {
      const slug = `audit-${randomUUID()}`;
      const file = (
        await db.query(
          `WITH g AS (INSERT INTO garage (id, name, slug)
             VALUES (gen_random_uuid(), 'Audit', $1) RETURNING id)
           INSERT INTO verification_file (id, garage_id)
           SELECT gen_random_uuid(), id FROM g RETURNING id`,
          [slug],
        )
      ).rows[0].id as string;
      await db.query(
        `INSERT INTO verification_check (id, file_id, kind)
         VALUES (gen_random_uuid(), $1, 'company')`,
        [file],
      );
      return `/api/v1/admin/verification-files/${file}/checks/company`;
    },
  },
};

// The reviews rule back on, with no request waiting on it.
async function clearRequests() {
  await db.query(`DELETE FROM platform_rule_change WHERE status = 'requested'`);
  await db.query(
    `UPDATE platform_rule SET value = 'true'::jsonb
     WHERE key = 'reviews_only_after_confirmed_job'`,
  );
}

// A request waiting on the reviews rule, asked by `asker`.
async function waiting(asker: string) {
  await clearRequests();
  return (
    await db.query(
      `INSERT INTO platform_rule_change
         (id, rule_key, old_value, new_value, reason, status,
          requested_by, requested_by_name)
       VALUES (gen_random_uuid(), 'reviews_only_after_confirmed_job',
         'true'::jsonb, 'false'::jsonb, 'Testăm recenziile.', 'requested',
         $1, 'Ioana')
       RETURNING id`,
      [asker],
    )
  ).rows[0].id as string;
}

const db = new Client({
  connectionString:
    process.env['DATABASE_URL'] ?? 'postgresql://localhost:5432/postgres',
});
let app: INestApplication;
let admin: string;
let authorization: string;

const routes = () => {
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
  const [method, template] = route.split(' ') as [string, string];
  const fixture = FIXTURES[route];
  const changes = method !== 'GET';
  if (changes && !fixture?.body) return `${route}: no fixture`;
  const path = (await fixture?.path?.()) ?? template;
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
  for (const route of routes()) {
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
  // The platform rule fixture switched maintenance on; other suites share the database.
  await db.query(
    `UPDATE platform_rule SET value = 'false'::jsonb
     WHERE key = 'maintenance_mode'`,
  );
  await clearRequests();
  await db.end();
  await api.stop();
});

describe('every admin route', () => {
  it('leaves an entry by the admin when it changes data, and none when it reads', async () => {
    expect(await callEach()).toEqual([]);
  });

  it('is listed, so a new one is called without editing the check', async () => {
    expect(routes()).toEqual(
      expect.arrayContaining([
        'GET /api/v1/admin/overview',
        ...Object.keys(FIXTURES),
      ]),
    );
  });
});
