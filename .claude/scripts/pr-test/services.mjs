// Private services for one PR tester run: free ports, the compose project (or,
// on a machine without Docker, a private PostgreSQL cluster, Redis and, when
// its binary is installed, MinIO), the environment the apps get, the health
// wait, and the cleanup of what a killed run left. Nothing here touches the
// shared default ports other sessions use.
import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
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
 * directory, on the run's ports, and MinIO beside them when `minio` (its
 * binary is on the PATH). MinIO does not daemonize: the caller spawns
 * `minio.cmd` detached, writes its pid to `minio.pidFile`, waits for
 * `minio.health` and creates the bucket. Without it there is no object store
 * and the caller reports storage down as a note.
 */
export function localPlan({ dir, ports, minio = false }) {
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
    ...(minio && {
      minio: {
        cmd: ["minio", "server", join(dir, "minio"), "--address", `127.0.0.1:${ports.minio}`, "--console-address", `127.0.0.1:${ports.minioConsole}`],
        env: { MINIO_ROOT_USER: STORAGE_KEYS.id, MINIO_ROOT_PASSWORD: STORAGE_KEYS.secret },
        health: `http://127.0.0.1:${ports.minio}/minio/health/live`,
        pidFile: join(dir, "minio.pid"),
      },
    }),
    storage: minio,
  };
}

/** Create the apps' bucket on the run's object store; one that is already there is fine. */
export async function createBucket({ repoRoot, env }) {
  const { CreateBucketCommand, S3Client } = createRequire(join(repoRoot, "package.json"))("@aws-sdk/client-s3");
  const client = new S3Client({
    endpoint: env.STORAGE_ENDPOINT,
    region: env.STORAGE_REGION,
    forcePathStyle: true,
    maxAttempts: 1,
    credentials: { accessKeyId: env.STORAGE_ACCESS_KEY_ID, secretAccessKey: env.STORAGE_SECRET_ACCESS_KEY },
  });
  try {
    await client.send(new CreateBucketCommand({ Bucket: env.STORAGE_BUCKET }));
  } catch (error) {
    if (error.name !== "BucketAlreadyOwnedByYou") throw error;
  } finally {
    client.destroy();
  }
}

/** The start of a local run's directory name: the PR and the process that owns it. */
export const runDirPrefix = (pr, pid = process.pid) => `mf-prtest-${pr}-${pid}-`;

const pidIn = (pattern, name) => Number(pattern.exec(name)?.[1] ?? 0) || null;
/** The process that owns a run directory, `mf-prtest-<pr>-<pid>-XXXXXX`. */
const runOwner = (name) => pidIn(/^mf-prtest-\d+-(\d+)-[A-Za-z0-9]{6}$/, name);
/** The process that owns a test worktree, `mf-prtest-<pr>-<sha7>-<pid>` (worktree.mjs). */
const worktreeOwner = (name) => pidIn(/^mf-prtest-\d+-[0-9a-f]{7}-(\d+)$/, name);

export function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

/**
 * Remove what killed local runs left in `tmp`: for each run directory whose
 * owning process is gone, stop its PostgreSQL, its Redis and MinIO (by pid
 * file, only while that pid is still the service), delete the directory with
 * its worktree; take down compose projects of dead runs; then prune the
 * repository's worktree list. `run(cmd, args)` returns { code, stdout } and
 * never throws. Returns a line per thing removed.
 */
export function cleanStale({ tmp, repo, isAlive: alive = isAlive, run }) {
  const cleaned = [];
  for (const name of existsSync(tmp) ? readdirSync(tmp) : []) {
    if (!name.startsWith("mf-prtest-")) continue;
    const dir = join(tmp, name);
    let pid = runOwner(name);
    // A run directory from before its name carried the pid: its worktree's name does.
    if (!pid) {
      try {
        pid = readdirSync(dir).map(worktreeOwner).find(Boolean) ?? null;
      } catch {}
    }
    if (!pid || alive(pid)) continue;
    if (existsSync(join(dir, "pg", "postmaster.pid"))) run("pg_ctl", ["-D", join(dir, "pg"), "-m", "immediate", "-w", "stop"]);
    for (const [file, service] of [["redis.pid", "redis-server"], ["minio.pid", "minio"]]) {
      const pidFile = join(dir, file);
      if (!existsSync(pidFile)) continue;
      const servicePid = readFileSync(pidFile, "utf8").trim();
      if (/^\d+$/.test(servicePid) && run("ps", ["-p", servicePid, "-o", "command="]).stdout.includes(service)) run("kill", [servicePid]);
    }
    rmSync(dir, { recursive: true, force: true });
    cleaned.push(`removed ${dir} (pid ${pid} gone)`);
  }
  for (const project of run("docker", ["compose", "ls", "-a", "-q"]).stdout.split("\n")) {
    const pid = pidIn(/^mf-prtest-\d+-(\d+)$/, project.trim());
    if (!pid || alive(pid)) continue;
    run("docker", ["compose", "-p", project.trim(), "down", "-v", "--remove-orphans"]);
    cleaned.push(`removed compose project ${project.trim()}`);
  }
  if (cleaned.length) run("git", ["-C", repo, "worktree", "prune"]);
  return cleaned;
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

const STORAGE_KEYS = { id: "motorfix", secret: "motorfix-secret" };

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
    STORAGE_ACCESS_KEY_ID: STORAGE_KEYS.id,
    STORAGE_SECRET_ACCESS_KEY: STORAGE_KEYS.secret,
  };
}
