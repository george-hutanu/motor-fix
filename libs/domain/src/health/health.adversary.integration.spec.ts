import { type DynamicModule, INestApplication, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { HealthModule } from './health.module';
import { READINESS } from './health.service';
import { S3TestStore } from '../storage/s3-test-store';
import { StorageModule } from '../storage/storage.module';

const databaseUrl =
  process.env['DATABASE_URL'] ?? 'postgresql://localhost:5432/postgres';
const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
const store = new S3TestStore();

@Module({})
class Consumer {}

const flag = { ready: false };
const switching: DynamicModule = {
  module: Consumer,
  providers: [{ provide: READINESS, useValue: { ready: () => flag.ready } }],
};

describe('health follows the consumer as it changes', () => {
  let app: INestApplication;

  beforeAll(() => store.start());
  afterAll(() => store.stop());
  beforeEach(async () => {
    flag.ready = false;
    const moduleRef = await Test.createTestingModule({
      imports: [
        switching,
        StorageModule.register(store.env()),
        HealthModule.register({ databaseUrl, redisUrl, version: 'abc123' }),
      ],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
  });
  afterEach(() => app.close());

  // @traces 520-FR-004
  it('turns from 503 to 200 on the next read once the consumer starts, then back', async () => {
    const server = app.getHttpServer();
    const down = { postgres: 'ok', redis: 'ok', storage: 'ok' };

    for (let i = 0; i < 3; i++) {
      const res = await request(server).get('/health/ready').expect(503);
      expect(res.body).toEqual({
        checks: down,
        status: 'error',
        version: 'abc123',
      });
    }
    flag.ready = true;
    await request(server).get('/health/ready').expect(200);
    flag.ready = false;
    await request(server).get('/health/ready').expect(503);
  });

  // @traces 520-FR-004
  it('keeps the live probe green while the consumer is off', async () => {
    await request(app.getHttpServer())
      .get('/health/live')
      .expect(200, { status: 'ok' });
  });
});
