import { afterEach, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { flowArgs, loadFlows, runFlows } from './run.mjs';
import { checkLive } from './precheck.mjs';
import { appEnv } from './services.mjs';

const dirs = [];
const servers = [];
afterEach(async () => {
  while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true });
  while (servers.length) {
    const s = servers.pop();
    s.closeAllConnections?.();
    await new Promise((r) => s.close(r));
  }
});
const file = (body, name = 'flows.mjs', sub = '') => {
  const dir = mkdtempSync(join(tmpdir(), 'flows-adv-'));
  dirs.push(dir);
  const d = sub ? join(dir, sub) : dir;
  mkdirSync(d, { recursive: true });
  const f = join(d, name);
  writeFileSync(f, body);
  return f;
};
const siblings = (f) => readdirSync(join(f, '..'));

describe('loadFlows: networkidle runs as load', () => {
  // @traces 988-FR-004
  it('loads a file with no networkidle through the plain importer, unchanged, with no note', async () => {
    const f = file("export const w = 'load'; export const x = 'networkidle0'; // networkidle\nexport default async () => [];");
    let seen = null;
    const r = await loadFlows(f, async (p) => ((seen = p), { default: 1 }));
    assert.equal(seen, f);
    assert.deepEqual(r.notes, []);
    assert.deepEqual(siblings(f), ['flows.mjs']);
  });

  // @traces 988-FR-004
  it('rewrites single, double and backtick quoted waits and names each line once', async () => {
    const f = file("export const a = 'networkidle';\nexport const b = \"networkidle\"; export const c = `networkidle`;\nexport const d = 'x';\n");
    const { mod, notes } = await loadFlows(f);
    assert.deepEqual([mod.a, mod.b, mod.c], ['load', 'load', 'load']);
    assert.equal(notes.length, 2);
    assert.match(notes[0], /:1:/);
    assert.match(notes[1], /:2:/);
  });

  // @traces 988-FR-004
  it('leaves a bare networkidle identifier and mismatched quotes alone', async () => {
    const f = file("const networkidle = 1;\nexport const a = 'networkidle\";\nexport const b = 'x' + networkidle;\n".replace("'networkidle\";", "'networkidle0';"));
    const r = await loadFlows(f);
    assert.deepEqual(r.notes, []);
  });

  // @traces 988-FR-004
  it('resolves a relative import from the flows folder and leaves no copy behind', async () => {
    const f = file("import { v } from './dep.mjs';\nexport const w = 'networkidle'; export const v2 = v;\n");
    writeFileSync(join(f, '..', 'dep.mjs'), 'export const v = 42;');
    const { mod } = await loadFlows(f);
    assert.equal(mod.v2, 42);
    assert.equal(mod.w, 'load');
    assert.deepEqual(siblings(f).sort(), ['dep.mjs', 'flows.mjs']);
  });

  // @traces 988-FR-004
  it('removes its copy and rejects when the rewritten file throws on import', async () => {
    const f = file("export const w = 'networkidle'; throw new Error('boom at import');\n");
    await assert.rejects(() => loadFlows(f), /boom at import/);
    assert.deepEqual(siblings(f), ['flows.mjs']);
  });

  // @traces 988-FR-004
  it('loads a file in a folder with a space and CRLF line endings', async () => {
    const f = file("export const w = 'networkidle';\r\nexport const z = 1;\r\n", 'my flows.mjs', 'a b');
    const { mod, notes } = await loadFlows(f);
    assert.equal(mod.w, 'load');
    assert.equal(notes.length, 1);
    assert.deepEqual(siblings(f), ['my flows.mjs']);
  });

  // @traces 988-FR-004
  it('loads the same file twice with the same result', async () => {
    const f = file("export const w = 'networkidle';\n");
    const a = await loadFlows(f);
    const b = await loadFlows(f);
    assert.equal(a.mod.w, b.mod.w);
    assert.deepEqual(a.notes, b.notes);
  });

  // @traces 988-FR-004
  it('rejects a missing file', async () => {
    await assert.rejects(() => loadFlows(join(tmpdir(), 'nope-988', 'flows.mjs')), /ENOENT/);
  });
});

