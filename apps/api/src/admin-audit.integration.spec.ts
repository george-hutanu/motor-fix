import { randomUUID } from 'node:crypto';

import { CURRENT_CONSENT } from '@motor-fix/contracts';
import {
  AccountsService,
  MAINTENANCE,
  type Maintenance,
  StorageService,
  signAccessToken,
} from '@motor-fix/domain';
import { TURN_WAIT_MS } from '@motor-fix/domain/testing';
import type { INestApplication } from '@nestjs/common';
import { Client } from 'pg';
import request from 'supertest';

import { apiBoot, TEST_TOKEN_SECRET } from './api-boot.testing';
import { openApiDocument } from './bootstrap';

const api = apiBoot();

const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;
type Method = (typeof METHODS)[number];

const ALL_VOICES_ON =
  'UPDATE copy_voice_setting SET enabled = true, pinned = false';

// The story that adds an admin route that changes data adds its row here: a
// body a signed-in admin can send and get a 2xx for. A logged read sets
// `entries: 1`; every other GET must leave the admin's history unchanged. A
// call that only says who is looking (presence) sets `entries: 0`. A
// route with path parameters gives `path`, which makes what it acts on. A
// route that always refuses gives the status it answers with, `answers`.
const FIXTURES: Record<
  string,
  {
    answers?: number;
    body?: (admin: string) => object;
    entries?: number;
    path?: () => Promise<string>;
  }
