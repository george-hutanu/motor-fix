import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { allGreen, decide } from './pr-lifecycle-gate.mjs';

const review = (state) => ({ __typename: 'StatusContext', context: 'agent-review', state });
const cr = (workflowName, conclusion, status = 'COMPLETED') => ({ __typename: 'CheckRun', name: 'scripts', workflowName, status, conclusion });
const ready = (rollup) => ({ isDraft: false, mergeable: 'MERGEABLE', labels: [{ name: 'QA' }, { name: 'feature' }], number: 6, title: 'feat(ui-cockpit): ST-50 Cockpit theme', state: 'OPEN', statusCheckRollup: rollup });
const task = (rollup) => ({ ahead: 3, branch: '050-cockpit-theme', pr: ready(rollup), prLinked: true, unpushed: 0 });

describe('PR lifecycle gate against a Mutation run on the head, adversarial', () => {
  // @traces 1344-FR-010
  it('calls a PR mergeable past Mutation checks in every state', () => {
    const rollup = [cr('CI', 'SUCCESS'), cr('Mutation', 'FAILURE'), cr('Mutation', null, 'IN_PROGRESS'), cr('Mutation', 'CANCELLED'), review('SUCCESS')];
    assert.match(decide(task(rollup)), /every check passed/);
  });

  // @traces 1344-FR-010
  it('allGreen stays false for a failing check whose workflow is empty or missing', () => {
    assert.equal(allGreen([cr('CI', 'SUCCESS'), cr('', 'FAILURE')]), false);
    const bare = { __typename: 'CheckRun', name: 'x', status: 'COMPLETED', conclusion: 'FAILURE' };
    assert.equal(allGreen([cr('CI', 'SUCCESS'), bare]), false);
  });

  // @traces 1344-FR-010
  it('allGreen stays false for a pending check of another workflow beside a passed Mutation one', () => {
    assert.equal(allGreen([cr('CI', null, 'IN_PROGRESS'), cr('Mutation', 'SUCCESS')]), false);
  });

  // @traces 1344-FR-010
  it('lets the session end while the head holds only Mutation checks and agent-review', () => {
    assert.equal(decide(task([cr('Mutation', 'SUCCESS'), cr('Mutation', 'FAILURE'), review('SUCCESS')])), null);
  });

  // @traces 1344-FR-010
  it('does not call a PR mergeable when a real check fails beside passing Mutation checks', () => {
    assert.equal(decide(task([cr('CI', 'FAILURE'), cr('Mutation', 'SUCCESS'), review('SUCCESS')])), null);
  });
});
