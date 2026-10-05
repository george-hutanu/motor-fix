import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

import { parseArgs } from './run.mjs';
import { EXTERNAL_PORTS, appEnv, externalPlan } from './services.mjs';

describe('run: arguments', () => {
  it('keeps the local defaults: its own worktree, ro and en, light and dark, tests on', () => {
    const o = parseArgs(['53']);
    assert.equal(o.pr, '53');
    assert.equal(o.tree, undefined);
    assert.deepEqual(o.routes, ['/', '/cockpit']);
    assert.deepEqual(o.langs, ['ro', 'en']);
    assert.deepEqual(o.schemes, ['light', 'dark']);
    assert.equal(o.tests, true);
  });

  it('tests a tree already checked out at a pinned SHA (the PR QA workflow)', () => {
    const o = parseArgs(['53', '--tree', 'pr', '--sha', 'f'.repeat(40)]);
    assert.equal(o.tree, 'pr');
    assert.equal(o.sha, 'f'.repeat(40));
  });
});

describe('services someone else runs', () => {
  it('are on the standard ports, with an object store, and nothing to start or stop', () => {
    assert.deepEqual(EXTERNAL_PORTS, { postgres: 5432, redis: 6379, minio: 9000 });
    const plan = externalPlan();
    assert.equal(plan.kind, 'external');
    assert.equal(plan.storage, true);
    assert.equal(plan.start, undefined);
    assert.equal(plan.up, undefined);
  });

  it('give the apps the standard URLs and the storage settings', () => {
    const env = appEnv({ ports: EXTERNAL_PORTS });
    assert.equal(env.DATABASE_URL, 'postgresql://motorfix:motorfix@127.0.0.1:5432/motorfix');
    assert.equal(env.REDIS_URL, 'redis://127.0.0.1:6379');
    assert.equal(env.STORAGE_ENDPOINT, 'http://127.0.0.1:9000');
  });
});
