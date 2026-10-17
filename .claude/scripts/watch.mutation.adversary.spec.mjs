import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { summarizePr } from './watch.mjs';

const check = (workflowName, conclusion, status = 'COMPLETED') => ({ __typename: 'CheckRun', name: 'ci', status, conclusion, workflowName });
const review = (state) => ({ __typename: 'StatusContext', context: 'agent-review', state });
const pr = (rollup) => ({ number: 21, headRefName: '901-x', state: 'OPEN', isDraft: false, headRefOid: 'abc', statusCheckRollup: rollup });

describe('watch PR summary against a Mutation run, adversarial', () => {
  // @traces 1344-FR-010
  it('reads fail when a real check fails beside a passing Mutation one', () => {
    assert.equal(summarizePr(pr([check('CI', 'FAILURE'), check('Mutation', 'SUCCESS')])).checks, 'fail');
  });

  // @traces 1344-FR-010
  it('reads pending when a real check is pending beside a failed Mutation one', () => {
    assert.equal(summarizePr(pr([check('CI', null, 'IN_PROGRESS'), check('Mutation', 'FAILURE')])).checks, 'pending');
  });

  // @traces 1344-FR-010
  it('reads fail for a failing check with an empty or missing workflow', () => {
    assert.equal(summarizePr(pr([check('CI', 'SUCCESS'), check('', 'FAILURE')])).checks, 'fail');
    const bare = { __typename: 'CheckRun', name: 'x', status: 'COMPLETED', conclusion: 'FAILURE' };
    assert.equal(summarizePr(pr([check('CI', 'SUCCESS'), bare])).checks, 'fail');
  });

  // @traces 1344-FR-010
  it('reads none, with agent-review kept, when only Mutation checks sit beside it', () => {
    const s = summarizePr(pr([check('Mutation', 'FAILURE'), review('SUCCESS')]));
    assert.equal(s.checks, 'none');
    assert.equal(s.agentReview, 'success');
  });

  // @traces 1344-FR-010
  it('reads none for an empty or absent rollup', () => {
    assert.equal(summarizePr(pr([])).checks, 'none');
    assert.equal(summarizePr(pr(undefined)).checks, 'none');
    assert.equal(summarizePr(pr(null)).checks, 'none');
  });
});
