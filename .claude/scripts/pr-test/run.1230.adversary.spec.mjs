// @traces 1230-FR-001 1230-FR-005 1230-FR-006 1230-FR-008
import { afterAll, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { appLaunchEnv, flowArgs } from './run.mjs';

const RUN = join(import.meta.dirname, 'run.mjs');
const made = [];
afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true });
});
const tmp = (prefix) => {
  const d = mkdtempSync(join(tmpdir(), prefix));
  made.push(d);
  return d;
};

describe('launch environment', () => {
  const plan = (over = {}) => appLaunchEnv({ apiPort: 1, webPort: 2, workerPort: 3, apiURL: 'http://127.0.0.1:1', webURL: 'http://127.0.0.1:2', ...over });

  it('hands the worker the web address exactly as given, whatever it looks like', () => {
    for (const webURL of ['http://127.0.0.1:2/', 'https://qa.example.test', 'http://[::1]:2']) assert.equal(plan({ webURL }).worker.PUBLIC_WEB_URL, webURL);
  });

  it('gives each app its own object, so one cannot change another\'s environment', () => {
    const env = plan();
    env.worker.PUBLIC_WEB_URL = 'changed';
    assert.equal(env.api.PUBLIC_WEB_URL, 'http://127.0.0.1:2');
    assert.equal(env.web.PUBLIC_WEB_URL, 'http://127.0.0.1:2');
  });

  it('writes every port as a string and port 0 as "0"', () => {
    const env = plan({ apiPort: 0, webPort: 0, workerPort: 0 });
    assert.deepEqual([env.api.PORT, env.web.PORT, env.worker.PORT], ['0', '0', '0']);
  });

  it('gives the worker no address of the API only the web app needs', () => {
    assert.equal(plan().worker.API_INTERNAL_URL, undefined);
  });
});

describe('flow arguments', () => {
  const args = (session) => flowArgs({ webURL: 'http://127.0.0.1:4100', apiURL: 'http://127.0.0.1:3100', outDir: '/o', repoRoot: '/r', worktree: '/w', session });

  it('hands over health and ready probes as functions', () => {
    const a = args(async () => 'r');
    assert.equal(typeof a.health, 'function');
    assert.equal(typeof a.ready, 'function');
  });

  it('signs a context in as a role with a cookie, and refuses a missing role', async () => {
    const asked = [];
    const a = args(async (...x) => (asked.push(x), 'tok'));
    const added = [];
    await a.signIn({ addCookies: async (c) => added.push(...c) }, 'driver');
    assert.equal(added.length, 1);
    assert.equal(added[0].name, 'mf_refresh');
    assert.equal(added[0].value, 'tok');
    assert.equal(asked[0][0], 'driver');
    await assert.rejects(a.signIn({ addCookies: async () => {} }), /role/);
    await assert.rejects(a.signIn({ addCookies: async () => {} }, ''), /role/);
  });

  it('passes a session failure to the flow instead of hiding it', async () => {
    const a = args(async () => {
      throw new Error('could not sign in as driver');
    });
    await assert.rejects(a.signIn({ addCookies: async () => assert.fail('no cookie for a failed sign-in') }, 'driver'), /could not sign in/);
  });
});

