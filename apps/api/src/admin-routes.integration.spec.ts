import { randomUUID } from 'node:crypto';

import { CURRENT_CONSENT } from '@motor-fix/contracts';
import {
  AccountsService,
  MAINTENANCE,
  type Maintenance,
  signAccessToken,
} from '@motor-fix/domain';
import type { INestApplication } from '@nestjs/common';
import { Client } from 'pg';
import request from 'supertest';

import { apiBoot, TEST_TOKEN_SECRET } from './api-boot.testing';
import { openApiDocument } from './bootstrap';

const api = apiBoot();

const KNOWN = [
  'GET /api/v1/admin/overview',
  'GET /api/v1/admin/platform-rules',
  'PATCH /api/v1/admin/platform-rules/{key}',
  'POST /api/v1/admin/live/test',
  'POST /api/v1/admin/news',
  'POST /api/v1/admin/notifications/test',
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
}, 120_000);

afterAll(() => api.stop());

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

    const res = await call(
      'get',
      '/api/v1/admin/overview',
      bearer(id, 'admin'),
    );

    expect([res.status, res.body?.code]).toEqual([403, 'account_suspended']);
  });
});

describe('the admin overview', () => {
  it('answers an admin the garages waiting and the platform figures, every one a count', async () => {
    const res = await call(
      'get',
      '/api/v1/admin/overview',
      bearer(await account('admin'), 'admin'),
    );

    expect(res.status).toBe(200);
    const required = [
      'activeDrivers',
      'garagesApprovedThisMonth',
      'garagesListed',
      'garagesWaiting',
    ];
    const fields = Object.keys(res.body);
    expect(fields).toEqual(expect.arrayContaining(required));
    expect(
      fields.filter(
        (f) => !required.includes(f) && f !== 'activeDriversMonthStart',
      ),
    ).toEqual([]);
    for (const value of Object.values(res.body)) {
      expect(Number.isInteger(value) && (value as number) >= 0).toBe(true);
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
