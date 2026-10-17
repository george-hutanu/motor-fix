import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fingerprint, hookById, scriptPath } from './hooks.mjs';
import { isMutationCheck, MUTATION_WORKFLOW } from './mutation-check.mjs';

const root = join(import.meta.dirname, '..', '..', '..');

describe('a Mutation workflow check', () => {
  // @traces 1344-FR-010
  it('is named after the workflow file', () => {
    const name = /^name: (.+)$/m.exec(readFileSync(join(root, '.github/workflows/mutation.yml'), 'utf8'))?.[1];
    assert.equal(MUTATION_WORKFLOW, name);
  });

  // @traces 1344-FR-010
  it("is told by gh's rollup workflowName or gh pr checks' workflow", () => {
    assert.equal(isMutationCheck({ name: 'scripts', workflowName: 'Mutation' }), true);
    assert.equal(isMutationCheck({ name: 'scripts', workflow: 'Mutation' }), true);
  });

  // @traces 1344-FR-010
  it('is never a check of another workflow, a status context or a check whose workflow is unknown', () => {
    assert.equal(isMutationCheck({ name: 'Mutation', workflowName: 'CI' }), false);
    assert.equal(isMutationCheck({ name: 'Mutation', workflow: '' }), false);
    assert.equal(isMutationCheck({ __typename: 'StatusContext', context: 'Mutation', state: 'PENDING' }), false);
    assert.equal(isMutationCheck({ name: 'Mutation' }), false);
  });

  // @traces 1344-FR-009
  it('is read by gates blessed as they stand', () => {
    for (const id of ['pre:bash:merge-gate', 'stop:pr-lifecycle']) {
      const entry = hookById(root, id);
      assert.equal(fingerprint(scriptPath(root, entry)), entry.fingerprint, id);
    }
  });
});
