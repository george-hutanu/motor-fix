import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

import { ghRun } from '../lib/gh-rest.mjs';
import { waitForCi } from './ci-wait.mjs';

// The wait as its entry point wires it: every `gh pr …` read goes over REST
// (lib/gh-rest.mjs), here against a fake GitHub whose head's 'PR title'
// attempt 1 stayed in_progress after attempt 2 completed.
const RUN = 39618505833;
const pull = { number: 466, title: 't', body: '', html_url: 'u', state: 'open', draft: false, merged_at: null, mergeable: true, head: { ref: 'b', sha: 'head1' }, base: { ref: 'main' }, user: { login: 'x' }, labels: [], merge_commit_sha: null };
const job = (name, status, conclusion, started_at, id, run = RUN, suite = 7) => ({
  id,
  name,
  status,
  conclusion,
  started_at,
  check_suite: { id: suite },
  html_url: `https://x/${id}`,
  details_url: `https://github.com/george-hutanu/motor-fix/actions/runs/${run}/job/${id}`,
});
const ciOk = job('CI OK', 'completed', 'success', '2026-10-21T14:20:00Z', 1, 101, 8);
const orphan = job('PR title', 'in_progress', null, '2026-10-21T14:37:49Z', 119285437128);
const retried = job('PR title', 'completed', 'success', '2026-10-21T14:43:56Z', 119288507053);

function github(checkRuns, runStatus) {
  const routes = {
    'pulls/466': pull,
    'commits/head1/check-runs?per_page=100&filter=all': { check_runs: checkRuns },
    'commits/head1/status': { statuses: [] },
    'actions/runs?head_sha=head1&per_page=100': {
      workflow_runs: [
        { id: 101, check_suite_id: 8, name: 'CI', status: 'completed' },
        { id: RUN, check_suite_id: 7, name: 'PR title', status: runStatus },
      ],
    },
  };
  const run = (file, args) => {
    if (file !== 'gh' || args[0] !== 'api') return { code: 0, stdout: '', stderr: '' };
    const hit = routes[args[1].replace('repos/{owner}/{repo}/', '')];
    if (hit === undefined) return { code: 1, stdout: '', stderr: `gh: Not Found (HTTP 404) ${args[1]}` };
    return { code: 0, stdout: JSON.stringify(args.includes('--slurp') ? [hit] : hit), stderr: '' };
  };
  return async (args) => ghRun(args, { run, env: {}, sleep: () => {} });
}

const wait = (gh) => {
  let t = 0;
  return waitForCi({ pr: 466, gh, sleep: async (ms) => void (t += ms), now: () => t, waitMs: 3 * 60_000 });
};

describe('ci-wait: an orphaned earlier attempt of a check', () => {
  // @traces 1362-FR-005
  it('ends green when the newer attempt of the same run completed', async () => {
    assert.deepEqual(await wait(github([ciOk, orphan, retried], 'completed')), { code: 0, lines: [] });
  });

  // @traces 1362-FR-005
  it('still waits on a genuinely pending check', async () => {
    const out = await wait(github([ciOk, orphan], 'completed'));
    assert.equal(out.code, 1);
    assert.match(out.lines.join('\n'), /still pending on #466.*PR title/);
    const rerun = job('PR title', 'in_progress', null, '2026-10-21T14:50:00Z', 119290000000);
    const going = await wait(github([ciOk, retried, rerun], 'in_progress'));
    assert.equal(going.code, 1);
  });
});
