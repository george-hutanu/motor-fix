import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

import { judgeProvenance, readProvenance, testerVerdict } from './provenance.mjs';

const QA_WORKFLOW_PATH = '.github/workflows/pr-qa.yml';

const SHA = 'a'.repeat(40);
const RUN = 'https://github.com/george-hutanu/motor-fix/actions/runs/123';
const bot = (over = {}) => ({ state: 'success', context: 'agent-review', description: 'PR QA lap 1 passed', target_url: RUN, creator: { login: 'github-actions[bot]', type: 'Bot' }, ...over });
const owner = (over = {}) => ({ state: 'success', context: 'agent-review', description: 'No blocking findings', creator: { login: 'george-hutanu', type: 'User' }, ...over });
const prRun = (over = {}) => ({ path: QA_WORKFLOW_PATH, event: 'pull_request', head_branch: 'feature', head_sha: SHA, display_title: `PR QA #21 at ${SHA} lap 1 `, status: 'completed', conclusion: 'success', ...over });
const dispatched = (over = {}) => prRun({ event: 'workflow_dispatch', head_branch: 'main', head_sha: 'b'.repeat(40), ...over });
const judge = (over = {}) => judgeProvenance({ sha: SHA, pr: 21, status: bot(), run: prRun(), testerReview: null, qaWorkflowChanged: false, defaultBranch: 'main', ...over });

describe('agent-review provenance — who may write the verdict the merge gate reads', () => {
  it("accepts the PR QA workflow's own pull_request run of this head", () => {
    assert.equal(judge(), null);
  });

  it("accepts a status the owner's tester wrote from the laptop (post.mjs, carry.mjs)", () => {
    assert.equal(judge({ status: owner(), run: null }), null);
  });

  it("accepts a lap dispatched on the default branch, which runs main's pr-qa.yml, for this head", () => {
    assert.equal(judge({ run: dispatched(), qaWorkflowChanged: true }), null);
  });

  // The hole: on pull_request GitHub runs the PR's own copy of the workflow.
  it('refuses a pull_request run when the PR changes pr-qa.yml: the PR ran its own QA', () => {
    const why = judge({ qaWorkflowChanged: true });
    assert.match(why, /changes \.github\/workflows\/pr-qa\.yml/);
    assert.match(why, /dispatch\.mjs 21/);
  });

  it('refuses a status written by any other workflow, such as one the PR added', () => {
    assert.match(judge({ run: prRun({ path: '.github/workflows/evil.yml' }) }), /evil\.yml, not the PR QA workflow/);
  });

  it('refuses a workflow status that names no run', () => {
    assert.match(judge({ status: bot({ target_url: 'https://example.com/x' }), run: null }), /names no run/);
  });

  it('refuses a status from any account but a person or GitHub Actions', () => {
    assert.match(judge({ status: bot({ creator: { login: 'some-app[bot]', type: 'Bot' } }) }), /some-app\[bot\]/);
  });

  it('refuses a run that tested another commit', () => {
    assert.match(judge({ run: prRun({ head_sha: 'c'.repeat(40) }) }), /tested ccccccc, not aaaaaaa/);
    assert.match(judge({ run: dispatched({ display_title: `PR QA #21 at ${'c'.repeat(40)} lap 2 ` }) }), /tested ccccccc, not aaaaaaa/);
  });

  it('refuses a run that did not pass, or has not finished', () => {
    assert.match(judge({ run: prRun({ conclusion: 'failure' }) }), /ended failure/);
    assert.match(judge({ run: prRun({ status: 'in_progress', conclusion: null }) }), /still in_progress/);
  });

  it("refuses a lap dispatched on another branch, whose pr-qa.yml is not the default branch's", () => {
    assert.match(judge({ run: dispatched({ head_branch: 'feature' }) }), /dispatched on feature/);
  });

  it('refuses a run started by any other event', () => {
    assert.match(judge({ run: prRun({ event: 'push' }) }), /push/);
  });

  // In the cloud the tester cannot write a status, only its review.
  it("refuses when the tester's latest review of this head is a failure, whoever wrote the status", () => {
    assert.match(judge({ testerReview: 'failure' }), /review of aaaaaaa is a failure/);
    assert.match(judge({ status: owner(), run: null, testerReview: 'failure' }), /failure/);
    assert.equal(judge({ testerReview: 'success' }), null);
  });
});

