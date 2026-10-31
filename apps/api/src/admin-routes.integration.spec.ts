import { randomUUID } from 'node:crypto';

import { CURRENT_CONSENT } from '@motor-fix/contracts';
import {
  AccountsService,
  ActorGuard,
  MAINTENANCE,
  type Maintenance,
  signAccessToken,
} from '@motor-fix/domain';
import { TURN_WAIT_MS } from '@motor-fix/domain/testing';
import type { HttpException, INestApplication } from '@nestjs/common';
import { Client } from 'pg';
import request from 'supertest';

import { apiBoot, TEST_TOKEN_SECRET } from './api-boot.testing';
import { openApiDocument } from './bootstrap';

const api = apiBoot();

const KNOWN = [
  'GET /api/v1/admin/accounts',
  'GET /api/v1/admin/accounts/summary',
  // @traces 105-FR-019
  'GET /api/v1/admin/brands',
  // @traces 103-FR-002 404-FR-006
  'GET /api/v1/admin/demand',
  // @traces 106-FR-008
  'GET /api/v1/admin/demand/supply',
  // @traces 066-FR-005
  'GET /api/v1/admin/garages',
  'GET /api/v1/admin/garages/summary',
  'GET /api/v1/admin/growth',
  'GET /api/v1/admin/overview',
  'GET /api/v1/admin/platform-rule-changes',
  'GET /api/v1/admin/platform-rules',
  // @traces 177-FR-001 177-FR-018
  'GET /api/v1/admin/review-reports',
  // @traces 298-FR-002
  'GET /api/v1/admin/system-log',
  'GET /api/v1/admin/verification-files/{id}/documents/{documentId}/pages/{n}/download-url',
  'GET /api/v1/admin/verification-queue',
  'PATCH /api/v1/admin/brands/{id}',
  'PATCH /api/v1/admin/platform-rules/{key}',
  'POST /api/v1/admin/brands',
  'POST /api/v1/admin/garages/{id}/suspend',
  'POST /api/v1/admin/live/test',
  'POST /api/v1/admin/news',
  'POST /api/v1/admin/platform-rule-changes',
  'POST /api/v1/admin/platform-rule-changes/{id}/approve',
  'POST /api/v1/admin/platform-rule-changes/{id}/cancel',
  'POST /api/v1/admin/platform-rule-changes/{id}/refuse',
  'POST /api/v1/admin/notifications/test',
  // @traces 306-FR-006
  'POST /api/v1/admin/verification-files/{id}/decision',
  'POST /api/v1/admin/verification-files/{id}/reopen',
  'PUT /api/v1/admin/verification-files/{id}/checks/{kind}',
];
const NON_ADMIN = ['driver', 'garage', 'receptionist', 'mechanic'] as const;
const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;
type Method = (typeof METHODS)[number];
type Role = (typeof NON_ADMIN)[number] | 'admin';

let app: INestApplication;
let routes: { method: Method; path: string }[];

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
  `Bearer ${signAccessToken({ accountId, role }, TEST_TOKEN_SECRET, Date.now())}`;

const call = (method: Method, path: string, authorization?: string) => {
  const req = request(app.getHttpServer())[method](path).send({});
  return authorization ? req.set('Authorization', authorization) : req;
};

beforeAll(async () => {
  app = await api.start();
  routes = Object.entries(openApiDocument(app).paths)
    .filter(([path]) => path.startsWith('/api/v1/admin/'))
    .flatMap(([path, item]) =>
      METHODS.filter((method) => method in item).map((method) => ({
        method,
        path,
      })),
    );
}, TURN_WAIT_MS);

afterAll(() => api.stop());

