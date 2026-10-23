// @traces 1363-FR-003
// The tail runs `ci-wait.mjs <n>` itself (tail.md "The wait"): the wait reads
// the PR's head from the PR on every poll and judges only that commit's checks,
// keeping the one started last of each, so an older head's green never reads
// as green for a newer head. Pins the rule the tail now leans on.
import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

import { ghRun } from '../lib/gh-rest.mjs';
import { waitForCi } from './ci-wait.mjs';

const pull = (sha) => ({ number: 495, title: 't', body: '', html_url: 'u', state: 'open', draft: false, merged_at: null, mergeable: true, head: { ref: 'b', sha }, base: { ref: 'main' }, user: { login: 'x' }, labels: [], merge_commit_sha: null });
const job = (name, conclusion, started_at, id) => ({
  id,
  name,
  status: 'completed',
  conclusion,
  started_at,
  check_suite: { id: 8 },
  html_url: `https://x/${id}`,
  details_url: `https://github.com/george-hutanu/motor-fix/actions/runs/101/job/${id}`,
});
const green = [job('CI OK', 'success', '2026-10-23T10:00:00Z', 1), job('Unit tests', 'success', '2026-10-23T10:00:00Z', 2)];

function github(head, checks) {
  const read = [];
  const routes = { 'pulls/495': pull(head) };
  for (const [sha, runs] of Object.entries(checks)) {
    routes[`commits/${sha}/check-runs?per_page=100&filter=all`] = { check_runs: runs };
    routes[`commits/${sha}/status`] = { statuses: [] };
    routes[`actions/runs?head_sha=${sha}&per_page=100`] = { workflow_runs: [{ id: 101, check_suite_id: 8, name: 'CI', status: 'completed' }] };
  }
  const run = (file, args) => {
    if (file !== 'gh' || args[0] !== 'api') return { code: 0, stdout: '', stderr: '' };
    const path = args[1].replace('repos/{owner}/{repo}/', '');
    read.push(path);
    const hit = routes[path];
    if (hit === undefined) return { code: 1, stdout: '', stderr: `gh: Not Found (HTTP 404) ${args[1]}` };
    return { code: 0, stdout: JSON.stringify(args.includes('--slurp') ? [hit] : hit), stderr: '' };
  };
  return { read, gh: async (args) => ghRun(args, { run, env: {}, sleep: () => {} }) };
}

const wait = (gh) => {
  let t = 0;
  return waitForCi({ pr: 495, gh, sleep: async (ms) => void (t += ms), now: () => t, waitMs: 3 * 60_000 });
};

describe('ci-wait <n>: the head is read from the PR, and only its checks count', () => {
  it('reports a newer head\'s failure though the older head is green, and never reads the older head', async () => {
    const { read, gh } = github('head2', { head1: green, head2: [job('CI OK', 'failure', '2026-10-23T11:00:00Z', 3), job('Unit tests', 'failure', '2026-10-23T11:00:00Z', 4)] });
    const out = await wait(gh);
    assert.match(out.lines.join('\n'), /Unit tests: fail/);
    assert.ok(!read.some((p) => p.includes('head1')), read.join('\n'));
  });

  it('keeps the attempt started last of each check on the head', async () => {
    const retried = [job('CI OK', 'success', '2026-10-23T11:05:00Z', 5), job('Unit tests', 'failure', '2026-10-23T11:00:00Z', 6), job('Unit tests', 'success', '2026-10-23T11:05:00Z', 7)];
    assert.deepEqual(await wait(github('head2', { head2: retried }).gh), { code: 0, lines: [] });
    const reverted = [job('CI OK', 'success', '2026-10-23T11:05:00Z', 5), job('Unit tests', 'success', '2026-10-23T11:00:00Z', 6), job('Unit tests', 'failure', '2026-10-23T11:05:00Z', 7)];
    assert.match((await wait(github('head2', { head2: reverted }).gh)).lines.join('\n'), /Unit tests: fail/);
  });
});
