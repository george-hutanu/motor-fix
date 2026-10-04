import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

import { allGreen, decide } from './pr-lifecycle-gate.mjs';

const green = [{ conclusion: 'SUCCESS' }, { conclusion: 'SKIPPED' }];
const ready = (over = {}) => ({
  isDraft: false,
  mergeable: 'MERGEABLE',
  number: 6,
  state: 'OPEN',
  statusCheckRollup: green,
  ...over,
});
const task = (over = {}) => ({ ahead: 3, branch: '050-cockpit-theme', pr: ready(), unpushed: 0, ...over });

describe('PR lifecycle gate — what it leaves alone', () => {
  it('lets a session on main, a detached HEAD or a branch with nothing ahead end', () => {
    assert.equal(decide(task({ branch: 'main' })), null);
    assert.equal(decide(task({ branch: 'HEAD' })), null);
    assert.equal(decide(task({ ahead: 0, pr: null, unpushed: 0 })), null);
  });

  it('lets a draft end: the work is not done yet', () => {
    assert.equal(decide(task({ pr: ready({ isDraft: true }) })), null);
  });

  it('lets a ready PR end while its checks are pending, failing or missing', () => {
    assert.equal(decide(task({ pr: ready({ statusCheckRollup: [{ state: 'PENDING' }] }) })), null);
    assert.equal(decide(task({ pr: ready({ statusCheckRollup: [{ conclusion: 'FAILURE' }] }) })), null);
    assert.equal(decide(task({ pr: ready({ statusCheckRollup: [] }) })), null);
  });

  it('lets a PR that cannot merge cleanly, or is merged or closed, end', () => {
    assert.equal(decide(task({ pr: ready({ mergeable: 'CONFLICTING' }) })), null);
    assert.equal(decide(task({ pr: ready({ state: 'MERGED' }) })), null);
    assert.equal(decide(task({ pr: ready({ state: 'CLOSED' }) })), null);
  });
});

describe('PR lifecycle gate — what it refuses', () => {
  it('refuses unpushed commits, before anything else', () => {
    assert.match(decide(task({ pr: null, unpushed: 2 })), /2 commit\(s\).*not pushed.*git push -u origin 050-cockpit-theme/);
  });

  it('refuses a pushed task branch with no PR', () => {
    assert.match(decide(task({ pr: null })), /has no PR.*gh pr create --draft/);
  });

  it('refuses a ready PR left unmerged after every check passed', () => {
    assert.match(decide(task()), /PR #6 is ready and every check passed.*gh pr merge 6 --merge/);
  });
});

describe('PR lifecycle gate — green means every check', () => {
  it('counts success, neutral and skipped as green, and nothing else', () => {
    assert.equal(allGreen(green), true);
    assert.equal(allGreen([{ conclusion: 'NEUTRAL' }]), true);
    assert.equal(allGreen([...green, { conclusion: 'CANCELLED' }]), false);
    assert.equal(allGreen([{ state: 'SUCCESS' }]), true);
  });

  it('never treats an empty rollup as green', () => {
    assert.equal(allGreen([]), false);
  });
});
