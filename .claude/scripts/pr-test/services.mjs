// Private services for one PR tester run: free ports, the compose project (or,
// on a machine without Docker, a private PostgreSQL cluster, Valkey and, when
// its binary is installed, the object store), the environment the apps get, the health
// wait, and the cleanup of what a killed run left. Nothing here touches the
// shared default ports other sessions use.
import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { basename, join } from "node:path";

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

/**
 * Poll a URL until it answers 2xx or the time runs out; each probe is bounded
 * too. `exited()` is checked before every probe: once it returns the exit
 * ({ code, signal }) of the process behind the URL, the wait ends at once.
 */
export async function waitForHttp(url, { timeoutMs = 120000, intervalMs = 1000, exited = () => null } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = "no answer";
  while (Date.now() < deadline) {
    const gone = exited();
    if (gone) return { ok: false, exited: gone, error: `${url}: the server exited (${exitReason(gone)}) before it answered` };
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(Math.max(1, Math.min(5000, deadline - Date.now()))) });
      if (res.ok) return { ok: true, status: res.status };
      last = `HTTP ${res.status}`;
    } catch (error) {
      last = error.cause?.code ?? error.message;
    }
    await new Promise((r) => setTimeout(r, Math.max(0, Math.min(intervalMs, deadline - Date.now()))));
  }
  const gone = exited();
  if (gone) return { ok: false, exited: gone, error: `${url}: the server exited (${exitReason(gone)}) before it answered` };
  return { ok: false, error: `${url} did not answer 2xx within ${timeoutMs} ms (last: ${last})` };
}

const exitReason = ({ code, signal }) => (signal ? `signal ${signal}` : `code ${code}`);

/** A function returning a child process's exit ({ code, signal }) once it has exited, else null. */
export function watchExit(child) {
  let gone = child.exitCode !== null || child.signalCode !== null ? { code: child.exitCode, signal: child.signalCode } : null;
  child.once("exit", (code, signal) => {
    gone = { code, signal };
  });
  return () => gone;
}

const TAIL_CHARS = 8000;

/** The last `n` lines of a server's log, at most TAIL_CHARS of them, or a line saying it is empty (or unreadable). */
export function logTail(file, n = 20) {
  let text = "";
  try {
    text = readFileSync(file, "utf8").trimEnd();
  } catch {}
  if (!text) return "(the log is empty)";
  const lines = text.split(/\r?\n/);
  const tail = lines.slice(Math.max(0, lines.length - n)).join("\n");
  return tail.length > TAIL_CHARS ? `…${tail.slice(-TAIL_CHARS)}` : tail;
}

/**
 * Wait for a launched server (`name`, logging to `log`) to answer `url`. A
 * server that exits first ends the wait at once; `exited()` may name another
 * server that exited (`name`, `log` on its result), which ends it too. A
 * failure carries the server at fault (`server`), the error and the last lines of its log (`tail`).
 */
export async function waitForServer(url, { name, exited, log, timeoutMs = 90000, intervalMs = 1000, lines = 20 }) {
  const h = await waitForHttp(url, { timeoutMs, intervalMs, exited });
  if (h.ok) return h;
  if (!h.exited) return { ok: false, server: name, error: `${name}: ${h.error}`, tail: logTail(log, lines) };
  const server = h.exited.name ?? name;
  return { ok: false, server, error: `${server} exited (${exitReason(h.exited)}) before it answered`, tail: logTail(h.exited.log ?? log, lines) };
}

/**
 * `docker` arguments for the compose services on the run's own ports and project.
 * The object store creates its bucket and is healthy only once it exists, so
 * `up --wait` is the whole setup.
 */
export function composePlan({ project, file, ports }) {
  const base = ["compose", "-p", project, "-f", file];
  return {
    kind: "docker",
    up: [...base, "up", "-d", "--wait", "postgres", "redis", "storage"],
    down: [...base, "down", "-v", "--remove-orphans"],
    env: { POSTGRES_PORT: String(ports.postgres), REDIS_PORT: String(ports.redis), STORAGE_PORT: String(ports.storage) },
    storage: true,
  };
}

