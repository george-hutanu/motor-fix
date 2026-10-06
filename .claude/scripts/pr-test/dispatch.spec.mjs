import { afterAll, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';

import {
  ARTIFACT_PREFIX,
  FLOWS_LIMIT,
  WORKFLOW,
  artifactName,
  checkReport,
  clearPrevious,
  dispatchCommand,
  dispatchInputs,
  encodeFlows,
  findRun,
  parseArgs,
  placeDownload,
  stagingDir,
} from './dispatch.mjs';

const SHA = 'a'.repeat(40);

describe('dispatch: arguments', () => {
  it('reads the PR, the flows, the routes, the lap, the output and the ref', () => {
    const o = parseArgs(['62', '--flows', 'f.mjs', '--routes', '/,/cockpit,/app', '--lap', '2', '--out', '/tmp/x', '--ref', 'chore-x']);
    assert.deepEqual(o, { pr: '62', flows: 'f.mjs', routes: '/,/cockpit,/app', lap: '2', out: '/tmp/x', ref: 'chore-x', noWait: false, run: undefined });
  });

  it('dispatches on main, lap 1, the default routes, without flows', () => {
    assert.deepEqual(parseArgs(['7']), { pr: '7', flows: undefined, routes: '/,/cockpit', lap: '1', out: undefined, ref: 'main', noWait: false, run: undefined });
  });

  it('reads the start-only form and the read-a-finished-run form', () => {
    assert.equal(parseArgs(['7', '--no-wait']).noWait, true);
    const o = parseArgs(['7', '--run', '123456']);
    assert.equal(o.run, '123456');
    assert.equal(o.pr, '7');
  });
});

describe('dispatch: the flows file travels as a workflow input', () => {
  it('is gzipped, then base64, and decodes back to the same text', () => {
    const text = `export default async () => [];\n// ${'ș'.repeat(500)}\n`;
    const encoded = encodeFlows(text);
    assert.match(encoded, /^[A-Za-z0-9+/]+=*$/);
    assert.equal(gunzipSync(Buffer.from(encoded, 'base64')).toString('utf8'), text);
  });

  it('refuses a file whose encoding would not fit GitHub\'s input limit, and says what to do', () => {
    assert.ok(FLOWS_LIMIT < 65535);
    const big = randomBytes(FLOWS_LIMIT).toString('hex');
    assert.throws(() => encodeFlows(big), /too large.*--local/s);
  });

  it('sends every input as a string, the flows empty when there are none', () => {
    const inputs = dispatchInputs({ pr: 62, sha: SHA, lap: 1, routes: '/,/cockpit', flows: null, nonce: 'n1' });
    assert.deepEqual(inputs, { pr: '62', sha: SHA, lap: '1', routes: '/,/cockpit', flows: '', nonce: 'n1' });
  });

  it('pins the run to the commit it was asked about', () => {
    assert.throws(() => dispatchInputs({ pr: 62, sha: 'abc1234', lap: 1, routes: '/', flows: null, nonce: 'n' }), /40/);
  });

  it('passes the inputs on stdin, never on the command line', () => {
    const { args, input } = dispatchCommand({ ref: 'main', inputs: { pr: '62', flows: 'x'.repeat(50000) } });
    assert.deepEqual(args, ['workflow', 'run', WORKFLOW, '--ref', 'main', '--json']);
    assert.equal(JSON.parse(input).flows.length, 50000);
  });
});

describe('dispatch: finding the run and its evidence', () => {
  it('finds the dispatched run by the nonce in its name', () => {
    const runs = [
      { databaseId: 1, displayTitle: 'PR QA #62 at aaa lap 1 62-aaaaaaa-old', url: 'u1' },
      { databaseId: 2, displayTitle: 'PR QA #62 at aaa lap 1 62-aaaaaaa-new', url: 'u2' },
    ];
    assert.equal(findRun(runs, '62-aaaaaaa-new').databaseId, 2);
    assert.equal(findRun(runs, 'missing'), null);
  });

  it('names the artifact the way the workflow uploads it', () => {
    assert.equal(artifactName(62), `${ARTIFACT_PREFIX}62`);
  });

  it('accepts a report about the commit it dispatched, and nothing else', () => {
    assert.equal(checkReport({ sha: SHA, verdict: 'success' }, SHA), null);
    assert.match(checkReport(null, SHA), /no report/);
    assert.match(checkReport({ sha: 'b'.repeat(40), verdict: 'success' }, SHA), /bbbbbbb/);
    assert.match(checkReport({ sha: SHA }, SHA), /verdict/);
  });

  it('never reads a cancelled run as a verdict, even when it left a report', () => {
    assert.match(checkReport({ sha: SHA, verdict: 'failure' }, SHA, 'cancelled'), /cancelled/);
    assert.match(checkReport({ sha: SHA, verdict: 'success' }, SHA, 'cancelled'), /cancelled/);
    assert.equal(checkReport({ sha: SHA, verdict: 'failure' }, SHA, 'failure'), null);
  });
});

describe('dispatch: a lap never reads the last lap\'s evidence', () => {
  it('clears the previous report and screenshots before downloading, so a run that uploaded nothing leaves no report', () => {
    const out = mkdtempSync(join(tmpdir(), 'dispatch-spec-'));
    writeFileSync(join(out, 'report.json'), JSON.stringify({ sha: SHA, verdict: 'success' }));
    writeFileSync(join(out, 'report.md'), 'old');
    mkdirSync(join(out, 'shots'));
    writeFileSync(join(out, 'shots', 'a.png'), 'x');
    clearPrevious(out);
    for (const f of ['report.json', 'report.md', 'shots']) assert.equal(existsSync(join(out, f)), false, f);
    assert.match(checkReport(null, SHA, 'failure'), /no report/);
  });
});

describe('dispatch: a lap downloads into a fresh folder, so files from an earlier run never refuse the download', () => {
  it('gives every download its own empty folder inside --out', () => {
    const out = mkdtempSync(join(tmpdir(), 'dispatch-spec-'));
    const a = stagingDir(out);
    const b = stagingDir(out);
    assert.notEqual(a, b);
    for (const d of [a, b]) {
      assert.equal(join(d, '..'), out);
      assert.deepEqual(readdirSync(d), []);
    }
  });

  it('replaces what the new artifact carries, keeps everything else in --out, and removes its own folder', () => {
    const out = mkdtempSync(join(tmpdir(), 'dispatch-spec-'));
    writeFileSync(join(out, 'observations.json'), 'old');
    mkdirSync(join(out, 'shots'));
    writeFileSync(join(out, 'shots', 'old.png'), 'x');
    writeFileSync(join(out, 'notes.txt'), 'mine');
    const staging = stagingDir(out);
    writeFileSync(join(staging, 'observations.json'), 'new');
    writeFileSync(join(staging, 'report.json'), JSON.stringify({ sha: SHA, verdict: 'success' }));
    mkdirSync(join(staging, 'shots'));
    writeFileSync(join(staging, 'shots', 'new.png'), 'y');
    placeDownload(staging, out);
    assert.equal(readFileSync(join(out, 'observations.json'), 'utf8'), 'new');
    assert.equal(existsSync(join(out, 'report.json')), true);
    assert.deepEqual(readdirSync(join(out, 'shots')), ['new.png']);
    assert.equal(readFileSync(join(out, 'notes.txt'), 'utf8'), 'mine');
    assert.equal(existsSync(staging), false);
  });

  it('refuses a folder that is not directly inside --out, so it never deletes outside the run\'s folder', () => {
    const out = mkdtempSync(join(tmpdir(), 'dispatch-spec-'));
    const elsewhere = mkdtempSync(join(tmpdir(), 'dispatch-spec-'));
    assert.throws(() => placeDownload(elsewhere, out), /not a download folder/);
    assert.equal(existsSync(elsewhere), true);
    const unprefixed = mkdtempSync(join(out, 'x-'));
    assert.throws(() => placeDownload(unprefixed, out), /not a download folder/);
    assert.equal(existsSync(unprefixed), true);
  });

  it('clears a download folder an interrupted lap left behind', () => {
    const out = mkdtempSync(join(tmpdir(), 'dispatch-spec-'));
    const left = stagingDir(out);
    writeFileSync(join(left, 'observations.json'), 'old');
    writeFileSync(join(out, 'notes.txt'), 'mine');
    clearPrevious(out);
    assert.equal(existsSync(left), false);
    assert.equal(existsSync(join(out, 'notes.txt')), true);
  });
});

// A fake `gh` on PATH: it answers the calls dispatch.mjs makes and logs every one.
const SCRIPT = join(import.meta.dirname, 'dispatch.mjs');
const FAKE_GH = `#!/usr/bin/env node
const { appendFileSync, readFileSync, writeFileSync, mkdirSync } = require('node:fs');
const { join } = require('node:path');
const dir = process.env.FAKE_GH_DIR;
const args = process.argv.slice(2);
appendFileSync(join(dir, 'calls.log'), args.join(' ') + '\\n');
const say = (v) => process.stdout.write(typeof v === 'string' ? v : JSON.stringify(v));
const [a, b] = args;
if (a === 'pr' && b === 'view') say({ state: 'OPEN', headRefOid: process.env.FAKE_HEAD });
else if (a === 'workflow' && b === 'run') writeFileSync(join(dir, 'nonce'), JSON.parse(readFileSync(0, 'utf8')).nonce);
else if (a === 'run' && b === 'list') {
  if (process.env.FAKE_NO_RUN) say([]);
  else say([{ databaseId: 77, displayTitle: 'PR QA ' + readFileSync(join(dir, 'nonce'), 'utf8'), url: 'https://x/runs/77' }]);
} else if (a === 'run' && b === 'view') {
  const run = { status: process.env.FAKE_STATUS || 'completed', conclusion: process.env.FAKE_CONCLUSION || 'success', url: 'https://x/runs/77' };
  const q = args.indexOf('-q');
  say(q === -1 ? run : String(run[args[q + 1].slice(1)]));
} else if (a === 'run' && b === 'download') {
  const out = args[args.indexOf('-D') + 1];
  mkdirSync(out, { recursive: true });
  if (process.env.FAKE_REPORT_SHA) writeFileSync(join(out, 'report.json'), JSON.stringify({ sha: process.env.FAKE_REPORT_SHA, verdict: process.env.FAKE_VERDICT || 'success', summary: 'ok.' }));
}
`;

const fakeDirs = [];
afterAll(() => {
  for (const dir of fakeDirs) rmSync(dir, { recursive: true, force: true });
});

function fakeGh(env = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'dispatch-gh-'));
  fakeDirs.push(dir);
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'gh'), FAKE_GH);
  chmodSync(join(bin, 'gh'), 0o755);
  const out = join(dir, 'out');
  const run = (...args) => {
    const r = spawnSync(process.execPath, [SCRIPT, '62', '--out', out, ...args], {
      encoding: 'utf8',
      timeout: 15_000,
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, FAKE_GH_DIR: dir, FAKE_HEAD: SHA, PR_QA_POLL_MS: '1', ...env },
    });
    const calls = existsSync(join(dir, 'calls.log')) ? readFileSync(join(dir, 'calls.log'), 'utf8').trim().split('\n') : [];
    return { code: r.status, stdout: r.stdout, stderr: r.stderr, calls, out };
  };
  return run;
}

