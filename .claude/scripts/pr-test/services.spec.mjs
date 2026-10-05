import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createServer as createTcp } from 'node:net';

import { appEnv, composePlan, freePorts, localPlan, waitForHttp } from './services.mjs';

const listen = (server, port = 0) =>
  new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server.address().port)));
const close = (server) => new Promise((resolve) => server.close(() => resolve()));

describe('free ports', () => {
  it('returns distinct ports that can be bound', async () => {
    const ports = await freePorts(5);
    assert.equal(new Set(ports).size, 5);
    for (const port of ports) {
      const server = createTcp();
      assert.equal(await listen(server, port), port);
      await close(server);
    }
  });
});

describe('waiting for health', () => {
  it('answers once the URL returns 2xx', async () => {
    const [port] = await freePorts(1);
    let up = false;
    const server = createServer((_req, res) => {
      res.statusCode = up ? 200 : 503;
      res.end();
    });
    await listen(server, port);
    setTimeout(() => (up = true), 300);
    const result = await waitForHttp(`http://127.0.0.1:${port}/health/live`, { timeoutMs: 5000, intervalMs: 50 });
    await close(server);
    assert.equal(result.ok, true);
    assert.equal(result.status, 200);
  });

  it('gives up after the time limit with the last thing it saw', async () => {
    const [port] = await freePorts(1);
    const started = Date.now();
    const result = await waitForHttp(`http://127.0.0.1:${port}/`, { timeoutMs: 400, intervalMs: 50 });
    assert.equal(result.ok, false);
    assert.ok(Date.now() - started < 3000);
    assert.ok(result.error);
  });
});

describe('service plans', () => {
  const ports = { postgres: 55001, redis: 55002, minio: 55003 };

  it('runs compose as its own project on the given ports and removes volumes on the way down', () => {
    const plan = composePlan({ project: 'mf-prtest-21-x1', file: '/wt/docker-compose.yml', ports });
    assert.deepEqual(plan.up.slice(0, 5), ['compose', '-p', 'mf-prtest-21-x1', '-f', '/wt/docker-compose.yml']);
    assert.ok(plan.up.includes('up') && plan.up.includes('-d'));
    assert.ok(plan.down.includes('down') && plan.down.includes('-v'));
    assert.equal(plan.env.POSTGRES_PORT, '55001');
    assert.equal(plan.env.REDIS_PORT, '55002');
    assert.equal(plan.env.MINIO_PORT, '55003');
    assert.equal(plan.storage, true);
  });

  it('waits only for the long-running services, then runs the one-shot bucket setup to its exit', () => {
    const plan = composePlan({ project: 'mf-prtest-21-x1', file: '/wt/docker-compose.yml', ports });
    assert.deepEqual(plan.up.slice(5), ['up', '-d', '--wait', 'postgres', 'redis', 'minio']);
    assert.deepEqual(plan.setup, ['compose', '-p', 'mf-prtest-21-x1', '-f', '/wt/docker-compose.yml', 'run', '--rm', 'minio-setup']);
  });

  it('without Docker, starts a private PostgreSQL and Redis on the given ports inside the run directory', () => {
    const plan = localPlan({ dir: '/tmp/run', ports });
    const flat = plan.start.map((c) => c.join(' ')).join('\n');
    assert.match(flat, /initdb .*\/tmp\/run\/pg/);
    assert.match(flat, /pg_ctl .*-p 55001/);
    assert.match(flat, /redis-server --port 55002/);
    assert.ok(plan.stop.some((c) => c.join(' ').includes('pg_ctl') && c.includes('stop')));
    assert.equal(plan.storage, false);
  });

  it('gives the apps URLs that point at those services, never at the shared defaults', () => {
    const env = appEnv({ ports, storage: true });
    assert.match(env.DATABASE_URL, /:55001\//);
    assert.match(env.REDIS_URL, /:55002/);
    assert.match(env.STORAGE_ENDPOINT, /:55003/);
    assert.doesNotMatch(JSON.stringify(env), /:5432|:6379|:9000/);
  });
});
