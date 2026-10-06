import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEADLINE_MS, deadlineMs, decideMerge, ghReader, mergeTarget, prefetchCarry, readPr } from './merge-gate.mjs';

const review = (state) => ({ __typename: 'StatusContext', context: 'agent-review', state });
const run = (name, conclusion, status = 'COMPLETED', startedAt = '2026-10-05T07:00:00Z') => ({ __typename: 'CheckRun', name, status, conclusion, startedAt });
const green = [run('Unit tests', 'SUCCESS'), run('CI OK', 'SUCCESS')];
const pr = (rollup) => ({ number: 21, state: 'OPEN', headRefOid: 'abc1234def5678', statusCheckRollup: rollup });

describe('merge gate — which commands are merges', () => {
  it('finds gh pr merge with a number, a branch, a URL or nothing', () => {
    assert.deepEqual(mergeTarget('gh pr merge 21 --merge'), { pr: '21' });
    assert.deepEqual(mergeTarget('GH_TOKEN=$(gh auth token -u george-hutanu) gh pr merge feature-branch --merge'), { pr: 'feature-branch' });
    assert.deepEqual(mergeTarget('gh pr merge https://github.com/george-hutanu/motor-fix/pull/21 --squash'), { pr: 'https://github.com/george-hutanu/motor-fix/pull/21' });
    assert.deepEqual(mergeTarget('git push && gh pr merge --merge'), { pr: null });
  });

  it('finds a merge with the repository flag anywhere, or gh called by its path', () => {
    assert.deepEqual(mergeTarget('gh -R george-hutanu/motor-fix pr merge 21 --merge'), { pr: '21' });
    assert.deepEqual(mergeTarget('gh pr merge --repo george-hutanu/motor-fix 21 --merge'), { pr: '21' });
    assert.deepEqual(mergeTarget('gh pr merge -R george-hutanu/motor-fix --squash 21'), { pr: '21' });
    assert.deepEqual(mergeTarget('/opt/homebrew/bin/gh pr merge 21'), { pr: '21' });
  });

  it('finds the REST merge call', () => {
    assert.deepEqual(mergeTarget('gh api -X PUT repos/george-hutanu/motor-fix/pulls/21/merge'), { pr: '21' });
  });

  it('leaves everything else alone', () => {
    assert.equal(mergeTarget('gh pr view 21 --json mergeable'), null);
    assert.equal(mergeTarget('git merge --no-edit origin/main'), null);
    assert.equal(mergeTarget('gh pr checks 21 --watch'), null);
    assert.equal(mergeTarget('echo "gh pr merge" is documented in AGENTS.md'), null);
  });
});

