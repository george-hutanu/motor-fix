import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { ghRun } from './gh-rest.mjs';

const BRANCH = 'b';
const REPO = 'repos/{owner}/{repo}/';
const pull = { number: 160, title: 't', body: '', html_url: 'u', state: 'open', draft: false, merged_at: null, mergeable: true, head: { ref: BRANCH, sha: 'head1' }, base: { ref: 'main' }, user: { login: 'x' }, labels: [], merge_commit_sha: null };
function fake(routes) {
  const run = (file, args) => {
    if (file !== 'gh' || args[0] !== 'api') return { code: 0, stdout: '', stderr: '' };
    const key = `${args[args.indexOf('-X') + 1]} ${args[1].replace(REPO, '')}`;
    if (!(key in routes)) return { code: 1, stdout: '', stderr: `gh: Not Found (HTTP 404) ${key}` };
    const hit = routes[key];
    if (hit && typeof hit === 'object' && 'code' in hit) return { stdout: '', stderr: '', ...hit };
    return { code: 0, stdout: JSON.stringify(args.includes('--slurp') ? [hit] : hit), stderr: '' };
  };
  return { run };
}
const base = (runs, workflowRuns) => ({
  'GET pulls/160': pull,
  'GET commits/head1/check-runs?per_page=100': { check_runs: runs },
  'GET commits/head1/status': { statuses: [] },
  ...(workflowRuns === undefined ? {} : { 'GET actions/runs?head_sha=head1&per_page=100': workflowRuns }),
});
const cr = (name, suite, extra = {}) => ({ name, status: 'completed', conclusion: 'success', check_suite: suite === undefined ? undefined : { id: suite }, ...extra });
const gh = (args, f) => ghRun(args, { run: f.run, env: { CLAUDE_CODE_REMOTE: 'true' }, sleep: () => {} });
const rollup = (f) => JSON.parse(gh(['pr', 'view', '160', '--json', 'statusCheckRollup'], f).stdout).statusCheckRollup.map((c) => c.workflowName);
const wf = (f) => JSON.parse(gh(['pr', 'checks', '160', '--json', 'name,workflow'], f).stdout).map((c) => c.workflow);

describe('workflow names on checks, adversarial', () => {
  // @traces 1344-FR-010
  it('gives empty names when a check has no suite, or its suite is in no run', () => {
    const f = fake(base([cr('a'), cr('b', 99)], { workflow_runs: [{ check_suite_id: 4, name: 'Mutation' }] }));
    assert.deepEqual(rollup(f), ['', '']);
    assert.deepEqual(wf(f), ['', '']);
  });

  // @traces 1344-FR-010
  it('gives empty names when the runs answer lacks workflow_runs or holds nulls', () => {
    for (const answer of [{}, { workflow_runs: null }, { workflow_runs: [null, {}, { check_suite_id: 4 }] }]) {
      const f = fake(base([cr('a', 4)], answer));
      assert.deepEqual(rollup(f), [''], JSON.stringify(answer));
      assert.deepEqual(wf(f), [''], JSON.stringify(answer));
    }
  });

  // @traces 1344-FR-010
  it('names the workflow of a Mutation run whose suite id is large', () => {
    const big = 28_000_000_000;
    const f = fake(base([cr('scripts', big)], { workflow_runs: [{ check_suite_id: big, name: 'Mutation' }] }));
    assert.deepEqual(rollup(f), ['Mutation']);
    assert.deepEqual(wf(f), ['Mutation']);
  });

  // @traces 1344-FR-010
  it('keeps a Mutation check in pr checks rows with the right bucket so readers can drop it', () => {
    const f = fake(base([cr('scripts', 9, { status: 'in_progress', conclusion: null })], { workflow_runs: [{ check_suite_id: 9, name: 'Mutation' }] }));
    assert.deepEqual(JSON.parse(gh(['pr', 'checks', '160', '--json', 'name,bucket,workflow'], f).stdout), [{ name: 'scripts', bucket: 'pending', workflow: 'Mutation' }]);
  });

  // @traces 1344-FR-010
  it('keeps a same-named check of two workflows apart', () => {
    const f = fake(base([cr('scripts', 1), cr('scripts', 2, { conclusion: 'failure' })], { workflow_runs: [{ check_suite_id: 1, name: 'CI' }, { check_suite_id: 2, name: 'Mutation' }] }));
    assert.deepEqual(wf(f), ['CI', 'Mutation']);
  });

  // @traces 1344-FR-010
  it('does not throw when the runs lookup fails with a transport error', () => {
    const f = fake(base([cr('a', 4)], { code: 127, stderr: 'gh: command crashed' }));
    assert.deepEqual(rollup(f), ['']);
  });
});