> = {
  // @traces 1267-FR-011
  // Only the driver deletes a repair: the admin is refused and nothing is
  // recorded.
  'DELETE /api/v1/admin/repairs/{id}': {
    answers: 403,
    body: () => ({}),
    entries: 0,
    path: async () => `/api/v1/admin/repairs/${await loggedRepair()}`,
  },
  // Who else has the file open: a hint kept for a minute, never recorded.
  'DELETE /api/v1/admin/verification-files/{id}/presence': {
    body: () => ({}),
    entries: 0,
    path: async () =>
      `/api/v1/admin/verification-files/${await submitted()}/presence`,
  },
  // @traces 003-FR-005 003-FR-014
  'GET /api/v1/admin/accounts/{id}': {
    path: async () => `/api/v1/admin/accounts/${await driver()}`,
  },
  // @traces 1267-FR-001
  'GET /api/v1/admin/accounts/{id}/repairs': {
    path: async () => `/api/v1/admin/accounts/${await driver()}/repairs`,
  },
  // @traces 105-FR-019
  'GET /api/v1/admin/brands': {},
  // @traces 414-FR-002
  'GET /api/v1/admin/catalogue-jobs': {},
  'GET /api/v1/admin/garages': {
    path: async () => '/api/v1/admin/garages?status=suspended',
  },
  'GET /api/v1/admin/platform-rule-changes': {
    path: async () =>
      '/api/v1/admin/platform-rule-changes?key=reviews_only_after_confirmed_job',
  },
  // @traces 1267-FR-003 1267-FR-004
  'GET /api/v1/admin/repairs/{id}': {
    entries: 1,
    path: async () => `/api/v1/admin/repairs/${await loggedRepair()}`,
  },
  'GET /api/v1/admin/system-log': {
    path: async () =>
      `/api/v1/admin/system-log?from=${new Date(Date.now() - 86_400_000).toISOString()}`,
  },
  'GET /api/v1/admin/verification-files/{id}': {
    path: async () => `/api/v1/admin/verification-files/${await submitted()}`,
  },
  'GET /api/v1/admin/verification-files/{id}/changes': {
    path: async () =>
      `/api/v1/admin/verification-files/${await submitted()}/changes`,
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
  // @traces 105-FR-019
  'PATCH /api/v1/admin/brands/{id}': {
    body: () => ({ active: false, seenUpdatedAt: brandSeen }),
    path: async () => `/api/v1/admin/brands/${await storedBrand()}`,
  },
  'PATCH /api/v1/admin/copy-voices/{voice}': {
    body: () => ({
      enabled: false,
      pinned: false,
      seen: { enabled: true, pinned: false },
    }),
    path: async () => {
      await db.query(ALL_VOICES_ON);
      return '/api/v1/admin/copy-voices/5';
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
  // @traces 1267-FR-005 1267-FR-007
  'PATCH /api/v1/admin/repairs/{id}': {
    body: () => ({ version: repairSeen, what: 'Schimb ulei și filtru' }),
    path: async () => `/api/v1/admin/repairs/${await loggedRepair()}`,
  },
  'POST /api/v1/admin/accounts/{id}/delete-on-request': {
    body: () => ({
      identityChecked: true,
      receivedOn: '2026-01-15',
      reference: 'DR-2026-0001',
    }),
    path: async () =>
      `/api/v1/admin/accounts/${await driver()}/delete-on-request`,
  },
  'POST /api/v1/admin/accounts/{id}/reset-access': {
    body: () => ({}),
    path: async () => `/api/v1/admin/accounts/${await driver()}/reset-access`,
  },
  'POST /api/v1/admin/accounts/{id}/restore': {
    body: () => ({}),
    path: async () =>
      `/api/v1/admin/accounts/${await driver('suspended')}/restore`,
  },
  'POST /api/v1/admin/accounts/{id}/suspend': {
    body: () => ({ reason: 'Cereri false, repetate.' }),
    path: async () => `/api/v1/admin/accounts/${await driver()}/suspend`,
  },
  // @traces 105-FR-019
  'POST /api/v1/admin/brands': {
    body: () => ({ name: `Marca ${randomUUID().slice(0, 8)}` }),
  },
  // @traces 414-FR-003 414-FR-004 414-FR-007
  'POST /api/v1/admin/catalogue-jobs/{id}/approve': {
    body: () => {
      const name = `Lucrare audit ${randomUUID().slice(0, 8)}`;
      return { carSystem: 'engine', nameEn: name, nameRo: name };
    },
    path: async () =>
      `/api/v1/admin/catalogue-jobs/${await proposedJob()}/approve`,
  },
  'POST /api/v1/admin/catalogue-jobs/{id}/reject': {
    body: () => ({ reason: 'Nu este o lucrare de catalog.' }),
    path: async () =>
      `/api/v1/admin/catalogue-jobs/${await proposedJob()}/reject`,
  },
  'POST /api/v1/admin/garages/{id}/rechecks': {
    body: () => ({
      checkedOn: new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Bucharest',
      }).format(new Date()),
      detail: 'Autorizația RAR a expirat',
      failure: 'expired',
      lastCheckedOn: null,
      result: 'failed',
    }),
    path: async () => {
      const garage = (
        await db.query(
          `INSERT INTO garage (id, name, slug, status, approved_at)
           VALUES (gen_random_uuid(), 'Audit', $1, 'approved', now())
           RETURNING id`,
          [`audit-${randomUUID()}`],
        )
      ).rows[0].id as string;
      return `/api/v1/admin/garages/${garage}/rechecks`;
    },
  },
  // A garage an admin suspended, put back with a note.
  'POST /api/v1/admin/garages/{id}/restore': {
    body: () => ({ note: 'Discutat cu proprietarul, problema e rezolvată.' }),
    path: async () => {
      const garage = (
        await db.query(
          `WITH g AS (INSERT INTO garage (id, name, slug, status, approved_at)
             VALUES (gen_random_uuid(), 'Audit', $1, 'suspended', now()) RETURNING id)
           INSERT INTO garage_suspension (garage_id, cause, reason, from_time)
           SELECT id, 'admin', 'Verificare la cererea echipei', now() FROM g
           RETURNING garage_id`,
          [`audit-${randomUUID()}`],
        )
      ).rows[0].garage_id as string;
      return `/api/v1/admin/garages/${garage}/restore`;
    },
  },
  'POST /api/v1/admin/garages/{id}/suspend': {
    body: () => ({ cause: 'admin', reason: 'Verificare la cererea echipei' }),
    path: async () => {
      const garage = (
        await db.query(
          `INSERT INTO garage (id, name, slug, status, approved_at)
           VALUES (gen_random_uuid(), 'Audit', $1, 'approved', now())
           RETURNING id`,
          [`audit-${randomUUID()}`],
        )
      ).rows[0].id as string;
      return `/api/v1/admin/garages/${garage}/suspend`;
    },
  },
  'POST /api/v1/admin/legal-documents/{id}/accept': {
    body: () => ({}),
    path: async () =>
      `/api/v1/admin/legal-documents/${await yearlyUpload()}/accept`,
  },
  'POST /api/v1/admin/legal-documents/{id}/refuse': {
    body: () => ({ note: 'Certificatul este ilizibil', reason: 'documents' }),
    path: async () =>
      `/api/v1/admin/legal-documents/${await yearlyUpload()}/refuse`,
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
  'POST /api/v1/admin/verification-files/{id}/decision': {
    body: () => ({
      decision: 'rejected',
      note: 'Lipsă acte',
      reason: 'documents',
    }),
    path: async () =>
      `/api/v1/admin/verification-files/${await submitted()}/decision`,
  },
  'POST /api/v1/admin/verification-files/{id}/open': {
    body: () => ({}),
    path: async () =>
      `/api/v1/admin/verification-files/${await submitted()}/open`,
  },
  'POST /api/v1/admin/verification-files/{id}/reopen': {
    body: () => ({}),
    path: async () =>
      `/api/v1/admin/verification-files/${await submitted('rejected')}/reopen`,
  },
  // An unfounded verdict on the one open report that reopened the file.
  'POST /api/v1/admin/verification-files/{id}/report-decision': {
    body: () => ({ decision: 'unfounded', note: 'Prețurile sunt corecte.' }),
    path: async () =>
      `/api/v1/admin/verification-files/${await reported()}/report-decision`,
  },
  // OK on the RAR check needs the file's number and every tick.
  'PUT /api/v1/admin/verification-files/{id}/checks/{kind}': {
    body: () => ({
      evidence: { found: true, sameAddress: true, sameCompany: true },
      result: 'ok',
    }),
    path: async () => {
      const slug = `audit-${randomUUID()}`;
      const file = (
        await db.query(
          `WITH g AS (INSERT INTO garage (id, name, slug)
             VALUES (gen_random_uuid(), 'Audit', $1) RETURNING id)
           INSERT INTO verification_file (id, garage_id, rar_number)
           SELECT gen_random_uuid(), id, 'RAR-1234' FROM g RETURNING id`,
          [slug],
        )
      ).rows[0].id as string;
      await db.query(
        `INSERT INTO verification_check (id, file_id, kind)
         VALUES (gen_random_uuid(), $1, 'rar')`,
        [file],
      );
      return `/api/v1/admin/verification-files/${file}/checks/rar`;
    },
  },
  'PUT /api/v1/admin/verification-files/{id}/presence': {
    body: () => ({}),
    entries: 0,
    path: async () =>
      `/api/v1/admin/verification-files/${await submitted()}/presence`,
  },
  'PUT /api/v1/admin/verification-files/{id}/rar-number': {
    body: () => ({ rarNumber: 'RAR-5678' }),
    path: async () =>
      `/api/v1/admin/verification-files/${await submitted()}/rar-number`,
  },
};

// An active brand of the loader's, and the value an admin edit sends back.
let brandSeen = '';
async function storedBrand() {
  const key = `audit-${randomUUID()}`;
  const row = (
    await db.query(
      `INSERT INTO brand (id, key, name, slug, updated_at)
       VALUES (gen_random_uuid(), $1, $1, $1, now())
       RETURNING id, updated_at`,
      [key],
    )
  ).rows[0] as { id: string; updated_at: Date };
  brandSeen = row.updated_at.toISOString();
  return row.id;
}

// A repair a driver logged on the car they own, and the version an admin's
// correction sends back.
let repairSeen = '';
async function loggedRepair() {
  const owner = await driver();
  const row = (
    await db.query(
      `WITH b AS (INSERT INTO brand (id, key, name, slug, updated_at)
         VALUES (gen_random_uuid(), $2, $2, $2, now()) RETURNING id),
       c AS (INSERT INTO car (id, owner_id, brand_id, model, year, fuel, odometer_km)
         SELECT gen_random_uuid(), $1, id, 'Cooper S', 2019, 'petrol', 82000
         FROM b RETURNING id),
       o AS (INSERT INTO car_ownership (id, car_id, account_id, access, from_date, opened_at)
         SELECT gen_random_uuid(), id, $1, 'owner', current_date, now() FROM c)
       INSERT INTO repair (id, car_id, source, what, garage_name, done_on)
       SELECT gen_random_uuid(), id, 'logged', 'Schimb ulei', 'Garaj Nordic',
         current_date - 1
       FROM c RETURNING id, updated_at`,
      [owner, `audit-${randomUUID()}`],
    )
  ).rows[0] as { id: string; updated_at: Date };
  repairSeen = row.updated_at.toISOString();
  return row.id;
}

// A driver's account for the account actions, suspended when asked.
async function driver(status: 'active' | 'suspended' = 'active') {
  const { id } = await app.get(AccountsService).createAccount({
    consent: CURRENT_CONSENT,
    identity: { method: 'google', subject: `driver-${randomUUID()}` },
    name: 'Radu',
    roles: ['driver'],
  });
  if (status === 'suspended') {
    await db.query(
      `UPDATE account SET status = 'suspended', suspended_reason = 'Cereri false, repetate.'
       WHERE id = $1`,
      [id],
    );
  }
  return id;
}

// A garage's job waiting for an admin's decision, under a name of its own.
async function proposedJob() {
  const name = `Propusă audit ${randomUUID()}`;
  return (
    await db.query(
      `WITH g AS (INSERT INTO garage (id, name, slug)
         VALUES (gen_random_uuid(), 'Audit', $1) RETURNING id)
       INSERT INTO job_type (id, key, name_ro, name_en, status,
         proposed_by_garage_id, updated_at)
       SELECT gen_random_uuid(), $1, $2, $2, 'pending', id, now() FROM g
       RETURNING id`,
      [`audit-${randomUUID()}`, name],
    )
  ).rows[0].id as string;
}

// A garage's file waiting to be opened, or already decided.
async function submitted(status = 'submitted') {
  return (
    await db.query(
      `WITH g AS (INSERT INTO garage (id, name, slug)
         VALUES (gen_random_uuid(), 'Audit', $1) RETURNING id)
       INSERT INTO verification_file (id, garage_id, status)
       SELECT gen_random_uuid(), id, $2::verification_file_status FROM g RETURNING id`,
      [`audit-${randomUUID()}`, status],
    )
  ).rows[0].id as string;
}

// An approved garage's yearly document, uploaded and waiting for an admin.
async function yearlyUpload() {
  return (
    await db.query(
      `WITH g AS (INSERT INTO garage (id, name, slug, status, approved_at)
         VALUES (gen_random_uuid(), 'Audit', $1, 'approved', now()) RETURNING id),
       f AS (INSERT INTO verification_file (id, garage_id, status)
         SELECT gen_random_uuid(), id, 'approved' FROM g RETURNING id)
       INSERT INTO legal_document (verification_file_id, kind, pages, status, issued_on)
       SELECT id, 'onrc_certificate', ARRAY['legal_document/audit/yearly'],
         'in_review', CURRENT_DATE
       FROM f RETURNING id`,
      [`audit-${randomUUID()}`],
    )
  ).rows[0].id as string;
}

// An approved garage's file that a driver's open report put back in review.
async function reported() {
  const file = (
    await db.query(
      `WITH g AS (INSERT INTO garage (id, name, slug, status, approved_at)
         VALUES (gen_random_uuid(), 'Audit', $1, 'approved', now()) RETURNING id)
       INSERT INTO verification_file (id, garage_id, status, reopen_reason, reopened_at)
       SELECT gen_random_uuid(), id, 'in_review', 'garage_report', now() FROM g
       RETURNING id, garage_id`,
      [`audit-${randomUUID()}`],
    )
  ).rows[0] as { garage_id: string; id: string };
  await db.query(
    `INSERT INTO garage_report (garage_id, verification_file_id, reporter_id, text)
     VALUES ($1, $2, $3, 'Prețuri false la manoperă, peste listă.')`,
    [file.garage_id, file.id, admin],
  );
  return file.id;
}

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

// The answer a route owes: the status its fixture names, or else a 2xx.
const answered = (status: number, answers?: number) =>
  answers === undefined ? status >= 200 && status <= 299 : status === answers;

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
  if (!answered(res.status, fixture?.answers)) {
    return `${route}: answered ${res.status}`;
  }
  const expected =
    fixture?.entries !== undefined
      ? gained === fixture.entries
      : changes
        ? gained >= 1
        : gained === 0;
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
}, TURN_WAIT_MS);

afterAll(async () => {
  // The platform rule fixture switched maintenance on; other suites share the database.
  await db.query(
    `UPDATE platform_rule SET value = 'false'::jsonb
     WHERE key = 'maintenance_mode'`,
  );
  await app.get<Maintenance>(MAINTENANCE, { strict: false }).set(false);
  // The copy voice fixture switched voice 5 off; the home page shares it.
  await db.query(ALL_VOICES_ON);
  await clearRequests();
  await db.end();
  await api.stop();
});

// @traces 003-FR-020
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
