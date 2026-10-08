import { randomUUID } from 'node:crypto';

import { CURRENT_CONSENT } from '@motor-fix/contracts';
import { AccountsService, signAccessToken } from '@motor-fix/domain';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { apiBoot, TEST_TOKEN_SECRET } from './api-boot.testing';
import { openApiDocument } from './bootstrap';

const api = apiBoot();

const PUBLIC = [
  'DELETE /api/v1/listing-drafts/00000000-0000-4000-8000-000000000000/photos/00000000-0000-4000-8000-000000000000',
  'GET /api/v1/auth/oauth/apple',
  'GET /api/v1/auth/oauth/google',
  'GET /api/v1/auth/oauth/google/callback',
  'GET /api/v1/auth/oauth/pending',
  'GET /api/v1/auth/providers',
  'GET /api/v1/brands',
  'GET /api/v1/brands/popular',
  'GET /api/v1/garages/00000000-0000-4000-8000-000000000000',
  'GET /api/v1/home',
  'GET /api/v1/job-types',
  'GET /api/v1/listing-drafts/00000000-0000-4000-8000-000000000000/photos',
  'GET /api/v1/listing-drafts/current',
  'GET /api/v1/live/public',
  'GET /api/v1/public-holidays',
  'GET /api/v1/search/garages',
  'GET /health/live',
  'GET /health/ready',
  'PATCH /api/v1/listing-drafts/00000000-0000-4000-8000-000000000000',
  'POST /api/v1/auth/confirm-email',
  'POST /api/v1/auth/confirm-email/resend',
  'POST /api/v1/auth/oauth/apple/callback',
  'POST /api/v1/auth/oauth/complete',
  'POST /api/v1/auth/password-reset',
  'POST /api/v1/auth/password-reset/check',
  'POST /api/v1/auth/password-reset/complete',
  'POST /api/v1/auth/phone-code',
  'POST /api/v1/auth/phone-sign-in',
  'POST /api/v1/auth/refresh',
  'POST /api/v1/auth/roles/switch',
  'POST /api/v1/auth/sign-in',
  'POST /api/v1/auth/sign-out',
  'POST /api/v1/auth/sign-out-everywhere',
  'POST /api/v1/auth/sign-up',
  'POST /api/v1/invites/check',
  'POST /api/v1/listing-drafts',
  'POST /api/v1/listing-drafts/00000000-0000-4000-8000-000000000000/continue-link',
  'POST /api/v1/listing-drafts/00000000-0000-4000-8000-000000000000/photos',
  'POST /api/v1/listing-drafts/00000000-0000-4000-8000-000000000000/photos/upload-url',
  'POST /api/v1/notification-preferences/unsubscribe',
];

const SOME_ID = '00000000-0000-4000-8000-000000000000';
const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

let app: INestApplication;
let routes: { method: (typeof METHODS)[number]; path: string }[];
let accountId: string;

beforeAll(async () => {
  app = await api.start();
  routes = Object.entries(openApiDocument(app).paths).flatMap(([path, item]) =>
    METHODS.filter((method) => method in item).map((method) => ({
      method,
      path: path.replace(/\{[^}]+\}/g, SOME_ID),
    })),
  );
  ({ id: accountId } = await app.get(AccountsService).createAccount({
    consent: CURRENT_CONSENT,
    identity: { method: 'google', subject: `driver-${randomUUID()}` },
    name: 'Andrei',
    roles: ['driver'],
  }));
}, 120_000);

afterAll(() => api.stop());

// The renewal refuses a missing cookie with the same code, but it is its own
// answer: it clears the cookie, which the guard never does.
const byGuard = (res: request.Response) =>
  res.status === 401 &&
  res.body?.code === 'sign_in_required' &&
  !res.headers['set-cookie'];

const call = (
  method: (typeof METHODS)[number],
  path: string,
  authorization?: string,
) => {
  // An open public stream never ends; a malformed query answers at once.
  const target = path.endsWith('/live/public') ? `${path}?garages=x` : path;
  const req = request(app.getHttpServer())[method](target).send({});
  return authorization ? req.set('Authorization', authorization) : req;
};

describe('routes without a session', () => {
  it('lists more routes than the public ones, so the check means something', () => {
    expect(routes.length).toBeGreaterThan(PUBLIC.length);
  });

  it('refuses every route but the public list with sign_in_required', async () => {
    const open: string[] = [];
    for (const { method, path } of routes) {
      if (!byGuard(await call(method, path))) {
        open.push(`${method.toUpperCase()} ${path}`);
      }
    }

    expect(open.sort()).toEqual(PUBLIC);
  });

  it.each([
    ['a malformed token', 'Bearer not-a-token'],
    ['a token signed with another key', 'Bearer eyJhbGciOiJIUzI1NiJ9.e30.x'],
    ['another scheme', 'Basic dXNlcjpwYXNz'],
  ])('refuses %s the same way', async (_, authorization) => {
    for (const { method, path } of routes) {
      if (PUBLIC.includes(`${method.toUpperCase()} ${path}`)) continue;
      const res = await call(method, path, authorization);

      expect([path, res.status, res.body?.code]).toEqual([
        path,
        401,
        'sign_in_required',
      ]);
    }
  });

  it('refuses an expired token for a real account on every gated route', async () => {
    const sign = (now: number) =>
      `Bearer ${signAccessToken({ accountId, role: 'driver' }, TEST_TOKEN_SECRET, now)}`;
    expect((await call('get', '/api/v1/me', sign(Date.now()))).status).toBe(
      200,
    );

    const expired = sign(Date.now() - 24 * 60 * 60 * 1000);
    const honoured: string[] = [];
    for (const { method, path } of routes) {
      const route = `${method.toUpperCase()} ${path}`;
      if (PUBLIC.includes(route)) continue;
      if (!byGuard(await call(method, path, expired))) honoured.push(route);
    }

    expect(honoured).toEqual([]);
  });
});
