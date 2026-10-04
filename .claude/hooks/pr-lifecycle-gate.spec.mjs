import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

import { allGreen, decide, hasAgentReview } from './pr-lifecycle-gate.mjs';

const review = (state) => ({ __typename: 'StatusContext', context: 'agent-review', state });
const green = [{ conclusion: 'SUCCESS' }, { conclusion: 'SKIPPED' }, review('SUCCESS')];
const ready = (over = {}) => ({
  isDraft: false,
  mergeable: 'MERGEABLE',
  labels: [{ name: 'in review' }],
  number: 6,
  state: 'OPEN',
  statusCheckRollup: green,
  ...over,
});
const task = (over = {}) => ({ ahead: 3, branch: '050-cockpit-theme', pr: ready(), prLinked: true, unpushed: 0, ...over });

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
    assert.match(decide(task({ pr: null })), /has no PR.*gh pr create --draft.*--body-file.*pull_request_template\.md/);
  });

  it('refuses a ready PR left unmerged after every check and the agent review passed', () => {
    assert.match(decide(task()), /PR #6 is ready and every check passed.*gh pr merge 6 --merge/);
  });

  it('refuses a green ready PR with no agent-review success on its head, and names the tester', () => {
    const rollup = [{ conclusion: 'SUCCESS' }, { conclusion: 'SKIPPED' }];
    const why = decide(task({ pr: ready({ statusCheckRollup: rollup }) }));
    assert.match(why, /agent-review/);
    assert.match(why, /speckit-pr-test 6/);
    assert.doesNotMatch(why, /gh pr merge/);
  });

  it('lets a blocked run end on a green ready PR with no agent review: Blocked is how a run stops', () => {
    const rollup = [{ conclusion: 'SUCCESS' }];
    assert.equal(decide(task({ blocked: true, pr: ready({ statusCheckRollup: rollup }) })), null);
  });

  it('lets a session end while the agent review says failure: the fix loop owns that PR', () => {
    const rollup = [{ conclusion: 'SUCCESS' }, review('FAILURE')];
    assert.equal(decide(task({ pr: ready({ statusCheckRollup: rollup }) })), null);
  });
});

describe('PR lifecycle gate — the PR link on the story', () => {
  it('refuses a story branch whose open PR is not recorded on its Notion story, draft or ready', () => {
    for (const pr of [ready({ isDraft: true }), ready()]) {
      const why = decide(task({ pr, prLinked: false }));
      assert.match(why, /PR #6/);
      assert.match(why, /speckit-notion-sync pr/);
    }
  });

  it('asks for the link before the merge', () => {
    assert.doesNotMatch(decide(task({ prLinked: false })), /gh pr merge/);
  });

  it('leaves a branch with no story alone, and a merged or closed PR', () => {
    assert.equal(decide(task({ branch: 'chore-harness-evals', pr: ready({ isDraft: true }), prLinked: false })), null);
    assert.equal(decide(task({ pr: ready({ state: 'MERGED' }), prLinked: false })), null);
    assert.equal(decide(task({ pr: ready({ state: 'CLOSED' }), prLinked: false })), null);
  });
});

describe('PR lifecycle gate — the in review label', () => {
  it('refuses a ready PR without the in review label, before anything about merging', () => {
    const why = decide(task({ pr: ready({ labels: [] }) }));
    assert.match(why, /PR #6/);
    assert.match(why, /gh pr edit 6 --add-label "in review"/);
  });

  it('asks the same of a ready PR with no story and of one whose checks are still running', () => {
    assert.match(decide(task({ branch: 'chore-x', pr: ready({ labels: [] }) })), /in review/);
    assert.match(decide(task({ pr: ready({ labels: [], statusCheckRollup: [{ state: 'PENDING' }] }) })), /in review/);
  });

  it('accepts the QA label in its place: the PR tester swaps one for the other', () => {
    assert.doesNotMatch(decide(task({ pr: ready({ labels: [{ name: 'QA' }] }) })), /add-label/);
  });

  it('leaves a draft, a merged and a closed PR without the label alone', () => {
    assert.equal(decide(task({ pr: ready({ isDraft: true, labels: [] }) })), null);
    assert.equal(decide(task({ pr: ready({ labels: [], state: 'MERGED' }) })), null);
    assert.equal(decide(task({ pr: ready({ labels: [], state: 'CLOSED' }) })), null);
  });
});

describe('PR lifecycle gate — the agent review', () => {
  it('counts only a success status named agent-review', () => {
    assert.equal(hasAgentReview([review('SUCCESS')]), true);
    assert.equal(hasAgentReview([review('FAILURE')]), false);
    assert.equal(hasAgentReview([review('PENDING')]), false);
    assert.equal(hasAgentReview([{ name: 'agent-review', conclusion: 'SUCCESS' }]), true);
    assert.equal(hasAgentReview([{ context: 'ci', state: 'SUCCESS' }]), false);
    assert.equal(hasAgentReview([]), false);
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
