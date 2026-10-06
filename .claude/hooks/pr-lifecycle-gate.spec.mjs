import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { allGreen, attachCommitters, committerArgs, decide, withCommitters, featureDir, handedOff, hasAgentReview, isDependabot, parseCommitters, prLinked, readPr, typeLabel } from './pr-lifecycle-gate.mjs';

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

  it('lets the story agent end on a ready PR it handed off: the tail agent tests and merges it', () => {
    assert.equal(decide(task({ handedOff: true, pr: ready({ statusCheckRollup: [{ conclusion: 'SUCCESS' }] }) })), null);
    // Green and passed by the tester, it still has to merge: a tail that stopped short is caught.
    assert.match(decide(task({ handedOff: true, pr: ready() })), /gh pr merge 6/);
    // The hand-off covers only the tail's steps: labels are still the story agent's.
    assert.match(decide(task({ handedOff: true, pr: ready({ labels: [{ name: 'feature' }] }) })), /QA/);
  });

  it('reads the hand-off note from the active feature, or from specs/<branch>', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gate-'));
    try {
      assert.equal(handedOff(dir, '050-cockpit-theme'), false);
      mkdirSync(join(dir, 'specs', '050-cockpit-theme'), { recursive: true });
      writeFileSync(join(dir, 'specs', '050-cockpit-theme', 'handoff.md'), '# hand-off\n');
      assert.equal(handedOff(dir, '050-cockpit-theme'), true);
      mkdirSync(join(dir, '.specify'), { recursive: true });
      mkdirSync(join(dir, 'specs', '051-other'), { recursive: true });
      writeFileSync(join(dir, '.specify', 'feature.json'), JSON.stringify({ feature_directory: 'specs/051-other' }));
      assert.equal(handedOff(dir, '050-cockpit-theme'), false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // @traces 725-FR-003
  it('reads the hand-off note from a zero-padded feature folder when nothing points at it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gate-'));
    try {
      mkdirSync(join(dir, 'specs', '083-sign-in'), { recursive: true });
      writeFileSync(join(dir, 'specs', '083-sign-in', 'handoff.md'), '# hand-off\n');
      assert.equal(handedOff(dir, '83-sign-in'), true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('lets a session end while the agent review says failure: the fix loop owns that PR', () => {
    const rollup = [{ conclusion: 'SUCCESS' }, review('FAILURE')];
    assert.equal(decide(task({ pr: ready({ statusCheckRollup: rollup }) })), null);
  });
});

describe('PR lifecycle gate — the feature folder', () => {
  const withRepo = (fn) => {
    const dir = mkdtempSync(join(tmpdir(), 'gate-'));
    try {
      fn(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
  const folder = (dir, name, files = {}) => {
    mkdirSync(join(dir, 'specs', name), { recursive: true });
    for (const [file, text] of Object.entries(files)) writeFileSync(join(dir, 'specs', name, file), text);
  };
  const point = (dir, featureDirectory) => {
    mkdirSync(join(dir, '.specify'), { recursive: true });
    writeFileSync(join(dir, '.specify', 'feature.json'), JSON.stringify({ feature_directory: featureDirectory }));
  };
  const linked = '- 2026-10-05 · pr · ST-83 · PR #136 https://github.com/o/r/pull/136\n';

  // @traces 725-FR-001
  it('takes the feature.json pointer first, then specs/<branch>', () =>
    withRepo((dir) => {
      folder(dir, '050-cockpit-theme');
      assert.equal(featureDir(dir, '050-cockpit-theme'), join('specs', '050-cockpit-theme'));
      folder(dir, '051-other');
      point(dir, 'specs/051-other');
      assert.equal(featureDir(dir, '050-cockpit-theme'), 'specs/051-other');
    }));

  // @traces 725-FR-001
  it('passes over a pointer to a folder that is gone, or that is not a path', () =>
    withRepo((dir) => {
      folder(dir, '083-sign-in-apple-google');
      point(dir, 'specs/051-removed');
      assert.equal(featureDir(dir, '83-sign-in-apple-google'), join('specs', '083-sign-in-apple-google'));
      point(dir, 51);
      assert.equal(featureDir(dir, '83-sign-in-apple-google'), join('specs', '083-sign-in-apple-google'));
    }));

  // @traces 725-FR-001
  it('finds a zero-padded folder with the same number and slug', () =>
    withRepo((dir) => {
      folder(dir, '083-sign-in-apple-google');
      assert.equal(featureDir(dir, '83-sign-in-apple-google'), join('specs', '083-sign-in-apple-google'));
    }));

  // @traces 725-FR-001
  it('never takes a folder with the same number but another slug', () =>
    withRepo((dir) => {
      folder(dir, '083-other-work');
      assert.equal(featureDir(dir, '83-sign-in-apple-google'), join('specs', '83-sign-in-apple-google'));
    }));

  // @traces 725-FR-002
  it('sees the PR link in a zero-padded folder, with and without feature.json', () =>
    withRepo((dir) => {
      folder(dir, '083-sign-in-apple-google', { 'notion-sync.md': linked });
      assert.equal(prLinked(dir, '83-sign-in-apple-google', 136), true);
      assert.equal(prLinked(dir, '83-sign-in-apple-google', 137), false);
      point(dir, 'specs/083-sign-in-apple-google');
      assert.equal(prLinked(dir, '83-sign-in-apple-google', 136), true);
    }));
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
  const botCommit = (over = {}) => ({ oid: 'aaa111', authors: [{ login: 'dependabot[bot]' }], committer: { login: 'web-flow' }, verified: true, ...over });
  const bot = (over = {}) =>
    ready({ author: { login: 'app/dependabot', is_bot: true }, commits: [botCommit()], labels: [{ name: 'QA' }, { name: 'tooling' }], title: 'chore(deps): bump actions/cache from 4 to 6', statusCheckRollup: checks, ...over });

  it('knows Dependabot by the PR author and every commit author, never the title or branch', () => {
    assert.equal(isDependabot({ author: { login: 'app/dependabot' }, commits: [botCommit()] }), true);
    assert.equal(isDependabot({ author: { login: 'dependabot[bot]' }, commits: [botCommit()] }), true);
    assert.equal(isDependabot({ author: { login: 'app/dependabot' }, commits: [botCommit(), botCommit({ authors: [{ login: 'george-hutanu' }] })] }), false);
    assert.equal(isDependabot({ author: { login: 'app/dependabot' } }), false);
    assert.equal(isDependabot({ author: { login: 'app/dependabot' }, commits: [] }), false);
    assert.equal(isDependabot({ author: { login: 'george-hutanu' }, title: 'chore(deps): bump x', headRefName: 'dependabot/npm_and_yarn/x' }), false);
    assert.equal(isDependabot({}), false);
  });

  // @traces 610-FR-001
  it('also reads who committed: web-flow or Dependabot, signature verified, on every commit', () => {
    const pr = (...commits) => ({ author: { login: 'app/dependabot' }, commits });
    assert.equal(isDependabot(pr(botCommit({ committer: { login: 'dependabot[bot]' } }))), true);
    assert.equal(isDependabot(pr(botCommit(), botCommit({ committer: { login: 'george-hutanu' } }))), false, 'a cherry-pick or local rebase keeps the author, not the committer');
    assert.equal(isDependabot(pr(botCommit({ verified: false }))), false, 'web-flow without a verified signature is not GitHub');
    assert.equal(isDependabot(pr(botCommit({ verified: 'true' }))), false);
    assert.equal(isDependabot(pr(botCommit({ committer: undefined }))), false, 'no committer data is not Dependabot');
    assert.equal(isDependabot(pr(botCommit({ committer: null, verified: undefined }))), false);
    assert.equal(isDependabot(pr({ oid: 'aaa111', authors: [{ login: 'dependabot[bot]' }] })), false);
  });

  // @traces 610-FR-002
  it('reads the committers off the REST pulls commits list, matched by sha', () => {
    assert.deepEqual(committerArgs(82), ['api', '--paginate', 'repos/{owner}/{repo}/pulls/82/commits?per_page=100', '--jq', '.[] | {sha, login: .committer.login, verified: .commit.verification.verified}']);
    const rows = parseCommitters('{"sha":"aaa111","login":"web-flow","verified":true}\n{"sha":"bbb222","login":null,"verified":false}\n\n');
    assert.deepEqual(rows, [{ sha: 'aaa111', login: 'web-flow', verified: true }, { sha: 'bbb222', login: null, verified: false }]);
    const pr = { author: { login: 'app/dependabot' }, commits: [{ oid: 'aaa111', authors: [{ login: 'dependabot[bot]' }] }, { oid: 'ccc333', authors: [{ login: 'dependabot[bot]' }] }] };
    const out = attachCommitters(pr, rows);
    assert.deepEqual(out.commits[0], { oid: 'aaa111', authors: [{ login: 'dependabot[bot]' }], committer: { login: 'web-flow' }, verified: true });
    assert.equal(out.commits[1].committer, undefined, 'a commit the REST list missed carries no committer');
    assert.equal(isDependabot(out), false);
    assert.equal(isDependabot(attachCommitters({ ...pr, commits: [pr.commits[0]] }, rows)), true);
    assert.equal(pr.commits[0].committer, undefined, 'the PR read is not mutated');
    assert.equal(attachCommitters({ number: 1 }, rows).commits, undefined);
  });

  // @traces 610-FR-001
  it('asks for the tester, not the merge, on a green Dependabot PR someone else committed to', () => {
    const why = decide(task({ pr: bot({ commits: [botCommit({ committer: { login: 'george-hutanu' }, verified: false })] }) }));
    assert.match(why, /speckit-pr-test 6/);
  });

  // @traces 610-FR-002
  it('reads the committers through gh for a Dependabot PR only, and keeps none when the read throws', () => {
    const read = { number: 6, author: { login: 'app/dependabot' }, commits: [{ oid: 'aaa111', authors: [{ login: 'dependabot[bot]' }] }] };
    let calls = 0;
    const gh = () => (calls++, '{"sha":"aaa111","login":"web-flow","verified":true}\n');
    assert.equal(isDependabot(withCommitters(read, gh)), true);
    const human = { ...read, author: { login: 'george-hutanu' } };
    assert.equal(withCommitters(human, gh), human);
    assert.equal(calls, 1);
    const failed = withCommitters(read, () => { throw new Error('gh: HTTP 502'); });
    assert.equal(isDependabot(failed), false);
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

describe('PR lifecycle gate — reading the PR', () => {
  const BRANCH = '766-cloud-rest-fallback';
  const failing = (stderr) => () => ({ code: 1, stdout: '', stderr });

  it('tells no PR from a read that failed', () => {
    assert.deepEqual(readPr(BRANCH, '.', { env: {}, run: failing('no pull requests found for branch "x"') }), { pr: null });
    assert.equal(readPr(BRANCH, '.', { env: {}, run: failing('HTTP 403: GitHub GraphQL is not available') }), null);
  });

  it('on the laptop asks gh pr view for the fields it judges', () => {
    const calls = [];
    const run = (file, args) => {
      calls.push([file, ...args].join(' '));
      return { code: 0, stdout: JSON.stringify({ number: 7, state: 'OPEN', isDraft: true, labels: [], author: { login: 'george-hutanu' } }), stderr: '' };
    };
    assert.equal(readPr(BRANCH, '.', { env: {}, run }).pr.number, 7);
    assert.deepEqual(calls, [`gh pr view ${BRANCH} --json author,commits,number,state,isDraft,labels,mergeable,statusCheckRollup,title`]);
  });

  it('in a cloud session reads it through REST and judges it the same', () => {
    const REPO = 'repos/{owner}/{repo}/';
    const routes = {
      [`pulls?head={owner}:${BRANCH}&state=all&per_page=100`]: [[{ number: 160 }]],
      'pulls/160': { number: 160, title: 'chore(harness): ST-766 x', state: 'open', draft: false, merged_at: null, mergeable: true, head: { ref: BRANCH, sha: 'h1' }, user: { login: 'george-hutanu' }, labels: [{ name: 'QA' }, { name: 'tooling' }] },
      'pulls/160/commits?per_page=100': [[{ sha: 'h1', author: { login: 'george-hutanu' }, commit: { author: { name: 'g', email: 'e' } } }]],
      'commits/h1/check-runs?per_page=100': [{ check_runs: [{ name: 'CI OK', status: 'completed', conclusion: 'success' }] }],
      'commits/h1/status': { statuses: [] },
    };
    const calls = [];
    const run = (file, args) => {
      calls.push([file, ...args].join(' '));
      const hit = routes[args[1].replace(REPO, '')];
      return hit === undefined ? { code: 1, stdout: '', stderr: 'HTTP 403' } : { code: 0, stdout: JSON.stringify(hit), stderr: '' };
    };
    const read = readPr(BRANCH, '.', { env: { CLAUDE_CODE_REMOTE: 'true' }, run });
    assert.ok(calls.every((c) => c.startsWith('gh api ')), calls.join('\n'));
    assert.deepEqual(read.pr.statusCheckRollup, [{ __typename: 'CheckRun', name: 'CI OK', status: 'COMPLETED', conclusion: 'SUCCESS' }]);
    assert.equal(read.pr.mergeable, 'MERGEABLE');
    assert.match(decide({ branch: BRANCH, ahead: 1, unpushed: 0, pr: read.pr }), /no agent-review status/);
  });
});
