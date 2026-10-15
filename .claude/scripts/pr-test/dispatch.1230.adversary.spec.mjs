// @traces 1230-FR-002 1230-FR-003 1230-FR-005
import { afterAll, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = join(import.meta.dirname, 'dispatch.mjs');
const SHA = 'a'.repeat(40);

const FAKE_GH = `#!/usr/bin/env node
const { appendFileSync, readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const dir = process.env.FAKE_GH_DIR;
const args = process.argv.slice(2);
appendFileSync(join(dir, 'calls.log'), args.join(' ') + '\\n');
const say = (v) => process.stdout.write(typeof v === 'string' ? v : JSON.stringify(v));
const [a, b] = args;
if (a === 'pr' && b === 'view') say({ state: 'OPEN', headRefOid: process.env.FAKE_HEAD });
else if (a === 'api' && b === 'repos/{owner}/{repo}/pulls/62') say({ state: 'open', head: { sha: process.env.FAKE_HEAD } });
else if (a === 'api' && b.startsWith('repos/{owner}/{repo}/actions/workflows/')) say({ total_count: 0, workflow_runs: [] });
else if (a === 'workflow' && b === 'run') writeFileSync(join(dir, 'stdin.json'), readFileSync(0, 'utf8'));
else if (a === 'run' && b === 'list') say([{ databaseId: 77, displayTitle: 'PR QA ' + JSON.parse(readFileSync(join(dir, 'stdin.json'), 'utf8')).nonce, url: 'https://x/runs/77' }]);
`;

const dirs = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function dispatch(...args) {
  const dir = mkdtempSync(join(tmpdir(), 'dispatch-1230-'));
  dirs.push(dir);
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'gh'), FAKE_GH);
  chmodSync(join(bin, 'gh'), 0o755);
  const r = spawnSync(process.execPath, [SCRIPT, '62', '--out', join(dir, 'out'), '--no-wait', ...args], {
    encoding: 'utf8',
    timeout: 15_000,
    env: { ...process.env, CLAUDE_CODE_REMOTE: '', PATH: `${bin}:${process.env.PATH}`, FAKE_GH_DIR: dir, FAKE_HEAD: SHA, PR_QA_POLL_MS: '1', PR_QA_POLL_TRIES: '2' },
  });
  const calls = existsSync(join(dir, 'calls.log')) ? readFileSync(join(dir, 'calls.log'), 'utf8').trim().split('\n') : [];
  const stdin = existsSync(join(dir, 'stdin.json')) ? JSON.parse(readFileSync(join(dir, 'stdin.json'), 'utf8')) : null;
  return { code: r.status, stderr: r.stderr, stdout: r.stdout, calls, stdin };
}

describe('dispatch refuses before it asks GitHub anything', () => {
  for (const [route, named] of [
    ['/app/driver:401', '/app/driver:401'],
    ['/app/', '/app/'],
    ['/app/driver?tab=2', '/app/driver?tab=2'],
    ['/a;b', '/a;b'],
    ['/a$(id)', '/a$(id)'],
    ['/a`id`', '/a`id`'],
    ['/a#x', '/a#x'],
    ['/café', '/café'],
    ['/a/:lang', '/a/:lang'],
    ['/a:b', '/a:b'],
    ['nolead', 'nolead'],
  ])
    it(`exits 64 for ${JSON.stringify(route)}, naming it, with no gh call`, () => {
      const r = dispatch('--routes', `/,${route}`);
      assert.equal(r.code, 64, r.stderr);
      assert.ok(r.stderr.split('\n').some((l) => l.includes(named)), r.stderr);
      assert.deepEqual(r.calls, []);
      assert.equal(r.stdin, null);
    });

  it('names every refused route on a line of its own and no accepted one', () => {
    const r = dispatch('--routes', '/app/a,/ok?x=1,/app/b,/bad route');
    assert.equal(r.code, 64);
    const lines = r.stderr.trim().split('\n');
    assert.ok(lines.some((l) => l.includes('/app/a')));
    assert.ok(lines.some((l) => l.includes('/app/b')));
    assert.ok(lines.some((l) => l.includes('/bad route')));
    assert.ok(!lines.some((l) => l.includes('/ok?x=1')), r.stderr);
  });

  it('refuses an empty route between commas', () => {
    const r = dispatch('--routes', '/a,,/b');
    assert.equal(r.code, 64, r.stderr);
    assert.deepEqual(r.calls, []);
  });

  it('refuses a route list that is empty', () => {
    const r = dispatch('--routes', '');
    assert.notEqual(r.code, 0);
    assert.equal(r.stdin, null);
  });

  it('refuses a route list that holds a newline', () => {
    const r = dispatch('--routes', '/a\n/b');
    assert.equal(r.code, 64, r.stderr);
    assert.deepEqual(r.calls, []);
  });
});

describe('dispatch sends accepted routes exactly as written', () => {
  for (const routes of [
    '/results?brand=dacia&sort=near',
    '/:lang',
    '/:lang/',
    '/:lang/x:404',
    '/app',
    '/apple-pay',
    '/app/driver@driver:401',
    '/results?q=100%25,/:lang/list-your-garage,/app/driver@driver',
  ])
    it(`sends ${routes}`, () => {
      const r = dispatch('--routes', routes);
      assert.equal(r.code, 0, r.stderr);
      assert.equal(r.stdin.routes, routes);
    });
});