/**
 * The ports of SeaweedFS's `weed mini` besides S3, each set from the run's
 * free ports (`ports.storageInner`, in this order): its defaults are fixed,
 * and each gRPC port would otherwise be its HTTP port + 10000.
 */
export const STORE_INNER_PORTS = ["s3.port.grpc", "master.port", "master.port.grpc", "volume.port", "volume.port.grpc", "filer.port", "filer.port.grpc", "admin.port", "admin.port.grpc"];

/**
 * Without Docker: a throwaway PostgreSQL cluster and Valkey inside the run's
 * directory, on the run's ports, and the object store beside them when
 * `storage` (the `weed` binary is on the PATH). It does not daemonize: the
 * caller spawns `store.cmd` detached, writes its pid to `store.pidFile`,
 * waits for `store.health`, which answers once the bucket it creates as it
 * starts exists. Without it there is no object
 * store and the caller reports storage down as a note.
 */
export function localPlan({ dir, ports, storage = false }) {
  const pg = join(dir, "pg");
  return {
    kind: "local",
    start: [
      ["initdb", "-D", pg, "-U", "motorfix", "--auth=trust", "--no-sync", "-E", "UTF8", "--no-locale"],
      ["pg_ctl", "-D", pg, "-l", join(dir, "pg.log"), "-o", `-p ${ports.postgres} -k ${dir} -c listen_addresses=127.0.0.1`, "-w", "start"],
      ["createdb", "-h", "127.0.0.1", "-p", String(ports.postgres), "-U", "motorfix", "motorfix"],
      ["valkey-server", "--port", String(ports.redis), "--bind", "127.0.0.1", "--save", "", "--appendonly", "no", "--maxmemory-policy", "noeviction", "--daemonize", "yes", "--pidfile", join(dir, "redis.pid"), "--dir", dir],
    ],
    stop: [
      ["pg_ctl", "-D", pg, "-m", "immediate", "-w", "stop"],
      ["valkey-cli", "-p", String(ports.redis), "shutdown", "nosave"],
    ],
    ...(storage && {
      store: {
        cmd: [
          "weed",
          "mini",
          `-dir=${join(dir, "storage")}`,
          "-ip=127.0.0.1",
          "-ip.bind=127.0.0.1",
          "-bucket=motorfix",
          "-admin.ui=false",
          "-webdav=false",
          "-master.telemetry=false",
          "-s3.port.iceberg=0",
          "-s3.port.lance=0",
          `-s3.port=${ports.storage}`,
          ...STORE_INNER_PORTS.map((flag, i) => `-${flag}=${ports.storageInner[i]}`),
        ],
        env: { AWS_ACCESS_KEY_ID: STORAGE_KEYS.id, AWS_SECRET_ACCESS_KEY: STORAGE_KEYS.secret },
        health: `http://127.0.0.1:${ports.storageInner[STORE_INNER_PORTS.indexOf("filer.port")]}/buckets/motorfix/`,
        pidFile: join(dir, "storage.pid"),
      },
    }),
    storage,
  };
}

/** The start of a local run's directory name: the PR and the process that owns it. */
export const runDirPrefix = (pr, pid = process.pid) => `mf-prtest-${pr}-${pid}-`;

const pidIn = (pattern, name) => Number(pattern.exec(name)?.[1] ?? 0) || null;
/** The process that owns a run directory, `mf-prtest-<pr>-<pid>-XXXXXX`. */
const runOwner = (name) => pidIn(/^mf-prtest-\d+-(\d+)-[A-Za-z0-9]{6}$/, name);
/** The process that owns a test worktree, `mf-prtest-<pr>-<sha7>-<pid>` (worktree.mjs). */
const worktreeOwner = (name) => pidIn(/^mf-prtest-\d+-[0-9a-f]{7}-(\d+)$/, name);

