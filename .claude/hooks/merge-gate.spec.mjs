import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

import { decideMerge, mergeTarget } from './merge-gate.mjs';

const review = (state) => ({ __typename: 'StatusContext', context: 'agent-review', state });
const run = (name, conclusion, status = 'COMPLETED') => ({ __typename: 'CheckRun', name, status, conclusion });
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

  it('refuses agent-review success when CI has not reported at all', () => {
    assert.match(decideMerge(pr([review('SUCCESS')])), /no CI OK check/);
  });

  it('leaves a PR that is not open to GitHub to refuse', () => {
    assert.equal(decideMerge({ ...pr([]), state: 'MERGED' }), null);
  });
});