describe('agent-review provenance — the tester verdict in the PR reviews', () => {
  const review = (commit_id, body, type = 'User', submitted_at = '2026-10-07T10:00:00Z') => ({ commit_id, body, type, submitted_at });

  it("reads the newest of a person's Verdict reviews on the commit", () => {
    const reviews = [review(SHA, 'Verdict: success (agent-review on aaaaaaa, lap 1)', 'User', '2026-10-07T09:00:00Z'), review(SHA, 'Verdict: failure (agent-review on aaaaaaa, lap 2)')];
    assert.equal(testerVerdict(reviews, SHA), 'failure');
  });

  it('ignores reviews of other commits, other comments, and any written by a bot', () => {
    assert.equal(testerVerdict([review('c'.repeat(40), 'Verdict: failure (x)'), review(SHA, 'Looks fine'), review(SHA, 'Verdict: success (x)', 'Bot')], SHA), null);
  });
});

describe('agent-review provenance — reading it from GitHub', () => {
  const routes = (over = {}) => ({
    [`commits/${SHA}/statuses`]: JSON.stringify([bot(), owner({ state: 'failure' })]),
    'actions/runs/123': JSON.stringify(prRun()),
    'pulls/21/files': `${JSON.stringify({ filename: 'a.ts', previous_filename: null })}\n${JSON.stringify({ filename: QA_WORKFLOW_PATH, previous_filename: null })}`,
    'pulls/21/reviews': JSON.stringify({ commit_id: SHA, body: 'Verdict: success (x)', type: 'User', submitted_at: '2026-10-07T10:00:00Z' }),
    'repos/{owner}/{repo} ': JSON.stringify({ branch: 'main' }),
    ...over,
  });
  const fake =
    (table, calls = []) =>
    async (args) => {
      calls.push(args.join(' '));
      const key = Object.keys(table).find((k) => `${args.join(' ')} `.includes(k));
      if (!key) return { code: 1, stdout: '', stderr: `no route for ${args.join(' ')}` };
      return table[key] === null ? { code: 1, stdout: '', stderr: 'HTTP 502' } : { code: 0, stdout: table[key], stderr: '' };
    };

  it('reads the newest agent-review status, its run, the files, the reviews and the default branch', async () => {
    const state = await readProvenance({ pr: 21, shas: [SHA], gh: fake(routes()) });
    assert.equal(state.qaWorkflowChanged, true);
    assert.equal(state.defaultBranch, 'main');
    assert.equal(state.bySha[SHA].status.creator.login, 'github-actions[bot]');
    assert.equal(state.bySha[SHA].run.path, QA_WORKFLOW_PATH);
    assert.equal(state.bySha[SHA].testerReview, 'success');
  });

  it('counts a rename away from pr-qa.yml as changing it', async () => {
    const state = await readProvenance({ pr: 21, shas: [SHA], gh: fake(routes({ 'pulls/21/files': JSON.stringify({ filename: 'x.yml', previous_filename: QA_WORKFLOW_PATH }) })) });
    assert.equal(state.qaWorkflowChanged, true);
  });

  it("counts a file list at GitHub's cap as changing pr-qa.yml, since the edit may be past it", async () => {
    const many = Array.from({ length: 3000 }, (_, i) => JSON.stringify({ filename: `f${i}.ts`, previous_filename: null })).join('\n');
    const state = await readProvenance({ pr: 21, shas: [SHA], gh: fake(routes({ 'pulls/21/files': many })) });
    assert.equal(state.qaWorkflowChanged, true);
  });

  it('reads no run for a status written by a person', async () => {
    const calls = [];
    const state = await readProvenance({ pr: 21, shas: [SHA], gh: fake(routes({ [`commits/${SHA}/statuses`]: JSON.stringify([owner()]) }), calls) });
    assert.equal(state.bySha[SHA].run, null);
    assert.ok(!calls.some((c) => c.includes('actions/runs/')));
  });

  it('throws when any read fails, so the gate refuses', async () => {
    await assert.rejects(readProvenance({ pr: 21, shas: [SHA], gh: fake(routes({ 'actions/runs/123': null })) }), /HTTP 502/);
    await assert.rejects(readProvenance({ pr: 21, shas: [SHA], gh: fake(routes({ 'pulls/21/files': null })) }), /HTTP 502/);
  });
});