describe('merge gate — the decision', () => {
  it('refuses a PR whose head commit has no agent-review success, and names the tester', () => {
    const why = decideMerge(pr(green));
    assert.match(why, /agent-review/);
    assert.match(why, /abc1234/);
    assert.match(why, /speckit-pr-test 21/);
  });

  it('refuses a failing agent review', () => {
    assert.match(decideMerge(pr([...green, review('FAILURE')])), /failure/i);
  });

  it('lets the merge run with agent-review success on the head commit', () => {
    assert.equal(decideMerge(pr([...green, review('SUCCESS')])), null);
  });

  it('counts skipped and neutral checks as green', () => {
    assert.equal(decideMerge(pr([...green, run('E2E tests', 'SKIPPED'), run('Lint', 'NEUTRAL'), review('SUCCESS')])), null);
  });

  // The PR tester now runs beside CI rather than after it, so agent-review
  // success alone no longer implies CI finished: the gate checks both.
  it('refuses agent-review success while a CI check failed, and names it', () => {
    const why = decideMerge(pr([run('Unit tests', 'FAILURE'), run('CI OK', 'FAILURE'), review('SUCCESS')]));
    assert.match(why, /Unit tests/);
    assert.match(why, /CI OK/);
    assert.match(why, /gh pr checks 21/);
  });

  it('refuses agent-review success while a CI check is still running', () => {
    const why = decideMerge(pr([run('Unit tests', 'SUCCESS'), run('CI OK', null, 'IN_PROGRESS'), review('SUCCESS')]));
    assert.match(why, /CI OK/);
    assert.match(why, /pending|running/i);
  });

  // PR #91's own rollup: the PR template workflow cancels a run in progress
  // when the body is edited again, leaving the cancelled run beside the new one.
  it('judges only the latest run of each check, so a cancelled earlier run does not block', () => {
    const rollup = [run('body', 'CANCELLED', 'COMPLETED', '2026-10-05T07:03:51Z'), run('body', 'SUCCESS', 'COMPLETED', '2026-10-05T07:04:15Z'), ...green, review('SUCCESS')];
    assert.equal(decideMerge(pr(rollup)), null);
  });

  it('still refuses when the latest run of a check is the failing one', () => {
    const rollup = [run('Unit tests', 'SUCCESS', 'COMPLETED', '2026-10-05T07:00:00Z'), run('Unit tests', 'FAILURE', 'COMPLETED', '2026-10-05T07:10:00Z'), run('CI OK', 'SUCCESS'), review('SUCCESS')];
    assert.match(decideMerge(pr(rollup)), /CI failed.*Unit tests/);
  });

  // gh reports a run that has not started with startedAt 0001-01-01, which
  // sorted it as the oldest run of its check (PR tester lap 2 on PR #91).
  const NOT_STARTED = '0001-01-01T00:00:00Z';

  it('reads a cancelled run followed by its queued replacement as pending, not failed', () => {
    const rollup = [run('body', 'CANCELLED', 'COMPLETED', '2026-10-05T07:03:51Z'), run('body', null, 'QUEUED', NOT_STARTED), ...green, review('SUCCESS')];
    const why = decideMerge(pr(rollup));
    assert.match(why, /still running.*body/);
    assert.doesNotMatch(why, /CI failed/);
  });

  it('refuses while a green check has a queued re-run, rather than merging on the old result', () => {
    const rollup = [run('Unit tests', 'SUCCESS', 'COMPLETED', '2026-10-05T07:00:00Z'), run('Unit tests', null, 'QUEUED', NOT_STARTED), run('CI OK', 'SUCCESS'), review('SUCCESS')];
    assert.match(decideMerge(pr(rollup)), /still running.*Unit tests/);
  });

  it('reads an in-progress run as the latest even when its start time is older', () => {
    const rollup = [run('Unit tests', null, 'IN_PROGRESS', '2026-10-05T06:00:00Z'), run('Unit tests', 'SUCCESS', 'COMPLETED', '2026-10-05T07:00:00Z'), run('CI OK', 'SUCCESS'), review('SUCCESS')];
    assert.match(decideMerge(pr(rollup)), /still running.*Unit tests/);
  });

  // The PR template workflow can cancel a run before a runner picks it up:
  // COMPLETED, CANCELLED and undated. It is the oldest run, not the newest.
  it('reads a run cancelled while still queued as older than the run that replaced it', () => {
    const rollup = [run('body', 'CANCELLED', 'COMPLETED', NOT_STARTED), run('body', 'SUCCESS', 'COMPLETED', '2026-10-05T07:04:15Z'), ...green, review('SUCCESS')];
    assert.equal(decideMerge(pr(rollup)), null);
  });

  it('keys check runs by workflow and name, so a same-named job in another workflow is not hidden', () => {
    const rollup = [
      { ...run('build', 'FAILURE', 'COMPLETED', '2026-10-05T07:00:00Z'), workflowName: 'Docker' },
      { ...run('build', 'SUCCESS', 'COMPLETED', '2026-10-05T07:05:00Z'), workflowName: 'CI' },
      { ...run('CI OK', 'SUCCESS'), workflowName: 'CI' },
      review('SUCCESS'),
    ];
    assert.match(decideMerge(pr(rollup)), /CI failed.*Docker \/ build/);
  });

  it('still judges the latest run within one workflow', () => {
    const rollup = [
      { ...run('build', 'FAILURE', 'COMPLETED', '2026-10-05T07:00:00Z'), workflowName: 'CI' },
      { ...run('build', 'SUCCESS', 'COMPLETED', '2026-10-05T07:05:00Z'), workflowName: 'CI' },
      { ...run('CI OK', 'SUCCESS'), workflowName: 'CI' },
      review('SUCCESS'),
    ];
    assert.equal(decideMerge(pr(rollup)), null);
  });

  it('reads an expected status context as pending, not failed', () => {
    const rollup = [...green, { __typename: 'StatusContext', context: 'deploy', state: 'EXPECTED' }, review('SUCCESS')];
    assert.match(decideMerge(pr(rollup)), /still running.*deploy/);
  });

  it('refuses agent-review success when CI has not reported at all', () => {
    assert.match(decideMerge(pr([review('SUCCESS')])), /no CI OK check/);
  });

  it('leaves a PR that is not open to GitHub to refuse', () => {
    assert.equal(decideMerge({ ...pr([]), state: 'MERGED' }), null);
  });
});

