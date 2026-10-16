import { afterEach, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { waitForCi } from './ci-wait.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'ci-wait.mjs');

function world({ runs = [{ status: 'completed', conclusion: 'success' }], checks = [[{ name: 'CI OK', bucket: 'pending' }]], mergeable = ['MERGEABLE'], runCode = 0 } = {}) {
  const calls = [];
  let t = 0;
  const next = (list) => (list.length > 1 ? list.shift() : list[0]);
  const gh = async (args) => {
    calls.push(args.join(' '));
    if (args[0] === 'pr' && args[1] === 'checks') return { code: 0, stdout: JSON.stringify(next(checks)), stderr: '' };
    if (args[0] === 'pr' && args[1] === 'view') return { code: 0, stdout: JSON.stringify({ mergeable: next(mergeable) }), stderr: '' };
    if (args[0] === 'run' && args[1] === 'view') return runCode ? { code: runCode, stdout: '', stderr: 'HTTP 502' } : { code: 0, stdout: JSON.stringify(next(runs)), stderr: '' };
    return { code: 1, stdout: '', stderr: 'no route' };
  };
  return { calls, gh, sleep: async (ms) => { t += ms; }, now: () => t };
}
const checksCalls = (w) => w.calls.filter((c) => c.startsWith('pr checks'));

describe('ci-wait with --run', () => {
  it('ends on a finished run while CI is still pending and never reads the checks', async () => {
    const w = world();
    const out = await waitForCi({ pr: 5, run: 99, gh: w.gh, sleep: w.sleep, now: w.now });
    assert.deepEqual(out, { code: 0, lines: ['QA run: success'] });
    assert.equal(checksCalls(w).length, 0);
  });

  it('ends on a finished run while CI has failed, without printing the failing check', async () => {
    const w = world({ checks: [[{ name: 'Checks', bucket: 'fail' }]] });
    const out = await waitForCi({ pr: 5, run: 99, gh: w.gh, sleep: w.sleep, now: w.now });
    assert.deepEqual(out, { code: 0, lines: ['QA run: success'] });
  });

  it('reports a failed or cancelled conclusion with exit 0 so the tail can review it', async () => {
    for (const conclusion of ['failure', 'cancelled', 'timed_out']) {
      const w = world({ runs: [{ status: 'completed', conclusion }] });
      const out = await waitForCi({ pr: 5, run: 99, gh: w.gh, sleep: w.sleep, now: w.now });
      assert.deepEqual(out, { code: 0, lines: [`QA run: ${conclusion}`] });
    }
  });

  it('polls an in-progress run until it completes', async () => {
    const w = world({ runs: [{ status: 'queued' }, { status: 'in_progress' }, { status: 'completed', conclusion: 'success' }] });
    const out = await waitForCi({ pr: 5, run: 99, gh: w.gh, sleep: w.sleep, now: w.now });
    assert.equal(out.code, 0);
    assert.equal(w.calls.filter((c) => c.startsWith('run view')).length, 3);
  });

  // @traces 1323-FR-005 — a run already completed returns before any other read; the merge gate still refuses a conflicting PR
  it('returns a finished run at once, before reading whether the PR conflicts', async () => {
    const w = world({ mergeable: ['CONFLICTING'] });
    const out = await waitForCi({ pr: 5, run: 99, gh: w.gh, sleep: w.sleep, now: w.now });
    assert.deepEqual(out, { code: 0, lines: ['QA run: success'] });
    assert.deepEqual(w.calls, ['run view 99 --json status,conclusion']);
  });

  it('exits 3 when the PR turns conflicting while the run is still going', async () => {
    const w = world({ runs: [{ status: 'in_progress' }], mergeable: ['MERGEABLE', 'CONFLICTING'] });
    const out = await waitForCi({ pr: 5, run: 99, gh: w.gh, sleep: w.sleep, now: w.now });
    assert.equal(out.code, 3);
  });

  it('exits 1 once the wait limit passes with the run still going', async () => {
    const w = world({ runs: [{ status: 'in_progress' }] });
    const out = await waitForCi({ pr: 5, run: 99, gh: w.gh, sleep: w.sleep, now: w.now, waitMs: 60_000, pollMs: 15_000 });
    assert.equal(out.code, 1);
    assert.match(out.lines[0], /QA run: still in_progress/);
  });

  it('exits 2 when gh cannot read the run', async () => {
    const w = world({ runCode: 1 });
    const out = await waitForCi({ pr: 5, run: 99, gh: w.gh, sleep: w.sleep, now: w.now });
    assert.equal(out.code, 2);
  });
});

describe('ci-wait without --run', () => {
  it('waits for CI and never reads the QA run', async () => {
    const w = world({ checks: [[{ name: 'CI OK', bucket: 'pending' }], [{ name: 'CI OK', bucket: 'pass' }]] });
    const out = await waitForCi({ pr: 5, gh: w.gh, sleep: w.sleep, now: w.now });
    assert.deepEqual(out, { code: 0, lines: [] });
    assert.equal(w.calls.filter((c) => c.startsWith('run view')).length, 0);
  });

  it('treats an empty check list after the no-checks limit as a limit, exit 1', async () => {
    const w = world({ checks: [[]] });
    const out = await waitForCi({ pr: 5, gh: w.gh, sleep: w.sleep, now: w.now, noChecksMs: 30_000, pollMs: 15_000 });
    assert.equal(out.code, 1);
  });

  it('lists a cancelled check as not passing', async () => {
    const w = world({ checks: [[{ name: 'Unit', bucket: 'cancel' }, { name: 'CI OK', bucket: 'pass' }]] });
    const out = await waitForCi({ pr: 5, gh: w.gh, sleep: w.sleep, now: w.now });
    assert.deepEqual(out, { code: 0, lines: ['Unit: cancel'] });
  });
});

describe('ci-wait command line', () => {
  const cli = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', timeout: 20_000 });
  it('rejects a bad usage with exit 64', () => {
    for (const args of [[], ['abc'], ['5', '--run'], ['5', '--run', 'abc'], ['5', '--runs', '9'], ['5', '--run', '-1'], ['5', '--run', '9; rm -rf /']]) {
      assert.equal(cli(...args).status, 64, JSON.stringify(args));
    }
  });
});