/** The built entry point of each app a lap boots; a pid file `<app>.pid` beside them names its process. */
export const APP_SCRIPTS = { api: "dist/apps/api/main.js", web: "dist/apps/web/server/server.mjs", worker: "dist/apps/worker/main.js" };

/** What a run's pid files name: a program (its command's first word) or a script it runs. */
const PID_FILES = [["redis.pid", "valkey-server"], ["storage.pid", "weed"], ...Object.entries(APP_SCRIPTS).map(([app, script]) => [`${app}.pid`, script])];

/** The pid on a file's first line, when it is one a process can have and is not init. */
function pidFrom(file) {
  const first = readFileSync(file, "utf8").split("\n")[0].trim();
  return /^\d+$/.test(first) && Number(first) > 1 ? first : null;
}

/** Whether a process's command line is still `want`: the program, or a command running that script. */
function runs(command, want) {
  const words = command.trim().split(/\s+/);
  return want.includes("/") ? words.slice(1).includes(want) : basename(words[0] ?? "") === want;
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

/**
 * Remove what killed local runs left in `tmp`: for each run directory whose
 * owning process is gone, stop its PostgreSQL, Redis, object store and apps (by pid
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
    const still = (file, want) => {
      const servicePid = existsSync(file) ? pidFrom(file) : null;
      return servicePid && runs(run("ps", ["-p", servicePid, "-o", "command="]).stdout, want) ? servicePid : null;
    };
    if (still(join(dir, "pg", "postmaster.pid"), "postgres")) run("pg_ctl", ["-D", join(dir, "pg"), "-m", "immediate", "-w", "stop"]);
    for (const [file, want] of PID_FILES) {
      const servicePid = still(join(dir, file), want);
      if (servicePid) run("kill", [servicePid]);
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
export const EXTERNAL_PORTS = { postgres: 5432, redis: 6379, storage: 9000 };

/**
 * Services something else already runs, on EXTERNAL_PORTS: on a GitHub runner
 * the workflow starts PostgreSQL, Redis and the object store (with its bucket) and stops
 * them with the job, so there is nothing to start or tear down here.
 */
export function externalPlan() {
  return { kind: "external", storage: true };
}

const STORAGE_KEYS = { id: "motorfix", secret: "motorfix-secret" };

/**
 * What every app gets: the run's services, never the shared defaults, and
 * every other variable an app's boot requires (readEnv in apps/api/src/main.ts,
 * WORKER_ENV, apps/web/src/server.ts; services.boot-env.spec.mjs holds them
 * together). Fixed local values only: nothing is read from .env or any file.
 */
export function appEnv({ ports }) {
  return {
    APP_ENV: "test",
    TZ: "UTC",
    AUTH_TOKEN_SECRET: "pr-tester-only-secret",
    // The local cluster trusts its one user, so the compose password does for both.
    DATABASE_URL: `postgresql://motorfix:motorfix@127.0.0.1:${ports.postgres}/motorfix`,
    REDIS_URL: `redis://127.0.0.1:${ports.redis}`,
    STORAGE_ENDPOINT: `http://127.0.0.1:${ports.storage}`,
    STORAGE_REGION: "eu-central-1",
    STORAGE_BUCKET: "motorfix",
    STORAGE_ACCESS_KEY_ID: STORAGE_KEYS.id,
    STORAGE_SECRET_ACCESS_KEY: STORAGE_KEYS.secret,
    // The web app boots with an analytics domain; a reserved .invalid name counts no page view.
    PLAUSIBLE_DOMAIN: "qa.motorfix.invalid",
  };
}

/**
 * The environment of the run's steps and apps: the caller's (its PATH, the
 * workflow's switches) with the tester's own values over it. Each app adds its
 * ports and URLs (run.mjs appLaunchEnv).
 */
export function bootEnv({ ports, base = process.env }) {
  return { ...base, ...appEnv({ ports }), NX_DAEMON: "false" };
}