describe('merge gate — Dependabot PRs need no agent review', () => {
  const botCommit = (over = {}) => ({ oid: 'abc1234def5678', authors: [{ login: 'dependabot[bot]' }], committer: { login: 'web-flow' }, verified: true, ...over });
  const bot = (rollup, login = 'app/dependabot') => ({ ...pr(rollup), author: { login, is_bot: true }, commits: [botCommit()] });

  it('lets a Dependabot PR merge on green CI with no agent-review status', () => {
    assert.equal(decideMerge(bot(green)), null);
    assert.equal(decideMerge(bot([...green, run('body', 'SKIPPED')], 'dependabot[bot]')), null);
  });

  it('refuses a Dependabot PR with a failing, running or missing check, and names it', () => {
    const red = decideMerge(bot([run('Unit tests', 'FAILURE'), run('CI OK', 'FAILURE')]));
    assert.match(red, /CI failed/);
    assert.match(red, /Unit tests/);
    assert.match(decideMerge(bot([run('Build', null, 'IN_PROGRESS'), run('CI OK', 'SUCCESS')])), /still running.*Build/);
    assert.match(decideMerge(bot([{ context: 'CI OK', state: 'PENDING' }])), /still running.*CI OK/);
    assert.match(decideMerge(bot([])), /no CI OK check/);
    assert.match(decideMerge(bot([run('Unit tests', 'SUCCESS')])), /no CI OK check/);
  });

  it('judges the latest run of each check, as for any other PR', () => {
    const NOT_STARTED = '0001-01-01T00:00:00Z';
    const rerunRed = [run('Unit tests', 'SUCCESS', 'COMPLETED', '2026-10-05T07:00:00Z'), run('Unit tests', 'FAILURE', 'COMPLETED', '2026-10-05T07:10:00Z'), run('CI OK', 'SUCCESS')];
    assert.match(decideMerge(bot(rerunRed)), /CI failed/);
    const queued = [run('Unit tests', 'SUCCESS', 'COMPLETED', '2026-10-05T07:00:00Z'), run('Unit tests', null, 'QUEUED', NOT_STARTED), run('CI OK', 'SUCCESS')];
    assert.match(decideMerge(bot(queued)), /still running/);
    const fixed = [run('Unit tests', 'FAILURE', 'COMPLETED', '2026-10-05T07:00:00Z'), run('Unit tests', 'SUCCESS', 'COMPLETED', '2026-10-05T07:10:00Z'), run('CI OK', 'SUCCESS')];
    assert.equal(decideMerge(bot(fixed)), null);
  });

  it('still refuses a Dependabot PR whose agent review failed', () => {
    assert.match(decideMerge(bot([...green, review('FAILURE')])), /agent-review is failure/);
  });

  it('reads the author, not the title or branch: anyone else still needs the agent review', () => {
    const human = { ...pr(green), title: 'chore(deps): bump vitest', headRefName: 'dependabot/npm_and_yarn/vitest-5', author: { login: 'george-hutanu' } };
    assert.match(decideMerge(human), /no agent-review status/);
    assert.match(decideMerge({ ...pr(green), author: { login: 'dependabot-fan' } }), /no agent-review status/);
  });

  it('takes back the exemption once anyone else pushed a commit to the branch', () => {
    const pushed = { ...bot(green), commits: [botCommit(), botCommit({ authors: [{ login: 'george-hutanu' }] })] };
    assert.match(decideMerge(pushed), /no agent-review status/);
    const coAuthored = { ...bot(green), commits: [botCommit({ authors: [{ login: 'dependabot[bot]' }, { login: 'george-hutanu' }] })] };
    assert.match(decideMerge(coAuthored), /no agent-review status/);
    assert.match(decideMerge({ ...bot(green), commits: undefined }), /no agent-review status/);
    assert.match(decideMerge({ ...bot(green), commits: [] }), /no agent-review status/);
  });

  // @traces 610-FR-001
  it('takes back the exemption from a Dependabot commit someone else committed, or GitHub did not sign', () => {
    assert.match(decideMerge({ ...bot(green), commits: [botCommit({ committer: { login: 'george-hutanu' }, verified: false })] }), /no agent-review status/);
    assert.match(decideMerge({ ...bot(green), commits: [botCommit({ verified: false })] }), /no agent-review status/);
    assert.match(decideMerge({ ...bot(green), commits: [botCommit({ committer: undefined, verified: undefined })] }), /no agent-review status/);
    assert.equal(decideMerge({ ...bot(green), commits: [botCommit({ committer: { login: 'dependabot[bot]' } })] }), null);
  });

  // @traces 610-FR-003
  it('tells a red Dependabot PR to go through Dependabot, never to the PR tester', () => {
    const why = decideMerge(bot([run('Unit tests', 'FAILURE'), run('CI OK', 'FAILURE')]));
    assert.match(why, /CI failed on abc1234 \(Unit tests, CI OK\)/);
    assert.doesNotMatch(why, /PR tester|speckit-pr-test/);
    assert.doesNotMatch(why, /fix it on the branch/);
    assert.match(why, /@dependabot rebase/);
    assert.match(why, /@dependabot recreate/);
    assert.match(why, /takes the exemption away/);
  });

  // @traces 610-FR-003
  it('keeps the fix-and-retest wording for a red PR the tester passed', () => {
    const why = decideMerge(pr([run('Unit tests', 'FAILURE'), run('CI OK', 'FAILURE'), review('SUCCESS')]));
    assert.match(why, /fix it on the branch, and run the PR tester again/);
    assert.doesNotMatch(why, /@dependabot/);
  });
});

