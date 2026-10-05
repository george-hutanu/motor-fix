import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

import { allGreen, decide, hasAgentReview, isDependabot, typeLabel } from './pr-lifecycle-gate.mjs';

const review = (state) => ({ __typename: 'StatusContext', context: 'agent-review', state });
const green = [{ conclusion: 'SUCCESS' }, { conclusion: 'SKIPPED' }, review('SUCCESS')];
const ready = (over = {}) => ({
  isDraft: false,
  mergeable: 'MERGEABLE',
  labels: [{ name: 'QA' }, { name: 'feature' }],
  number: 6,
  title: 'feat(ui-cockpit): ST-50 Cockpit theme',
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
    assert.equal(decide(task({ pr: ready({ isDraft: true, labels: [{ name: 'in development' }, { name: 'feature' }] }) })), null);
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
    assert.equal(decide(task({ branch: 'chore-harness-evals', pr: ready({ isDraft: true, labels: [{ name: 'in development' }, { name: 'feature' }] }), prLinked: false })), null);
    assert.equal(decide(task({ pr: ready({ state: 'MERGED' }), prLinked: false })), null);
    assert.equal(decide(task({ pr: ready({ state: 'CLOSED' }), prLinked: false })), null);
  });
});

describe('PR lifecycle gate — the QA label', () => {
  it('refuses a ready PR without the QA label, before anything about merging', () => {
    const why = decide(task({ pr: ready({ labels: [] }) }));
    assert.match(why, /PR #6/);
    assert.match(why, /gh pr edit 6 --add-label "QA"\)/);
  });

  it('asks the same of a ready PR with no story and of one whose checks are still running', () => {
    assert.match(decide(task({ branch: 'chore-x', pr: ready({ labels: [] }) })), /--add-label "QA"/);
    assert.match(decide(task({ pr: ready({ labels: [], statusCheckRollup: [{ state: 'PENDING' }] }) })), /--add-label "QA"/);
  });

  it('refuses a draft without the in development label', () => {
    const why = decide(task({ branch: 'chore-x', pr: ready({ isDraft: true, labels: [] }) }));
    assert.match(why, /gh pr edit 6 --add-label "in development"/);
    assert.equal(decide(task({ branch: 'chore-x', pr: ready({ isDraft: true, labels: [{ name: 'in development' }, { name: 'feature' }] }) })), null);
  });

  it('takes planning for a draft: the task has not reached implement yet', () => {
    assert.equal(decide(task({ branch: 'chore-x', pr: ready({ isDraft: true, labels: [{ name: 'planning' }, { name: 'feature' }] }) })), null);
    assert.match(decide(task({ branch: 'chore-x', pr: ready({ isDraft: true, labels: [] }) })), /"planning".*"in development"/);
  });

  it('does not take planning for a ready PR, and names the swap', () => {
    assert.match(decide(task({ pr: ready({ labels: [{ name: 'planning' }] }) })), /gh pr edit 6 --remove-label "planning" --add-label "QA"\)/);
  });

  it('does not take in development for a ready PR, and names the swap', () => {
    assert.match(
      decide(task({ pr: ready({ labels: [{ name: 'in development' }, { name: 'feature' }] }) })),
      /gh pr edit 6 --remove-label "in development" --add-label "QA"\)/,
    );
  });

  it('leaves a merged and a closed PR without the label alone', () => {
    assert.equal(decide(task({ pr: ready({ labels: [], state: 'MERGED' }) })), null);
    assert.equal(decide(task({ pr: ready({ labels: [], state: 'CLOSED' }) })), null);
  });
});

describe('PR lifecycle gate — in review is retired, folded into QA', () => {
  const labels = (...names) => [...names.map((name) => ({ name })), { name: 'feature' }];
  const pending = [{ state: 'PENDING' }];

  it('does not take in review for a ready PR: ready is QA', () => {
    const why = decide(task({ pr: ready({ labels: labels('in review'), statusCheckRollup: pending }) }));
    assert.match(why, /retired/);
    assert.match(why, /gh pr edit 6 --remove-label "in review" --add-label "QA"\)/);
  });

  it('drops in review beside QA without adding anything', () => {
    const why = decide(task({ pr: ready({ labels: labels('in review', 'QA'), statusCheckRollup: pending }) }));
    assert.match(why, /gh pr edit 6 --remove-label "in review"\)/);
    assert.doesNotMatch(why, /add-label/);
  });

  it('swaps in review on a draft for in development', () => {
    assert.match(decide(task({ pr: ready({ isDraft: true, labels: labels('in review') }) })), /gh pr edit 6 --remove-label "in review" --add-label "in development"\)/);
  });
});

