import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ghCwd, mergeTarget, prOfNode } from './merge-gate.mjs';

// @traces 448-FR-001
// @traces 448-FR-002

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

  // Review of ST-448: each of these merged a PR the gate never judged.
  it('refuses a command that merges more than one PR, whichever paths it mixes', () => {
    const cli = ['gh', 'pr', 'merge'].join(' ');
    assert.match(mergeTarget(`${cli} 5 && ${inline()}`).unresolved, /more than one/);
    assert.match(mergeTarget(`gh api -X PUT repos/o/r/pulls/5/merge && ${inline()}`).unresolved, /more than one/);
    assert.match(mergeTarget(`${cli} 5 && ${cli} 6`).unresolved, /more than one/);
    assert.deepEqual(mergeTarget(`${cli} 5; ${cli} 5 --auto`), { pr: '5' });
  });

  it('refuses a repeated id or query field, since gh sends the last one', () => {
    const query = `query='mutation($id: ID!) { mergePullRequest(input: {pullRequestId: $id}) { clientMutationId } }'`;
    assert.match(mergeTarget(`gh api graphql -f ${query} -f id=PR_ok -f id=PR_other`).unresolved, /more than one/);
    assert.match(mergeTarget(`gh api graphql -f ${query} -f id=${ID} -f id=${ID}`).unresolved, /more than once/);
    assert.match(mergeTarget(`gh api graphql -f query='{ viewer { login } }' -f ${query} -f id=${ID}`).unresolved, /more than once/);
  });

  it('refuses a graphql call whose query it cannot read: from a file, stdin or --input', () => {
    for (const cmd of ['gh api graphql -F query=@merge.graphql -f id=PR_x', 'gh api graphql -f query=@- < q.graphql', 'gh api graphql --input body.json'])
      assert.match(mergeTarget(cmd).unresolved, /cannot read the query/, cmd);
  });

  it('leaves a graphql call that merges nothing alone, and the mutation named outside gh api graphql', () => {
    assert.equal(mergeTarget(`gh api graphql -f query='{ viewer { login } }'`), null);
    assert.equal(mergeTarget(`gh api graphql -f query='mutation { addComment(input: {subjectId: "${ID}", body: "x"}) { clientMutationId } }'`), null);
    assert.equal(mergeTarget('grep -n mergePullRequest .claude/hooks/merge-gate.mjs'), null);
  });
});

