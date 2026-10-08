import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { flowArgs, parseArgs, testsCommand } from './run.mjs';
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

  it('takes the baseline run\'s folder (the workflow downloads it) and has none without it', () => {
    assert.equal(parseArgs(['53', '--baseline', '/tmp/base']).baseline, '/tmp/base');
    assert.equal(parseArgs(['53']).baseline, undefined);
  });
});

describe('run: what the QA flows are given', () => {
  it('hands the flows a signIn that signs the context in through the run session, on the web origin', async () => {
    const asked = [];
    const args = flowArgs({
      webURL: 'http://127.0.0.1:4100',
      apiURL: 'http://127.0.0.1:3100',
      outDir: '/out/shots',
      repoRoot: '/repo',
      worktree: '/wt',
      session: async (role) => (asked.push(role), 'r-1'),
    });
    assert.equal(args.baseURL, 'http://127.0.0.1:4100');
    assert.equal(args.apiURL, 'http://127.0.0.1:3100');
    assert.equal(args.outDir, '/out/shots');
    assert.equal(args.repoRoot, '/repo');
    assert.equal(args.worktree, '/wt');
    assert.equal(typeof args.health, 'function');
    assert.equal(typeof args.ready, 'function');
    const added = [];
    await args.signIn({ addCookies: async (c) => added.push(...c) }, 'driver');
    assert.deepEqual(asked, ['driver']);
    assert.equal(added[0].value, 'r-1');
    assert.equal(added[0].domain, '127.0.0.1');
    assert.equal(added[0].path, '/api/v1/auth');
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

  it('judges screens by a design rubric with severities and the tools behind it', () => {
    const rubric = doc.slice(doc.indexOf('### Design rubric'), doc.indexOf('### Mock fidelity'));
    assert.ok(doc.indexOf('### Design rubric') > -1 && rubric.length > 0);
    for (const high of [/under the minimum/, /sideways/, /clipped/, /alignment/, /contrast/, /type scale/]) assert.match(rubric, high);
    for (const medium of [/spacing/, /hierarchy/, /density/, /icons?/, /padding/, /orphan/, /radi/]) assert.match(rubric, medium);
    assert.match(rubric, /apple-design-skill/);
    assert.match(rubric, /design-audit/);
    assert.match(rubric, /contrast\.mjs/);
  });

  it('compares each changed screen with its board, and cites the pixel diff', () => {
    const fidelity = doc.slice(doc.indexOf('### Mock fidelity'), doc.indexOf('## 5. Post'));
    assert.match(fidelity, /design\.md/);
    for (const axis of [/type hierarchy/, /spacing/, /alignment/, /colou?r/, /component/, /states/]) assert.match(fidelity, axis);
    assert.match(fidelity, /no board/i);
    assert.match(fidelity, /diff\/<shot>\.png/);
  });
});
