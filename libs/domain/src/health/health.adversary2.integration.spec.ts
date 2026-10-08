import {
  createServer as createHttp,
  type Server as HttpServer,
} from 'node:http';
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
const store = new S3TestStore();

async function start(
  endpoint: string,
  secret = store.env().STORAGE_SECRET_ACCESS_KEY,
) {
  const moduleRef = await Test.createTestingModule({
    imports: [
      StorageModule.register({
        ...store.env(),
        STORAGE_ENDPOINT: endpoint,
        STORAGE_SECRET_ACCESS_KEY: secret,
      }),
      HealthModule.register({ databaseUrl, redisUrl, version: 'v1' }),
    ],
  }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  await app.init();
  return app;
}

describe('readiness with a misbehaving store', () => {
  let app: INestApplication;
  const servers: (Server | HttpServer)[] = [];
  const sockets: Socket[] = [];

  beforeAll(() => store.start());
  afterAll(() => store.stop());
  afterEach(async () => {
    await app.close();
    for (const s of sockets.splice(0)) s.destroy();
    await Promise.all(
      servers
        .splice(0)
        .map((s) => new Promise<void>((r) => s.close(() => r()))),
    );
  });

  async function listen<T extends Server | HttpServer>(server: T) {
    servers.push(server);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  }

  it('names only storage when the store never answers and the others are fine', async () => {
    const endpoint = await listen(createServer((s) => sockets.push(s)));
    app = await start(endpoint);
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

  it('stays ready when the store answers after one second', async () => {
    const endpoint = await listen(
      createHttp((_req, res) => {
        setTimeout(() => res.writeHead(200).end(), 1000);
      }),
    );
    app = await start(endpoint);

    const res = await request(app.getHttpServer()).get('/health/ready');

    expect(res.status).toBe(200);
    expect(res.body.checks.storage).toBe('ok');
  });

  it.each([500, 502, 503, 301, 404])(
    'answers 503 naming storage when the bucket check gets %i',
    async (status) => {
      const endpoint = await listen(
        createHttp((_req, res) => {
          res.writeHead(status, { location: 'http://127.0.0.1:1/' }).end();
        }),
      );
      app = await start(endpoint);

      const res = await request(app.getHttpServer()).get('/health/ready');

      expect(res.status).toBe(503);
      expect(res.body.checks.storage).toBe('error');
    },
  );

  it('answers 503 when the store closes the connection mid-response', async () => {
    const endpoint = await listen(
      createServer((socket) => {
        sockets.push(socket);
        socket.once('data', () => socket.destroy());
      }),
    );
    app = await start(endpoint);

    const res = await request(app.getHttpServer()).get('/health/ready');

    expect(res.status).toBe(503);
    expect(res.body.checks.storage).toBe('error');
  });

  it('does not put the storage endpoint or secret in a failed answer', async () => {
    app = await start('http://127.0.0.1:1', 'super-secret-value');

    const res = await request(app.getHttpServer()).get('/health/ready');

    expect(res.status).toBe(503);
    expect(res.text).not.toContain('super-secret-value');
    expect(res.text).not.toContain('127.0.0.1');
  });

  it('recovers to 200 once the store answers again', async () => {
    let up = false;
    const endpoint = await listen(
      createHttp((_req, res) => {
        res.writeHead(up ? 200 : 500).end();
      }),
    );
    app = await start(endpoint);
    const http = request(app.getHttpServer());

    await http.get('/health/ready').expect(503);
    up = true;
    const res = await http.get('/health/ready');

    expect(res.status).toBe(200);
    expect(res.body.checks.storage).toBe('ok');
  });
});
