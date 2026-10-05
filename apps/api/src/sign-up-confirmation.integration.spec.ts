import { randomUUID } from 'node:crypto';

import { readEnv, STORAGE_ENV } from '@motor-fix/contracts';
import { NotificationsService } from '@motor-fix/domain';
import { databaseTurn, S3TestStore } from '@motor-fix/domain/testing';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from './app.module';
import { configureApp } from './bootstrap';

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
const webUrl = process.env['PUBLIC_WEB_URL'];

let app: INestApplication;
let sent: jest.SpyInstance;

beforeAll(async () => {
  await turn.take();
  process.env['PUBLIC_WEB_URL'] = 'https://motorfix.test';
  await store.start();
  const config = readEnv(
    ['DATABASE_URL', 'REDIS_URL', 'AUTH_TOKEN_SECRET', ...STORAGE_ENV],
    { ...env, ...store.env() },
  );
  sent = jest
    .spyOn(NotificationsService.prototype, 'sendAccountEmail')
    .mockResolvedValue(undefined);
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.register(config)],
  }).compile();
  app = moduleRef.createNestApplication({ bufferLogs: true });
  configureApp(app, config);
  await app.init();
}, 120_000);

afterAll(async () => {
  await app.close();
  await store.stop();
  sent.mockRestore();
  await turn.release();
  if (webUrl === undefined) delete process.env['PUBLIC_WEB_URL'];
  else process.env['PUBLIC_WEB_URL'] = webUrl;
});

describe('signing up through the api', () => {
  it('sends the new address a confirmation link to the web app', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/sign-up')
      .send({
        email: `confirm-${randomUUID()}@example.test`,
        language: 'en',
        name: 'Andrei Marin',
        password: 'o-parola-lunga',
      })
      .expect(201);
    expect(sent).toHaveBeenCalledTimes(1);
    expect(sent.mock.calls[0]?.[0]).toMatchObject({
      link: expect.stringMatching(
        /^https:\/\/motorfix\.test\/en\/confirm-email\/[A-Za-z0-9_-]{43}$/,
      ),
      purpose: 'email_check',
    });
  });
});
