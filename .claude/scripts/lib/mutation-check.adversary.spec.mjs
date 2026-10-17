import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { isMutationCheck } from './mutation-check.mjs';

describe('telling a Mutation workflow check, hostile inputs', () => {
  // @traces 1344-FR-010
  it('never throws on null, undefined, a string or an empty object, and answers false', () => {
    for (const v of [null, undefined, 'Mutation', 42, {}, []]) assert.equal(isMutationCheck(v), false);
  });

  // @traces 1344-FR-010
  it('matches the workflow name exactly, not by case, padding or prefix', () => {
    for (const w of ['mutation', 'MUTATION', ' Mutation', 'Mutation ', 'Mutation tests', 'Mutations', 'Mutation\n'])
      assert.equal(isMutationCheck({ name: 'scripts', workflowName: w }), false, JSON.stringify(w));
  });

  // @traces 1344-FR-010
  it('counts a non-string workflow as unknown', () => {
    for (const w of [null, 0, ['Mutation'], { name: 'Mutation' }]) {
      assert.equal(isMutationCheck({ name: 'x', workflowName: w }), false);
      assert.equal(isMutationCheck({ name: 'x', workflow: w }), false);
    }
  });

  // @traces 1344-FR-010
  it('does not take a status context for a check even when it carries the workflow name', () => {
    assert.equal(isMutationCheck({ __typename: 'StatusContext', context: 'agent-review', state: 'SUCCESS', workflowName: 'Mutation' }), false);
  });
});
