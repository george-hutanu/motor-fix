import { afterEach, beforeEach, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { decideMerge, mergeTarget, prOfNode } from './merge-gate.mjs';

const ID = 'PR_kwDOadversary';
const mutation = (name = 'mergePullRequest', id = ID) => `mutation { ${name}(input: {pullRequestId: "${id}"}) { clientMutationId } }`;
const hooks = fileURLToPath(new URL('.', import.meta.url));

const check = (name, conclusion, status = 'COMPLETED', startedAt = '2026-10-24T07:00:00Z') => ({ __typename: 'CheckRun', name, status, conclusion, startedAt, workflowName: name === 'PR title' ? 'PR title' : 'CI' });
const review = { __typename: 'StatusContext', context: 'agent-review', state: 'SUCCESS' };
const pr = (rollup, extra = {}) => ({ id: ID, number: 21, state: 'OPEN', headRefOid: 'abc1234def5678', statusCheckRollup: rollup, ...extra });

describe('merge gate graphql spellings, adversarial', () => {
  // @traces 448-FR-001
  it('finds the merge when gh is run inside a command substitution', () => {
    assert.deepEqual(mergeTarget(`echo $(gh api graphql -f query='${mutation()}')`), { pr: null, nodeId: ID });
  });

  // @traces 448-FR-001
  it('finds the merge when gh is run inside a subshell', () => {
    assert.deepEqual(mergeTarget(`(gh api graphql -f query='${mutation()}')`), { pr: null, nodeId: ID });
  });

  // @traces 448-FR-001
  it('finds the merge when gh is run inside bash -c', () => {
    assert.deepEqual(mergeTarget(`bash -c "gh api graphql -f query='${mutation()}'"`), { pr: null, nodeId: ID });
  });

  // @traces 448-FR-001
  it('finds the merge when the endpoint is quoted as "graphql"', () => {
    assert.deepEqual(mergeTarget(`gh api "graphql" -f query='${mutation()}'`), { pr: null, nodeId: ID });
  });

  // @traces 448-FR-001
  it('finds the merge when the command is continued over a backslash-newline', () => {
    assert.deepEqual(mergeTarget(`gh api graphql \\\n  -f query='${mutation()}'`), { pr: null, nodeId: ID });
  });

  // @traces 448-FR-001
  it('finds the merge written without spaces and with the id first or last in the input', () => {
    assert.deepEqual(mergeTarget(`gh api graphql -f query='mutation{mergePullRequest(input:{pullRequestId:"${ID}"}){clientMutationId}}'`), { pr: null, nodeId: ID });
    assert.deepEqual(mergeTarget(`gh api graphql -f query='mutation { mergePullRequest(input: {mergeMethod: SQUASH, pullRequestId: "${ID}"}) { clientMutationId } }'`), { pr: null, nodeId: ID });
  });

  // @traces 448-FR-001
  it('finds the merge behind env, command, a path to gh, a pipe, a semicolon and a newline', () => {
    const body = `gh api graphql -f query='${mutation('enablePullRequestAutoMerge')}'`;
    for (const c of [`env ${body}`, `command ${body}`, `echo x | ${body}`, `true; ${body}`, `true\n${body}`, `GH_TOKEN=t ${body}`, `/usr/local/bin/${body}`]) {
      assert.deepEqual(mergeTarget(c), { pr: null, nodeId: ID }, c);
    }
  });

  // @traces 448-FR-002
  it('resolves one distinct id when the same literal is inline and a variable', () => {
    const q = `mutation($id: ID!) { a: mergePullRequest(input: {pullRequestId: "${ID}"}) { clientMutationId } b: mergePullRequest(input: {pullRequestId: $id}) { clientMutationId } }`;
    assert.deepEqual(mergeTarget(`gh api graphql -f query='${q}' -f id=${ID}`), { pr: null, nodeId: ID });
  });

  // @traces 448-FR-002
  it('refuses an inline id and a different variable value', () => {
    const q = `mutation($id: ID!) { a: mergePullRequest(input: {pullRequestId: "${ID}"}) { clientMutationId } b: mergePullRequest(input: {pullRequestId: $id}) { clientMutationId } }`;
    assert.match(mergeTarget(`gh api graphql -f query='${q}' -f id=PR_other`).unresolved, /more than one/);
  });

  // @traces 448-FR-002
  it('never names a PR when the id is a shell variable even if another field carries a real id', () => {
    const q = `mutation($id: ID!) { mergePullRequest(input: {pullRequestId: $id}) { clientMutationId } }`;
    const t = mergeTarget(`gh api graphql -f query='${q}' -f id=$PR_ID -f note=${ID}`);
    assert.equal(t.nodeId, undefined);
    assert.match(t.unresolved, /no pull request id/);
  });

  // @traces 448-FR-002
  it('refuses a merge whose input is an object variable instead of guessing', () => {
    const q = `mutation($i: MergePullRequestInput!) { mergePullRequest(input: $i) { clientMutationId } }`;
    const t = mergeTarget(`gh api graphql -f query='${q}' -F i='{"pullRequestId":"${ID}"}'`);
    assert.ok(t.unresolved || t.nodeId === ID, JSON.stringify(t));
  });

  // @traces 448-FR-002
  it('does not resolve an id with a zero-width character smuggled in to a clean id', () => {
    const t = mergeTarget(`gh api graphql -f query='${mutation('mergePullRequest', `${ID}​`)}'`);
    assert.notEqual(t.nodeId, ID);
  });

  // @traces 448-FR-001
  it('leaves other pull request mutations alone', () => {
    for (const name of ['disablePullRequestAutoMerge', 'closePullRequest', 'markPullRequestReadyForReview', 'updatePullRequest']) {
      assert.equal(mergeTarget(`gh api graphql -f query='${mutation(name)}'`), null, name);
    }
  });

  // @traces 448-FR-001
  it('does not treat an empty or blank command as a merge', () => {
    for (const c of ['', '   ', '\n']) assert.equal(mergeTarget(c), null, JSON.stringify(c));
  });
});

describe('prOfNode, adversarial', () => {
  const answer = (stdout, code = 0, stderr = '') => async () => ({ code, stdout, stderr });

  // @traces 448-FR-002
  it('rejects output that is not JSON', async () => {
    await assert.rejects(prOfNode(ID, answer('<html>502</html>'), {}));
  });

  // @traces 448-FR-002
  it('rejects a pull request answer with no number', async () => {
    await assert.rejects(prOfNode(ID, answer('{"__typename":"PullRequest"}'), {}));
  });

  // @traces 448-FR-002
  it('rejects a pull request number of zero or a negative one', async () => {
    await assert.rejects(prOfNode(ID, answer('{"__typename":"PullRequest","number":0}'), {}));
    await assert.rejects(prOfNode(ID, answer('{"__typename":"PullRequest","number":-3}'), {}));
  });

  // @traces 448-FR-002
  it('rejects empty output from a successful read', async () => {
    await assert.rejects(prOfNode(ID, answer(''), {}));
  });

  // @traces 448-FR-002
  it('propagates a gh that rejects', async () => {
    await assert.rejects(prOfNode(ID, async () => { throw new Error('spawn gh ENOENT'); }, {}), /ENOENT/);
  });

  // @traces 448-FR-002
  it('passes the id as a variable and never splices it into the query text', async () => {
    const hostile = 'PR_x"){ viewer { login } }#';
    let args;
    await prOfNode(hostile, async (a) => { args = a; return { code: 0, stdout: '{"__typename":"PullRequest","number":4}', stderr: '' }; }, {});
    const query = args.find((a) => /query=/.test(a));
    assert.ok(!query.includes(hostile), query);
  });
});

describe('a graphql merge through the gate process, adversarial', () => {
  let dir;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'gate-')); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const gate = (command, env) =>
    spawnSync(process.execPath, [join(hooks, 'merge-gate.mjs')], {
      input: JSON.stringify({ tool_input: { command } }),
      encoding: 'utf8',
      timeout: 20000,
      env: { ...process.env, SPECKIT_CARRY_STATE: '', SPECKIT_MERGE_GATE_DEADLINE_MS: '', SPECKIT_PROVENANCE_STATE: '', ...env },
    });
  const fakeGh = (script) => {
    writeFileSync(join(dir, 'gh'), `#!/bin/sh\n${script}\n`);
    chmodSync(join(dir, 'gh'), 0o755);
    return { PATH: `${dir}:${process.env.PATH}`, SPECKIT_PR_STATE: '' };
  };

  // @traces 448-FR-002
  it('refuses, naming the CLI merge, when the node read fails', () => {
    const out = gate(`gh api graphql -f query='${mutation()}'`, fakeGh('echo "HTTP 502" >&2; exit 1'));
    assert.equal(out.status, 2);
    assert.match(out.stderr, /gh pr merge <n>/);
  });

  // @traces 448-FR-002
  it('refuses, naming the CLI merge, when the node read prints garbage', () => {
    const out = gate(`gh api graphql -f query='${mutation()}'`, fakeGh('echo "not json"; exit 0'));
    assert.equal(out.status, 2);
    assert.match(out.stderr, /gh pr merge <n>/);
  });

  // @traces 448-FR-002
  it('refuses, naming the CLI merge, when the node is an issue', () => {
    const out = gate(`gh api graphql -f query='${mutation()}'`, fakeGh(`echo '{"__typename":"Issue","number":9}'`));
    assert.equal(out.status, 2);
    assert.match(out.stderr, /gh pr merge <n>/);
  });

  // @traces 448-FR-002
  it('refuses two distinct ids without reading GitHub', () => {
    const q = `mutation { a: mergePullRequest(input: {pullRequestId: "PR_a"}) { clientMutationId } b: enablePullRequestAutoMerge(input: {pullRequestId: "PR_b"}) { clientMutationId } }`;
    const out = gate(`gh api graphql -f query='${q}'`, fakeGh('exit 0'));
    assert.equal(out.status, 2);
    assert.match(out.stderr, /gh pr merge <n>/);
  });

  // @traces 448-FR-001
  it('refuses a graphql merge chained after another command', () => {
    const state = JSON.stringify(pr([check('CI OK', 'SUCCESS'), check('PR title', 'SUCCESS')]));
    const out = gate(`git status && gh api graphql -f query='${mutation()}'`, { SPECKIT_PR_STATE: state });
    assert.equal(out.status, 2);
    assert.match(out.stderr, /no agent-review status/);
  });

  // @traces 448-FR-004
  it('refuses a graphql merge of a PR with no PR title check even with agent-review success', () => {
    const state = JSON.stringify(pr([check('CI OK', 'SUCCESS'), review]));
    const out = gate(`gh api graphql -f query='${mutation('enablePullRequestAutoMerge')}'`, { SPECKIT_PR_STATE: state, SPECKIT_PROVENANCE_STATE: '{"status":{"creator":{"login":"george-hutanu","type":"User"}}}' });
    assert.equal(out.status, 2);
    assert.match(out.stderr, /PR title/);
  });

  // @traces 448-FR-001
  it('lets a graphql query that names no merge mutation through', () => {
    const out = gate(`gh api graphql -f query='{ viewer { login } }'`, { SPECKIT_PR_STATE: '' });
    assert.equal(out.status, 0, out.stderr);
  });

  // @traces 448-FR-001
  it('exits 0 on a payload with no command', () => {
    const out = spawnSync(process.execPath, [join(hooks, 'merge-gate.mjs')], { input: JSON.stringify({ tool_input: {} }), encoding: 'utf8', timeout: 20000 });
    assert.equal(out.status, 0, out.stderr);
  });
});

