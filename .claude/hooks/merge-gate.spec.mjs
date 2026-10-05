import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

import { decideMerge, mergeTarget } from './merge-gate.mjs';

const review = (state) => ({ __typename: 'StatusContext', context: 'agent-review', state });
const run = (name, conclusion, status = 'COMPLETED', startedAt = '2026-10-05T07:00:00Z') => ({ __typename: 'CheckRun', name, status, conclusion, startedAt });
const green = [run('Unit tests', 'SUCCESS'), run('CI OK', 'SUCCESS')];
const pr = (rollup) => ({ number: 21, state: 'OPEN', headRefOid: 'abc1234def5678', statusCheckRollup: rollup });

describe('merge gate — which commands are merges', () => {
  it('finds gh pr merge with a number, a branch, a URL or nothing', () => {
    assert.deepEqual(mergeTarget('gh pr merge 21 --merge'), { pr: '21' });
    assert.deepEqual(mergeTarget('GH_TOKEN=$(gh auth token -u george-hutanu) gh pr merge feature-branch --merge'), { pr: 'feature-branch' });
    assert.deepEqual(mergeTarget('gh pr merge https://github.com/george-hutanu/motor-fix/pull/21 --squash'), { pr: 'https://github.com/george-hutanu/motor-fix/pull/21' });
    assert.deepEqual(mergeTarget('git push && gh pr merge --merge'), { pr: null });
  });

  it('finds a merge with the repository flag anywhere, or gh called by its path', () => {
    assert.deepEqual(mergeTarget('gh -R george-hutanu/motor-fix pr merge 21 --merge'), { pr: '21' });
    assert.deepEqual(mergeTarget('gh pr merge --repo george-hutanu/motor-fix 21 --merge'), { pr: '21' });
    assert.deepEqual(mergeTarget('gh pr merge -R george-hutanu/motor-fix --squash 21'), { pr: '21' });
    assert.deepEqual(mergeTarget('/opt/homebrew/bin/gh pr merge 21'), { pr: '21' });
  });

  it('finds the REST merge call', () => {
    assert.deepEqual(mergeTarget('gh api -X PUT repos/george-hutanu/motor-fix/pulls/21/merge'), { pr: '21' });
  });

  it('leaves everything else alone', () => {
    assert.equal(mergeTarget('gh pr view 21 --json mergeable'), null);
    assert.equal(mergeTarget('git merge --no-edit origin/main'), null);
    assert.equal(mergeTarget('gh pr checks 21 --watch'), null);
    assert.equal(mergeTarget('echo "gh pr merge" is documented in AGENTS.md'), null);
  });
});

