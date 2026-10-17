import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { decideMerge } from './merge-gate.mjs';

const review = (state) => ({ __typename: 'StatusContext', context: 'agent-review', state });
const run = (name, conclusion, status = 'COMPLETED', workflowName = 'CI', startedAt = '2026-10-05T07:00:00Z') => ({ __typename: 'CheckRun', name, status, conclusion, startedAt, workflowName });
const pr = (rollup) => ({ number: 21, state: 'OPEN', headRefOid: 'abc1234def5678', statusCheckRollup: rollup });
const green = [run('Unit tests', 'SUCCESS'), run('CI OK', 'SUCCESS')];

describe('merge gate against a Mutation run on the head, adversarial', () => {
  // @traces 1344-FR-010
  it('ignores a failing Mutation check that is named CI OK', () => {
    assert.equal(decideMerge(pr([...green, run('CI OK', 'FAILURE', 'COMPLETED', 'Mutation'), review('SUCCESS')])), null);
  });

  // @traces 1344-FR-010
  it('ignores a Mutation check started after the real CI OK of the same name', () => {
    const later = '2026-10-05T09:00:00Z';
    assert.equal(decideMerge(pr([...green, run('CI OK', null, 'IN_PROGRESS', 'Mutation', later), review('SUCCESS')])), null);
  });

  // @traces 1344-FR-010
  it('does not take a Mutation CI OK for the CI OK that the merge needs', () => {
    assert.match(decideMerge(pr([run('Unit tests', 'SUCCESS'), run('CI OK', 'SUCCESS', 'COMPLETED', 'Mutation'), review('SUCCESS')])), /no CI OK check/);
  });

  // @traces 1344-FR-010
  it('refuses a failing check whose workflow could not be resolved', () => {
    assert.match(decideMerge(pr([...green, run('Lint', 'FAILURE', 'COMPLETED', ''), review('SUCCESS')])), /Lint|failed/);
  });

  // @traces 1344-FR-010
  it('refuses a failing check that carries no workflow field at all', () => {
    const bare = { __typename: 'CheckRun', name: 'Lint', status: 'COMPLETED', conclusion: 'FAILURE' };
    assert.match(decideMerge(pr([...green, bare, review('SUCCESS')])), /Lint|failed/);
  });

  // @traces 1344-FR-010
  it('still refuses a failing CI check when Mutation checks pass beside it', () => {
    assert.match(decideMerge(pr([...green, run('Unit tests', 'FAILURE'), run('scripts', 'SUCCESS', 'COMPLETED', 'Mutation'), review('SUCCESS')])), /failed/i);
  });

  // @traces 1344-FR-010
  it('merges past ten thousand Mutation checks in every state', () => {
    const states = [[null, 'IN_PROGRESS'], [null, 'QUEUED'], ['FAILURE', 'COMPLETED'], ['TIMED_OUT', 'COMPLETED'], ['STARTUP_FAILURE', 'COMPLETED'], ['ACTION_REQUIRED', 'COMPLETED']];
    const many = Array.from({ length: 10000 }, (_, i) => run(`shard-${i}`, ...states[i % states.length], 'Mutation'));
    assert.equal(decideMerge(pr([...green, ...many, review('SUCCESS')])), null);
  });

  // @traces 1344-FR-010
  it('does not mutate the rollup it was given', () => {
    const rollup = [...green, run('scripts', 'FAILURE', 'COMPLETED', 'Mutation'), review('SUCCESS')];
    const before = JSON.stringify(rollup);
    decideMerge(pr(rollup));
    assert.equal(JSON.stringify(rollup), before);
  });
});
