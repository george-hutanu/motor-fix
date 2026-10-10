import { createServer, type Server, type Socket } from 'node:net';

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { HealthModule } from './health.module';
import { S3TestStore } from '../storage/s3-test-store';
import { StorageModule } from '../storage/storage.module';
import { timersArmedBy } from '../waits.testing';

const databaseUrl =
  process.env['DATABASE_URL'] ?? 'postgresql://localhost:5432/postgres';
const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
const deadUrl = (scheme: string) => `${scheme}://localhost:1/x`;
const store = new S3TestStore();

async function start(
  urls: { databaseUrl: string; redisUrl: string },
  storageEndpoint = store.env().STORAGE_ENDPOINT,
) {
  const moduleRef = await Test.createTestingModule({
    imports: [
      StorageModule.register({
        ...store.env(),
        STORAGE_ENDPOINT: storageEndpoint,
      }),
      HealthModule.register({ ...urls, version: 'abc123' }),
    ],
  }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  await app.init();
  return app;
}

// @traces 251-FR-001
describe('health', () => {
  let app: INestApplication;

  beforeAll(() => store.start());
  afterAll(() => store.stop());
  afterEach(() => app.close());

  it('answers live without touching PostgreSQL, Redis or storage', async () => {
    app = await start(
      { databaseUrl: deadUrl('postgresql'), redisUrl: deadUrl('redis') },
      deadUrl('http'),
    );

    await request(app.getHttpServer())
      .get('/health/live')
      .expect(200, { status: 'ok' });
  });

  it('is ready when PostgreSQL, Redis and storage all answer', async () => {
    app = await start({ databaseUrl, redisUrl });

    await request(app.getHttpServer())
      .get('/health/ready')
      .expect(200, {
        checks: { postgres: 'ok', redis: 'ok', storage: 'ok' },
        status: 'ok',
        version: 'abc123',
      });
  });

  it('names Redis when Redis is down', async () => {
    app = await start({ databaseUrl, redisUrl: deadUrl('redis') });

    await request(app.getHttpServer())
      .get('/health/ready')
      .expect(503, {
        checks: { postgres: 'ok', redis: 'error', storage: 'ok' },
        status: 'error',
        version: 'abc123',
      });
  });

  it('names PostgreSQL when PostgreSQL is down', async () => {
    app = await start({ databaseUrl: deadUrl('postgresql'), redisUrl });

    const res = await request(app.getHttpServer()).get('/health/ready');

    expect(res.status).toBe(503);
    expect(res.body.checks).toEqual({
      postgres: 'error',
      redis: 'ok',
      storage: 'ok',
    });
  });

  it('names storage when the store is down', async () => {
    app = await start({ databaseUrl, redisUrl }, deadUrl('http'));

    await request(app.getHttpServer())
      .get('/health/ready')
      .expect(503, {
        checks: { postgres: 'ok', redis: 'ok', storage: 'error' },
        status: 'error',
        version: 'abc123',
      });
  });

  describe('with a dependency that accepts connections and never answers', () => {
    let silent: Server;
    let port: number;
    const sockets: Socket[] = [];

    beforeEach(async () => {
      silent = createServer((socket) => sockets.push(socket));
      await new Promise<void>((resolve) => silent.listen(0, resolve));
      port = (silent.address() as { port: number }).port;
    });

    afterEach(() => {
      for (const socket of sockets) socket.destroy();
      return new Promise<void>((resolve) => silent.close(() => resolve()));
    });

    it('gives up after 2 seconds and answers 503', async () => {
      app = await start({ databaseUrl, redisUrl: `redis://localhost:${port}` });
      const { log, value: res } = await timersArmedBy(
        'health.service',
        async () => request(app.getHttpServer()).get('/health/ready'),
      );

      expect(res.status).toBe(503);
      expect(res.body.checks.redis).toBe('error');
      // The check's own 2-second limit is what ended the wait.
      expect(log).toContain('fired 2000');
    });

    it('gives up on a silent store after 2 seconds and names storage', async () => {
      app = await start({ databaseUrl, redisUrl }, `http://127.0.0.1:${port}`);
      const { log, value: res } = await timersArmedBy(
        ['health.service', 'storage.service'],
        async () => request(app.getHttpServer()).get('/health/ready'),
      );

      expect(res.status).toBe(503);
      expect(res.body.checks).toEqual({
        postgres: 'ok',
        redis: 'ok',
        storage: 'error',
      });
      // A 2-second limit, the check's or the store's own, ended the wait.
      expect(log).toContain('fired 2000');
    });
  });
});