describe('runFlows: findings a flow pushed', () => {
  // @traces 988-FR-005
  it('keeps what was pushed when the flow then throws, and rethrows', async () => {
    const findings = [];
    const f1 = { severity: 'high', title: 'one' };
    const f2 = { severity: 'low', title: 'two' };
    await assert.rejects(() => runFlows(async () => (findings.push(f1, f2), Promise.reject(new Error('timed out'))), findings), /timed out/);
    assert.deepEqual(findings, [f1, f2]);
  });

  // @traces 988-FR-005
  it('counts a finding pushed and returned once', async () => {
    const findings = [];
    const f = { severity: 'high', title: 'x' };
    const added = await runFlows(async () => (findings.push(f), [f]), findings);
    assert.deepEqual(findings, [f]);
    assert.deepEqual(added, []);
  });

  // @traces 988-FR-005
  it('keeps pushed findings first and appends a different returned one', async () => {
    const findings = [];
    const p = { title: 'p' };
    const r = { title: 'r' };
    await runFlows(async () => (findings.push(p), [r]), findings);
    assert.deepEqual(findings, [p, r]);
  });

  // @traces 988-FR-005
  it('treats null, undefined and an empty array as nothing returned', async () => {
    for (const v of [null, undefined, []]) {
      const findings = [];
      assert.deepEqual(await runFlows(async () => v, findings), []);
      assert.deepEqual(findings, []);
    }
  });

  // @traces 988-FR-005
  it('keeps two distinct findings with equal content', async () => {
    const findings = [];
    await runFlows(async () => [{ title: 'same' }, { title: 'same' }], findings);
    assert.equal(findings.length, 2);
  });

  // @traces 988-FR-005
  it('keeps ten thousand pushed findings', async () => {
    const findings = [];
    await runFlows(async () => {
      for (let i = 0; i < 10000; i++) findings.push({ title: String(i) });
    }, findings);
    assert.equal(findings.length, 10000);
  });

  // @traces 988-FR-005
  it('hands the flow the very array in flowArgs', () => {
    const findings = [];
    const a = flowArgs({ webURL: 'http://w', apiURL: 'http://a', outDir: '/o', repoRoot: '/r', worktree: '/r', session: {}, findings });
    assert.equal(a.findings, findings);
  });
});

async function serve(handler) {
  const server = createServer(handler);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  servers.push(server);
  return `http://127.0.0.1:${server.address().port}`;
}

describe('a flow that waits for networkidle on a page holding a stream', { timeout: 30_000 }, () => {
  // @traces 988-FR-004
  it('finishes inside its bound under checkLive, with the note and no finding', async () => {
    const webURL = await serve((req, res) => {
      if (req.url === '/live') {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.write('<html><body>hi<script>new EventSource("/stream")</script></body></html>');
        return res.end();
      }
      if (req.url === '/stream') {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        const t = setInterval(() => res.write('data: x\n\n'), 200);
        return req.on('close', () => clearInterval(t));
      }
      res.writeHead(200).end('ok');
    });
    const apiURL = await serve((req, res) => res.writeHead(200).end('{}'));
    const f = file(`export default async ({ baseURL }) => {
  const { chromium } = await import('@playwright/test');
  const b = await chromium.launch();
  try {
    const p = await b.newPage();
    await p.goto(baseURL + '/live', { waitUntil: 'networkidle', timeout: 8000 });
    return [];
  } finally { await b.close(); }
};`);
    const t0 = Date.now();
    const lines = await checkLive({ flows: f, baseURL: webURL, apiURL });
    assert.ok(Date.now() - t0 < 25000);
    assert.equal(lines.filter((l) => l.startsWith('finding') || l.startsWith('flows threw')).length, 0, lines.join('\n'));
    assert.equal(lines.filter((l) => l.startsWith('note:')).length, 1);
    assert.match(lines.find((l) => l.startsWith('note:')), /:\d+:/);
  }, 40000);
});

describe('PLAUSIBLE_DOMAIN in the QA environment', () => {
  // @traces 988-FR-007
  it('is a bare lower-case domain name the env parser shape accepts, under a reserved suffix', () => {
    const d = appEnv({ ports: { postgres: 1, redis: 2, storage: 3 } }).PLAUSIBLE_DOMAIN;
    assert.match(d, /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/);
    assert.match(d, /\.(invalid|test|example|localhost)$/);
  });

  // @traces 988-FR-007
  it('is the same on every call and with other ports', () => {
    const a = appEnv({ ports: { postgres: 1, redis: 2, storage: 3 } }).PLAUSIBLE_DOMAIN;
    const b = appEnv({ ports: { postgres: 9, redis: 8, storage: 7 } }).PLAUSIBLE_DOMAIN;
    assert.equal(a, b);
  });
});
