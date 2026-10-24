import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

import { judgeProvenance, readProvenance } from './provenance.mjs';

const QA = '.github/workflows/pr-qa.yml';
const SHA = 'a'.repeat(40);
const RUN = 'https://github.com/george-hutanu/motor-fix/actions/runs/123';
const bot = (over = {}) => ({ state: 'success', context: 'agent-review', description: 'x', target_url: RUN, creator: { login: 'github-actions[bot]', type: 'Bot' }, ...over });
const owner = (over = {}) => ({ state: 'success', context: 'agent-review', description: 'x', creator: { login: 'george-hutanu', type: 'User' }, ...over });
const prRun = (over = {}) => ({ path: QA, event: 'pull_request', head_branch: 'feature', head_sha: SHA, display_title: `PR QA #21 at ${SHA} lap 1 `, status: 'completed', conclusion: 'success', ...over });
const dispatched = (over = {}) => prRun({ event: 'workflow_dispatch', head_branch: 'main', head_sha: 'b'.repeat(40), ...over });
const judge = (over = {}) => judgeProvenance({ sha: SHA, pr: 21, status: bot(), run: prRun(), testerReview: null, qaWorkflowChanged: false, defaultBranch: 'main', ...over });

describe('provenance of a person-written verdict, attacked', () => {
  // @traces 447-FR-003
  it('refuses a person success that names a run when the run could not be supplied', () => {
    assert.match(judge({ status: owner({ target_url: RUN }), run: null, qaWorkflowChanged: true }), /names no run/);
  });

  // @traces 447-FR-003
  it('refuses a person success naming a pull_request run still in progress or cancelled', () => {
    assert.match(judge({ status: owner({ target_url: RUN }), run: prRun({ status: 'in_progress', conclusion: null }) }), /still in_progress/);
    assert.match(judge({ status: owner({ target_url: RUN }), run: prRun({ conclusion: 'cancelled' }) }), /cancelled/);
  });

  // @traces 447-FR-003
  it('refuses a person success naming a lap dispatched on a feature branch', () => {
    assert.match(judge({ status: owner({ target_url: RUN }), run: dispatched({ head_branch: 'feature' }) }), /dispatched on feature/);
  });

  // @traces 447-FR-003
  it('refuses a person success naming a push-triggered run', () => {
    assert.match(judge({ status: owner({ target_url: RUN }), run: prRun({ event: 'push' }) }), /push/);
  });

  // @traces 447-FR-003
  it('accepts a person success naming a lap dispatched on a non-main default branch', () => {
    const run = dispatched({ head_branch: 'trunk', display_title: `PR QA #21 at ${SHA} lap 1 ` });
    assert.equal(judge({ status: owner({ target_url: RUN }), run, defaultBranch: 'trunk', qaWorkflowChanged: true }), null);
    assert.match(judge({ status: owner({ target_url: RUN }), run, defaultBranch: 'main', qaWorkflowChanged: true }), /dispatched on trunk/);
  });

  // @traces 447-FR-003
  it('refuses a person success naming a lap dispatched for another commit by its title', () => {
    const run = dispatched({ display_title: `PR QA #21 at ${'c'.repeat(40)} lap 2 ` });
    assert.match(judge({ status: owner({ target_url: RUN }), run }), /tested ccccccc/);
  });

  // @traces 447-FR-003
  it('refuses a pull_request run of a changed pr-qa.yml when the change flag is the only evidence, with no target_url trick', () => {
    const why = judge({ status: owner({ target_url: `${RUN}/attempts/2` }), run: prRun(), qaWorkflowChanged: true });
    assert.match(why, /changes \.github\/workflows\/pr-qa\.yml/);
  });

  // @traces 447-FR-003
  it('does not judge a person failure by its run, the gate refuses failures elsewhere', () => {
    assert.equal(judge({ status: owner({ state: 'failure', target_url: RUN }), run: prRun(), qaWorkflowChanged: true }), null);
  });

  // @traces 447-FR-003
  it('refuses a person success when the tester review of this head is a failure, even with a clean dispatched run', () => {
    assert.match(judge({ status: owner({ target_url: RUN }), run: dispatched(), testerReview: 'failure' }), /failure/);
  });

  // @traces 447-FR-003
  it('refuses an account that is a User type but a bot-looking login on the run-less path only for non-person types', () => {
    assert.match(judge({ status: owner({ creator: { login: 'x[bot]', type: 'Organization' } }), run: null }), /x\[bot\]/);
    assert.match(judge({ status: owner({ creator: null }), run: null }), /unknown account/);
  });

  // @traces 447-FR-003
  // Spec edge case (review 2026-10-24): only a success is judged here; a pending or failing state is the merge gate's own check.
  it("leaves a person-written pending state to the merge gate's state check", () => {
    assert.equal(judge({ status: owner({ state: 'pending' }), run: null }), null);
  });
});

