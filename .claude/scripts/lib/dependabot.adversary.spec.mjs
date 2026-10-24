import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

import { dependabotCommit, isDependabot, openedByDependabot } from './dependabot.mjs';

const c = (over = {}) => ({ authors: [{ login: 'dependabot[bot]' }], committer: { login: 'web-flow' }, verified: true, ...over });
const pr = (over = {}) => ({ author: { login: 'app/dependabot' }, commits: [c()], ...over });

describe('dependabot predicate: hostile shapes', () => {
  // @traces 961-FR-002
  it('answers false, never throws, for null, undefined and empty input', () => {
    for (const v of [null, undefined, {}, [], 'x', 0]) {
      assert.equal(isDependabot(v), false);
      assert.equal(openedByDependabot(v), false);
    }
  });

  // @traces 961-FR-002
  it('answers false when commits is not an array', () => {
    for (const commits of [null, 'abc', { length: 1 }, 5, {}]) assert.equal(isDependabot(pr({ commits })), false);
  });

  // @traces 961-FR-002
  it('answers false, not a TypeError, for a null entry among a commit\'s authors or commits', () => {
    assert.equal(isDependabot(pr({ commits: [c({ authors: [null] })] })), false);
    assert.equal(isDependabot(pr({ commits: [c({ authors: [{ login: 'dependabot[bot]' }, undefined] })] })), false);
    assert.equal(isDependabot(pr({ commits: [null] })), false);
  });

  // @traces 961-FR-002
  it('answers false for a commit with no authors, or authors that is not a list', () => {
    for (const authors of [[], undefined, null, 'dependabot[bot]', { login: 'dependabot[bot]' }]) {
      assert.equal(dependabotCommit(c({ authors })), false);
    }
  });

  // @traces 961-FR-002
  it('accepts only the exact committers and an exact true signature', () => {
    for (const login of ['Web-Flow', 'web-flow ', 'webflow', 'github', '']) assert.equal(dependabotCommit(c({ committer: { login } })), false, login);
    for (const verified of ['true', 1, undefined, null, 'verified']) assert.equal(dependabotCommit(c({ verified })), false, String(verified));
    assert.equal(dependabotCommit(c({ committer: { login: 'dependabot[bot]' } })), true);
  });

  // @traces 961-FR-002
  it('one bad commit among ten thousand good ones takes the exemption away', () => {
    const many = Array.from({ length: 10000 }, () => c());
    assert.equal(isDependabot(pr({ commits: many })), true);
    assert.equal(isDependabot(pr({ commits: [...many, c({ verified: false })] })), false);
    assert.equal(isDependabot(pr({ commits: [c({ authors: [{ login: 'george-hutanu' }] }), ...many] })), false);
  });

  // @traces 961-FR-002
  it('does not read the title, branch or body: a bot-looking human PR is not exempt', () => {
    const human = { author: { login: 'george-hutanu' }, title: 'chore(deps): bump x', headRefName: 'dependabot/npm_and_yarn/x', commits: [c()] };
    assert.equal(isDependabot(human), false);
    assert.equal(isDependabot({ ...pr(), author: null }), false);
    assert.equal(isDependabot({ ...pr(), author: { login: undefined } }), false);
  });
});