describe('merge gate — reading a Dependabot PR\'s committers', () => {
  const view = (author) => JSON.stringify({ number: 82, author: { login: author }, commits: [{ oid: 'aaa111', authors: [{ login: 'dependabot[bot]' }] }] });
  const rows = '{"sha":"aaa111","login":"web-flow","verified":true}\n';
  const ghOf = (author, committers) => {
    const calls = [];
    const gh = async (args) => (calls.push(args), args[0] === 'pr' ? { code: 0, stdout: view(author), stderr: '' } : committers);
    return { gh, calls };
  };

  // @traces 610-FR-002
  it('reads the REST committers for a PR Dependabot opened, and only for it', async () => {
    const bot = ghOf('app/dependabot', { code: 0, stdout: rows, stderr: '' });
    const pr = await readPr('82', bot.gh);
    assert.deepEqual(pr.commits[0].committer, { login: 'web-flow' });
    assert.equal(pr.commits[0].verified, true);
    assert.match(bot.calls[1].join(' '), /pulls\/82\/commits/);
    const human = ghOf('george-hutanu', { code: 0, stdout: rows, stderr: '' });
    assert.equal((await readPr('82', human.gh)).commits[0].committer, undefined);
    assert.equal(human.calls.length, 1, 'no extra GitHub call for anyone else\'s PR');
  });

  // @traces 610-FR-002
  it('throws on a failed committer read, so the gate refuses with a retry; garbled rows leave the PR not exempt', async () => {
    await assert.rejects(readPr('82', ghOf('app/dependabot', { code: 1, stdout: '', stderr: 'HTTP 502' }).gh), /committers: HTTP 502/);
    const garbled = await readPr('82', ghOf('app/dependabot', { code: 0, stdout: 'not json', stderr: '' }).gh);
    assert.equal(garbled.commits[0].committer, undefined);
  });
});