const called = (calls, prefix) => calls.filter((c) => c.startsWith(prefix));

describe('dispatch --no-wait: start the run, record it and end', () => {
  it('dispatches once, prints the hand-off line and never watches or downloads', () => {
    const r = fakeGh()('--no-wait', '--lap', '2');
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stdout.trim(), `- QA run: 77 · head ${SHA} · lap 2 · https://x/runs/77`);
    assert.equal(called(r.calls, 'workflow run').length, 1);
    assert.deepEqual(called(r.calls, 'run watch'), []);
    assert.deepEqual(called(r.calls, 'run download'), []);
  });

  it('exits 2 with no hand-off line when the run never appears', () => {
    const r = fakeGh({ FAKE_NO_RUN: '1' })('--no-wait');
    assert.equal(r.code, 2);
    assert.equal(r.stdout.trim(), '');
    assert.match(r.stderr, /no pr-qa\.yml run/);
  });
});

describe('dispatch --run <id>: read a finished run, start nothing', () => {
  it('dispatches nothing and downloads that run\'s artifact into --out', () => {
    const r = fakeGh({ FAKE_REPORT_SHA: SHA })('--run', '77');
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(called(r.calls, 'workflow run'), []);
    assert.deepEqual(called(r.calls, 'run watch'), []);
    assert.equal(called(r.calls, 'run download 77').length, 1);
    assert.equal(JSON.parse(readFileSync(join(r.out, 'report.json'), 'utf8')).sha, SHA);
    assert.equal(JSON.parse(readFileSync(join(r.out, 'ci-run.json'), 'utf8')).id, 77);
  });

  it('exits 1 on a failing report, as a dispatched lap does', () => {
    assert.equal(fakeGh({ FAKE_REPORT_SHA: SHA, FAKE_VERDICT: 'failure', FAKE_CONCLUSION: 'failure' })('--run', '77').code, 1);
  });

  it('exits 2 on a run not yet completed, naming its status, and downloads nothing', () => {
    const r = fakeGh({ FAKE_STATUS: 'in_progress', FAKE_REPORT_SHA: SHA })('--run', '77');
    assert.equal(r.code, 2);
    assert.match(r.stderr, /in_progress/);
    assert.deepEqual(called(r.calls, 'run download'), []);
    assert.deepEqual(called(r.calls, 'run watch'), []);
  });

  it('refuses a report about another head than the PR\'s, and a cancelled run', () => {
    assert.equal(fakeGh({ FAKE_REPORT_SHA: 'c'.repeat(40) })('--run', '77').code, 2);
    assert.equal(fakeGh({ FAKE_REPORT_SHA: SHA, FAKE_CONCLUSION: 'cancelled' })('--run', '77').code, 2);
  });

  it('refuses an id that is not a run number', () => {
    assert.equal(fakeGh({ FAKE_REPORT_SHA: SHA })('--run', 'latest').code, 64);
  });

  it('refuses --no-wait with --run, which would read a run and wait for nothing', () => {
    const run = fakeGh({ FAKE_REPORT_SHA: SHA });
    const r = run('--run', '77', '--no-wait');
    assert.equal(r.code, 64);
    assert.deepEqual(r.calls, []);
  });
});
