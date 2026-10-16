// @traces 1176-FR-004
import { afterAll, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SEEDED } from './endpoints.mjs';
import * as helpers from './flow-helpers.mjs';
import { appLaunchEnv, collectRejections, filesBetween, flowArgs, parseArgs, strayRejection, testsCommand } from './run.mjs';
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
    await args.signIn({ addInitScript: async () => {}, addCookies: async (c) => added.push(...c) }, 'driver');
    assert.deepEqual(asked, ['driver']);
    assert.equal(added[0].value, 'r-1');
    assert.equal(added[0].domain, '127.0.0.1');
    assert.equal(added[0].path, '/api/v1/auth');
  });
});

describe('services someone else runs', () => {
  it('are on the standard ports, with an object store, and nothing to start or stop', () => {
    assert.deepEqual(EXTERNAL_PORTS, { postgres: 5432, redis: 6379, storage: 9000 });
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

describe('filesBetween', () => {
  const tree = fileURLToPath(new URL('../../..', import.meta.url));

  it('lists the files two commits of the tree under test differ by: none for a commit and itself', () => {
    assert.deepEqual(filesBetween(tree, 'HEAD', 'HEAD'), []);
  });

  it('is null when a commit is not in that tree, so the baseline counts as stale', () => {
    assert.equal(filesBetween(tree, 'f'.repeat(40), 'HEAD'), null);
  });
});

// @traces 1230-FR-005
describe('run: a route the sweep cannot open is refused before anything starts', () => {
  const dir = mkdtempSync(join(tmpdir(), 'run-routes-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  // Every outside command the run would start first, logged: none may be called.
  for (const cmd of ['gh', 'git', 'sh', 'docker'])
    writeFileSync(join(bin, cmd), `#!/bin/sh\necho "${cmd} $*" >> "${join(dir, 'calls.log')}"\nexit 1\n`, { mode: 0o755 });
  const run = (env, ...args) =>
    spawnSync(process.execPath, [fileURLToPath(new URL('./run.mjs', import.meta.url)), '62', ...args], {
      encoding: 'utf8',
      timeout: 15_000,
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, ...env },
    });
  const calls = () => (existsSync(join(dir, 'calls.log')) ? readFileSync(join(dir, 'calls.log'), 'utf8').trim() : '');

  it('exits 64 naming /app/driver, with no heavy slot, no gh and no browser', () => {
    for (const env of [{ HEAVY_HELD: '' }, { HEAVY_HELD: '1' }]) {
      const r = run(env, '--routes', '/,/app/driver');
      assert.equal(r.status, 64, r.stderr);
      assert.match(r.stderr, /\/app\/driver: .*@role/);
      assert.equal(calls(), '');
    }
  });
});

// @traces 1230-FR-001
describe('run: what each app is launched with', () => {
  it('gives the worker the web address the api and the web app get, so every notification consumer is on', () => {
    const env = appLaunchEnv({ apiPort: 3100, webPort: 4100, workerPort: 3200, apiURL: 'http://127.0.0.1:3100', webURL: 'http://127.0.0.1:4100' });
    assert.equal(env.worker.PUBLIC_WEB_URL, 'http://127.0.0.1:4100');
    assert.equal(env.worker.PUBLIC_WEB_URL, env.api.PUBLIC_WEB_URL);
    assert.equal(env.worker.PUBLIC_WEB_URL, env.web.PUBLIC_WEB_URL);
    assert.deepEqual([env.api.PORT, env.web.PORT, env.worker.PORT], ['3100', '4100', '3200']);
    assert.equal(env.web.API_INTERNAL_URL, 'http://127.0.0.1:3100');
  });
});

// @traces 1230-FR-006
describe('run: the shared flow helpers', () => {
  it('hands the flows waitForText, openSheet, stepButton and the seeded accounts, next to the rest', () => {
    const args = flowArgs({ webURL: 'http://127.0.0.1:4100', apiURL: 'http://127.0.0.1:3100', outDir: '/o', repoRoot: '/r', worktree: '/w', session: async () => 'r' });
    for (const name of ['waitForText', 'openSheet', 'stepButton']) assert.equal(args[name], helpers[name], name);
    assert.equal(args.accounts, SEEDED);
    for (const name of ['baseURL', 'apiURL', 'signIn', 'health', 'ready']) assert.ok(args[name], name);
  });
});

// @traces 1230-FR-008
describe('run: an unhandled rejection a flow leaves', () => {
  // In a child process: the test runner treats any unhandled rejection in its own process as a failure.
  const probe = (body) => {
    const dir = mkdtempSync(join(tmpdir(), 'run-rejections-'));
    const file = join(dir, 'probe.mjs');
    writeFileSync(
      file,
      `import { collectRejections } from ${JSON.stringify(new URL('./run.mjs', import.meta.url).href)};
const before = process.listenerCount('unhandledRejection');
const findings = [];
let threw = null;
${body}
console.log(JSON.stringify({ findings, before, after: process.listenerCount('unhandledRejection'), threw }));
`,
    );
    const r = spawnSync(process.execPath, [file], { encoding: 'utf8', timeout: 15_000 });
    rmSync(dir, { recursive: true, force: true });
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout.trim().split('\n').at(-1));
  };

  it('becomes one high finding each, naming the error, and the run goes on', () => {
    const out = probe(`const result = await collectRejections(findings, async () => {
  Promise.reject(new Error('the bell never rang'));
  Promise.reject(new Error('the sheet never opened'));
  return 'done';
});
if (result !== 'done') throw new Error('the flows result was lost');`);
    assert.equal(out.findings.length, 2);
    assert.deepEqual(out.findings.map((f) => f.severity), ['high', 'high']);
    assert.match(JSON.stringify(out.findings), /the bell never rang/);
    assert.match(JSON.stringify(out.findings), /the sheet never opened/);
    assert.equal(out.after, out.before);
  });

  it('removes its handler when the flows throw too', () => {
    const out = probe(`try {
  await collectRejections(findings, async () => {
    Promise.reject(new Error('left behind'));
    throw new Error('the flow threw');
  });
} catch (error) { threw = error.message; }`);
    assert.equal(out.threw, 'the flow threw');
    assert.equal(out.findings.length, 1);
    assert.equal(out.after, out.before);
  });
});

// @traces 1230-FR-012
describe('how to write a route and a flow, where the tester and its callers read it', () => {
  const read = (path) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');
  const docs = {
    skill: read('../../skills/speckit-pr-test/SKILL.md'),
    agent: read('../../agents/pr-tester.md'),
    agents: read('../../../AGENTS.md'),
  };

  for (const [name, doc] of Object.entries(docs))
    it(`${name} states the route grammar and the pre-flight check`, () => {
      assert.match(doc, /path\[\?query\]\[@role\]\[:status\]/);
      assert.match(doc, /\/:lang/);
      assert.match(doc, /\/app\/[^\n]*@role|@role[^\n]*\/app\//);
      assert.match(doc, /precheck\.mjs[^\n]*--check/);
    });

  it('gives a query example the app serves: public screens live under /:lang, and /results is no route', () => {
    for (const doc of [docs.agent, read('./sweep.mjs')]) {
      assert.doesNotMatch(doc, /\/results\?brand=/);
      assert.match(doc, /\/:lang\/garages\?brand=dacia/);
    }
  });

  it("sweep's contextCookies comment does not say a flow's context asks for no language", () => {
    assert.doesNotMatch(read('./sweep.mjs'), /flowSignIn\) asks for no language/);
  });

  for (const name of ['skill', 'agent'])
    it(`${name} names the shared flow helpers`, () => {
      for (const helper of ['waitForText', 'openSheet', 'stepButton', 'accounts']) assert.match(docs[name], new RegExp(`\\b${helper}\\b`), helper);
    });
});

// @traces 1230-FR-008
describe('run: an unhandled rejection outside the flows step', () => {
  it('is a high finding instead of a crash, and left to the flows step while it runs', () => {
    const findings = [];
    let flows = true;
    const handler = strayRejection(findings, () => flows);
    handler(new Error('settled during the flows'));
    assert.deepEqual(findings, []);
    flows = false;
    handler(new Error('a wait the flows left behind'));
    assert.equal(findings.length, 1);
    assert.equal(findings[0].severity, 'high');
    assert.match(JSON.stringify(findings[0]), /a wait the flows left behind/);
  });

  it('is left to collectRejections only while its handler is on, not for the rest of the flows step', async () => {
    const findings = [];
    const handler = strayRejection(findings);
    await collectRejections(findings, async () => handler(new Error('while collecting')));
    assert.deepEqual(findings, []);
    handler(new Error('after collectRejections returned'));
    assert.equal(findings.length, 1);
    assert.match(JSON.stringify(findings[0]), /after collectRejections returned/);
  });
});
