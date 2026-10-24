import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

import { decideMerge } from './merge-gate.mjs';

const review = (state) => ({ __typename: 'StatusContext', context: 'agent-review', state });
const run = (name, conclusion, status = 'COMPLETED') => ({ __typename: 'CheckRun', name, status, conclusion, startedAt: '2026-10-05T07:00:00Z' });
const green = [run('Unit tests', 'SUCCESS'), run('CI OK', 'SUCCESS')];
const commit = (over = {}) => ({ oid: 'abc1234def5678', authors: [{ login: 'dependabot[bot]' }], committer: { login: 'web-flow' }, verified: true, ...over });
const bot = (rollup, over = {}) => ({ number: 21, state: 'OPEN', headRefOid: 'abc1234def5678', statusCheckRollup: rollup, author: { login: 'app/dependabot', is_bot: true }, commits: [commit()], ...over });
const notPrQa = { judge: () => 'agent-review on abc1234 was written by .github/workflows/dependabot-review.yml, not the PR QA workflow' };

describe('merge gate: Dependabot exemption under attack', () => {
  // @traces 961-FR-004
  it('refuses a Dependabot PR carrying a human commit even when the workflow-style success is on the head', () => {
    const pushed = bot([...green, review('SUCCESS')], { commits: [commit(), commit({ authors: [{ login: 'george-hutanu' }] })] });
    assert.match(decideMerge(pushed, undefined, notPrQa), /not the PR QA workflow/);
  });

  // @traces 961-FR-004
  it('refuses an unverified Dependabot commit carrying a non-pr-qa success', () => {
    const unsigned = bot([...green, review('SUCCESS')], { commits: [commit({ verified: false })] });
    assert.match(decideMerge(unsigned, undefined, notPrQa), /not the PR QA workflow/);
  });

  // @traces 961-FR-004
  it('refuses a Dependabot PR with no checks at all, with or without a success', () => {
    assert.notEqual(decideMerge(bot([]), undefined, notPrQa), null);
    assert.notEqual(decideMerge(bot([review('SUCCESS')]), undefined, notPrQa), null);
    assert.notEqual(decideMerge(bot(undefined), undefined, notPrQa), null);
  });

  // @traces 961-FR-004
  it('refuses a Dependabot PR whose CI OK is pending or cancelled, success on the head notwithstanding', () => {
    for (const ci of [run('CI OK', null, 'IN_PROGRESS'), run('CI OK', 'CANCELLED'), run('CI OK', 'TIMED_OUT'), run('CI OK', 'STARTUP_FAILURE')]) {
      assert.notEqual(decideMerge(bot([run('Unit tests', 'SUCCESS'), ci, review('SUCCESS')]), undefined, notPrQa), null);
    }
  });

  // @traces 961-FR-004
  it('refuses a failure, an error and a pending review on an exempt Dependabot PR', () => {
    for (const state of ['FAILURE', 'ERROR', 'PENDING', 'EXPECTED']) {
      assert.notEqual(decideMerge(bot([...green, review(state)]), undefined, notPrQa), null, state);
    }
  });

  // @traces 961-FR-004
  it('lets the exempt Dependabot PR through with the review absent or success, and the provenance judge never consulted', () => {
    let asked = 0;
    const spy = { judge: () => { asked += 1; return 'not pr-qa'; } };
    assert.equal(decideMerge(bot(green), undefined, spy), null);
    assert.equal(decideMerge(bot([...green, review('SUCCESS')]), undefined, spy), null);
    assert.equal(asked, 0);
  });

  // @traces 961-FR-004
  it('a non-Dependabot PR gets no help from a Dependabot-looking branch, title or commit list', () => {
    const imposter = bot([...green, review('SUCCESS')], { author: { login: 'george-hutanu' }, headRefName: 'dependabot/npm_and_yarn/x', title: 'chore(deps): bump x' });
    assert.match(decideMerge(imposter, undefined, notPrQa), /not the PR QA workflow/);
    assert.match(decideMerge({ ...imposter, statusCheckRollup: green }), /no agent-review status/);
  });

  // @traces 961-FR-004
  it('answers the same twice for the same PR', () => {
    const p = bot([...green, review('FAILURE')]);
    assert.equal(decideMerge(p), decideMerge(p));
    assert.match(decideMerge(p), /agent-review is failure/);
  });

  // @traces 961-FR-004
  it('does not mutate the PR it judges', () => {
    const p = bot([...green, review('SUCCESS')]);
    const before = JSON.stringify(p);
    decideMerge(p, undefined, notPrQa);
    assert.equal(JSON.stringify(p), before);
  });
});
