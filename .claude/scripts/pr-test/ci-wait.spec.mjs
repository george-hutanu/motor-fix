import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

import { waitForCi } from './ci-wait.mjs';

// A fake gh that answers each call from the next entry of a script per route,
// and a clock that the sleeps advance, so no test waits for real.
function world({ checks = [], run = [] } = {}) {
  const calls = [];
  let t = 0;
  const next = (list) => (list.length > 1 ? list.shift() : list[0]);
  const gh = async (args) => {
    calls.push(args.join(' '));
    if (args[0] === 'pr' && args[1] === 'checks') {
      const answer = next(checks);
      if (answer === 'none') return { code: 1, stdout: '', stderr: "no checks reported on the '701-x' branch" };
      if (answer === 'error') return { code: 1, stdout: '', stderr: 'HTTP 502' };
      if (answer === 'garbled') return { code: 0, stdout: '<html>', stderr: '' };
      // The cloud's gh.mjs keeps gh's plain exit codes under --json: 8 pending, 1 failing.
      if (answer.cloud) return { code: answer.cloud, stdout: JSON.stringify(answer.checks), stderr: '' };
      return { code: 0, stdout: JSON.stringify(answer), stderr: '' };
    }
    if (args[0] === 'run' && args[1] === 'view') return { code: 0, stdout: JSON.stringify(next(run)), stderr: '' };
    return { code: 1, stdout: '', stderr: `no route for ${args.join(' ')}` };
  };
  const sleep = async (ms) => {
    t += ms;
  };
  return { calls, gh, sleep, now: () => t };
}

const green = [{ name: 'CI OK', bucket: 'pass' }, { name: 'Checks', bucket: 'pass' }];
const done = { status: 'completed', conclusion: 'success' };

describe('waiting for CI and the QA run before the tail starts', () => {
  it('keeps waiting while the PR has no checks yet, instead of ending at once', async () => {
    const w = world({ checks: ['none', [], [{ name: 'CI OK', bucket: 'pending' }], green] });
    const out = await waitForCi({ pr: 21, gh: w.gh, sleep: w.sleep, now: w.now });
    assert.deepEqual(out, { code: 0, lines: [] });
    assert.equal(w.calls.length, 4);
  });

  it('waits out a pending check, then prints only what did not pass', async () => {
    const w = world({ checks: [[{ name: 'Checks', bucket: 'pending' }], [{ name: 'Checks', bucket: 'fail' }, { name: 'Docs', bucket: 'skipping' }, { name: 'CI OK', bucket: 'pass' }]] });
    const out = await waitForCi({ pr: 21, gh: w.gh, sleep: w.sleep, now: w.now });
    assert.deepEqual(out, { code: 0, lines: ['Checks: fail'] });
  });

  it('waits for the QA run to finish too, and prints its conclusion', async () => {
    const w = world({ checks: [green], run: [{ status: 'in_progress', conclusion: '' }, done] });
    const out = await waitForCi({ pr: 21, run: '123', gh: w.gh, sleep: w.sleep, now: w.now });
    assert.deepEqual(out, { code: 0, lines: ['QA run: success'] });
    assert.equal(w.calls.filter((c) => c.startsWith('run view 123')).length, 2);
  });

  it('gives up on a PR that still has no checks after the limit, which the tail treats as a Hard Stop', async () => {
    const w = world({ checks: ['none'] });
    const out = await waitForCi({ pr: 21, gh: w.gh, sleep: w.sleep, now: w.now, noChecksMs: 60_000, pollMs: 15_000 });
    assert.equal(out.code, 1);
    assert.match(out.lines[0], /CI: no checks on #21 after 1 min/);
  });

  it("reads the cloud's checks whatever exit code it gives, so a pending one is still waited for", async () => {
    const w = world({ checks: [{ cloud: 8, checks: [{ name: 'Checks', bucket: 'pending' }] }, { cloud: 1, checks: [{ name: 'Checks', bucket: 'fail' }] }] });
    const out = await waitForCi({ pr: 21, gh: w.gh, sleep: w.sleep, now: w.now });
    assert.deepEqual(out, { code: 0, lines: ['Checks: fail'] });
  });

  it('gives up on CI or a run still pending after the overall limit, so the wait always ends', async () => {
    const stuck = world({ checks: [[{ name: 'agent-review', bucket: 'pending' }]] });
    const ci = await waitForCi({ pr: 21, gh: stuck.gh, sleep: stuck.sleep, now: stuck.now, waitMs: 60_000, pollMs: 15_000 });
    assert.equal(ci.code, 1);
    assert.match(ci.lines[0], /CI: still pending on #21 after 1 min: agent-review/);
    const queued = world({ checks: [green], run: [{ status: 'queued', conclusion: '' }] });
    const run = await waitForCi({ pr: 21, run: '123', gh: queued.gh, sleep: queued.sleep, now: queued.now, waitMs: 60_000, pollMs: 15_000 });
    assert.equal(run.code, 1);
    assert.match(run.lines.at(-1), /QA run: still queued after 1 min/);
  });

  it('reports output it cannot read as a gh failure', async () => {
    const w = world({ checks: ['garbled'] });
    assert.equal((await waitForCi({ pr: 21, gh: w.gh, sleep: w.sleep, now: w.now })).code, 2);
  });

  it('stops on a gh failure rather than reading it as green', async () => {
    const w = world({ checks: ['error'] });
    const out = await waitForCi({ pr: 21, gh: w.gh, sleep: w.sleep, now: w.now });
    assert.equal(out.code, 2);
    assert.match(out.lines[0], /HTTP 502/);
  });
});
