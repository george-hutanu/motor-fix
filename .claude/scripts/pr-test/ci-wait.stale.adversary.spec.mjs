// @traces 1230-FR-010
import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

import { waitForCi } from './ci-wait.mjs';

const link = (id, tail = '') => `https://github.com/george-hutanu/motor-fix/actions/runs/${id}${tail}`;

// Checks and run states are scripted; the clock advances only by sleeping.
function world({ checks, runs = {}, mergeable = 'MERGEABLE' }) {
  const calls = [];
  let t = 0;
  const list = Array.isArray(checks[0]) ? checks : [checks];
  let i = 0;
  const gh = async (args) => {
    calls.push(args.join(' '));
    if (args[0] === 'pr' && args[1] === 'checks') return { code: 0, stdout: JSON.stringify(list[Math.min(i++, list.length - 1)]), stderr: '' };
    if (args[0] === 'pr' && args[1] === 'view') return { code: 0, stdout: JSON.stringify({ mergeable }), stderr: '' };
    if (args[0] === 'run' && args[1] === 'view') {
      const state = runs[args[2]];
      if (state === 'error') return { code: 1, stdout: '', stderr: 'HTTP 502' };
      if (!state) return { code: 1, stdout: '', stderr: 'not found' };
      return { code: 0, stdout: JSON.stringify(typeof state === 'function' ? state() : state), stderr: '' };
    }
    return { code: 1, stdout: '', stderr: 'no route' };
  };
  return { calls, gh, sleep: async (ms) => void (t += ms), now: () => t, elapsed: () => t };
}

const wait = (w, extra = {}) => waitForCi({ pr: 5, gh: w.gh, sleep: w.sleep, now: w.now, ...extra });
const pendingReview = (id, tail) => ({ name: 'agent-review', bucket: 'pending', link: link(id, tail) });
const done = (conclusion) => ({ status: 'completed', conclusion });

describe('a pending agent-review whose run is over', () => {
  for (const conclusion of ['cancelled', 'success', 'failure', 'timed_out', 'skipped']) {
    it(`ends the wait at once with one line and code 1 when its run is ${conclusion}`, async () => {
      const w = world({ checks: [pendingReview(900), { name: 'Checks', bucket: 'pending' }], runs: { 900: done(conclusion) } });
      const out = await wait(w, { pollMs: 15_000 });
      assert.equal(out.code, 1);
      assert.equal(out.lines.length, 1);
      assert.match(out.lines[0], /agent-review/);
      assert.ok(out.lines[0].includes('900'), out.lines[0]);
      assert.ok(w.elapsed() <= 15_000, `${w.elapsed()} ms`);
    });
  }

  it('says the conclusion when there is one', async () => {
    const w = world({ checks: [pendingReview(900)], runs: { 900: done('cancelled') } });
    assert.match((await wait(w)).lines[0], /cancelled/);
  });

  it('ends within the first poll even when everything else already passed', async () => {
    const w = world({ checks: [pendingReview(900), { name: 'CI OK', bucket: 'pass' }], runs: { 900: done('cancelled') } });
    assert.equal((await wait(w)).code, 1);
  });

  it('reads a link that points at a job inside the run', async () => {
    const w = world({ checks: [pendingReview(901, '/job/55555')], runs: { 901: done('cancelled') } });
    const out = await wait(w);
    assert.equal(out.code, 1);
    assert.ok(w.calls.some((c) => c.startsWith('run view 901')), w.calls.join('\n'));
  });

  it('reads a link with a query or fragment after the run id', async () => {
    const w = world({ checks: [{ name: 'agent-review', bucket: 'pending', link: `${link(902)}?pr=5#x` }], runs: { 902: done('cancelled') } });
    assert.equal((await wait(w)).code, 1);
  });

  it('ends once a run that was still going when first seen is over on a later poll', async () => {
    let n = 0;
    const w = world({ checks: [pendingReview(903)], runs: { 903: () => (++n < 3 ? { status: 'in_progress', conclusion: '' } : done('cancelled')) } });
    const out = await wait(w, { pollMs: 15_000 });
    assert.equal(out.code, 1);
    assert.match(out.lines[0], /agent-review/);
    assert.ok(w.elapsed() <= 2 * 15_000 + 1, `${w.elapsed()} ms`);
  });
});

describe('a pending agent-review that is not stale', () => {
  it('keeps waiting while its run is queued or in progress, then passes when it turns green', async () => {
    const w = world({
      checks: [[pendingReview(910)], [pendingReview(910)], [{ name: 'agent-review', bucket: 'pass', link: link(910) }, { name: 'CI OK', bucket: 'pass' }]],
      runs: { 910: { status: 'in_progress', conclusion: '' } },
    });
    assert.deepEqual(await wait(w), { code: 0, lines: [] });
  });

  it('keeps waiting while its run is queued', async () => {
    const w = world({ checks: [[pendingReview(911)], [{ name: 'agent-review', bucket: 'pass' }]], runs: { 911: { status: 'queued', conclusion: null } } });
    assert.equal((await wait(w)).code, 0);
  });

  it('waits out the limit, not ends early, with no link', async () => {
    const w = world({ checks: [{ name: 'agent-review', bucket: 'pending' }] });
    const out = await wait(w, { waitMs: 60_000, pollMs: 15_000 });
    assert.equal(out.code, 1);
    assert.match(out.lines[0], /still pending on #5 after 1 min/);
  });

  it('waits out the limit with a link that names no Actions run', async () => {
    const w = world({ checks: [{ name: 'agent-review', bucket: 'pending', link: 'https://example.test/status/1' }] });
    const out = await wait(w, { waitMs: 60_000, pollMs: 15_000 });
    assert.match(out.lines[0], /still pending/);
  });

  it('keeps waiting when the run cannot be read, and does not crash', async () => {
    const w = world({ checks: [pendingReview(912)], runs: { 912: 'error' } });
    const out = await wait(w, { waitMs: 45_000, pollMs: 15_000 });
    assert.match(out.lines[0], /still pending/);
  });

  it('does not end the wait for another pending check whose run is over', async () => {
    const w = world({ checks: [{ name: 'Checks', bucket: 'pending', link: link(913) }], runs: { 913: done('cancelled') } });
    const out = await wait(w, { waitMs: 30_000, pollMs: 15_000 });
    assert.match(out.lines[0], /still pending/);
    assert.ok(!w.calls.some((c) => c.startsWith('run view 913')));
  });

  it('does not call an agent-review that failed or passed stale', async () => {
    for (const bucket of ['fail', 'pass']) {
      const w = world({ checks: [{ name: 'agent-review', bucket, link: link(914) }, { name: 'CI OK', bucket: 'pass' }], runs: { 914: done('cancelled') } });
      const out = await wait(w);
      assert.equal(out.code, 0);
      assert.deepEqual(out.lines, bucket === 'fail' ? ['agent-review: fail'] : []);
    }
  });

  it('names the stale review rather than a lookalike check', async () => {
    const w = world({ checks: [{ name: 'agent-review-2', bucket: 'pending', link: link(915) }], runs: { 915: done('cancelled') } });
    const out = await wait(w, { waitMs: 30_000, pollMs: 15_000 });
    assert.match(out.lines[0], /still pending/);
  });
});

describe('a conflicting PR with a stale review', () => {
  it('still ends the wait', async () => {
    const w = world({ checks: [pendingReview(920)], runs: { 920: done('cancelled') }, mergeable: 'CONFLICTING' });
    const out = await wait(w);
    assert.notEqual(out.code, 0);
  });
});