describe('merge gate — started through a symlinked path', () => {
  const hooks = fileURLToPath(new URL('.', import.meta.url));
  const gate = (dir) =>
    spawnSync(process.execPath, [join(dir, 'merge-gate.mjs')], {
      input: JSON.stringify({ tool_input: { command: 'gh pr merge 21 --merge' } }),
      encoding: 'utf8',
      env: { ...process.env, SPECKIT_PR_STATE: JSON.stringify(pr(green)) },
    });

  it('refuses a merge with no agent-review, as it does through the real path', () => {
    const root = mkdtempSync(join(tmpdir(), 'merge-gate-link-'));
    try {
      symlinkSync(hooks, join(root, 'hooks'));
      assert.equal(gate(hooks).status, 2);
      const linked = gate(join(root, 'hooks'));
      assert.equal(linked.status, 2);
      assert.match(linked.stderr, /agent-review/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('merge gate — a verdict carried over a docs-only head is verified, not trusted', () => {
  const FROM = 'f'.repeat(40);
  const carried = (description = `carried from ${FROM}: docs-only change`) => ({ ...review('SUCCESS'), description });
  const state = (over = {}) => ({
    fromReview: { state: 'success', description: 'No blocking findings' },
    compare: { status: 'ahead', total_commits: 1, commits: [{ sha: 'abc1234def5678' }], files: [{ filename: 'specs/194-email-sending/deferred.md' }] },
    between: [],
    headReviews: [],
    ...over,
  });
  const prc = (rollup) => ({ ...pr(rollup), commits: [{ oid: FROM }, { oid: 'abc1234def5678' }] });
  const lookup = (s, seen = []) => ({ description: () => null, state: (from, head) => (seen.push([from, head]), s) });

  it('lets a verified carry merge on green CI, checking the commit it names against head', () => {
    const seen = [];
    assert.equal(decideMerge(prc([...green, carried()]), lookup(state(), seen)), null);
    assert.deepEqual(seen, [[FROM, 'abc1234def5678']]);
  });

  it('reads the description from GitHub when the rollup leaves it out', () => {
    const reads = { description: () => `carried from ${FROM}: docs-only change`, state: () => state({ fromReview: { state: 'failure' } }) };
    assert.match(decideMerge(prc([...green, review('SUCCESS')]), reads), /carried from fffffff.*no agent-review success/);
  });

  it('refuses a carry naming a commit whose agent review failed', () => {
    const why = decideMerge(prc([...green, carried()]), lookup(state({ fromReview: { state: 'failure', description: 'x' } })));
    assert.match(why, /no agent-review success/);
    assert.match(why, /speckit-pr-test 21/);
  });

  it('refuses a carry naming a commit that is not an ancestor of head', () => {
    assert.match(decideMerge(prc([...green, carried()]), lookup(state({ compare: { ...state().compare, status: 'diverged' } }))), /not an ancestor/);
  });

  it('refuses a carry over a diff that is not documentation only', () => {
    const compare = { ...state().compare, files: [{ filename: 'specs/x/deferred.md' }, { filename: '.claude/hooks/merge-gate.mjs' }] };
    assert.match(decideMerge(prc([...green, carried()]), lookup(state({ compare }))), /merge-gate\.mjs/);
  });

  it('refuses a carry naming a commit that is not one of the PR\'s own, such as a tested commit on main', () => {
    const why = decideMerge({ ...prc([...green, carried()]), commits: [{ oid: 'abc1234def5678' }] }, lookup(state()));
    assert.match(why, /not one of this PR's commits/);
    assert.match(decideMerge(pr([...green, carried()]), lookup(state())), /not one of this PR's commits/);
  });

  it('refuses a carry it cannot verify, rather than trusting it', () => {
    const broken = { description: () => null, state: () => { throw new Error('HTTP 502'); } };
    assert.match(decideMerge(prc([...green, carried()]), broken), /could not verify.*HTTP 502/);
    assert.match(decideMerge(prc([...green, carried()])), /could not verify/);
    const unreadable = { description: () => { throw new Error('HTTP 502'); }, state: () => state() };
    assert.match(decideMerge(prc([...green, review('SUCCESS')]), unreadable), /could not read/);
  });

  it('still needs every CI check after a verified carry', () => {
    assert.match(decideMerge(prc([run('Unit tests', 'FAILURE'), run('CI OK', 'FAILURE'), carried()]), lookup(state())), /CI failed/);
    assert.match(decideMerge(prc([carried()]), lookup(state())), /no CI OK check/);
  });
});

// A gate Claude Code stops for running long does not block, so the
// gate stops itself first, and refuses: a merge it could not finish checking
// has not been approved.
describe('merge gate — a check it cannot finish refuses the merge', () => {
  const hooks = fileURLToPath(new URL('.', import.meta.url));
  const REPO = join(hooks, '..', '..');
  const FROM = 'f'.repeat(40);
  const HEAD = 'abc1234def5678';
  const carriedPr = (description = `carried from ${FROM}: docs-only change`) => ({
    ...pr([...green, { ...review('SUCCESS'), ...(description ? { description } : {}) }]),
    commits: [{ oid: FROM }, { oid: HEAD }],
  });
  const goodState = {
    fromReview: { state: 'success', description: 'No blocking findings' },
    compare: { status: 'ahead', total_commits: 1, commits: [{ sha: HEAD }], files: [{ filename: 'specs/194-email-sending/deferred.md' }] },
    between: [],
    headReviews: [],
  };
  const gate = (env) =>
    spawnSync(process.execPath, [join(hooks, 'merge-gate.mjs')], {
      input: JSON.stringify({ tool_input: { command: 'gh pr merge 21 --merge' } }),
      encoding: 'utf8',
      timeout: 20000,
      env: { ...process.env, SPECKIT_PR_STATE: '', SPECKIT_CARRY_STATE: '', SPECKIT_CARRY_DELAY_MS: '', SPECKIT_MERGE_GATE_DEADLINE_MS: '', ...env },
    });
  /** A PATH whose gh runs `body`, for the real read path. */
  const withGh = (body, f) => {
    const dir = mkdtempSync(join(tmpdir(), 'merge-gate-gh-'));
    try {
      writeFileSync(join(dir, 'gh'), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
      return f(`${dir}:${process.env.PATH}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  it('refuses when GitHub does not answer within the deadline, and stops at the deadline', () => {
    withGh('exec sleep 15', (PATH) => {
      const started = Date.now();
      const out = gate({ PATH, SPECKIT_MERGE_GATE_DEADLINE_MS: '500' });
      assert.equal(out.status, 2);
      assert.match(out.stderr, /within 0\.5 s/);
      assert.ok(Date.now() - started < 10000, 'the gate stops itself rather than waiting on gh');
    });
  });

  it('refuses when the PR cannot be read, rather than letting a blind merge through', () => {
    withGh('echo "HTTP 502: Bad Gateway" >&2; exit 1', (PATH) => {
      const out = gate({ PATH });
      assert.equal(out.status, 2);
      assert.match(out.stderr, /could not read.*HTTP 502/);
    });
  });

  it('refuses when the PR it read cannot be judged, rather than exiting 1, which does not block', () => {
    const out = gate({ SPECKIT_PR_STATE: '{"number":21,"state":"OPEN","statusCheckRollup":{}}' });
    assert.equal(out.status, 2);
    assert.match(out.stderr, /the gate failed/);
  });

  it('refuses a carried verdict whose verification outlasts the deadline', () => {
    const out = gate({
      SPECKIT_PR_STATE: JSON.stringify(carriedPr()),
      SPECKIT_CARRY_STATE: JSON.stringify(goodState),
      SPECKIT_CARRY_DELAY_MS: '15000',
      SPECKIT_MERGE_GATE_DEADLINE_MS: '500',
    });
    assert.equal(out.status, 2);
    assert.match(out.stderr, /within 0\.5 s/);
  });

  it('still passes a verified carry that finishes inside the deadline', () => {
    const out = gate({
      SPECKIT_PR_STATE: JSON.stringify(carriedPr()),
      SPECKIT_CARRY_STATE: JSON.stringify(goodState),
      SPECKIT_CARRY_DELAY_MS: '50',
      SPECKIT_MERGE_GATE_DEADLINE_MS: '5000',
    });
    assert.equal(out.status, 0, out.stderr);
  });

  it('stops before the wrapper does, and the wrapper before Claude Code', () => {
    const entry = JSON.parse(readFileSync(join(REPO, '.claude/hooks/registry.json'), 'utf8')).hooks.find((h) => h.id === 'pre:bash:merge-gate');
    const settings = JSON.parse(readFileSync(join(REPO, '.claude/settings.json'), 'utf8'));
    const hook = Object.values(settings.hooks)
      .flat()
      .flatMap((m) => m.hooks)
      .find((h) => h.command.endsWith(' pre:bash:merge-gate'));
    assert.ok(DEADLINE_MS < entry.timeout_ms, 'the gate refuses before run-hook.mjs stops it');
    assert.ok(entry.timeout_ms < hook.timeout * 1000, 'run-hook.mjs refuses before Claude Code gives up on the hook');
  });

  it('lets the deadline be shortened, never lengthened', () => {
    assert.equal(deadlineMs({}), DEADLINE_MS);
    assert.equal(deadlineMs({ SPECKIT_MERGE_GATE_DEADLINE_MS: '500' }), 500);
    assert.equal(deadlineMs({ SPECKIT_MERGE_GATE_DEADLINE_MS: String(DEADLINE_MS * 10) }), DEADLINE_MS);
    assert.equal(deadlineMs({ SPECKIT_MERGE_GATE_DEADLINE_MS: 'soon' }), DEADLINE_MS);
  });

  it('reads head\'s statuses once and the rest of a carry in one round', async () => {
    const MID = 'b'.repeat(40);
    const MID2 = 'd'.repeat(40);
    const lines = [];
    let inFlight = 0;
    let most = 0;
    const answer = (line) => {
      if (/compare\//.test(line))
        return { status: 'ahead', base_commit: { sha: FROM }, total_commits: 3, commits: [{ sha: MID }, { sha: MID2 }, { sha: HEAD }], files: [{ filename: 'specs/x/deferred.md' }] };
      if (line.includes(`commits/${FROM}/`)) return [{ context: 'agent-review', state: 'success', description: 'No blocking findings' }];
      if (line.includes(`commits/${HEAD}/`)) return [{ context: 'agent-review', state: 'success', description: `carried from ${FROM}: docs-only change` }];
      return [];
    };
    const gh = async (args) => {
      const line = args.join(' ');
      lines.push(line);
      inFlight++;
      most = Math.max(most, inFlight);
      await new Promise((r) => setTimeout(r, 10));
      inFlight--;
      return { code: 0, stdout: JSON.stringify(answer(line)), stderr: '' };
    };
    const head = carriedPr(null);
    const carry = await prefetchCarry(head, ghReader(gh));
    assert.equal(decideMerge(head, carry), null);
    assert.equal(lines.filter((l) => l.includes(`commits/${HEAD}/statuses`)).length, 1, 'head statuses read once');
    assert.equal(most, 3, 'the named commit and both commits between are read together');
  });

  it('replays a failed read as the refusal decideMerge already gives', async () => {
    const reader = { description: async () => { throw new Error('HTTP 502'); }, state: async () => goodState };
    assert.match(decideMerge(carriedPr(null), await prefetchCarry(carriedPr(null), reader)), /could not read.*HTTP 502/);
    const slow = { description: async () => null, state: async () => { throw new Error('HTTP 504'); } };
    assert.match(decideMerge(carriedPr(), await prefetchCarry(carriedPr(), slow)), /could not verify.*HTTP 504/);
  });
});

describe('merge gate — the PR QA run is judged by agent-review, not as a CI check', () => {
  const qa = (conclusion, status = 'COMPLETED') => ({ ...run('PR QA', conclusion, status), workflowName: 'PR QA' });

  it('merges past a PR QA run a newer lap cancelled', () => {
    assert.equal(decideMerge(pr([...green, qa('CANCELLED'), review('SUCCESS')])), null);
  });

  it('still refuses while agent-review is not success, whatever the PR QA check says', () => {
    assert.match(decideMerge(pr([...green, qa('SUCCESS'), review('PENDING')])), /agent-review is pending/);
  });

  it('keeps judging a check of another workflow that happens to be named PR QA', () => {
    assert.match(decideMerge(pr([...green, { ...run('PR QA', 'FAILURE'), workflowName: 'CI' }, review('SUCCESS')])), /CI failed/);
  });
});

describe('merge gate — a cloud session reads the PR over REST', () => {
  const HEAD = 'abc1234def5678';
  const answers = {
    'repos/{owner}/{repo}/pulls/21': { number: 21, state: 'open', head: { sha: HEAD }, user: { login: 'george-hutanu' } },
    'repos/{owner}/{repo}/pulls/21/commits?per_page=100': [{ sha: HEAD, author: 'george-hutanu', login: 'web-flow', verified: true }],
    [`repos/{owner}/{repo}/commits/${HEAD}/status?per_page=100`]: { statuses: [{ context: 'agent-review', state: 'success', description: 'PR QA lap 1 passed' }] },
    [`repos/{owner}/{repo}/commits/${HEAD}/check-runs?per_page=100`]: [
      { name: 'Unit tests', status: 'completed', conclusion: 'success', started_at: '2026-10-05T07:00:00Z', suite: 11 },
      { name: 'CI OK', status: 'completed', conclusion: 'success', started_at: '2026-10-05T07:01:00Z', suite: 11 },
      { name: 'PR QA', status: 'completed', conclusion: 'cancelled', started_at: '2026-10-05T07:02:00Z', suite: 12 },
    ],
    [`repos/{owner}/{repo}/actions/runs?head_sha=${HEAD}&per_page=100`]: [
      { suite: 11, name: 'CI' },
      { suite: 12, name: 'PR QA' },
    ],
  };
  const restGh = (override = {}) => {
    const calls = [];
    const gh = async (args) => {
      calls.push(args);
      const path = args.find((a) => a.startsWith('repos/'));
      if (override[path]) return override[path];
      const v = answers[path];
      if (v === undefined) return { code: 1, stdout: '', stderr: `unexpected ${args.join(' ')}` };
      // --jq output is one JSON value per line, as gh prints it.
      const stdout = args.includes('--jq') ? v.map((x) => JSON.stringify(x)).join('\n') : JSON.stringify(v);
      return { code: 0, stdout, stderr: '' };
    };
    return { gh, calls };
  };

  it('never calls gh pr, and shapes the PR as the rollup the rule reads', async () => {
    const { gh, calls } = restGh();
    const got = await readPr('21', gh, { cloud: true });
    assert.equal(calls.filter((c) => c[0] === 'pr').length, 0);
    assert.equal(got.number, 21);
    assert.equal(got.state, 'OPEN');
    assert.equal(got.headRefOid, HEAD);
    assert.deepEqual(got.author, { login: 'george-hutanu' });
    assert.deepEqual(got.commits, [{ oid: HEAD, authors: [{ login: 'george-hutanu' }], committer: { login: 'web-flow' }, verified: true }]);
    assert.deepEqual(got.statusCheckRollup.find((c) => c.context === 'agent-review'), { __typename: 'StatusContext', context: 'agent-review', state: 'SUCCESS', description: 'PR QA lap 1 passed' });
    assert.deepEqual(got.statusCheckRollup.find((c) => c.name === 'CI OK'), { __typename: 'CheckRun', name: 'CI OK', workflowName: 'CI', status: 'COMPLETED', conclusion: 'SUCCESS', startedAt: '2026-10-05T07:01:00Z' });
    assert.equal(decideMerge(got), null);
  });

  it('refuses on the REST read exactly as on the GraphQL one: a red check, a pending review', async () => {
    const red = restGh({
      [`repos/{owner}/{repo}/commits/${HEAD}/check-runs?per_page=100`]: { code: 0, stdout: JSON.stringify({ name: 'CI OK', status: 'completed', conclusion: 'failure', started_at: '2026-10-05T07:01:00Z', suite: 11 }), stderr: '' },
    });
    assert.match(decideMerge(await readPr('21', red.gh, { cloud: true })), /CI failed on abc1234 \(CI \/ CI OK\)/);
    const pending = restGh({
      [`repos/{owner}/{repo}/commits/${HEAD}/status?per_page=100`]: { code: 0, stdout: JSON.stringify({ statuses: [{ context: 'agent-review', state: 'pending', description: 'PR QA lap 1 running' }] }), stderr: '' },
    });
    assert.match(decideMerge(await readPr('21', pending.gh, { cloud: true })), /agent-review is pending/);
  });

  it('throws when any REST read fails, so the gate refuses', async () => {
    const { gh } = restGh({ [`repos/{owner}/{repo}/actions/runs?head_sha=${HEAD}&per_page=100`]: { code: 1, stdout: '', stderr: 'HTTP 502' } });
    await assert.rejects(readPr('21', gh, { cloud: true }), /HTTP 502/);
  });

  it('needs the PR number: the branch cannot be resolved to a PR without GraphQL', async () => {
    await assert.rejects(readPr(null, restGh().gh, { cloud: true }), /PR number/);
    await assert.rejects(readPr('feature-branch', restGh().gh, { cloud: true }), /PR number/);
  });

  it('reads a PR URL as its number', async () => {
    const got = await readPr('https://github.com/george-hutanu/motor-fix/pull/21', restGh().gh, { cloud: true });
    assert.equal(got.number, 21);
  });
});
