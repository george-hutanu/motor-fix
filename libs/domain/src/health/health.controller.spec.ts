import { createServer, type Server, type Socket } from 'node:net';

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { HealthModule } from './health.module';

const databaseUrl =
  process.env['DATABASE_URL'] ?? 'postgresql://localhost:5432/postgres';
const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
const deadUrl = (scheme: string) => `${scheme}://localhost:1/x`;

async function start(urls: { databaseUrl: string; redisUrl: string }) {
  const moduleRef = await Test.createTestingModule({
    imports: [HealthModule.register({ ...urls, version: 'abc123' })],
  }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  await app.init();
  return app;
}

describe('health', () => {
  let app: INestApplication;

  afterEach(() => app.close());

  it('answers live without touching PostgreSQL or Redis', async () => {
    app = await start({
      databaseUrl: deadUrl('postgresql'),
      redisUrl: deadUrl('redis'),
    });

    await request(app.getHttpServer())
      .get('/health/live')
      .expect(200, { status: 'ok' });
  });

  it('is ready when PostgreSQL and Redis both answer', async () => {
    app = await start({ databaseUrl, redisUrl });

    await request(app.getHttpServer())
      .get('/health/ready')
      .expect(200, {
        checks: { postgres: 'ok', redis: 'ok' },
        status: 'ok',
        version: 'abc123',
      });
  });

  it('names Redis when Redis is down', async () => {
    app = await start({ databaseUrl, redisUrl: deadUrl('redis') });

    await request(app.getHttpServer())
      .get('/health/ready')
      .expect(503, {
        checks: { postgres: 'ok', redis: 'error' },
        status: 'error',
        version: 'abc123',
      });
  });

  it('names PostgreSQL when PostgreSQL is down', async () => {
    app = await start({ databaseUrl: deadUrl('postgresql'), redisUrl });

    const res = await request(app.getHttpServer()).get('/health/ready');

    expect(res.status).toBe(503);
    expect(res.body.checks).toEqual({ postgres: 'error', redis: 'ok' });
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
      const started = Date.now();

      const res = await request(app.getHttpServer()).get('/health/ready');

      expect(res.status).toBe(503);
      expect(res.body.checks.redis).toBe('error');
      expect(Date.now() - started).toBeLessThan(3000);
    });
  });
});