// Second review of ST-448: each of these still merged a PR the gate never judged, or judged the wrong one.
describe('merge gate — merges hidden by quoting, a pipe or another repository', () => {
  const cli = ['gh', 'pr', 'merge'].join(' ');
  const R = 'george-hutanu/motor-fix';

  it('finds a merge whose words are quoted or escaped, in the command word or inside a word', () => {
    assert.deepEqual(mergeTarget(`"gh" pr merge 5`), { pr: '5' });
    assert.deepEqual(mergeTarget(`'gh' pr merge 5`), { pr: '5' });
    assert.deepEqual(mergeTarget(`\\gh pr merge 5`), { pr: '5' });
    assert.deepEqual(mergeTarget(`gh pr me""rge 5`), { pr: '5' });
    assert.deepEqual(mergeTarget(`gh p'r' merge 5`), { pr: '5' });
    assert.deepEqual(mergeTarget(`GH_TOKEN=x env "gh" pr merge 5`), { pr: '5' });
    // A mention is refused with the rest of what the gate cannot place: fail-closed.
    assert.match(mergeTarget(`echo "${cli}" is documented`).unresolved, /cannot place/);
    assert.match(mergeTarget(`grep -n '${cli}' AGENTS.md`).unresolved, /cannot place/);
    assert.equal(mergeTarget(`grep -rn mergePullRequest .claude`), null);
  });

  it('refuses a graphql query it cannot read, however the query field is written', () => {
    const q = 'mutation { mergePullRequest(input: {pullRequestId: \\"PR_x\\"}) { clientMutationId } }';
    for (const cmd of [
      'gh api graphql -fquery=@q.graphql',
      'gh api graphql -f "query"=@q.graphql',
      'gh api graphql --field=query=@q.graphql',
      'gh api graphql -f query="$(cat q.graphql)"',
      'gh api graphql -f query="$Q"',
      'gh api graphql -f query=$Q',
      'gh api graphql -f query=`cat q.graphql`',
      `gh api graphql -f query='{ viewer { login } }'"$MORE"`,
      'gh api graphql',
      `bash -c "gh api graphql -f query='$(cat q.graphql)'"`,
      `eval "gh api graphql -f query='\`cat q\`'"`,
    ])
      assert.match(mergeTarget(cmd)?.unresolved ?? 'allowed', /cannot read the query/, cmd);
    assert.deepEqual(mergeTarget(`gh api graphql -f query="${q}"`), { pr: null, nodeId: 'PR_x' });
  });

  it('judges --input only on the graphql call that takes it', () => {
    assert.equal(mergeTarget(`gh api graphql -f query='{ viewer { login } }' && gh api repos/a/b/issues -X POST --input body.json`), null);
    assert.match(mergeTarget('gh api graphql --input body.json').unresolved, /cannot read the query/);
  });

  it('refuses a merge whose PR comes from its input or a placeholder, never the current branch', () => {
    assert.match(mergeTarget(`echo 6 | xargs ${cli}`).unresolved, /input/);
    assert.match(mergeTarget(`echo 6 | xargs -n1 ${cli} --merge`).unresolved, /input/);
    assert.match(mergeTarget('gh api -X PUT repos/{owner}/{repo}/pulls/$N/merge').unresolved, /number/);
    assert.match(mergeTarget('gh api -X PUT "repos/{owner}/{repo}/pulls/{}/merge"').unresolved, /number/);
    assert.deepEqual(mergeTarget('gh api -X PUT "repos/{owner}/{repo}/pulls/141/merge"'), { pr: '141' });
  });

  it('returns the repository a merge names, from -R, --repo, GH_REPO, a URL or a REST path', () => {
    assert.deepEqual(mergeTarget(`${cli} 5 -R other/repo`), { pr: '5', repo: 'other/repo' });
    assert.deepEqual(mergeTarget(`${cli} 5 --repo=other/repo`), { pr: '5', repo: 'other/repo' });
    assert.deepEqual(mergeTarget(`GH_REPO=other/repo ${cli} 5`), { pr: '5', repo: 'other/repo' });
    assert.deepEqual(mergeTarget(`${cli} https://github.com/other/repo/pull/5`), { pr: 'https://github.com/other/repo/pull/5', repo: 'other/repo' });
    assert.deepEqual(mergeTarget('gh api -X PUT repos/other/repo/pulls/5/merge'), { pr: '5', repo: 'other/repo' });
    assert.deepEqual(mergeTarget(`${cli} 5 -R ${R}`), { pr: '5', repo: R });
    assert.match(mergeTarget(`${cli} feature -R other/repo`).unresolved, /number/);
    assert.match(mergeTarget(`${cli} 5 -R other/repo && ${cli} 5`).unresolved, /more than one/);
  });
});

// Third review of ST-448: a wrapper's option, a quoted field name, or an earlier command moving gh.
describe('merge gate — words read as the shell reads them, and what earlier commands change', () => {
  const cli = ['gh', 'pr', 'merge'].join(' ');
  const quotedCli = ['"gh"', 'pr', 'merge'].join(' ');

  it('finds a quoted gh after a wrapper that takes an option value', () => {
    for (const cmd of [`nice -n 10 ${quotedCli} 5`, `sudo -u me ${quotedCli} 5`, `env -u X ${quotedCli} 5`, `timeout 30 ${quotedCli} 5`])
      assert.deepEqual(mergeTarget(cmd), { pr: '5' }, cmd);
    assert.match(mergeTarget(`echo 6 | xargs -n 1 ${quotedCli}`).unresolved, /input/);
  });

  it('reads a field name the shell unquotes, so a hidden query or id field is seen', () => {
    const q = `query='mutation($id: ID!) { mergePullRequest(input: {pullRequestId: $id}) { clientMutationId } }'`;
    assert.match(mergeTarget(`gh api graphql -f query='{ viewer { login } }' -f qu""ery=@q.graphql`).unresolved, /cannot read the query/);
    assert.match(mergeTarget(`gh api graphql -f query='{ viewer { login } }' -f quer\\y=@q.graphql`).unresolved, /cannot read the query/);
    assert.match(mergeTarget(`gh api graphql -f ${q} -f id=PR_ours -f i""d=PR_other`).unresolved, /more than one/);
    assert.match(mergeTarget(`gh api graphql -f ${q} -f "$(echo id)=PR_other"`).unresolved, /cannot read the query/);
  });

  it('follows GH_REPO and a literal cd set by an earlier command, and refuses what it cannot follow', () => {
    assert.deepEqual(mergeTarget(`export GH_REPO=other/repo; ${cli} 5`), { pr: '5', repo: 'other/repo' });
    assert.deepEqual(mergeTarget(`GH_REPO=other/repo; ${cli} 5`), { pr: '5', repo: 'other/repo' });
    assert.deepEqual(mergeTarget(`cd ../other && ${cli} 5`), { pr: '5', cwd: '../other' });
    assert.deepEqual(mergeTarget(`${cli} 5; cd ../other`), { pr: '5' });
    assert.match(mergeTarget(`git switch other && ${cli}`).unresolved, /switches branch/);
    assert.deepEqual(mergeTarget(`git switch other && ${cli} 5`), { pr: '5' });
    for (const cmd of [`cd $WT && ${cli} 5`, `pushd ../other && ${cli} 5`, `gh repo set-default other/repo && ${cli} 5`])
      assert.match(mergeTarget(cmd).unresolved, /cannot follow/, cmd);
    assert.match(mergeTarget(`${cli} "$(echo 5)"`).unresolved, /built by the shell/);
  });

  it('reads gh where a literal cd moved it, home included', () => {
    assert.equal(ghCwd('/w/repo', { pr: '5' }, '/home/me'), '/w/repo');
    assert.equal(ghCwd('/w/repo', { pr: '5', cwd: '../other' }, '/home/me'), '/w/other');
    assert.equal(ghCwd('/w/repo', { pr: '5', cwd: '~/x' }, '/home/me'), '/home/me/x');
    assert.equal(ghCwd('/w/repo', { pr: '5', cwd: '~' }, '/home/me'), '/home/me');
  });
});

