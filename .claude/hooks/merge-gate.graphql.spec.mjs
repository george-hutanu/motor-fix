import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { mergeTarget, prOfNode } from './merge-gate.mjs';

// @traces 448-merge-gate-graphql-FR-001
// @traces 448-merge-gate-graphql-FR-002

const ID = 'PR_kwDOMotorFix21';
const inline = (mutation = 'mergePullRequest') => `gh api graphql -f query='mutation { ${mutation}(input: {pullRequestId: "${ID}"}) { clientMutationId } }'`;

describe('merge gate — a merge through gh api graphql', () => {
  it('finds mergePullRequest and enablePullRequestAutoMerge with an inline pull request id', () => {
    assert.deepEqual(mergeTarget(inline()), { pr: null, nodeId: ID });
    assert.deepEqual(mergeTarget(inline('enablePullRequestAutoMerge')), { pr: null, nodeId: ID });
  });

  it('finds the id behind a variable given with -f, -F, --field or --raw-field', () => {
    const query = `query='mutation($id: ID!) { mergePullRequest(input: {pullRequestId: $id, mergeMethod: MERGE}) { clientMutationId } }'`;
    for (const flag of ['-f', '-F', '--field', '--raw-field']) assert.deepEqual(mergeTarget(`gh api graphql -f ${query} ${flag} id=${ID}`), { pr: null, nodeId: ID }, flag);
    assert.deepEqual(mergeTarget(`gh api graphql -F id="${ID}" -f ${query}`), { pr: null, nodeId: ID });
  });

  it('finds it in a multi-line query, after another command, and with gh called by its path', () => {
    assert.deepEqual(mergeTarget(`git push && gh api graphql -f query='\nmutation {\n  mergePullRequest(input: {\n    pullRequestId: "${ID}"\n  }) { clientMutationId }\n}'`), { pr: null, nodeId: ID });
    assert.deepEqual(mergeTarget(`GH_TOKEN=x /opt/homebrew/bin/gh api graphql -f query="mutation { mergePullRequest(input: {pullRequestId: \\"${ID}\\"}) { clientMutationId } }"`), { pr: null, nodeId: ID });
  });

  it('refuses to guess the PR: no id, a shell variable, two ids', () => {
    assert.match(mergeTarget(`gh api graphql -f query='mutation { mergePullRequest(input: {}) { clientMutationId } }'`).unresolved, /no pull request id/);
    assert.match(mergeTarget(`gh api graphql -f query='mutation($id: ID!) { mergePullRequest(input: {pullRequestId: $id}) { clientMutationId } }' -f id=$PR_ID`).unresolved, /no pull request id/);
    assert.match(mergeTarget(`gh api graphql -f query='mutation($id: ID!) { mergePullRequest(input: {pullRequestId: $id}) { clientMutationId } }'`).unresolved, /no pull request id/);
    assert.match(mergeTarget(`gh api graphql -f query='mutation { a: mergePullRequest(input: {pullRequestId: "PR_a"}) { clientMutationId } b: mergePullRequest(input: {pullRequestId: "PR_b"}) { clientMutationId } }'`).unresolved, /more than one/);
  });

  it('leaves a graphql call that merges nothing alone, and the mutation named outside gh api graphql', () => {
    assert.equal(mergeTarget(`gh api graphql -f query='{ viewer { login } }'`), null);
    assert.equal(mergeTarget(`gh api graphql -f query='mutation { addComment(input: {subjectId: "${ID}", body: "x"}) { clientMutationId } }'`), null);
    assert.equal(mergeTarget('grep -n mergePullRequest .claude/hooks/merge-gate.mjs'), null);
  });
});

