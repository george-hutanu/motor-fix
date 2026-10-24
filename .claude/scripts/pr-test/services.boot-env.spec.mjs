// @traces 1376-FR-001 1376-FR-002
// A local QA boot in a worktree with no .env: every variable a server's boot
// passes to readEnv comes from the tester itself, never from a file.
import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { STORAGE_ENV, readEnv } from '../../../libs/contracts/src/env.ts';
import { appLaunchEnv } from './run.mjs';
import { bootEnv } from './services.mjs';

/** The required names `env` leaves unset or empty, and APP_ENV when readEnv would refuse it. */
function missingBootEnv(env, list) {
  const appEnvOk = (() => {
    try {
      readEnv([], env);
      return true;
    } catch {
      return false;
    }
  })();
  return list.filter((name) => (name === 'APP_ENV' ? !appEnvOk : !env[name]));
}

const source = (path) => readFileSync(fileURLToPath(new URL(`../../../${path}`, import.meta.url)), 'utf8');
const LISTS = { STORAGE_ENV };

/** The names in an array literal's body: quoted names, and `...LIST` spreads of a list this spec knows. */
function names(body, where) {
  const out = [];
  for (const [, quoted, spread] of body.matchAll(/'([A-Z0-9_]+)'|\.\.\.([A-Z0-9_]+)/g)) {
    if (quoted) out.push(quoted);
    else if (LISTS[spread]) out.push(...LISTS[spread]);
    else throw new Error(`${where} spreads ${spread}, which this spec does not expand: add it to LISTS`);
  }
  return out;
}

/** What each server's boot requires: the readEnv list of its entry point, plus APP_ENV, which readEnv always checks. */
function required() {
  const first = (path, pattern) => {
    const m = source(path).match(pattern);
    if (!m) throw new Error(`${path}: no ${pattern} found; the boot's required variables moved`);
    return ['APP_ENV', ...names(m[1], path)];
  };
  return {
    api: first('apps/api/src/main.ts', /readEnv\(\[([^\]]*)\]/),
    worker: first('apps/worker/src/worker.module.ts', /WORKER_ENV = \[([^\]]*)\]/),
    web: first('apps/web/src/server.ts', /readEnv\(\[([^\]]*)\]/),
  };
}

const ports = { postgres: 5501, redis: 5502, storage: 5503 };
const launch = appLaunchEnv({ apiPort: 3101, webPort: 4101, workerPort: 3201, apiURL: 'http://127.0.0.1:3101', webURL: 'http://127.0.0.1:4101' });

describe('the boot environment with no .env', () => {
  const lists = required();

  for (const app of ['api', 'web', 'worker']) {
    it(`gives the ${app} every variable its boot requires, from an empty caller environment`, () => {
      const env = { ...bootEnv({ ports, base: {} }), ...launch[app] };
      assert.deepEqual(missingBootEnv(env, lists[app]), [], `${app} boot lacks: ${missingBootEnv(env, lists[app]).join(', ')}`);
      // The boot's own check accepts it: APP_ENV is one readEnv knows, and nothing required is empty.
      assert.doesNotThrow(() => readEnv(lists[app], env));
    });
  }



  it("puts the tester's own values over whatever the caller's environment holds", () => {
    const base = { PATH: '/usr/bin', APP_ENV: 'production', AUTH_TOKEN_SECRET: 'a-real-secret', DATABASE_URL: 'postgresql://prod/motorfix', STORAGE_SECRET_ACCESS_KEY: 'real-key' };
    const env = bootEnv({ ports, base });
    assert.equal(env.PATH, '/usr/bin', 'the caller environment still carries the tools');
    assert.equal(env.APP_ENV, 'test');
    assert.notEqual(env.AUTH_TOKEN_SECRET, 'a-real-secret');
    assert.equal(env.DATABASE_URL, `postgresql://motorfix:motorfix@127.0.0.1:${ports.postgres}/motorfix`);
    assert.notEqual(env.STORAGE_SECRET_ACCESS_KEY, 'real-key');
  });

  it('reads no .env: a file in the working directory changes nothing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mf-bootenv-'));
    const cwd = process.cwd();
    try {
      writeFileSync(join(dir, '.env'), 'APP_ENV=production\nAUTH_TOKEN_SECRET=from-dotenv\nEXTRA_FROM_DOTENV=1\n');
      const before = bootEnv({ ports, base: {} });
      process.chdir(dir);
      const inside = bootEnv({ ports, base: {} });
      assert.deepEqual(inside, before);
      assert.equal(inside.EXTRA_FROM_DOTENV, undefined);
    } finally {
      process.chdir(cwd);
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
