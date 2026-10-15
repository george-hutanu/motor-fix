// @traces 1230-FR-006 1230-FR-007 1230-FR-008
import { afterEach, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { checkLive } from './precheck.mjs';
import { SEEDED } from './endpoints.mjs';

const SCRIPT = join(import.meta.dirname, 'precheck.mjs');
const servers = [];
const dirs = [];
afterEach(async () => {
  while (servers.length) await new Promise((r) => servers.pop().close(r));
  while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true });
});

async function serve(handler) {
  const server = createServer(handler);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  servers.push(server);
  return `http://127.0.0.1:${server.address().port}`;
}

async function stack({ web = 200, health = 200 } = {}) {
  const seen = [];
  const webURL = await serve((req, res) => (res.writeHead(web).end('ok')));
  const apiURL = await serve((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, body: raw ? JSON.parse(raw) : null });
      if (req.url === '/api/v1/auth/sign-in') return res.writeHead(200, { 'content-type': 'application/json', 'set-cookie': 'mf_refresh=rt-9; Path=/' }).end('{"accessToken":"at"}');
      if (req.url.startsWith('/health')) return res.writeHead(health).end('ok');
      res.writeHead(200).end('{}');
    });
  });
  return { webURL, apiURL, seen };
}

const closed = async () => {
  const s = createServer();
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const { port } = s.address();
  await new Promise((r) => s.close(r));
  return `http://127.0.0.1:${port}`;
};

function flows(body) {
  const dir = mkdtempSync(join(tmpdir(), 'precheck-live-adv-'));
  dirs.push(dir);
  const file = join(dir, 'flows.mjs');
  writeFileSync(file, body);
  return file;
}

const cli = (file, { webURL, apiURL }, extra = [], env = {}) =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, [SCRIPT, '--flows', file, '--check', '--base-url', webURL, '--api-url', apiURL, ...extra], { env: { ...process.env, ...env } });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => (stdout += c));
    child.stderr.on('data', (c) => (stderr += c));
    const timer = setTimeout(() => child.kill(), 20_000);
    child.on('close', (code) => (clearTimeout(timer), resolve({ code, stdout, stderr, lines: stdout.split('\n').filter(Boolean) })));
  });

describe('--check against a served app', () => {
  it('is silent and exits 0 for a flow that finds nothing', async () => {
    const r = await cli(flows('export default async () => [];'), await stack());
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.equal(r.stdout, '');
  });

  it('exits 0 for a flow that returns nothing at all', async () => {
    const r = await cli(flows('export default async () => {};'), await stack());
    assert.equal(r.code, 0, r.stdout + r.stderr);
  });

  it('hands the flow the run\'s whole argument set', async () => {
    const file = flows(`export default async (a) => {
  const need = ['baseURL','apiURL','signIn','health','ready','waitForText','openSheet','stepButton','accounts'];
  const missing = need.filter((k) => a[k] === undefined);
  return missing.length ? [{ severity: 'high', title: 'missing ' + missing.join(',') }] : [];
};`);
    const s = await stack();
    const r = await cli(file, s);
    assert.equal(r.code, 0, r.stdout);
  });

  it('hands over the addresses it was given, and the same accounts the API calls use', async () => {
    const s = await stack();
    const file = flows(`import { SEEDED } from ${JSON.stringify(new URL('./endpoints.mjs', import.meta.url).href)};
export default async (a) => {
  const bad = [];
  if (a.baseURL !== ${JSON.stringify(s.webURL)}) bad.push('base ' + a.baseURL);
  if (a.apiURL !== ${JSON.stringify(s.apiURL)}) bad.push('api ' + a.apiURL);
  if (JSON.stringify(a.accounts) !== JSON.stringify(SEEDED)) bad.push('accounts');
  return bad.map((t) => ({ severity: 'high', title: t }));
};`);
    const r = await cli(file, s);
    assert.equal(r.code, 0, r.stdout);
  });

  it('prints one line per finding and exits 1', async () => {
    const file = flows(`export default async () => [{ severity: 'high', title: 'bell is silent', steps: ['open', 'wait'] }, { severity: 'low', title: 'tiny' }];`);
    const r = await cli(file, await stack());
    assert.equal(r.code, 1);
    assert.equal(r.lines.length, 2, r.stdout);
    assert.match(r.lines[0], /bell is silent/);
    assert.match(r.lines[1], /tiny/);
  });

  it('prints a throw as one line naming its message and exits 1', async () => {
    const r = await cli(flows(`export default async () => { throw new Error('fakeServer is not defined'); };`), await stack());
    assert.equal(r.code, 1);
    assert.equal(r.lines.length, 1, r.stdout);
    assert.match(r.lines[0], /fakeServer is not defined/);
  });

  it('prints a synchronous throw too', async () => {
    const r = await cli(flows(`export default () => { throw new Error('sync boom'); };`), await stack());
    assert.equal(r.code, 1);
    assert.match(r.stdout, /sync boom/);
  });

  it('prints a thrown non-error as a line', async () => {
    const r = await cli(flows(`export default async () => { throw 'a plain string'; };`), await stack());
    assert.equal(r.code, 1);
    assert.match(r.stdout, /a plain string/);
  });

  it('turns an unawaited rejection into a line and exits 1 instead of crashing', async () => {
    const r = await cli(flows(`export default async () => { Promise.reject(new Error('forgot an await')); return []; };`), await stack());
    assert.equal(r.code, 1);
    assert.match(r.stdout, /forgot an await/);
    assert.doesNotMatch(r.stderr, /unhandled|ERR_UNHANDLED/i);
  });

  it('gives each of two unhandled rejections its own line', async () => {
    const r = await cli(flows(`export default async () => { Promise.reject(new Error('first one')); Promise.reject(new Error('second one')); return []; };`), await stack());
    assert.equal(r.code, 1);
    assert.match(r.stdout, /first one/);
    assert.match(r.stdout, /second one/);
  });

  it('reports a thrown error and a finding together', async () => {
    const r = await cli(flows(`export default async () => { Promise.reject(new Error('stray')); throw new Error('thrown'); };`), await stack());
    assert.equal(r.code, 1);
    assert.match(r.stdout, /thrown/);
    assert.match(r.stdout, /stray/);
  });

  it('signs a seeded account in for real with the seed password', async () => {
    const s = await stack();
    const file = flows(`export default async (a) => {
  const cookies = [];
  await a.signIn({ addInitScript: async () => {}, addCookies: async (c) => cookies.push(...c) }, 'driver');
  return cookies.length === 1 && cookies[0].value === 'rt-9' ? [] : [{ severity: 'high', title: 'cookie ' + JSON.stringify(cookies) }];
};`);
    const r = await cli(file, s, [], { SEED_PASSWORD: 'pw-from-env' });
    assert.equal(r.code, 0, r.stdout);
    const call = s.seen.find((c) => c.url === '/api/v1/auth/sign-in');
    assert.equal(call.body.email, SEEDED.driver);
    assert.equal(call.body.password, 'pw-from-env');
  });

  it('does not touch the API when the flow does not sign in', async () => {
    const s = await stack();
    await cli(flows('export default async () => [];'), s);
    assert.deepEqual(s.seen.filter((c) => c.method !== 'GET'), []);
  });
});