describe('PR lifecycle gate — exactly one stage label', () => {
  const labels = (...names) => [...names.map((name) => ({ name })), { name: 'feature' }];
  const pending = [{ state: 'PENDING' }];

  it('refuses a ready PR carrying in development and QA, keeping QA', () => {
    const why = decide(task({ pr: ready({ labels: labels('in development', 'QA'), statusCheckRollup: pending }) }));
    assert.match(why, /more than one stage label \(in development, QA\)/);
    assert.match(why, /Keep "QA" \(gh pr edit 6 --remove-label "in development"\)/);
  });

  it('keeps the furthest fitting label of a draft, and drops one that does not fit', () => {
    assert.match(decide(task({ pr: ready({ isDraft: true, labels: labels('planning', 'in development') }) })), /Keep "in development" \(gh pr edit 6 --remove-label "planning"\)/);
    assert.match(decide(task({ pr: ready({ isDraft: true, labels: labels('in development', 'QA') }) })), /Keep "in development" \(gh pr edit 6 --remove-label "QA"\)/);
  });

  it('refuses a draft carrying the ready stage label, naming the swap', () => {
    assert.match(decide(task({ pr: ready({ isDraft: true, labels: labels('QA') }) })), /gh pr edit 6 --remove-label "QA" --add-label "in development"\)/);
  });

  it('lets one fitting stage label through', () => {
    for (const stage of ['planning', 'in development']) assert.equal(decide(task({ pr: ready({ isDraft: true, labels: labels(stage) }) })), null, stage);
    assert.equal(decide(task({ pr: ready({ labels: labels('QA'), statusCheckRollup: pending }) })), null);
  });
});

describe('PR lifecycle gate — the type label', () => {
  it('reads the type label off the Conventional Commit title', () => {
    assert.equal(typeLabel('feat(web): ST-21 x'), 'feature');
    assert.equal(typeLabel('fix(audit): x'), 'bug');
    assert.equal(typeLabel('refactor(api)!: x'), 'tech debt');
    assert.equal(typeLabel('perf(web): x'), 'performance');
    assert.equal(typeLabel('docs(specs): x'), 'documentation');
    assert.equal(typeLabel('test(api): x'), 'tests');
    for (const t of ['ci(platform): x', 'build: x', 'chore(harness): x']) assert.equal(typeLabel(t), 'tooling');
    assert.equal(typeLabel('Merge branch main'), null);
  });

  it('refuses an open PR, draft or ready, without its type label', () => {
    for (const isDraft of [true, false]) {
      const labels = [{ name: isDraft ? 'in development' : 'QA' }];
      assert.match(decide(task({ pr: ready({ isDraft, labels }) })), /gh pr edit 6 --add-label "feature"/);
    }
  });

  it('asks for breaking on a title marked with !', () => {
    const labels = [{ name: 'QA' }, { name: 'feature' }];
    assert.match(decide(task({ pr: ready({ labels, title: 'feat(api)!: ST-9 x' }) })), /--add-label "breaking"/);
  });

  it('leaves a title with no Conventional type, and a merged PR, alone', () => {
    assert.equal(decide(task({ pr: ready({ isDraft: true, labels: [{ name: 'planning' }], title: 'WIP' }) })), null);
    assert.equal(decide(task({ pr: ready({ labels: [], state: 'MERGED' }) })), null);
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

describe('PR lifecycle gate — Dependabot PRs need no agent review', () => {
  const checks = [{ conclusion: 'SUCCESS' }, { conclusion: 'SKIPPED' }];
  const bot = (over = {}) =>
    ready({ author: { login: 'app/dependabot', is_bot: true }, commits: [{ authors: [{ login: 'dependabot[bot]' }] }], labels: [{ name: 'QA' }, { name: 'tooling' }], title: 'chore(deps): bump actions/cache from 4 to 6', statusCheckRollup: checks, ...over });

  it('knows Dependabot by the PR author and every commit author, never the title or branch', () => {
    assert.equal(isDependabot({ author: { login: 'app/dependabot' }, commits: [{ authors: [{ login: 'dependabot[bot]' }] }] }), true);
    assert.equal(isDependabot({ author: { login: 'dependabot[bot]' }, commits: [{ authors: [{ login: 'dependabot[bot]' }] }] }), true);
    assert.equal(isDependabot({ author: { login: 'app/dependabot' }, commits: [{ authors: [{ login: 'dependabot[bot]' }] }, { authors: [{ login: 'george-hutanu' }] }] }), false);
    assert.equal(isDependabot({ author: { login: 'app/dependabot' } }), false);
    assert.equal(isDependabot({ author: { login: 'app/dependabot' }, commits: [] }), false);
    assert.equal(isDependabot({ author: { login: 'george-hutanu' }, title: 'chore(deps): bump x', headRefName: 'dependabot/npm_and_yarn/x' }), false);
    assert.equal(isDependabot({}), false);
  });

  it('asks for the merge, not the tester, on a green Dependabot PR', () => {
    const why = decide(task({ branch: 'dependabot/github_actions/actions/cache-6', pr: bot() }));
    assert.match(why, /gh pr merge 6 --merge/);
    assert.doesNotMatch(why, /speckit-pr-test/);
  });

  it('lets a Dependabot PR with a failing or pending check end: fix or wait', () => {
    assert.equal(decide(task({ pr: bot({ statusCheckRollup: [{ conclusion: 'FAILURE' }] }) })), null);
    assert.equal(decide(task({ pr: bot({ statusCheckRollup: [{ state: 'PENDING' }] }) })), null);
  });

  it('still names the tester for a green PR by anyone else', () => {
    const why = decide(task({ pr: ready({ statusCheckRollup: checks, author: { login: 'george-hutanu' } }) }));
    assert.match(why, /speckit-pr-test 6/);
  });
});
