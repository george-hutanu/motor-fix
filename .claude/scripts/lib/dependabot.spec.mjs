import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

import * as gate from '../../hooks/pr-lifecycle-gate.mjs';
import { isDependabot, openedByDependabot } from './dependabot.mjs';

const commit = (over = {}) => ({ oid: 'abc1234', authors: [{ login: 'dependabot[bot]' }], committer: { login: 'web-flow' }, verified: true, ...over });
const pr = (over = {}) => ({ author: { login: 'app/dependabot' }, commits: [commit()], ...over });

describe('the Dependabot rule, shared by the gates and the review workflow', () => {
  // @traces 961-FR-002
  it('exempts a PR Dependabot opened whose every commit is Dependabot\'s, committed by GitHub or Dependabot and signed', () => {
    assert.equal(isDependabot(pr()), true);
    assert.equal(isDependabot(pr({ author: { login: 'dependabot[bot]' }, commits: [commit({ committer: { login: 'dependabot[bot]' } })] })), true);
    assert.equal(openedByDependabot(pr()), true);
  });

  // @traces 961-FR-002
  it('takes the exemption away for another author, a human commit, another committer, no signature or no commits', () => {
    assert.equal(isDependabot(pr({ author: { login: 'george-hutanu' } })), false);
    assert.equal(isDependabot(pr({ commits: [commit(), commit({ authors: [{ login: 'george-hutanu' }] })] })), false);
    assert.equal(isDependabot(pr({ commits: [commit({ committer: { login: 'george-hutanu' } })] })), false);
    assert.equal(isDependabot(pr({ commits: [commit({ verified: false })] })), false);
    assert.equal(isDependabot(pr({ commits: [] })), false);
    assert.equal(isDependabot(pr({ commits: [commit({ authors: [] })] })), false);
  });

  it('is the same rule the gates export', () => {
    assert.equal(gate.isDependabot, isDependabot);
    assert.equal(gate.openedByDependabot, openedByDependabot);
  });
});
