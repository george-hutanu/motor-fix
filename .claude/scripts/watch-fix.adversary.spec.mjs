import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { DEFAULT_THRESHOLDS, fixOf } from './watch.mjs';

const MIN = 60_000;
const NOW = Date.parse('2026-10-11T12:00:00Z');
const opts = { now: NOW, thresholds: DEFAULT_THRESHOLDS };
const HEAD = 'abc';

const pr = (over = {}) => ({ state: 'ready', head: HEAD, checks: 'pending', agentReview: null, mergeable: 'MERGEABLE', ...over });
const row = (over = {}) => ({
  main: false,
  phase: 'qa',
  holder: 'none',
  activity: { at: NOW - 60 * MIN, source: 'commit' },
  pr: pr(),
  clean: true,
  head: HEAD,
  unpushed: 0,
  handoff: true,
  qaRun: { id: 77, head: HEAD },
  qaRunState: { status: 'in_progress' },
  ...over,
});
const fix = (over, o = opts) => fixOf(row(over), o);

describe('a handed-off ready PR and its QA run', () => {
  it('waits with no fix while the run has not completed, however quiet and whatever CI says', () => {
    for (const checks of ['pending', 'pass', 'fail']) {
      for (const status of ['queued', 'in_progress']) {
        const r = fix({ pr: pr({ checks }), qaRunState: { status } });
        assert.equal(r.verdict, 'waiting', `${checks} ${status}`);
        assert.equal(r.fix, null);
      }
    }
  });

  it('gives the tail fix once the run completed, whatever CI is doing', () => {
    for (const checks of ['pending', 'pass', 'fail']) {
      const r = fix({ pr: pr({ checks }), qaRunState: { status: 'completed', conclusion: 'success' } });
      assert.equal(r.verdict, 'stale', checks);
      assert.equal(r.fix, 'tail', checks);
    }
  });

  it('gives the tail fix for a completed run even when the row is quiet for one minute only', () => {
    const r = fix({ activity: { at: NOW - 1 * MIN, source: 'commit' }, qaRunState: { status: 'completed', conclusion: 'failure' } });
    assert.equal(r.fix, 'tail');
  });

  it('gives a failing-CI row with a completed run the tail, not fix-ci', () => {
    assert.equal(fix({ pr: pr({ checks: 'fail' }), qaRunState: { status: 'completed' } }).fix, 'tail');
  });

  it('does not wait for a run that tested another head', () => {
    const r = fix({ qaRun: { id: 77, head: 'old' }, qaRunState: { status: 'in_progress' } });
    assert.notEqual(r.verdict, 'waiting');
    assert.equal(r.fix, 'tail');
  });

  it('waits on an unreadable run only until the quiet threshold, then gives the tail', () => {
    assert.equal(fix({ qaRunState: null, activity: { at: NOW - 1 * MIN, source: 'commit' } }).verdict, 'waiting');
    assert.equal(fix({ qaRunState: null, activity: { at: NOW - 600 * MIN, source: 'commit' } }).fix, 'tail');
  });

  it('gives nothing to a row a live agent holds', () => {
    const r = fix({ holder: 'live', qaRunState: { status: 'completed' } });
    assert.equal(r.fix, null);
  });

  it('never waits on a run for a PR that is not ready', () => {
    const r = fix({ pr: pr({ state: 'draft' }), qaRunState: { status: 'in_progress' } });
    assert.notEqual(r.verdict, 'waiting');
  });
});

describe('a PR whose head the tester passed', () => {
  const passed = (over = {}) => ({ pr: pr({ agentReview: 'success', checks: 'pass', ...over.pr }), ...over, pr: pr({ agentReview: 'success', checks: 'pass', ...over.pr }) });

  it('gets the merge fix at once, with no quiet threshold, when every check passes', () => {
    const r = fix({ ...passed(), activity: { at: NOW - 1 * MIN, source: 'file' } });
    assert.equal(r.fix, 'merge');
    assert.equal(r.verdict, 'stale');
  });

  it('merges even while its QA run is recorded as still running', () => {
    assert.equal(fix({ ...passed(), qaRunState: { status: 'in_progress' } }).fix, 'merge');
  });

  it('waits for CI with no fix while a check is pending', () => {
    const r = fix(passed({ pr: { checks: 'pending' } }));
    assert.equal(r.verdict, 'waiting');
    assert.equal(r.fix, null);
  });

  it('never merges on a failing check', () => {
    for (const age of [1, 600]) {
      const r = fix({ ...passed({ pr: { checks: 'fail' } }), activity: { at: NOW - age * MIN, source: 'commit' } });
      assert.notEqual(r.fix, 'merge');
    }
  });

  it('never merges when the worktree is dirty, behind the PR head, or has no recorded head', () => {
    assert.notEqual(fix({ ...passed(), clean: false }).fix, 'merge');
    assert.notEqual(fix({ ...passed(), head: 'other' }).fix, 'merge');
    assert.notEqual(fix({ ...passed(), head: undefined }).fix, 'merge');
    assert.notEqual(fix({ ...passed(), head: undefined, pr: pr({ agentReview: 'success', checks: 'pass', head: undefined }) }).fix, 'merge');
  });

  it('never merges a draft, a merged or a closed PR', () => {
    for (const state of ['draft', 'merged', 'closed']) assert.notEqual(fix(passed({ pr: { state } })).fix, 'merge', state);
  });

  it('never merges on a verdict other than success', () => {
    for (const agentReview of ['failure', 'pending', null, undefined, 'SUCCESS']) assert.notEqual(fix({ pr: pr({ agentReview, checks: 'pass' }) }).fix, 'merge', String(agentReview));
  });

  it('merges main in first when the PR conflicts, not the merge fix', () => {
    assert.equal(fix(passed({ pr: { mergeable: 'CONFLICTING' } })).fix, 'merge-main');
  });

  it('gives a held row (live agent or owner) no merge', () => {
    assert.equal(fix({ ...passed(), holder: 'live' }).fix, null);
    assert.equal(fix({ ...passed(), holder: 'owner' }).fix, null);
  });

  it('gives the main checkout no merge', () => {
    assert.notEqual(fix({ ...passed(), main: true, holder: 'owner' }).fix, 'merge');
  });

  it('gives no merge without a handoff either: the immediate merge does not depend on one', () => {
    assert.equal(fix({ ...passed(), handoff: false, qaRun: undefined, qaRunState: undefined }).fix, 'merge');
  });
});