// Fourth review of ST-448: shell spellings the parser misread, a cd it followed wrongly, and a backstop for the rest.
describe('merge gate — the fourth review, and the backstop for a merge the parser cannot place', () => {
  const cli = ['gh', 'pr', 'merge'].join(' ');

  it('ends $\'…\' at its real closing quote, and takes gh followed by pr or api, not an option value', () => {
    assert.deepEqual(mergeTarget(`echo $'\\'' ; ${cli} 5`), { pr: '5' });
    assert.deepEqual(mergeTarget(`env -u gh ${cli} 5`), { pr: '5' });
    assert.deepEqual(mergeTarget(`sudo -u gh ${cli} 5`), { pr: '5' });
  });

  it('reads a combined -c flag, and refuses a merge in a string some program runs', () => {
    assert.deepEqual(mergeTarget(`bash -ec '${cli} 5'`), { pr: '5' });
    assert.deepEqual(mergeTarget(`sh -lc "${cli} 5"`), { pr: '5' });
    for (const cmd of [`bash <<< '${cli} 5'`, `echo '${cli} 5' | sh`, `node -e "require('child_process').execSync('${cli} 5')"`, `echo "${cli}" is documented`, `node -e "x('gh api -X PUT repos/o/r/pulls/5/merge')"`])
      assert.match(mergeTarget(cmd)?.unresolved ?? 'allowed', /cannot place/, cmd);
  });

  it('follows a cd only at the top of an && chain up to the merge, composing each one', () => {
    assert.deepEqual(mergeTarget(`cd a && cd b && ${cli} 5`), { pr: '5', cwd: 'a/b' });
    assert.deepEqual(mergeTarget(`cd a && cd /x && ${cli} 5`), { pr: '5', cwd: '/x' });
    for (const cmd of [`(cd ../other) && ${cli} 5`, `echo $(cd ../other); ${cli} 5`, `cd ../other || true; ${cli} 5`, `cd a; ${cli} 5`, `cd a && true; ${cli} 5`])
      assert.match(mergeTarget(cmd)?.unresolved ?? 'allowed', /cannot follow/, cmd);
  });

  it('sees GH_REPO set by declare, and refuses GIT_DIR, GIT_WORK_TREE, GH_HOST and env -C before a merge', () => {
    assert.deepEqual(mergeTarget(`declare -x GH_REPO=o/r; ${cli} 5`), { pr: '5', repo: 'o/r' });
    for (const cmd of [`GIT_DIR=../other/.git ${cli} 5`, `export GIT_WORK_TREE=x; ${cli} 5`, `GH_HOST=ghe.example ${cli} 5`, `env -C ../other ${cli} 5`, `env --chdir=../other ${cli} 5`])
      assert.match(mergeTarget(cmd)?.unresolved ?? 'allowed', /cannot follow/, cmd);
    assert.match(mergeTarget('gh api --hostname ghe.example -X PUT repos/george-hutanu/motor-fix/pulls/5/merge').unresolved, /cannot follow/);
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
  const state = (rollup, id = ID) => JSON.stringify({ id, number: 21, state: 'OPEN', headRefOid: 'abc1234def5678', statusCheckRollup: rollup });
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

  it('refuses a node of another repository, which the number alone would judge as this repo\'s PR', () => {
    const passing = [...green, { __typename: 'StatusContext', context: 'agent-review', state: 'SUCCESS' }];
    for (const id of ['PR_kwDOSomeoneElse21', null]) {
      const out = gate(inline(), { SPECKIT_PR_STATE: state(passing, id), SPECKIT_PROVENANCE_STATE: '{"status":{"creator":{"login":"george-hutanu","type":"User"}}}' });
      assert.equal(out.status, 2, String(id));
      assert.match(out.stderr, /not this repository's PR #21/);
    }
  });

  it('refuses a merge naming another repository, which this repository\'s PR of that number would stand in for', () => {
    const passing = [...green, { __typename: 'StatusContext', context: 'agent-review', state: 'SUCCESS' }];
    const provenance = '{"status":{"creator":{"login":"george-hutanu","type":"User"}}}';
    const cli = ['gh', 'pr', 'merge'].join(' ');
    const ours = (repo) => JSON.stringify({ ...JSON.parse(state(passing)), ...(repo ? { repo } : {}) });
    for (const cmd of [`${cli} 21 -R other/repo`, 'gh api -X PUT repos/other/repo/pulls/21/merge', `${cli} https://github.com/other/repo/pull/21`]) {
      const out = gate(cmd, { SPECKIT_PR_STATE: ours('george-hutanu/motor-fix'), SPECKIT_PROVENANCE_STATE: provenance });
      assert.equal(out.status, 2, cmd);
      assert.match(out.stderr, /other\/repo is not this repository/, cmd);
    }
    assert.equal(gate(`${cli} 21 -R george-hutanu/motor-fix`, { SPECKIT_PR_STATE: ours('George-Hutanu/motor-fix'), SPECKIT_PROVENANCE_STATE: provenance }).status, 0);
    assert.equal(gate(`${cli} 21 -R george-hutanu/motor-fix`, { SPECKIT_PR_STATE: ours(null), SPECKIT_PROVENANCE_STATE: provenance }).status, 2, 'a repository the read does not report is refused');
  });

  it('lets a graphql merge through with agent-review success and every check green', () => {
    const out = gate(inline(), { SPECKIT_PR_STATE: state([...green, { __typename: 'StatusContext', context: 'agent-review', state: 'SUCCESS' }]), SPECKIT_PROVENANCE_STATE: '{"status":{"creator":{"login":"george-hutanu","type":"User"}}}' });
    assert.equal(out.status, 0, out.stderr);
  });
});

// @traces 448-FR-003
// @traces 448-FR-009
describe('merge gate — the eval cases that hold the graphql path shut', () => {
  const root = fileURLToPath(new URL('../..', import.meta.url));
  const cases = JSON.parse(readFileSync(join(root, '.claude/evals/cases/merge-gate.json'), 'utf8'));
  const runCase = (c) =>
    spawnSync(process.execPath, [join(root, '.claude/hooks/merge-gate.mjs')], {
      input: JSON.stringify(c.payload),
      encoding: 'utf8',
      timeout: 20000,
      env: { ...process.env, SPECKIT_CARRY_STATE: '', SPECKIT_MERGE_GATE_DEADLINE_MS: '', SPECKIT_PROVENANCE_STATE: '', ...c.env },
    });

  it('has a graphql merge without agent-review refused for "no agent-review status"', () => {
    const c = cases.find((x) => /graphql/.test(x.payload?.tool_input?.command ?? '') && x.expect.exit === 2 && x.expect.stderr === 'no agent-review status');
    assert.ok(c, 'no such eval case in merge-gate.json');
    const out = runCase(c);
    assert.equal(out.status, 2, out.stderr);
    assert.match(out.stderr, /no agent-review status/);
  });

  it('keeps every graphql and PR title eval case holding, and the eval floor at 1', () => {
    const ours = cases.filter((x) => /graphql|pr-title/.test(x.id));
    assert.ok(ours.length >= 4, ours.map((x) => x.id).join(', '));
    for (const c of ours) assert.equal(runCase(c).status, c.expect.exit, c.id);
    assert.ok(JSON.parse(readFileSync(join(root, '.claude/evals/baseline.json'), 'utf8')).pass_rate >= 1);
  });
});
