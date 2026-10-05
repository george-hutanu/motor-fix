// Private services for one PR tester run: free ports, the compose project (or,
// on a machine without Docker, a private PostgreSQL cluster and Redis), the
// environment the apps get, and the health wait. Nothing here touches the
// shared default ports other sessions use.
import { createServer } from "node:net";
import { join } from "node:path";

/** `n` distinct ports the OS reports free right now. */
export async function freePorts(n) {
  const servers = [];
  try {
    for (let i = 0; i < n; i++) {
      const server = createServer();
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
      });
      servers.push(server);
    }
    return servers.map((s) => s.address().port);
  } finally {
    await Promise.all(servers.map((s) => new Promise((resolve) => s.close(resolve))));
  }
}

/** The health routes of the API and the worker (both mount libs/domain/src/health/health.controller.ts), the only two it serves. */
export const HEALTH = { live: "/health/live", ready: "/health/ready" };

/** What a flows file gets for the API it runs against: each returns the fetch Response. */
export function apiHealth(apiURL) {
  const get = (path) => fetch(apiURL + path, { signal: AbortSignal.timeout(5000) });
  return { health: () => get(HEALTH.live), ready: () => get(HEALTH.ready) };
}

/** Poll a URL until it answers 2xx or the time runs out. */
export async function waitForHttp(url, { timeoutMs = 120000, intervalMs = 1000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = "no answer";
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(Math.min(5000, timeoutMs)) });
      if (res.ok) return { ok: true, status: res.status };
      last = `HTTP ${res.status}`;
    } catch (error) {
      last = error.cause?.code ?? error.message;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return { ok: false, error: `${url} did not answer 2xx within ${timeoutMs} ms (last: ${last})` };
}

/**
 * `docker` arguments for the compose services on the run's own ports and project.
 * The one-shot minio-setup stays out of `up --wait`, which fails whenever it
 * exits before compose sees it running; `run --rm` returns its exit code.
 */
export function composePlan({ project, file, ports }) {
  const base = ["compose", "-p", project, "-f", file];
  return {
    kind: "docker",
    up: [...base, "up", "-d", "--wait", "postgres", "redis", "minio"],
    setup: [...base, "run", "--rm", "minio-setup"],
    down: [...base, "down", "-v", "--remove-orphans"],
    env: { POSTGRES_PORT: String(ports.postgres), REDIS_PORT: String(ports.redis), MINIO_PORT: String(ports.minio) },
    storage: true,
  };
}

/**
 * Without Docker: a throwaway PostgreSQL cluster and Redis inside the run's
 * directory, on the run's ports. There is no object store, so the apps'
 * readiness check reports storage down; the caller reports that as an
 * environment limit, not a fault of the change.
 */
export function localPlan({ dir, ports }) {
  const pg = join(dir, "pg");
  return {
    kind: "local",
    start: [
      ["initdb", "-D", pg, "-U", "motorfix", "--auth=trust", "--no-sync", "-E", "UTF8", "--no-locale"],
      ["pg_ctl", "-D", pg, "-l", join(dir, "pg.log"), "-o", `-p ${ports.postgres} -k ${dir} -c listen_addresses=127.0.0.1`, "-w", "start"],
      ["createdb", "-h", "127.0.0.1", "-p", String(ports.postgres), "-U", "motorfix", "motorfix"],
      ["redis-server", "--port", String(ports.redis), "--bind", "127.0.0.1", "--save", "", "--appendonly", "no", "--daemonize", "yes", "--pidfile", join(dir, "redis.pid"), "--dir", dir],
    ],
    stop: [
      ["pg_ctl", "-D", pg, "-m", "immediate", "-w", "stop"],
      ["redis-cli", "-p", String(ports.redis), "shutdown", "nosave"],
    ],
    storage: false,
  };
}

/** Where the PR QA workflow's containers listen (.github/workflows/pr-qa.yml). */
export const EXTERNAL_PORTS = { postgres: 5432, redis: 6379, minio: 9000 };

/**
 * Services something else already runs, on EXTERNAL_PORTS: on a GitHub runner
 * the workflow starts PostgreSQL, Redis and MinIO (with its bucket) and stops
 * them with the job, so there is nothing to start or tear down here.
 */
export function externalPlan() {
  return { kind: "external", storage: true };
}

/** What every app gets: the run's services, never the shared defaults. */
export function appEnv({ ports }) {
  return {
    APP_ENV: "test",
    TZ: "UTC",
    AUTH_TOKEN_SECRET: "pr-tester-only-secret",
    // The local cluster trusts its one user, so the compose password does for both.
    DATABASE_URL: `postgresql://motorfix:motorfix@127.0.0.1:${ports.postgres}/motorfix`,
    REDIS_URL: `redis://127.0.0.1:${ports.redis}`,
    STORAGE_ENDPOINT: `http://127.0.0.1:${ports.minio}`,
    STORAGE_REGION: "eu-central-1",
    STORAGE_BUCKET: "motorfix",
    STORAGE_ACCESS_KEY_ID: "motorfix",
    STORAGE_SECRET_ACCESS_KEY: "motorfix-secret",
  };
}
