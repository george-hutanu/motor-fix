import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { parseArgs, testsCommand } from './run.mjs';
import { EXTERNAL_PORTS, appEnv, externalPlan } from './services.mjs';

describe('run: arguments', () => {
  it('keeps the local defaults: its own worktree, ro and en, light and dark, tests off (CI runs them)', () => {
    const o = parseArgs(['53']);
    assert.equal(o.pr, '53');
    assert.equal(o.tree, undefined);
    assert.deepEqual(o.routes, ['/', '/cockpit']);
    assert.deepEqual(o.langs, ['ro', 'en']);
    assert.deepEqual(o.schemes, ['light', 'dark']);
    assert.equal(o.tests, false);
  });

  it('runs the unit and end-to-end suites only on --tests', () => {
    assert.equal(parseArgs(['53', '--tests']).tests, true);
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

describe('run: --tests', () => {
  it('runs the affected unit tests without the Nx cache, between the base and the head', () => {
    const cmd = testsCommand({ base: 'b'.repeat(40), sha: 'h'.repeat(40) });
    assert.deepEqual(cmd.slice(0, 4), ['nx', 'affected', '-t', 'test']);
    assert.ok(cmd.includes('--skip-nx-cache'));
    assert.ok(cmd.includes(`--base=${'b'.repeat(40)}`));
    assert.ok(cmd.includes(`--head=${'h'.repeat(40)}`));
  });
});

describe('the pr-tester agent', () => {
  const doc = readFileSync(fileURLToPath(new URL('../../agents/pr-tester.md', import.meta.url)), 'utf8');

  it('says storage down without an object store is a note, never a finding', () => {
    assert.match(doc, /storage[^.]*note/i);
    assert.doesNotMatch(doc, /medium environment finding/);
  });

  it('runs a --local lap in the background and posts a lap with no report as a failure', () => {
    assert.match(doc, /run_in_background/);
    assert.match(doc, /post\.mjs --missing/);
  });

  it('documents the route syntax and the endpoint calls', () => {
    assert.match(doc, /@role/);
    assert.match(doc, /:status/);
    assert.match(doc, /changed (API )?operations|changed endpoints/i);
    assert.doesNotMatch(doc, /changed GET\s+endpoints/);
  });
});
