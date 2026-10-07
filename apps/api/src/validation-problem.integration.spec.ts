// @traces 472-FR-001 472-FR-002
import { randomUUID } from 'node:crypto';

import { CURRENT_CONSENT, readEnv, STORAGE_ENV } from '@motor-fix/contracts';
import { AccountsService, signAccessToken } from '@motor-fix/domain';
import { databaseTurn, S3TestStore } from '@motor-fix/domain/testing';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from './app.module';
import { configureApp } from './bootstrap';

// The domain specs run these routes without ProblemFilter, so they can check
// only the status; here the app is set up as in production.
const env = {
  APP_ENV: 'test',
  AUTH_TOKEN_SECRET: 'test-secret',
  DATABASE_URL:
    process.env['DATABASE_URL'] ?? 'postgresql://localhost:5432/postgres',
  REDIS_URL: process.env['REDIS_URL'] ?? 'redis://localhost:6379',
  RELEASE_SHA: 'abc123',
} as const;
const store = new S3TestStore();
// The domain specs empty the account tables meanwhile: wait for our turn.
const turn = databaseTurn(env.DATABASE_URL);

let app: INestApplication;
let bearer: string;

beforeAll(async () => {
  await turn.take();
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
  const { id } = await app.get(AccountsService).createAccount({
    consent: CURRENT_CONSENT,
    identity: { method: 'google', subject: `garage-${randomUUID()}` },
    name: 'Ion',
    roles: ['garage', 'driver'],
  });
  bearer = `Bearer ${signAccessToken({ accountId: id, role: 'garage' }, env.AUTH_TOKEN_SECRET, Date.now())}`;
}, 120_000);

afterAll(async () => {
  await app.close();
  await store.stop();
  await turn.release();
});

describe('a signed-in request that fails validation', () => {
  it('answers validation_failed on the audit history', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/audit-history')
      .query({ limit: '100' })
      .set('Authorization', bearer);

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'validation_failed', status: 400 });
  });

  it('answers validation_failed on the role switch', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/roles/switch')
      .send({ role: 'owner' })
      .set('Authorization', bearer);

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'validation_failed', status: 400 });
  });
});
