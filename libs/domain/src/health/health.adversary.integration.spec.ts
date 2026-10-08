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
  version = 'abc123',
  storageEndpoint = store.env().STORAGE_ENDPOINT,
) {
  const moduleRef = await Test.createTestingModule({
    imports: [
      StorageModule.register({
        ...store.env(),
        STORAGE_ENDPOINT: storageEndpoint,
      }),
      HealthModule.register({ ...urls, version }),
    ],
  }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  await app.init();
  return app;
}

describe('health under hostile conditions', () => {
  let app: INestApplication;

  beforeAll(() => store.start());
  afterAll(() => store.stop());
  afterEach(() => app.close());

  it('answers 404 to a POST on the live path', async () => {
    app = await start({ databaseUrl, redisUrl });

    await request(app.getHttpServer()).post('/health/live').expect(404);
  });

  it('answers 404 to a POST on the ready path', async () => {
    app = await start({ databaseUrl, redisUrl });

    await request(app.getHttpServer()).post('/health/ready').expect(404);
  });

  it('answers ready as JSON with the documented keys only', async () => {
    app = await start({ databaseUrl, redisUrl });

    const res = await request(app.getHttpServer()).get('/health/ready');

    expect(res.headers['content-type']).toContain('application/json');
    expect(Object.keys(res.body).sort()).toEqual([
      'checks',
      'status',
      'version',
    ]);
    expect(Object.keys(res.body.checks).sort()).toEqual([
      'postgres',
      'redis',
      'storage',
    ]);
  });

  it('reports every dependency as error when all are down', async () => {
    app = await start(
      { databaseUrl: deadUrl('postgresql'), redisUrl: deadUrl('redis') },
      'abc123',
      deadUrl('http'),
    );

    const res = await request(app.getHttpServer()).get('/health/ready');

    expect(res.status).toBe(503);
    expect(res.body).toEqual({
      checks: { postgres: 'error', redis: 'error', storage: 'error' },
      status: 'error',
      version: 'abc123',
    });
  });

  it('answers 503 rather than 500 when the connection strings are garbage', async () => {
    app = await start({ databaseUrl: 'not a url', redisUrl: '%%%' });

    const res = await request(app.getHttpServer()).get('/health/ready');

    expect(res.status).toBe(503);
    expect(res.body.checks).toEqual({
      postgres: 'error',
      redis: 'error',
      storage: 'ok',
    });
  });

  it('answers 503 rather than 500 when the storage endpoint is garbage', async () => {
    app = await start({ databaseUrl, redisUrl }, 'abc123', 'not a url');

    const res = await request(app.getHttpServer()).get('/health/ready');

    expect(res.status).toBe(503);
    expect(res.body.checks).toEqual({
      postgres: 'ok',
      redis: 'ok',
      storage: 'error',
    });
  });

  it('answers 503 for a bucket that does not exist', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        StorageModule.register({ ...store.env(), STORAGE_BUCKET: 'missing' }),
        HealthModule.register({ databaseUrl, redisUrl, version: 'abc123' }),
      ],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.init();

    const res = await request(app.getHttpServer()).get('/health/ready');

    expect(res.status).toBe(503);
    expect(res.body.checks.storage).toBe('error');
  });

  it('answers 503 for a database that does not exist', async () => {
    const missing = databaseUrl.replace(/\/[^/]*$/, '/no_such_db_adversary');
    app = await start({ databaseUrl: missing, redisUrl });

    const res = await request(app.getHttpServer()).get('/health/ready');

    expect(res.status).toBe(503);
    expect(res.body.checks).toEqual({
      postgres: 'error',
      redis: 'ok',
      storage: 'ok',
    });
  });

  it('answers 503 for wrong credentials without leaking them', async () => {
    const url = new URL(databaseUrl);
    url.username = 'nobody';
    url.password = 'hunter2-wrong';
    app = await start({ databaseUrl: url.toString(), redisUrl });

    const res = await request(app.getHttpServer()).get('/health/ready');

    expect(res.status).toBe(503);
    expect(res.text).not.toContain('hunter2');
  });

  it('echoes the version verbatim, including unicode', async () => {
    app = await start({ databaseUrl, redisUrl }, 'ß-✓-"quoted"');

    const res = await request(app.getHttpServer()).get('/health/ready');

    expect(res.body.version).toBe('ß-✓-"quoted"');
  });

  it('gives the same answer on repeated and concurrent calls', async () => {
    app = await start({ databaseUrl, redisUrl });
    const http = request(app.getHttpServer());
    const first = await http.get('/health/ready');

    const many = await Promise.all(
      Array.from({ length: 40 }, () => http.get('/health/ready')),
    );

    for (const res of many) {
      expect(res.status).toBe(200);
      expect(res.body).toEqual(first.body);
    }
  });

  it('keeps answering after a failed check', async () => {
    app = await start({ databaseUrl, redisUrl: deadUrl('redis') });
    const http = request(app.getHttpServer());

    await http.get('/health/ready').expect(503);
    await http.get('/health/ready').expect(503);
    await http.get('/health/live').expect(200, { status: 'ok' });
  });

  describe('with dependencies that accept and never answer', () => {
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

    it('limits PostgreSQL to 2 seconds as well', async () => {
      app = await start({
        databaseUrl: `postgresql://localhost:${port}/x`,
        redisUrl,
      });
      const { log, value: res } = await timersArmedBy(
        'health.service',
        async () => request(app.getHttpServer()).get('/health/ready'),
      );

      expect(res.status).toBe(503);
      expect(res.body.checks).toEqual({
        postgres: 'error',
        redis: 'ok',
        storage: 'ok',
      });
      // The check's own 2-second limit is what ended the wait.
      expect(log).toContain('fired 2000');
    });

    // @traces 976-FR-004
    it('runs all checks in parallel, so three hung checks cost 2 seconds not 6', async () => {
      app = await start(
        {
          databaseUrl: `postgresql://localhost:${port}/x`,
          redisUrl: `redis://localhost:${port}`,
        },
        'abc123',
        `http://127.0.0.1:${port}`,
      );
      const { log, value: res } = await timersArmedBy(
        'health.service',
        async () => request(app.getHttpServer()).get('/health/ready'),
      );

      expect(res.status).toBe(503);
      expect(res.body.checks).toEqual({
        postgres: 'error',
        redis: 'error',
        storage: 'error',
      });
      // In parallel: every limit, the three checks' own and the store's, was
      // running before the first ran out, and none started after.
      const first = log.findIndex((entry) => entry.startsWith('fired'));
      expect(first).toBeGreaterThanOrEqual(3);
      expect(log.slice(0, first).every((entry) => entry === 'armed 2000')).toBe(
        true,
      );
      expect(
        log.slice(first).filter((entry) => entry.startsWith('armed')),
      ).toEqual([]);
    });

    it('does not make the live path wait for a hung ready check', async () => {
      app = await start({
        databaseUrl: `postgresql://localhost:${port}/x`,
        redisUrl: `redis://localhost:${port}`,
      });
      const http = request(app.getHttpServer());
      let readyAnswered = false;
      const hung = http.get('/health/ready').then((r) => {
        readyAnswered = true;
        return r;
      });

      await http.get('/health/live').expect(200, { status: 'ok' });
      // Live answered while the ready check was still waiting on its limit.
      expect(readyAnswered).toBe(false);
      await hung;
    });
  });
});
