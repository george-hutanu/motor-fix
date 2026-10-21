import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

import { canSkipSuite, main } from './preflight-skip.mjs';

// @traces 1355-FR-003
describe('canSkipSuite: the preflight suite is skipped only on a clean base CI passed', () => {
  const base = { porcelain: '', head: 'abc1234def', mergeBase: 'abc1234def', ciOk: true };

  it('skips a clean worktree at its merge base whose commit has CI OK', () => {
    assert.deepEqual(canSkipSuite(base), { skip: true });
  });

  it('runs on any change in the tree', () => {
    assert.equal(canSkipSuite({ ...base, porcelain: ' M a.ts\n' }).skip, false);
    assert.match(canSkipSuite({ ...base, porcelain: '?? b.ts\n' }).reason, /tree/);
  });

  it('runs when HEAD is not the merge base with origin/main', () => {
    const r = canSkipSuite({ ...base, head: 'fff0000' });
    assert.equal(r.skip, false);
    assert.match(r.reason, /merge base/);
  });

  it('runs when the base has no successful CI OK', () => {
    const r = canSkipSuite({ ...base, ciOk: false });
    assert.equal(r.skip, false);
    assert.match(r.reason, /CI OK/);
  });
});

describe('preflight-skip CLI', () => {
  const runner = ({ porcelain = '', head = 'abc1234def', mergeBase = 'abc1234def', checks = [], fail } = {}) => {
    const calls = [];
    const run = (file, args) => {
      calls.push(`${file} ${args.join(' ')}`);
      if (fail && `${file} ${args.join(' ')}`.includes(fail)) return { code: 1, stdout: '', stderr: 'boom' };
      if (file === 'git' && args[0] === 'status') return { code: 0, stdout: porcelain, stderr: '' };
      if (file === 'git' && args[0] === 'rev-parse') return { code: 0, stdout: `${head}\n`, stderr: '' };
      if (file === 'git' && args[0] === 'merge-base') return { code: 0, stdout: `${mergeBase}\n`, stderr: '' };
      if (file === 'git') return { code: 0, stdout: '', stderr: '' };
      if (args[1].includes('/check-runs')) return { code: 0, stdout: JSON.stringify([{ check_runs: checks }]), stderr: '' };
      if (args[1].includes('actions/runs')) return { code: 0, stdout: JSON.stringify([{ workflow_runs: [] }]), stderr: '' };
      return { code: 0, stdout: JSON.stringify({ statuses: [] }), stderr: '' };
    };
    return { run, calls };
  };
  const ok = { name: 'checks / CI OK', status: 'completed', conclusion: 'success' };

  it('fetches origin/main first and prints skip with the short sha', () => {
    const f = runner({ checks: [ok] });
    assert.equal(main(f.run), 'skip abc1234');
    assert.equal(f.calls[0], 'git fetch -q origin main');
    assert.ok(f.calls.some((c) => c.includes('commits/abc1234def/check-runs')));
  });

  it('prints run with the reason when a condition fails', () => {
    assert.match(main(runner({ checks: [{ ...ok, conclusion: 'failure' }] }).run), /^run .*CI OK/);
    assert.match(main(runner({ checks: [ok], porcelain: ' M x\n' }).run), /^run .*tree/);
  });

  it('prints run when any read fails, never skip', () => {
    assert.match(main(runner({ checks: [ok], fail: 'check-runs' }).run), /^run /);
    assert.match(main(runner({ checks: [ok], fail: 'fetch' }).run), /^run /);
  });
});