describe('--check against what is not there', () => {
  it('says the app is not reachable in one line and exits 1 when nothing serves at the web address', async () => {
    const s = await stack();
    const r = await cli(flows('export default async () => [];'), { webURL: await closed(), apiURL: s.apiURL });
    assert.equal(r.code, 1);
    assert.equal(r.lines.length, 1, r.stdout);
    assert.match(r.lines[0], /app/i);
  });

  it('says the API is not reachable in one line and exits 1', async () => {
    const s = await stack();
    const r = await cli(flows('export default async () => [];'), { webURL: s.webURL, apiURL: await closed() });
    assert.equal(r.code, 1);
    assert.equal(r.lines.length, 1, r.stdout);
    assert.match(r.lines[0], /API/);
  });

  it('names both when neither is up, and never runs the flow', async () => {
    const marker = join(tmpdir(), `ran-${process.pid}-${Date.now()}`);
    const file = flows(`import { writeFileSync } from 'node:fs'; export default async () => { writeFileSync(${JSON.stringify(marker)}, 'x'); return []; };`);
    const r = await cli(file, { webURL: await closed(), apiURL: await closed() });
    assert.equal(r.code, 1);
    assert.equal(r.lines.length, 2, r.stdout);
    const { existsSync } = await import('node:fs');
    assert.equal(existsSync(marker), false);
  });

  it('treats a 5xx from the app as not serving', async () => {
    const r = await cli(flows('export default async () => [];'), await stack({ web: 503 }));
    assert.equal(r.code, 1);
    assert.match(r.stdout, /503/);
  });

  it('treats a failing API health as not serving', async () => {
    const r = await cli(flows('export default async () => [];'), await stack({ health: 500 }));
    assert.equal(r.code, 1);
    assert.match(r.stdout, /500/);
  });

  it('exits 1 on a flows file that does not load, with a line', async () => {
    const r = await cli(flows('export default async ( => ;'), await stack());
    assert.equal(r.code, 1);
    assert.ok(r.lines.length >= 1);
  });

  it('exits 1 on a flows file with no default function', async () => {
    const r = await cli(flows('export const x = 1;'), await stack());
    assert.equal(r.code, 1);
    assert.match(r.stdout, /default/i);
  });

  it('exits 64 on a flows file that does not exist', async () => {
    const r = await cli(join(tmpdir(), 'no-such-flows.mjs'), await stack());
    assert.equal(r.code, 64);
  });
});

describe('checkLive', () => {
  it('returns no lines for a clean flow and the line for a finding', async () => {
    const s = await stack();
    assert.deepEqual(await checkLive({ flows: flows('export default async () => [];'), baseURL: s.webURL, apiURL: s.apiURL }), []);
    const lines = await checkLive({ flows: flows(`export default async () => [{ severity: 'medium', title: 'odd' }];`), baseURL: s.webURL, apiURL: s.apiURL });
    assert.equal(lines.length, 1);
    assert.match(lines[0], /medium/);
    assert.match(lines[0], /odd/);
  });

  it('runs a flows file again after it changed on disk', async () => {
    const s = await stack();
    const file = flows(`export default async () => [];`);
    assert.deepEqual(await checkLive({ flows: file, baseURL: s.webURL, apiURL: s.apiURL }), []);
    writeFileSync(file, `export default async () => [{ severity: 'high', title: 'now broken' }];`);
    assert.equal((await checkLive({ flows: file, baseURL: s.webURL, apiURL: s.apiURL })).length, 1);
  });

  it('leaves the process with the listeners it started with', async () => {
    const s = await stack();
    const before = process.listenerCount('unhandledRejection');
    await checkLive({ flows: flows(`export default async () => { throw new Error('x'); };`), baseURL: s.webURL, apiURL: s.apiURL });
    assert.equal(process.listenerCount('unhandledRejection'), before);
  });
});