// @traces 165-FR-004
describe('the admin routes', () => {
  it('include the overview and the admin tools', () => {
    const listed = routes.map((r) => `${r.method.toUpperCase()} ${r.path}`);

    expect(listed).toEqual(expect.arrayContaining(KNOWN));
  });

  it.each(NON_ADMIN)(
    'answer not_found to a %s, before reading any body',
    async (role) => {
      const authorization = bearer(await account(role), role);
      const answers: string[] = [];
      for (const { method, path } of routes) {
        const res = await call(method, path, authorization);
        answers.push(`${method} ${path} ${res.status} ${res.body?.code}`);
      }

      expect(answers).toEqual(
        routes.map(({ method, path }) => `${method} ${path} 404 not_found`),
      );
    },
  );

  it('answer sign_in_required without a session', async () => {
    for (const { method, path } of routes) {
      const res = await call(method, path);

      expect([path, res.status, res.body?.code]).toEqual([
        path,
        401,
        'sign_in_required',
      ]);
    }
  });

  // @traces 165-FR-002
  it('admit an active admin on every operation', async () => {
    const decide = jest.spyOn(
      app.get(ActorGuard, { strict: false }),
      'canActivate',
    );
    const authorization = bearer(await account('admin'), 'admin');
    const answers: string[] = [];
    try {
      for (const { method, path } of routes) {
        decide.mockClear();
        const res = await call(method, path, authorization);
        const [guarded] = decide.mock.results;
        const decision = guarded
          ? await (guarded.value as Promise<boolean>).then(
              (admitted) => (admitted ? 'admitted' : 'refused'),
              (refusal: HttpException) =>
                (refusal.getResponse() as { code?: string }).code ??
                'not_found',
            )
          : 'unguarded';
        const status = [401, 403].includes(res.status)
          ? `${res.status} ${res.body?.code}`
          : 'open';
        answers.push(`${method} ${path} ${decision} ${status}`);
      }
    } finally {
      decide.mockRestore();
    }

    // The route's own rule, after the access check admits: only the driver
    // deletes a logged repair.
    const ownRefusals: Record<string, string> = {
      'delete /api/v1/admin/repairs/{id}': '403 forbidden',
    };
    expect(answers).toEqual(
      routes.map(({ method, path }) => {
        const key = `${method} ${path}`;
        return `${key} admitted ${ownRefusals[key] ?? 'open'}`;
      }),
    );
  });

  // @traces 165-FR-003
  it('answer account_suspended to a suspended admin', async () => {
    const id = await account('admin');
    const db = new Client({
      connectionString:
        process.env['DATABASE_URL'] ?? 'postgresql://localhost:5432/postgres',
    });
    await db.connect();
    try {
      await db.query("UPDATE account SET status = 'suspended' WHERE id = $1", [
        id,
      ]);
    } finally {
      await db.end();
    }

    const answers: unknown[] = [];
    for (const path of ['/api/v1/admin/overview', '/api/v1/admin/growth']) {
      const res = await call('get', path, bearer(id, 'admin'));
      answers.push([path, res.status, res.body?.code]);
    }

    expect(answers).toEqual([
      ['/api/v1/admin/overview', 403, 'account_suspended'],
      ['/api/v1/admin/growth', 403, 'account_suspended'],
    ]);
  });
});

describe('the admin overview', () => {
  it('answers an admin the garages waiting and the platform figures, every one a count, and the cities to choose', async () => {
    const res = await call(
      'get',
      '/api/v1/admin/overview',
      bearer(await account('admin'), 'admin'),
    );

    expect(res.status).toBe(200);
    const required = [
      'activeDrivers',
      'bookings',
      'garagesApprovedThisMonth',
      'garagesListed',
      'garagesWaiting',
      'reportsOverdue',
      'reportsPending',
      'requestsSent',
    ];
    const optional = ['activeDriversMonthStart', 'answerRate', 'cities'];
    const fields = Object.keys(res.body);
    expect(fields).toEqual(expect.arrayContaining(required));
    expect(
      fields.filter((f) => !required.includes(f) && !optional.includes(f)),
    ).toEqual([]);
    const { cities, ...counts } = res.body;
    for (const value of Object.values(counts)) {
      expect(Number.isInteger(value) && (value as number) >= 0).toBe(true);
    }
    expect(cities[0]).toMatchObject({ key: 'all' });
    for (const city of cities) {
      expect(Object.keys(city).sort()).toEqual(['garages', 'key', 'name']);
      expect(Number.isInteger(city.garages) && city.garages >= 0).toBe(true);
    }
  });

  it('stays open to an admin while the platform is in maintenance', async () => {
    const maintenance = app.get<Maintenance>(MAINTENANCE, { strict: false });
    const on = jest.spyOn(maintenance, 'on').mockResolvedValue(true);
    try {
      const res = await call(
        'get',
        '/api/v1/admin/overview',
        bearer(await account('admin'), 'admin'),
      );

      expect(res.status).toBe(200);
    } finally {
      on.mockRestore();
    }
  });
});

describe('the admin growth', () => {
  it('answers an admin twelve months, each a month and its counts only', async () => {
    const res = await call(
      'get',
      '/api/v1/admin/growth',
      bearer(await account('admin'), 'admin'),
    );

    expect(res.status).toBe(200);
    expect(Object.keys(res.body)).toEqual(['months']);
    expect(res.body.months).toHaveLength(12);
    for (const entry of res.body.months) {
      const { month, ...counts } = entry;
      expect(month).toMatch(/^\d{4}-\d{2}$/);
      for (const [field, value] of Object.entries(counts)) {
        expect(['activeDrivers', 'garagesListed']).toContain(field);
        expect(Number.isInteger(value) && (value as number) >= 0).toBe(true);
      }
    }
    expect(Object.keys(res.body.months.at(-1)).sort()).toEqual([
      'activeDrivers',
      'garagesListed',
      'month',
    ]);
  });
});