describe('reading provenance, attacked', () => {
  const routes = (over = {}) => ({
    [`commits/${SHA}/statuses`]: JSON.stringify([owner({ target_url: RUN })]),
    'actions/runs/123': JSON.stringify(prRun()),
    'pulls/21/files': JSON.stringify({ filename: 'a.ts', previous_filename: null }),
    'pulls/21/reviews': '',
    'repos/{owner}/{repo} ': JSON.stringify({ branch: 'main', name: 'george-hutanu/motor-fix' }),
    ...over,
  });
  const fake = (table, calls = []) => async (args) => {
    calls.push(args.join(' '));
    const key = Object.keys(table).find((k) => `${args.join(' ')} `.includes(k));
    if (!key) return { code: 1, stdout: '', stderr: `no route for ${args.join(' ')}` };
    return table[key] === null ? { code: 1, stdout: '', stderr: 'HTTP 502' } : { code: 0, stdout: table[key], stderr: '' };
  };

  // @traces 447-FR-003
  it("throws when the person's named run cannot be read", async () => {
    await assert.rejects(readProvenance({ pr: 21, shas: [SHA], gh: fake(routes({ 'actions/runs/123': null })) }), /HTTP 502/);
  });

  // @traces 447-FR-003
  it('reads the run for a URL with a query string or trailing slash', async () => {
    for (const target_url of [`${RUN}?pr=21`, `${RUN}/`, `${RUN}/attempts/1`]) {
      const calls = [];
      await readProvenance({ pr: 21, shas: [SHA], gh: fake(routes({ [`commits/${SHA}/statuses`]: JSON.stringify([owner({ target_url })]) }), calls) });
      assert.ok(calls.some((c) => c.includes('actions/runs/123')), target_url);
    }
  });

  // @traces 447-FR-003
  it('reads only the newest agent-review status, so an older person success does not outlive a newer failure', async () => {
    const statuses = [owner({ state: 'failure', target_url: RUN }), owner({ state: 'success' })];
    const state = await readProvenance({ pr: 21, shas: [SHA], gh: fake(routes({ [`commits/${SHA}/statuses`]: JSON.stringify(statuses) })) });
    assert.equal(state.bySha[SHA].status.state, 'failure');
  });

  // @traces 447-FR-003
  it('returns a null status for a commit with no agent-review status and reads no run', async () => {
    const calls = [];
    const statuses = [owner({ context: 'ci/other', target_url: RUN })];
    const state = await readProvenance({ pr: 21, shas: [SHA], gh: fake(routes({ [`commits/${SHA}/statuses`]: JSON.stringify(statuses) }), calls) });
    assert.equal(state.bySha[SHA].status ?? null, null);
    assert.equal(state.bySha[SHA].run ?? null, null);
  });

  // @traces 447-FR-003
  it('returns no per-commit entries for an empty sha list', async () => {
    const state = await readProvenance({ pr: 21, shas: [], gh: fake(routes()) });
    assert.deepEqual(Object.keys(state.bySha), []);
  });
});
