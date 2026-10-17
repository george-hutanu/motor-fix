import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { waitForCi } from './ci-wait.mjs';

function world(checks) {
  const calls = [];
  let t = 0;
  const gh = async (args) => {
    calls.push(args.join(' '));
    if (args[1] === 'checks') {
      const a = checks.length > 1 ? checks.shift() : checks[0];
      if (a.cloud) return { code: a.cloud, stdout: JSON.stringify(a.checks), stderr: '' };
      return { code: 0, stdout: JSON.stringify(a), stderr: '' };
    }
    if (args[1] === 'view') return { code: 0, stdout: JSON.stringify({ mergeable: 'MERGEABLE' }), stderr: '' };
    return { code: 1, stdout: '', stderr: 'no route' };
  };
  return { calls, gh, sleep: async (ms) => { t += ms; }, now: () => t };
}
const pass = (name, workflow = 'CI') => ({ name, bucket: 'pass', workflow });
const m = (bucket, name = 'scripts') => ({ name, bucket, workflow: 'Mutation' });
const go = (w, extra = {}) => waitForCi({ pr: 21, gh: w.gh, sleep: w.sleep, now: w.now, ...extra });

describe('waiting for CI with a Mutation run on the head, adversarial', () => {
  // @traces 1344-FR-010
  it('treats a head of Mutation checks alone as no checks and gives up after the no-checks limit', async () => {
    const w = world([[m('pending')]]);
    const out = await go(w, { noChecksMs: 60_000, pollMs: 15_000 });
    assert.equal(out.code, 1);
    assert.match(out.lines[0], /no checks on #21/);
  });

  // @traces 1344-FR-010
  it('does not report a failing Mutation check named like a CI check', async () => {
    const w = world([[pass('CI OK'), m('fail', 'CI OK'), m('cancel', 'Checks')]]);
    assert.deepEqual(await go(w), { code: 0, lines: [] });
  });

  // @traces 1344-FR-010
  it('reads the cloud exit 1 or 8 caused by Mutation checks alone as green when the rest passed', async () => {
    const w1 = world([{ cloud: 1, checks: [pass('CI OK'), m('fail')] }]);
    assert.deepEqual(await go(w1), { code: 0, lines: [] });
    const w8 = world([{ cloud: 8, checks: [pass('CI OK'), m('pending')] }]);
    assert.deepEqual(await go(w8), { code: 0, lines: [] });
  });

  // @traces 1344-FR-010
  it('keeps a failing check whose workflow is empty or absent', async () => {
    const w = world([[pass('CI OK'), { name: 'Lint', bucket: 'fail', workflow: '' }, { name: 'Build', bucket: 'fail' }]]);
    assert.deepEqual(await go(w), { code: 0, lines: ['Lint: fail', 'Build: fail'] });
  });

  // @traces 1344-FR-010
  it('still waits for a pending real check while Mutation checks have passed', async () => {
    const w = world([[m('pass'), { name: 'Checks', bucket: 'pending', workflow: 'CI' }], [m('pass'), pass('Checks')]]);
    assert.deepEqual(await go(w), { code: 0, lines: [] });
    assert.equal(w.calls.filter((c) => c.startsWith('pr checks')).length, 2);
  });

  // @traces 1344-FR-010
  it('times out on a pending real check and names it, not the Mutation one', async () => {
    const w = world([[m('pending', 'shard'), { name: 'agent-review', bucket: 'pending' }]]);
    const out = await go(w, { waitMs: 60_000, pollMs: 15_000 });
    assert.equal(out.code, 1);
    assert.match(out.lines[0], /agent-review/);
    assert.doesNotMatch(out.lines[0], /shard/);
  });

  // @traces 1344-FR-010
  it('ends with the QA run and reads no checks when --run is given, Mutation or not', async () => {
    const w = world([[m('fail')]]);
    w.gh = async (args) => (args[1] === 'view' && args[0] === 'run' ? { code: 0, stdout: JSON.stringify({ status: 'completed', conclusion: 'success' }), stderr: '' } : { code: 1, stdout: '', stderr: 'x' });
    assert.deepEqual(await go(w, { run: '9' }), { code: 0, lines: ['QA run: success'] });
  });
});