describe('merge gate — the PR behind a node id', () => {
  const ghAnswering = (out) => {
    const calls = [];
    return { calls, gh: async (args) => (calls.push(args), out) };
  };

  it('reads the node once over GraphQL and returns the pull request number', async () => {
    const { gh, calls } = ghAnswering({ code: 0, stdout: '{"__typename":"PullRequest","number":21}\n', stderr: '' });
    assert.equal(await prOfNode(ID, gh, {}), '21');
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].slice(0, 2), ['api', 'graphql']);
    assert.ok(calls[0].includes(`id=${ID}`), JSON.stringify(calls[0]));
  });

  it('throws for a node that is not a pull request, a missing node and a failed read', async () => {
    await assert.rejects(prOfNode(ID, ghAnswering({ code: 0, stdout: '{"__typename":"Issue"}', stderr: '' }).gh, {}), /not a pull request/);
    await assert.rejects(prOfNode(ID, ghAnswering({ code: 0, stdout: 'null', stderr: '' }).gh, {}), /not a pull request/);
    await assert.rejects(prOfNode(ID, ghAnswering({ code: 1, stdout: '', stderr: 'HTTP 502' }).gh, {}), /HTTP 502/);
  });

  it('takes the number from SPECKIT_PR_STATE without reading GitHub', async () => {
    const { gh, calls } = ghAnswering({ code: 1, stdout: '', stderr: 'no' });
    assert.equal(await prOfNode(ID, gh, { SPECKIT_PR_STATE: '{"number":21}' }), '21');
    assert.equal(calls.length, 0);
  });
});

describe('merge gate — a graphql merge is judged like gh pr merge', () => {
  const hooks = fileURLToPath(new URL('.', import.meta.url));
  const green = [
    { __typename: 'CheckRun', name: 'CI OK', conclusion: 'SUCCESS', status: 'COMPLETED' },
    { __typename: 'CheckRun', name: 'PR title', conclusion: 'SUCCESS', status: 'COMPLETED' },
  ];
  const state = (rollup) => JSON.stringify({ number: 21, state: 'OPEN', headRefOid: 'abc1234def5678', statusCheckRollup: rollup });
  const gate = (command, env) =>
    spawnSync(process.execPath, [join(hooks, 'merge-gate.mjs')], {
      input: JSON.stringify({ tool_input: { command } }),
      encoding: 'utf8',
      timeout: 20000,
      env: { ...process.env, SPECKIT_CARRY_STATE: '', SPECKIT_MERGE_GATE_DEADLINE_MS: '', SPECKIT_PROVENANCE_STATE: '', ...env },
    });

  it('refuses a graphql merge whose head has no agent-review success', () => {
    for (const mutation of ['mergePullRequest', 'enablePullRequestAutoMerge']) {
      const out = gate(inline(mutation), { SPECKIT_PR_STATE: state(green) });
      assert.equal(out.status, 2, mutation);
      assert.match(out.stderr, /no agent-review status/);
      assert.match(out.stderr, /speckit-pr-test 21/);
    }
  });

  it('refuses a graphql merge while CI is red, even with agent-review success', () => {
    const out = gate(inline(), { SPECKIT_PR_STATE: state([{ ...green[0], conclusion: 'FAILURE' }, green[1], { __typename: 'StatusContext', context: 'agent-review', state: 'SUCCESS' }]) });
    assert.equal(out.status, 2);
    assert.match(out.stderr, /CI failed/);
  });

  it('refuses a graphql merge it cannot tie to one PR, naming gh pr merge', () => {
    const out = gate(`gh api graphql -f query='mutation($id: ID!) { mergePullRequest(input: {pullRequestId: $id}) { clientMutationId } }' -f id=$PR_ID`, { SPECKIT_PR_STATE: state(green) });
    assert.equal(out.status, 2);
    assert.match(out.stderr, /gh pr merge <n>/);
  });

  it('lets a graphql merge through with agent-review success and every check green', () => {
    const out = gate(inline(), { SPECKIT_PR_STATE: state([...green, { __typename: 'StatusContext', context: 'agent-review', state: 'SUCCESS' }]), SPECKIT_PROVENANCE_STATE: '{"status":{"creator":{"login":"george-hutanu","type":"User"}}}' });
    assert.equal(out.status, 0, out.stderr);
  });
});
