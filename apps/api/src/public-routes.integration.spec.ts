import { readEnv, STORAGE_ENV } from '@motor-fix/contracts';
import { S3TestStore } from '@motor-fix/domain/testing';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from './app.module';
import { configureApp, openApiDocument } from './bootstrap';

const env = {
  APP_ENV: 'test',
  AUTH_TOKEN_SECRET: 'test-secret',
  DATABASE_URL:
    process.env['DATABASE_URL'] ?? 'postgresql://localhost:5432/postgres',
  REDIS_URL: process.env['REDIS_URL'] ?? 'redis://localhost:6379',
  RELEASE_SHA: 'abc123',
} as const;
const store = new S3TestStore();

const PUBLIC = [
  'GET /health/live',
  'GET /health/ready',
  'POST /api/v1/auth/confirm-email',
  'POST /api/v1/auth/confirm-email/resend',
  'POST /api/v1/auth/password-reset',
  'POST /api/v1/auth/password-reset/check',
  'POST /api/v1/auth/password-reset/complete',
  'POST /api/v1/auth/refresh',
  'POST /api/v1/auth/roles/switch',
  'POST /api/v1/auth/sign-in',
  'POST /api/v1/auth/sign-out',
  'POST /api/v1/auth/sign-out-everywhere',
  'POST /api/v1/auth/sign-up',
  'POST /api/v1/notification-preferences/unsubscribe',
];

const SOME_ID = '00000000-0000-4000-8000-000000000000';
const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

let app: INestApplication;
let routes: { method: (typeof METHODS)[number]; path: string }[];

beforeAll(async () => {
  await store.start();
  const config = readEnv(
    ['DATABASE_URL', 'REDIS_URL', 'AUTH_TOKEN_SECRET', ...STORAGE_ENV],
    { ...env, ...store.env() },
  );
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.register(config)],
  }).compile();
  app = moduleRef.createNestApplication({ bufferLogs: true });
  configureApp(app, config);
  await app.init();
  routes = Object.entries(openApiDocument(app).paths).flatMap(([path, item]) =>
    METHODS.filter((method) => method in item).map((method) => ({
      method,
      path: path.replace(/\{[^}]+\}/g, SOME_ID),
    })),
  );
});

afterAll(async () => {
  await app.close();
  await store.stop();
});

const call = (
  method: (typeof METHODS)[number],
  path: string,
  authorization?: string,
) => {
  const req = request(app.getHttpServer())[method](path).send({});
  return authorization ? req.set('Authorization', authorization) : req;
};

describe('routes without a session', () => {
  it('lists more routes than the public ones, so the check means something', () => {
    expect(routes.length).toBeGreaterThan(PUBLIC.length);
  });

  it('refuses every route but the public list with sign_in_required', async () => {
    const open: string[] = [];
    for (const { method, path } of routes) {
      const res = await call(method, path);
      // The renewal refuses a missing cookie with the same code, but it is its
      // own answer: it clears the cookie, which the guard never does.
      const byGuard =
        res.status === 401 &&
        res.body?.code === 'sign_in_required' &&
        !res.headers['set-cookie'];
      if (!byGuard) open.push(`${method.toUpperCase()} ${path}`);
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
});
