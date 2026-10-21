import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

import { ciOkOn } from './gh-rest.mjs';

const SHA = 'deadbeefcafe';

/**
 * A fake `gh api`: check-runs come back as the pages given, wrapped the way
 * --slurp wraps them. Anything else the reader asks for is empty.
 */
function github({ pages, checkRuns, fail, throws, raw } = {}) {
  const calls = [];
  const run = (file, args) => {
    calls.push(`${file} ${args.join(' ')}`);
    if (throws) throw new Error('spawn gh ENOENT');
    const path = args[1] ?? '';
    if (path.includes('/check-runs')) {
      if (fail) return { code: 1, stdout: '', stderr: fail };
      if (raw !== undefined) return { code: 0, stdout: raw, stderr: '' };
      const body = pages ?? [{ check_runs: checkRuns ?? [] }];
      return { code: 0, stdout: JSON.stringify(args.includes('--slurp') ? body : body[0]), stderr: '' };
    }
    if (path.includes('actions/runs')) return { code: 0, stdout: JSON.stringify(args.includes('--slurp') ? [{ workflow_runs: [] }] : { workflow_runs: [] }), stderr: '' };
    return { code: 0, stdout: JSON.stringify({ statuses: [] }), stderr: '' };
  };
  return { run, calls };
}
const check = (name, conclusion = 'success', status = 'completed') => ({ name, status, conclusion });
const ciOk = (checkRuns) => ciOkOn(github({ checkRuns }).run, SHA);

// @traces 1355-FR-003
describe('ciOkOn: only an all-green set of CI OK checks counts', () => {
  it('is true for one success named exactly CI OK, and for a prefixed one', () => {
    assert.equal(ciOk([check('CI OK')]), true);
    assert.equal(ciOk([check('checks / CI OK')]), true);
  });

  it('is false when a prefixed CI OK failed beside a green plain CI OK', () => {
    assert.equal(ciOk([check('CI OK'), check('release / CI OK', 'failure')]), false);
    assert.equal(ciOk([check('release / CI OK', 'failure'), check('CI OK')]), false);
  });

  it('is false when a second CI OK is still running', () => {
    assert.equal(ciOk([check('checks / CI OK'), check('other / CI OK', null, 'in_progress')]), false);
    assert.equal(ciOk([check('checks / CI OK'), check('other / CI OK', null, 'queued')]), false);
  });

  it('is false for every conclusion other than success', () => {
    for (const c of ['failure', 'cancelled', 'timed_out', 'neutral', 'skipped', 'action_required', 'stale', null, 'SUCCESS-ish']) {
      assert.equal(ciOk([check('checks / CI OK', c)]), false, String(c));
    }
  });

  it('is false for names that only contain or resemble CI OK', () => {
    for (const name of ['CI OK later', 'CI OKAY', 'CI-OK', 'CIOK', 'CI', 'OK', 'ci ok', '', 'CI OK ✓ done']) {
      assert.equal(ciOk([check(name)]), false, JSON.stringify(name));
    }
  });

  it('is false when other checks pass but none is named CI OK', () => {
    assert.equal(ciOk([check('Unit tests'), check('Biome'), check('Typecheck')]), false);
  });

  it('is false for an empty or absent check list', () => {
    assert.equal(ciOk([]), false);
    assert.equal(ciOkOn(github({ pages: [{}] }).run, SHA), false);
    assert.equal(ciOkOn(github({ pages: [] }).run, SHA), false);
    assert.equal(ciOkOn(github({ pages: [{ check_runs: null }] }).run, SHA), false);
  });

  it('ignores a failing check that is not a CI OK', () => {
    assert.equal(ciOk([check('checks / CI OK'), check('Docker build', 'failure')]), true);
  });

  it('is false when the check name is missing or not a string', () => {
    assert.equal(ciOk([{ status: 'completed', conclusion: 'success' }]), false);
    assert.equal(ciOk([{ name: 7, status: 'completed', conclusion: 'success' }]), false);
    assert.equal(ciOk([{ name: null, status: 'completed', conclusion: 'success' }]), false);
  });

  it('is false when a failing CI OK is on the second page and a green one on the first', () => {
    const pages = [{ check_runs: [check('checks / CI OK')] }, { check_runs: [check('late / CI OK', 'failure')] }];
    assert.equal(ciOkOn(github({ pages }).run, SHA), false);
  });

  it('is true when the only CI OK is on the second page', () => {
    const pages = [{ check_runs: [check('Biome')] }, { check_runs: [check('checks / CI OK')] }];
    assert.equal(ciOkOn(github({ pages }).run, SHA), true);
  });

  it('is false, not a throw, when the check-runs read is refused', () => {
    assert.equal(ciOkOn(github({ fail: 'gh: HTTP 403 rate limit exceeded' }).run, SHA), false);
    assert.equal(ciOkOn(github({ fail: 'gh: Not Found (HTTP 404)' }).run, 'ffffffffffff'), false);
  });

  it('is false, not a throw, when gh cannot be spawned', () => {
    assert.equal(ciOkOn(github({ throws: true }).run, SHA), false);
    assert.equal(ciOkOn(() => undefined, SHA), false);
  });

  it('is false, not a throw, when the answer is not JSON', () => {
    assert.equal(ciOkOn(github({ raw: '<html>bad gateway</html>' }).run, SHA), false);
    assert.equal(ciOkOn(github({ raw: 'null' }).run, SHA), false);
  });

  it('reads the named commit and gives the same answer twice', () => {
    const f = github({ checkRuns: [check('checks / CI OK')] });
    assert.equal(ciOkOn(f.run, SHA), true);
    assert.equal(ciOkOn(f.run, SHA), true);
    assert.ok(f.calls.some((c) => c.includes(`commits/${SHA}/check-runs`)), f.calls.join('\n'));
  });
});