describe('merge gate — the decision', () => {
  it('refuses a PR whose head commit has no agent-review success, and names the tester', () => {
    const why = decideMerge(pr(green));
    assert.match(why, /agent-review/);
    assert.match(why, /abc1234/);
    assert.match(why, /speckit-pr-test 21/);
  });

  it('refuses a failing agent review', () => {
    assert.match(decideMerge(pr([...green, review('FAILURE')])), /failure/i);
  });

  it('lets the merge run with agent-review success on the head commit', () => {
    assert.equal(decideMerge(pr([...green, review('SUCCESS')])), null);
  });

  it('counts skipped and neutral checks as green', () => {
    assert.equal(decideMerge(pr([...green, run('E2E tests', 'SKIPPED'), run('Lint', 'NEUTRAL'), review('SUCCESS')])), null);
  });

  // The PR tester now runs beside CI rather than after it, so agent-review
  // success alone no longer implies CI finished: the gate checks both.
  it('refuses agent-review success while a CI check failed, and names it', () => {
    const why = decideMerge(pr([run('Unit tests', 'FAILURE'), run('CI OK', 'FAILURE'), review('SUCCESS')]));
    assert.match(why, /Unit tests/);
    assert.match(why, /CI OK/);
    assert.match(why, /gh pr checks 21/);
  });

  it('refuses agent-review success while a CI check is still running', () => {
    const why = decideMerge(pr([run('Unit tests', 'SUCCESS'), run('CI OK', null, 'IN_PROGRESS'), review('SUCCESS')]));
    assert.match(why, /CI OK/);
    assert.match(why, /pending|running/i);
  });

  // PR #91's own rollup: the PR template workflow cancels a run in progress
  // when the body is edited again, leaving the cancelled run beside the new one.
  it('judges only the latest run of each check, so a cancelled earlier run does not block', () => {
    const rollup = [run('body', 'CANCELLED', 'COMPLETED', '2026-10-05T07:03:51Z'), run('body', 'SUCCESS', 'COMPLETED', '2026-10-05T07:04:15Z'), ...green, review('SUCCESS')];
    assert.equal(decideMerge(pr(rollup)), null);
  });

  it('still refuses when the latest run of a check is the failing one', () => {
    const rollup = [run('Unit tests', 'SUCCESS', 'COMPLETED', '2026-10-05T07:00:00Z'), run('Unit tests', 'FAILURE', 'COMPLETED', '2026-10-05T07:10:00Z'), run('CI OK', 'SUCCESS'), review('SUCCESS')];
    assert.match(decideMerge(pr(rollup)), /CI failed.*Unit tests/);
  });

  // gh reports a run that has not started with startedAt 0001-01-01, which
  // sorted it as the oldest run of its check (PR tester lap 2 on PR #91).
  const NOT_STARTED = '0001-01-01T00:00:00Z';

  it('reads a cancelled run followed by its queued replacement as pending, not failed', () => {
    const rollup = [run('body', 'CANCELLED', 'COMPLETED', '2026-10-05T07:03:51Z'), run('body', null, 'QUEUED', NOT_STARTED), ...green, review('SUCCESS')];
    const why = decideMerge(pr(rollup));
    assert.match(why, /still running.*body/);
    assert.doesNotMatch(why, /CI failed/);
  });

  it('refuses while a green check has a queued re-run, rather than merging on the old result', () => {
    const rollup = [run('Unit tests', 'SUCCESS', 'COMPLETED', '2026-10-05T07:00:00Z'), run('Unit tests', null, 'QUEUED', NOT_STARTED), run('CI OK', 'SUCCESS'), review('SUCCESS')];
    assert.match(decideMerge(pr(rollup)), /still running.*Unit tests/);
  });

  it('reads an in-progress run as the latest even when its start time is older', () => {
    const rollup = [run('Unit tests', null, 'IN_PROGRESS', '2026-10-05T06:00:00Z'), run('Unit tests', 'SUCCESS', 'COMPLETED', '2026-10-05T07:00:00Z'), run('CI OK', 'SUCCESS'), review('SUCCESS')];
    assert.match(decideMerge(pr(rollup)), /still running.*Unit tests/);
  });

  // The PR template workflow can cancel a run before a runner picks it up:
  // COMPLETED, CANCELLED and undated. It is the oldest run, not the newest.
  it('reads a run cancelled while still queued as older than the run that replaced it', () => {
    const rollup = [run('body', 'CANCELLED', 'COMPLETED', NOT_STARTED), run('body', 'SUCCESS', 'COMPLETED', '2026-10-05T07:04:15Z'), ...green, review('SUCCESS')];
    assert.equal(decideMerge(pr(rollup)), null);
  });

  it('keys check runs by workflow and name, so a same-named job in another workflow is not hidden', () => {
    const rollup = [
      { ...run('build', 'FAILURE', 'COMPLETED', '2026-10-05T07:00:00Z'), workflowName: 'Docker' },
      { ...run('build', 'SUCCESS', 'COMPLETED', '2026-10-05T07:05:00Z'), workflowName: 'CI' },
      { ...run('CI OK', 'SUCCESS'), workflowName: 'CI' },
      review('SUCCESS'),
    ];
    assert.match(decideMerge(pr(rollup)), /CI failed.*build/);
  });

  it('still judges the latest run within one workflow', () => {
    const rollup = [
      { ...run('build', 'FAILURE', 'COMPLETED', '2026-10-05T07:00:00Z'), workflowName: 'CI' },
      { ...run('build', 'SUCCESS', 'COMPLETED', '2026-10-05T07:05:00Z'), workflowName: 'CI' },
      { ...run('CI OK', 'SUCCESS'), workflowName: 'CI' },
      review('SUCCESS'),
    ];
    assert.equal(decideMerge(pr(rollup)), null);
  });

  it('reads an expected status context as pending, not failed', () => {
    const rollup = [...green, { __typename: 'StatusContext', context: 'deploy', state: 'EXPECTED' }, review('SUCCESS')];
    assert.match(decideMerge(pr(rollup)), /still running.*deploy/);
  });

  it('refuses agent-review success when CI has not reported at all', () => {
    assert.match(decideMerge(pr([review('SUCCESS')])), /no CI OK check/);
  });

  it('leaves a PR that is not open to GitHub to refuse', () => {
    assert.equal(decideMerge({ ...pr([]), state: 'MERGED' }), null);
  });
});
