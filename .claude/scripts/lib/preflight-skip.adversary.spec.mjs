import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

import { canSkipSuite, main } from './preflight-skip.mjs';

const clean = { porcelain: '', head: 'abc1234def', mergeBase: 'abc1234def', ciOk: true };

// @traces 1355-FR-003
describe('canSkipSuite: anything unproven runs the suite', () => {
  it('skips on the empty porcelain and on a lone trailing newline', () => {
    assert.deepEqual(canSkipSuite(clean), { skip: true });
    assert.deepEqual(canSkipSuite({ ...clean, porcelain: '\n' }), { skip: true });
  });

  it('runs when the only change is a status line that begins with a space', () => {
    assert.equal(canSkipSuite({ ...clean, porcelain: ' M a.ts' }).skip, false);
    assert.equal(canSkipSuite({ ...clean, porcelain: ' D a.ts\n M b.ts\n' }).skip, false);
  });

  it('runs on an untracked unicode path', () => {
    assert.equal(canSkipSuite({ ...clean, porcelain: '?? "caf\\303\\251.ts"\n' }).skip, false);
  });

  it('runs when HEAD and merge base are both unknown', () => {
    assert.equal(canSkipSuite({ ...clean, head: undefined, mergeBase: undefined }).skip, false);
    assert.equal(canSkipSuite({ ...clean, head: '', mergeBase: '' }).skip, false);
    assert.equal(canSkipSuite({ ...clean, head: null, mergeBase: null }).skip, false);
  });

  it('runs when the porcelain was never read', () => {
    for (const porcelain of [undefined, null]) {
      let r;
      try {
        r = canSkipSuite({ ...clean, porcelain });
      } catch {
        r = { skip: false };
      }
      assert.equal(r.skip, false, String(porcelain));
    }
  });

  it('runs unless CI OK is exactly true', () => {
    for (const ciOk of [undefined, null, false, 0, '']) {
      assert.equal(canSkipSuite({ ...clean, ciOk }).skip, false, `ciOk ${String(ciOk)}`);
    }
  });

  it('runs when a short sha stands against the full one', () => {
    assert.equal(canSkipSuite({ ...clean, head: 'abc1234' }).skip, false);
  });

  it('gives a reason string for every refusal', () => {
    for (const over of [{ porcelain: ' M a' }, { head: 'zzz' }, { ciOk: false }]) {
      const r = canSkipSuite({ ...clean, ...over });
      assert.equal(r.skip, false);
      assert.equal(typeof r.reason, 'string');
      assert.notEqual(r.reason.length, 0);
    }
  });
});

describe('preflight-skip main: a broken read can never print skip', () => {
  const ok = { name: 'checks / CI OK', status: 'completed', conclusion: 'success' };
  const sha = 'abc1234def5678';

  const runner = ({ porcelain = '', head = `${sha}\n`, mergeBase = `${sha}\n`, checks = [ok], broken = {}, check_stdout } = {}) => {
    const calls = [];
    const run = (file, args) => {
      const cmd = `${file} ${args.join(' ')}`;
      calls.push(cmd);
      const bad = Object.entries(broken).find(([k]) => cmd.includes(k));
      if (bad) return bad[1];
      if (file === 'git' && args[0] === 'status') return { code: 0, stdout: porcelain, stderr: '' };
      if (file === 'git' && args[0] === 'rev-parse') return { code: 0, stdout: head, stderr: '' };
      if (file === 'git' && args[0] === 'merge-base') return { code: 0, stdout: mergeBase, stderr: '' };
      if (file === 'git') return { code: 0, stdout: '', stderr: '' };
      if (args[1].includes('/check-runs')) return { code: 0, stdout: check_stdout ?? JSON.stringify([{ check_runs: checks }]), stderr: '' };
      if (args[1].includes('actions/runs')) return { code: 0, stdout: JSON.stringify([{ workflow_runs: [] }]), stderr: '' };
      return { code: 0, stdout: JSON.stringify({ statuses: [] }), stderr: '' };
    };
    return { run, calls };
  };
  const fail = { code: 128, stdout: '', stderr: 'fatal: boom' };

  it('prints skip with the seven-character sha on the happy path', () => {
    assert.equal(main(runner().run), 'skip abc1234');
  });

  it('prints run when git status fails, though its stdout is empty', () => {
    assert.match(main(runner({ broken: { 'git status': fail } }).run), /^run /);
  });

  it('prints run when rev-parse and merge-base both fail with empty output', () => {
    assert.match(main(runner({ broken: { 'git rev-parse': fail, 'git merge-base': fail } }).run), /^run /);
  });

  it('prints run when both shas come back empty with exit 0', () => {
    assert.match(main(runner({ head: '', mergeBase: '' }).run), /^run /);
  });

  it('prints run when only merge-base fails', () => {
    assert.match(main(runner({ broken: { 'git merge-base': fail } }).run), /^run /);
  });

  it('prints run when a git call throws instead of returning', () => {
    const run = () => {
      throw new Error('ENOENT');
    };
    assert.match(main(run), /^run /);
  });

  it('prints run when the runner answers nothing at all', () => {
    assert.match(main(() => undefined), /^run /);
    assert.match(main(() => null), /^run /);
  });

  it('prints run when the check-runs answer is not JSON', () => {
    assert.match(main(runner({ check_stdout: '<html>502 Bad Gateway</html>' }).run), /^run /);
    assert.match(main(runner({ check_stdout: '' }).run), /^run /);
    assert.match(main(runner({ check_stdout: 'null' }).run), /^run /);
  });

  it('prints run on an HTTP error from the check-runs read', () => {
    assert.match(main(runner({ broken: { 'check-runs': { code: 1, stdout: '', stderr: 'gh: HTTP 403 rate limit' } } }).run), /^run /);
  });

  it('prints run while CI OK is pending or concluded anything but success', () => {
    for (const c of [
      { name: 'checks / CI OK', status: 'in_progress', conclusion: null },
      { name: 'checks / CI OK', status: 'queued', conclusion: null },
      { name: 'checks / CI OK', status: 'completed', conclusion: 'cancelled' },
      { name: 'checks / CI OK', status: 'completed', conclusion: 'timed_out' },
      { name: 'checks / CI OK', status: 'completed', conclusion: 'neutral' },
    ]) {
      assert.match(main(runner({ checks: [c] }).run), /^run /, JSON.stringify(c));
    }
  });

  it('prints run when a green CI OK sits beside a failed one with a longer prefix', () => {
    const checks = [ok, { name: 'release / checks / CI OK', status: 'completed', conclusion: 'failure' }];
    assert.match(main(runner({ checks }).run), /^run /);
  });

  it('prints run when no check run exists for the commit', () => {
    assert.match(main(runner({ checks: [] }).run), /^run /);
  });

  it('prints one line only, with no trailing newline', () => {
    for (const out of [main(runner().run), main(runner({ porcelain: ' M x\n' }).run)]) {
      assert.equal(out.includes('\n'), false, out);
    }
  });

  it('reads CI OK for the merge base commit, not for a branch name', () => {
    const f = runner();
    main(f.run);
    const reads = f.calls.filter((c) => c.includes('check-runs'));
    assert.equal(reads.length >= 1, true);
    assert.ok(reads.every((c) => c.includes(`commits/${sha}/check-runs`)), reads.join('\n'));
  });

  it('makes the same answer twice in a row', () => {
    const f = runner({ checks: [ok] });
    assert.equal(main(f.run), main(f.run));
  });
});