describe('the PR title rule, adversarial', () => {
  const base = [check('Unit tests', 'SUCCESS'), check('CI OK', 'SUCCESS')];
  const dependabot = { author: { login: 'app/dependabot' }, commits: [{ authors: [{ login: 'dependabot[bot]' }], committer: { login: 'web-flow' }, verified: true }] };

  // @traces 448-FR-004
  it('refuses when the PR title check is missing', () => {
    assert.match(decideMerge(pr([...base, review])), /PR title/);
  });

  // @traces 448-FR-004
  it('refuses while the PR title check is queued, in progress or waiting', () => {
    for (const status of ['QUEUED', 'IN_PROGRESS', 'WAITING', 'PENDING']) {
      assert.match(decideMerge(pr([...base, check('PR title', null, status), review])), /PR title/, status);
    }
  });

  // @traces 448-FR-004
  it('refuses a failing, cancelled or timed-out PR title check', () => {
    for (const conclusion of ['FAILURE', 'CANCELLED', 'TIMED_OUT', 'STARTUP_FAILURE', 'ACTION_REQUIRED']) {
      assert.match(decideMerge(pr([...base, check('PR title', conclusion), review])), /PR title/, conclusion);
    }
  });

  // @traces 448-FR-004
  it('lets the latest run decide: an old failure then a new success passes', () => {
    const rollup = [...base, check('PR title', 'FAILURE', 'COMPLETED', '2026-10-24T06:00:00Z'), check('PR title', 'SUCCESS', 'COMPLETED', '2026-10-24T08:00:00Z'), review];
    assert.equal(decideMerge(pr(rollup)), null);
  });

  // @traces 448-FR-004
  it('lets the latest run decide: an old success then a new failure refuses', () => {
    const rollup = [...base, check('PR title', 'SUCCESS', 'COMPLETED', '2026-10-24T06:00:00Z'), check('PR title', 'FAILURE', 'COMPLETED', '2026-10-24T08:00:00Z'), review];
    assert.match(decideMerge(pr(rollup)), /PR title/);
  });

  // @traces 448-FR-004
  it('lets the latest run decide: an old success then a re-run in progress refuses', () => {
    const rollup = [...base, check('PR title', 'SUCCESS', 'COMPLETED', '2026-10-24T06:00:00Z'), check('PR title', null, 'IN_PROGRESS', '2026-10-24T08:00:00Z'), review];
    assert.match(decideMerge(pr(rollup)), /PR title/);
  });

  // @traces 448-FR-004
  it('does not take a differently named check for the PR title check', () => {
    for (const name of ['pr title', 'PR Title', 'PR title ', 'PR-title', 'PR title (edited)']) {
      assert.match(decideMerge(pr([...base, check(name, 'SUCCESS'), review])), /PR title/, name);
    }
  });

  // @traces 448-FR-004
  it('does not take a PR title status context for the PR title check run', () => {
    const ctx = { __typename: 'StatusContext', context: 'PR title', state: 'SUCCESS' };
    assert.match(decideMerge(pr([...base, ctx, review])), /PR title/);
  });

  // @traces 448-FR-004
  it('still refuses a missing CI OK when PR title is green', () => {
    assert.match(decideMerge(pr([check('Unit tests', 'SUCCESS'), check('PR title', 'SUCCESS'), review])), /CI OK/);
  });

  // @traces 448-FR-004
  it('refuses an empty rollup', () => {
    assert.match(decideMerge(pr([review])), /CI OK/);
  });

  // @traces 448-FR-005
  it('refuses a Dependabot PR with CI OK success and no PR title check', () => {
    assert.match(decideMerge(pr(base, dependabot)), /PR title/);
  });

  // @traces 448-FR-005
  it('allows a Dependabot PR with CI OK and PR title both green', () => {
    assert.equal(decideMerge(pr([...base, check('PR title', 'SUCCESS')], dependabot)), null);
  });

  // @traces 448-FR-005
  it('refuses a Dependabot PR with a failing PR title check', () => {
    assert.match(decideMerge(pr([...base, check('PR title', 'FAILURE')], dependabot)), /PR title/);
  });
});
