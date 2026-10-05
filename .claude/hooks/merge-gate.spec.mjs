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
    assert.match(decideMerge(pr(rollup)), /CI failed.*Docker \/ build/);
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

describe('merge gate — Dependabot PRs need no agent review', () => {
  const bot = (rollup, login = 'app/dependabot') => ({ ...pr(rollup), author: { login, is_bot: true }, commits: [{ authors: [{ login: 'dependabot[bot]' }] }] });

  it('lets a Dependabot PR merge on green CI with no agent-review status', () => {
    assert.equal(decideMerge(bot(green)), null);
    assert.equal(decideMerge(bot([...green, run('body', 'SKIPPED')], 'dependabot[bot]')), null);
  });

  it('refuses a Dependabot PR with a failing, running or missing check, and names it', () => {
    const red = decideMerge(bot([run('Unit tests', 'FAILURE'), run('CI OK', 'FAILURE')]));
    assert.match(red, /CI failed/);
    assert.match(red, /Unit tests/);
    assert.match(decideMerge(bot([run('Build', null, 'IN_PROGRESS'), run('CI OK', 'SUCCESS')])), /still running.*Build/);
    assert.match(decideMerge(bot([{ context: 'CI OK', state: 'PENDING' }])), /still running.*CI OK/);
    assert.match(decideMerge(bot([])), /no CI OK check/);
    assert.match(decideMerge(bot([run('Unit tests', 'SUCCESS')])), /no CI OK check/);
  });

  it('judges the latest run of each check, as for any other PR', () => {
    const NOT_STARTED = '0001-01-01T00:00:00Z';
    const rerunRed = [run('Unit tests', 'SUCCESS', 'COMPLETED', '2026-10-05T07:00:00Z'), run('Unit tests', 'FAILURE', 'COMPLETED', '2026-10-05T07:10:00Z'), run('CI OK', 'SUCCESS')];
    assert.match(decideMerge(bot(rerunRed)), /CI failed/);
    const queued = [run('Unit tests', 'SUCCESS', 'COMPLETED', '2026-10-05T07:00:00Z'), run('Unit tests', null, 'QUEUED', NOT_STARTED), run('CI OK', 'SUCCESS')];
    assert.match(decideMerge(bot(queued)), /still running/);
    const fixed = [run('Unit tests', 'FAILURE', 'COMPLETED', '2026-10-05T07:00:00Z'), run('Unit tests', 'SUCCESS', 'COMPLETED', '2026-10-05T07:10:00Z'), run('CI OK', 'SUCCESS')];
    assert.equal(decideMerge(bot(fixed)), null);
  });

  it('still refuses a Dependabot PR whose agent review failed', () => {
    assert.match(decideMerge(bot([...green, review('FAILURE')])), /agent-review is failure/);
  });

  it('reads the author, not the title or branch: anyone else still needs the agent review', () => {
    const human = { ...pr(green), title: 'chore(deps): bump vitest', headRefName: 'dependabot/npm_and_yarn/vitest-5', author: { login: 'george-hutanu' } };
    assert.match(decideMerge(human), /no agent-review status/);
    assert.match(decideMerge({ ...pr(green), author: { login: 'dependabot-fan' } }), /no agent-review status/);
  });

  it('takes back the exemption once anyone else pushed a commit to the branch', () => {
    const pushed = { ...bot(green), commits: [{ authors: [{ login: 'dependabot[bot]' }] }, { authors: [{ login: 'george-hutanu' }] }] };
    assert.match(decideMerge(pushed), /no agent-review status/);
    const coAuthored = { ...bot(green), commits: [{ authors: [{ login: 'dependabot[bot]' }, { login: 'george-hutanu' }] }] };
    assert.match(decideMerge(coAuthored), /no agent-review status/);
    assert.match(decideMerge({ ...bot(green), commits: undefined }), /no agent-review status/);
    assert.match(decideMerge({ ...bot(green), commits: [] }), /no agent-review status/);
  });
});

describe('merge gate — a verdict carried over a docs-only head is verified, not trusted', () => {
  const FROM = 'f'.repeat(40);
  const carried = (description = `carried from ${FROM}: docs-only change`) => ({ ...review('SUCCESS'), description });
  const state = (over = {}) => ({
    fromReview: { state: 'success', description: 'No blocking findings' },
    compare: { status: 'ahead', total_commits: 1, commits: [{ sha: 'abc1234def5678' }], files: [{ filename: 'specs/194-email-sending/deferred.md' }] },
    between: [],
    headReviews: [],
    ...over,
  });
  const prc = (rollup) => ({ ...pr(rollup), commits: [{ oid: FROM }, { oid: 'abc1234def5678' }] });
  const lookup = (s, seen = []) => ({ description: () => null, state: (from, head) => (seen.push([from, head]), s) });

  it('lets a verified carry merge on green CI, checking the commit it names against head', () => {
    const seen = [];
    assert.equal(decideMerge(prc([...green, carried()]), lookup(state(), seen)), null);
    assert.deepEqual(seen, [[FROM, 'abc1234def5678']]);
  });

  it('reads the description from GitHub when the rollup leaves it out', () => {
    const reads = { description: () => `carried from ${FROM}: docs-only change`, state: () => state({ fromReview: { state: 'failure' } }) };
    assert.match(decideMerge(prc([...green, review('SUCCESS')]), reads), /carried from fffffff.*no agent-review success/);
  });

  it('refuses a carry naming a commit whose agent review failed', () => {
    const why = decideMerge(prc([...green, carried()]), lookup(state({ fromReview: { state: 'failure', description: 'x' } })));
    assert.match(why, /no agent-review success/);
    assert.match(why, /speckit-pr-test 21/);
  });

  it('refuses a carry naming a commit that is not an ancestor of head', () => {
    assert.match(decideMerge(prc([...green, carried()]), lookup(state({ compare: { ...state().compare, status: 'diverged' } }))), /not an ancestor/);
  });

  it('refuses a carry over a diff that is not documentation only', () => {
    const compare = { ...state().compare, files: [{ filename: 'specs/x/deferred.md' }, { filename: '.claude/hooks/merge-gate.mjs' }] };
    assert.match(decideMerge(prc([...green, carried()]), lookup(state({ compare }))), /merge-gate\.mjs/);
  });

  it('refuses a carry naming a commit that is not one of the PR\'s own, such as a tested commit on main', () => {
    const why = decideMerge({ ...prc([...green, carried()]), commits: [{ oid: 'abc1234def5678' }] }, lookup(state()));
    assert.match(why, /not one of this PR's commits/);
    assert.match(decideMerge(pr([...green, carried()]), lookup(state())), /not one of this PR's commits/);
  });

  it('refuses a carry it cannot verify, rather than trusting it', () => {
    const broken = { description: () => null, state: () => { throw new Error('HTTP 502'); } };
    assert.match(decideMerge(prc([...green, carried()]), broken), /could not verify.*HTTP 502/);
    assert.match(decideMerge(prc([...green, carried()])), /could not verify/);
    const unreadable = { description: () => { throw new Error('HTTP 502'); }, state: () => state() };
    assert.match(decideMerge(prc([...green, review('SUCCESS')]), unreadable), /could not read/);
  });

  it('still needs every CI check after a verified carry', () => {
    assert.match(decideMerge(prc([run('Unit tests', 'FAILURE'), run('CI OK', 'FAILURE'), carried()]), lookup(state())), /CI failed/);
    assert.match(decideMerge(prc([carried()]), lookup(state())), /no CI OK check/);
  });
});
