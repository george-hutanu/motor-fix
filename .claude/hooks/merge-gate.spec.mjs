import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

import { decideMerge, mergeTarget } from './merge-gate.mjs';

const review = (state) => ({ __typename: 'StatusContext', context: 'agent-review', state });
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
    const why = decideMerge(pr([{ conclusion: 'SUCCESS' }]));
    assert.match(why, /agent-review/);
    assert.match(why, /abc1234/);
    assert.match(why, /speckit-pr-test 21/);
  });

  it('refuses a failing agent review', () => {
    assert.match(decideMerge(pr([{ conclusion: 'SUCCESS' }, review('FAILURE')])), /failure/i);
  });

  it('lets the merge run with agent-review success on the head commit', () => {
    assert.equal(decideMerge(pr([{ conclusion: 'SUCCESS' }, review('SUCCESS')])), null);
  });

  it('leaves a PR that is not open to GitHub to refuse', () => {
    assert.equal(decideMerge({ ...pr([]), state: 'MERGED' }), null);
  });
});

describe('merge gate — Dependabot PRs need no agent review', () => {
  const bot = (rollup, login = 'app/dependabot') => ({ ...pr(rollup), author: { login, is_bot: true } });

  it('lets a Dependabot PR merge with every other check green and no agent-review status', () => {
    assert.equal(decideMerge(bot([{ conclusion: 'SUCCESS' }, { conclusion: 'SKIPPED' }])), null);
    assert.equal(decideMerge(bot([{ conclusion: 'SUCCESS' }], 'dependabot[bot]')), null);
  });

  it('refuses a Dependabot PR with a failing, pending or missing check, and names it', () => {
    const red = decideMerge(bot([{ conclusion: 'SUCCESS' }, { name: 'Unit tests', conclusion: 'FAILURE' }]));
    assert.match(red, /Unit tests/);
    assert.match(red, /Dependabot/);
    assert.match(decideMerge(bot([{ name: 'Build', status: 'IN_PROGRESS', conclusion: '' }])), /Build/);
    assert.match(decideMerge(bot([{ context: 'CI OK', state: 'PENDING' }])), /CI OK/);
    assert.match(decideMerge(bot([])), /no checks/);
  });

  it('still refuses a Dependabot PR whose agent review failed', () => {
    assert.match(decideMerge(bot([{ conclusion: 'SUCCESS' }, review('FAILURE')])), /agent-review is failure/);
  });

  it('reads the author, not the title or branch: anyone else still needs the agent review', () => {
    const human = { ...pr([{ conclusion: 'SUCCESS' }]), title: 'chore(deps): bump vitest', headRefName: 'dependabot/npm_and_yarn/vitest-5', author: { login: 'george-hutanu' } };
    assert.match(decideMerge(human), /no agent-review status/);
    assert.match(decideMerge({ ...pr([{ conclusion: 'SUCCESS' }]), author: { login: 'dependabot-fan' } }), /no agent-review status/);
  });
});