describe('collectRejections in its own process', () => {
  const probe = (body) => {
    const dir = tmp('run-rej-adv-');
    const file = join(dir, 'probe.mjs');
    writeFileSync(
      file,
      `import { collectRejections } from ${JSON.stringify(new URL('./run.mjs', import.meta.url).href)};
const findings = [];
const pre = () => {};
process.on('unhandledRejection', pre);
const before = process.listenerCount('unhandledRejection');
let threw = null, result;
${body}
console.log(JSON.stringify({ findings, before, after: process.listenerCount('unhandledRejection'), threw, result }));
process.off('unhandledRejection', pre);
`,
    );
    const r = spawnSync(process.execPath, [file], { encoding: 'utf8', timeout: 15_000 });
    const last = r.stdout.trim().split('\n').at(-1);
    return { status: r.status, stderr: r.stderr, out: last ? JSON.parse(last) : null };
  };

  it('finds nothing when the flows leave nothing, and returns their result', () => {
    const { status, out } = probe(`result = await collectRejections(findings, async () => [{ title: 'kept' }]);`);
    assert.equal(status, 0);
    assert.deepEqual(out.findings, []);
    assert.deepEqual(out.result, [{ title: 'kept' }]);
    assert.equal(out.after, out.before);
  });

  it('turns many rejections into as many findings', () => {
    const { out } = probe(`await collectRejections(findings, async () => { for (let i = 0; i < 200; i++) Promise.reject(new Error('e' + i)); });`);
    assert.equal(out.findings.length, 200);
    assert.ok(out.findings.every((f) => f.severity === 'high'));
  });

  it('turns rejections with no Error in them into findings, and survives a null reason', () => {
    const { status, out } = probe(`await collectRejections(findings, async () => { Promise.reject('plain string'); Promise.reject(null); Promise.reject(undefined); Promise.reject({ code: 7 }); });`);
    assert.equal(status, 0);
    assert.equal(out.findings.length, 4);
    assert.match(JSON.stringify(out.findings), /plain string/);
  });

  it('counts the same error rejected twice as two findings', () => {
    const { out } = probe(`const e = new Error('same'); await collectRejections(findings, async () => { Promise.reject(e); Promise.reject(e); });`);
    assert.equal(out.findings.length, 2);
  });

  it('counts a rejection a flow awaited and caught as none', () => {
    const { out } = probe(`await collectRejections(findings, async () => { try { await Promise.reject(new Error('handled')); } catch {} const p = Promise.reject(new Error('late-caught')); p.catch(() => {}); });`);
    assert.deepEqual(out.findings, []);
  });

  it('catches a rejection from a timer inside the step', () => {
    const { out } = probe(`await collectRejections(findings, async () => { setTimeout(() => Promise.reject(new Error('timer')), 5); await new Promise((r) => setTimeout(r, 40)); });`);
    assert.equal(out.findings.length, 1);
    assert.match(JSON.stringify(out.findings), /timer/);
  });

  it('lets the flows\' own throw out, with the rejections it left still found and the handler gone', () => {
    const { out } = probe(`try { await collectRejections(findings, async () => { Promise.reject(new Error('left')); throw new Error('boom'); }); } catch (e) { threw = e.message; }`);
    assert.equal(out.threw, 'boom');
    assert.equal(out.findings.length, 1);
    assert.equal(out.after, out.before);
  });

  it('leaves a rejection outside the step to the default handling, which ends the process', () => {
    const { status, stderr, out } = probe(`await collectRejections(findings, async () => 1); process.off('unhandledRejection', pre); Promise.reject(new Error('after the step'));`);
    assert.notEqual(status, 0);
    assert.match(stderr, /after the step/);
    assert.deepEqual(out.findings, []);
  });

  it('keeps separate calls from sharing findings', () => {
    const { out } = probe(`const other = []; await collectRejections(other, async () => { Promise.reject(new Error('a')); }); await collectRejections(findings, async () => {});`);
    assert.deepEqual(out.findings, []);
  });
});

describe('run.mjs refuses a bad route before anything starts', () => {
  const dir = tmp('run-route-adv-');
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  for (const cmd of ['gh', 'git', 'sh', 'docker', 'bash', 'npx', 'nx'])
    writeFileSync(join(bin, cmd), `#!/bin/sh\necho "${cmd} $*" >> "${join(dir, 'calls.log')}"\nexit 1\n`, { mode: 0o755 });
  const run = (routes) => spawnSync(process.execPath, [RUN, '62', '--routes', routes], { encoding: 'utf8', timeout: 15_000, env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } });
  const calls = () => (existsSync(join(dir, 'calls.log')) ? readFileSync(join(dir, 'calls.log'), 'utf8').trim() : '');

  for (const [routes, named] of [
    ['/app/driver:401', '/app/driver:401'],
    ['/app/', '/app/'],
    ['/results?x=1,/app/driver?tab=2', '/app/driver?tab=2'],
    ['/a b', '/a b'],
    ['/a#b', '/a#b'],
    ['/x/:lang', '/x/:lang'],
    ['/café', '/café'],
    ['/a;touch', '/a;touch'],
    ['/ok,,/app/x', '/app/x'],
  ])
    it(`exits 64 naming ${JSON.stringify(named)} and starts nothing`, () => {
      const r = run(routes);
      assert.equal(r.status, 64, r.stderr);
      assert.ok(r.stderr.split('\n').some((l) => l.includes(named)), r.stderr);
      assert.equal(calls(), '');
    });

  it('prints one line per refused route', () => {
    const r = run('/app/a,/app/b,/fine,/c d');
    assert.equal(r.status, 64);
    const lines = r.stderr.trim().split('\n').filter((l) => /^\/(app\/a|app\/b|c d)\b/.test(l.trim()) || l.includes('/app/a') || l.includes('/app/b') || l.includes('/c d'));
    assert.equal(lines.length, 3, r.stderr);
  });
});
