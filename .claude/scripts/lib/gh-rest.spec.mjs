import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { main } from '../gh.mjs';
import { ghRun, ghSync, isCloud } from './gh-rest.mjs';

const CLOUD = { CLAUDE_CODE_REMOTE: 'true' };
const BRANCH = '766-cloud-rest-fallback';
const URL = 'https://github.com/george-hutanu/motor-fix/pull/160';
const REPO = 'repos/{owner}/{repo}/';

const pull = (over = {}) => ({
  number: 160,
  title: 'chore(harness): ST-766 make it work',
  body: 'the body',
  html_url: URL,
  state: 'open',
  draft: true,
  merged_at: null,
  mergeable: true,
  head: { ref: BRANCH, sha: 'head1' },
  base: { ref: 'main' },
  user: { login: 'george-hutanu' },
  labels: [{ name: 'planning' }, { name: 'tooling' }],
  merge_commit_sha: 'merge1',
  ...over,
});

/**
 * A fake GitHub behind `gh api`: routes map "METHOD path" (without the
 * repos/{owner}/{repo}/ prefix) to a JSON answer, a function of the request
 * body, or { code, stderr }. Every call is recorded.
 */
function fake(routes = {}, { branch = BRANCH, jq } = {}) {
  const calls = [];
  const run = (file, args, opts = {}) => {
    calls.push({ file, args, input: opts.input });
    if (file === 'git') return { code: 0, stdout: `${branch}\n`, stderr: '' };
    if (file === 'jq') return jq ? jq(args, opts.input) : { code: 127, stdout: '', stderr: 'jq: not found' };
    if (file !== 'gh' || args[0] !== 'api') return { code: 0, stdout: `plain ${args.join(' ')}\n`, stderr: '' };
    const path = args[1].replace(REPO, '');
    const method = args[args.indexOf('-X') + 1];
    const key = `${method} ${path}`;
    if (!(key in routes)) return { code: 1, stdout: '', stderr: `gh: Not Found (HTTP 404) ${key}` };
    const hit = routes[key];
    if (hit && typeof hit === 'object' && 'code' in hit) return { stdout: '', stderr: '', ...hit };
    const body = typeof hit === 'function' ? hit(opts.input ? JSON.parse(opts.input) : null) : hit;
    const out = args.includes('--slurp') ? [body] : body;
    return { code: 0, stdout: JSON.stringify(out ?? null), stderr: '' };
  };
  const api = () => calls.filter((c) => c.file === 'gh').map((c) => `${c.args[c.args.indexOf('-X') + 1]} ${c.args[1].replace(REPO, '')}`);
  return { run, calls, api };
}

const byBranch = (pulls) => ({ [`GET pulls?head={owner}:${BRANCH}&state=all&per_page=100`]: pulls });
const gh = (args, f, env = CLOUD, extra = {}) => ghRun(args, { run: f.run, env, sleep: () => {}, ...extra });

describe('isCloud', () => {
  it('is true only for CLAUDE_CODE_REMOTE=true', () => {
    assert.equal(isCloud(CLOUD), true);
    assert.equal(isCloud({}), false);
    assert.equal(isCloud({ CLAUDE_CODE_REMOTE: '1' }), false);
  });
});

// @traces 1323-FR-001
describe('outside the cloud', () => {
  const graphqlDown = (routes) => {
    const f = fake(routes);
    const run = (file, args, opts) =>
      file === 'gh' && args[0] !== 'api' ? (f.calls.push({ file, args }), { code: 1, stdout: '', stderr: 'GraphQL: API rate limit already exceeded for user ID 1.' }) : f.run(file, args, opts);
    return { ...f, run };
  };

  it('reads pr view, list and checks over REST, so a spent GraphQL quota does not stop them', () => {
    const f = graphqlDown({
      ...byBranch([pull()]),
      'GET pulls/160': pull(),
      'GET commits/head1/check-runs?per_page=100': { check_runs: [{ name: 'CI OK', status: 'completed', conclusion: 'success' }] },
      'GET commits/head1/status': { statuses: [] },
      [`GET pulls?head={owner}:${BRANCH}&state=open&per_page=100`]: [pull()],
    });
    assert.equal(gh(['pr', 'view', '160', '--json', 'state,mergeable', '-q', '.mergeable'], f, {}).stdout, 'MERGEABLE\n');
    assert.equal(gh(['pr', 'list', '--head', BRANCH, '--json', 'number', '-q', '.[0].number'], f, {}).stdout, '160\n');
    const checks = gh(['pr', 'checks', '160', '--json', 'name,bucket'], f, {});
    assert.equal(checks.code, 0, checks.stderr);
    assert.deepEqual(JSON.parse(checks.stdout), [{ name: 'CI OK', bucket: 'pass' }]);
    assert.deepEqual(f.calls.filter((c) => c.file === 'gh' && c.args[0] !== 'api'), []);
  });

  it('fails on a --json field it does not read, as gh does, never answering null', () => {
    const f = fake({ 'GET pulls/160': pull() });
    const r = gh(['pr', 'view', '160', '--json', 'state,reviewDecision'], f, {});
    assert.equal(r.code, 1);
    assert.match(r.stderr, /Unknown JSON field: "reviewDecision"/);
  });

  for (const args of [['pr', 'create', '--draft', '--title', 't'], ['pr', 'ready', '160'], ['pr', 'comment', '160', '--body', 'b'], ['pr', 'edit', '160', '--add-label', 'QA'], ['label', 'create', 'QA']]) {
    it(`runs gh ${args.slice(0, 2).join(' ')} exactly as asked`, () => {
      const f = fake();
      const r = gh(args, f, {});
      assert.deepEqual(f.calls, [{ file: 'gh', args, input: undefined }]);
      assert.equal(r.stdout, `plain ${args.join(' ')}\n`);
    });
  }
});

describe('in the cloud, commands it does not translate', () => {
  for (const args of [['pr', 'merge', '160', '--merge'], ['api', 'repos/{owner}/{repo}/pulls'], ['run', 'list'], ['workflow', 'run', 'pr-qa.yml']]) {
    it(`passes gh ${args.slice(0, 2).join(' ')} through`, () => {
      const f = fake();
      gh(args, f);
      assert.deepEqual(f.calls.map((c) => [c.file, c.args]), [['gh', args]]);
    });
  }
});

describe('pr list', () => {
  it('lists the open PRs of a head branch and applies --jq', () => {
    const f = fake({ [`GET pulls?head={owner}:${BRANCH}&state=open&per_page=100`]: [pull()] });
    const r = gh(['pr', 'list', '--head', BRANCH, '--state', 'open', '--json', 'number', '--jq', '.[0].number'], f);
    assert.equal(r.code, 0);
    assert.equal(r.stdout, '160\n');
  });

  it('prints an empty line when the branch has no PR', () => {
    const f = fake({ [`GET pulls?head={owner}:${BRANCH}&state=open&per_page=100`]: [] });
    const r = gh(['pr', 'list', '--head', BRANCH, '--state', 'open', '--json', 'number', '--jq', '.[0].number'], f);
    assert.deepEqual([r.code, r.stdout], [0, '\n']);
  });
});

describe('pr view', () => {
  it('finds the PR by branch and prints only the asked fields, in GraphQL shape', () => {
    const f = fake({ ...byBranch([pull()]), 'GET pulls/160': pull() });
    const r = gh(['pr', 'view', BRANCH, '--json', 'number,title,isDraft,url,state,labels,author,headRefName,headRefOid,mergeable'], f);
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout), {
      number: 160,
      title: 'chore(harness): ST-766 make it work',
      isDraft: true,
      url: URL,
      state: 'OPEN',
      labels: [{ name: 'planning' }, { name: 'tooling' }],
      author: { login: 'george-hutanu' },
      headRefName: BRANCH,
      headRefOid: 'head1',
      mergeable: 'MERGEABLE',
    });
  });

  it('prefers the open PR of a branch over a closed one', () => {
    const f = fake({ ...byBranch([pull({ number: 150, state: 'closed' }), pull()]), 'GET pulls/160': pull() });
    assert.equal(JSON.parse(gh(['pr', 'view', BRANCH, '--json', 'number'], f).stdout).number, 160);
  });

  it('reads the current branch when no PR is named', () => {
    const f = fake({ ...byBranch([pull()]), 'GET pulls/160': pull() });
    const r = gh(['pr', 'view', '--json', 'number', '-q', '.number'], f);
    assert.equal(r.stdout, '160\n');
    assert.deepEqual(f.calls[0].args, ['rev-parse', '--abbrev-ref', 'HEAD']);
  });

  it('takes a number or a PR URL', () => {
    for (const sel of ['160', URL]) {
      const f = fake({ 'GET pulls/160': pull() });
      assert.equal(gh(['pr', 'view', sel, '--json', 'url', '-q', '.url'], f).stdout, `${URL}\n`);
      assert.deepEqual(f.api(), ['GET pulls/160']);
    }
  });

  it('maps merged, closed and mergeability like GraphQL', () => {
    const cases = [
      [{ state: 'closed', merged_at: '2026-10-06T00:00:00Z', mergeable: null }, 'MERGED', 'UNKNOWN'],
      [{ state: 'closed', mergeable: false }, 'CLOSED', 'CONFLICTING'],
    ];
    for (const [over, state, mergeable] of cases) {
      const f = fake({ 'GET pulls/160': pull(over) });
      assert.deepEqual(JSON.parse(gh(['pr', 'view', '160', '--json', 'state,mergeable'], f).stdout), { state, mergeable });
    }
  });

  it('prints the merge commit through --jq', () => {
    const f = fake({ 'GET pulls/160': pull() });
    assert.equal(gh(['pr', 'view', '160', '--json', 'mergeCommit', '--jq', '.mergeCommit.oid'], f).stdout, 'merge1\n');
  });

  it('reads every page of comments', () => {
    const f = fake({
      'GET pulls/160': pull(),
      'GET issues/160/comments?per_page=100': [
        { user: { login: 'george-hutanu' }, body: 'one', created_at: '2026-10-06T01:00:00Z' },
        { user: { login: 'github-actions[bot]' }, body: 'two', created_at: '2026-10-06T02:00:00Z' },
      ],
    });
    const r = gh(['pr', 'view', '160', '--json', 'comments'], f);
    assert.deepEqual(JSON.parse(r.stdout).comments, [
      { author: { login: 'george-hutanu' }, body: 'one', createdAt: '2026-10-06T01:00:00Z' },
      { author: { login: 'github-actions[bot]' }, body: 'two', createdAt: '2026-10-06T02:00:00Z' },
    ]);
    const call = f.calls.find((c) => c.args[1].includes('comments'));
    assert.ok(call.args.includes('--paginate') && call.args.includes('--slurp'));
  });

  it('reads the commits with their authors', () => {
    const f = fake({
      'GET pulls/160': pull(),
      'GET pulls/160/commits?per_page=100': [{ sha: 'c1', author: { login: 'dependabot[bot]' }, commit: { author: { name: 'dependabot[bot]', email: 'd@x' } } }],
    });
    assert.deepEqual(JSON.parse(gh(['pr', 'view', '160', '--json', 'commits'], f).stdout).commits, [
      { oid: 'c1', authors: [{ login: 'dependabot[bot]', name: 'dependabot[bot]', email: 'd@x' }] },
    ]);
  });

  it('builds statusCheckRollup from the head commit check runs and statuses', () => {
    const f = fake({
      'GET pulls/160': pull(),
      'GET commits/head1/check-runs?per_page=100': { check_runs: [{ name: 'CI OK', status: 'completed', conclusion: 'success' }, { name: 'Unit tests', status: 'in_progress', conclusion: null }] },
      'GET commits/head1/status': { statuses: [{ context: 'agent-review', state: 'success' }] },
    });
    assert.deepEqual(JSON.parse(gh(['pr', 'view', '160', '--json', 'statusCheckRollup'], f).stdout).statusCheckRollup, [
      { __typename: 'CheckRun', name: 'CI OK', status: 'COMPLETED', conclusion: 'SUCCESS', workflowName: '' },
      { __typename: 'CheckRun', name: 'Unit tests', status: 'IN_PROGRESS', conclusion: '', workflowName: '' },
      { __typename: 'StatusContext', context: 'agent-review', state: 'SUCCESS' },
    ]);
  });

  // @traces 1344-FR-010
  it("gives each CheckRun its workflow's name, empty when the runs cannot be read", () => {
    const checks = { check_runs: [{ name: 'CI OK', status: 'completed', conclusion: 'success', check_suite: { id: 4 } }, { name: 'scripts', status: 'queued', conclusion: null, check_suite: { id: 9 } }] };
    const f = fake({
      'GET pulls/160': pull(),
      'GET commits/head1/check-runs?per_page=100': checks,
      'GET commits/head1/status': { statuses: [] },
      'GET actions/runs?head_sha=head1&per_page=100': { workflow_runs: [{ check_suite_id: 4, name: 'CI' }, { check_suite_id: 9, name: 'Mutation' }] },
    });
    assert.deepEqual(
      JSON.parse(gh(['pr', 'view', '160', '--json', 'statusCheckRollup'], f).stdout).statusCheckRollup.map((c) => c.workflowName),
      ['CI', 'Mutation'],
    );
    const down = fake({ 'GET pulls/160': pull(), 'GET commits/head1/check-runs?per_page=100': checks, 'GET commits/head1/status': { statuses: [] } });
    assert.deepEqual(
      JSON.parse(gh(['pr', 'view', '160', '--json', 'statusCheckRollup'], down).stdout).statusCheckRollup.map((c) => c.workflowName),
      ['', ''],
    );
  });

  it('answers a branch with no PR the way gh does', () => {
    const f = fake(byBranch([]));
    const r = gh(['pr', 'view', BRANCH, '--json', 'number'], f);
    assert.equal(r.code, 1);
    assert.match(r.stderr, new RegExp(`no pull requests found for branch "${BRANCH}"`));
  });

  it('passes a REST failure on as exit 1 with its message', () => {
    const f = fake({ 'GET pulls/160': { code: 1, stderr: 'gh: Server Error (HTTP 502)' } });
    const r = gh(['pr', 'view', '160', '--json', 'number'], f);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /HTTP 502/);
  });

  it('exits 1 instead of throwing on an answer it cannot parse or a body file it cannot read', () => {
    const f = fake();
    const garbled = (file, args) => (file === 'gh' ? { code: 0, stdout: '<html>proxy error</html>', stderr: '' } : f.run(file, args));
    const r = ghRun(['pr', 'view', '160', '--json', 'number'], { run: garbled, env: CLOUD });
    assert.equal(r.code, 1);
    assert.match(r.stderr, /JSON/);
    const missing = gh(['pr', 'edit', '160', '--body-file', '/nonexistent/body.md'], f);
    assert.equal(missing.code, 1);
    assert.match(missing.stderr, /ENOENT/);
  });
});

describe('pr create, edit, ready, comment', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gh-rest-'));
  const bodyFile = join(dir, 'body.md');
  writeFileSync(bodyFile, '## Why\n\nbecause\n');

  it('creates the draft, labels it and prints its URL', () => {
    const f = fake({ 'POST pulls': (b) => ({ ...pull(), echo: b }), 'POST issues/160/labels': [] });
    const r = gh(['pr', 'create', '--draft', '--base', 'main', '--head', BRANCH, '--title', 'T', '--body-file', bodyFile, '--label', 'planning', '--label', 'scope: harness'], f);
    assert.deepEqual([r.code, r.stdout], [0, `${URL}\n`]);
    const [create, labels] = f.calls.filter((c) => c.file === 'gh');
    assert.deepEqual(JSON.parse(create.input), { title: 'T', head: BRANCH, base: 'main', body: '## Why\n\nbecause\n', draft: true });
    assert.deepEqual(JSON.parse(labels.input), { labels: ['planning', 'scope: harness'] });
  });

  it('edits the body and title, adds labels and removes them, ignoring one the PR lacks', () => {
    const f = fake({
      'PATCH pulls/160': pull(),
      'POST issues/160/labels': [],
      'DELETE issues/160/labels/in%20development': { code: 1, stderr: 'gh: Label does not exist (HTTP 404)' },
      'DELETE issues/160/labels/planning': [],
    });
    const r = gh(['pr', 'edit', '160', '--body-file', bodyFile, '--title', 'New', '--add-label', 'QA', '--remove-label', 'in development', '--remove-label', 'planning'], f);
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(f.api(), ['PATCH pulls/160', 'POST issues/160/labels', 'DELETE issues/160/labels/in%20development', 'DELETE issues/160/labels/planning']);
    assert.deepEqual(JSON.parse(f.calls[0].input), { body: '## Why\n\nbecause\n', title: 'New' });
    assert.deepEqual(JSON.parse(f.calls[1].input), { labels: ['QA'] });
  });

  it('stops on any other label removal failure', () => {
    const f = fake({ 'DELETE issues/160/labels/planning': { code: 1, stderr: 'gh: Server Error (HTTP 500)' } });
    assert.equal(gh(['pr', 'edit', '160', '--remove-label', 'planning'], f).code, 1);
  });

  it('marks the PR ready through the cloud route', () => {
    const f = fake({ 'POST pulls/160/ccr/ready_for_review': {} });
    assert.equal(gh(['pr', 'ready', '160'], f).code, 0);
    assert.deepEqual(f.api(), ['POST pulls/160/ccr/ready_for_review']);
  });

  it('comments from a file or a string', () => {
    for (const [flag, value, body] of [['--body-file', bodyFile, '## Why\n\nbecause\n'], ['--body', 'Blocked: x', 'Blocked: x']]) {
      const f = fake({ 'POST issues/160/comments': { html_url: `${URL}#c` } });
      const r = gh(['pr', 'comment', '160', flag, value], f);
      assert.equal(r.code, 0);
      assert.deepEqual(JSON.parse(f.calls[0].input), { body });
    }
  });

  it('creates a label, and with --force updates one that exists', () => {
    const exists = { 'POST labels': { code: 1, stderr: 'gh: Validation Failed (HTTP 422)' }, 'PATCH labels/scope%3A%20harness': {} };
    assert.equal(gh(['label', 'create', 'scope: harness', '--force'], fake(exists)).code, 0);
    assert.equal(gh(['label', 'create', 'scope: harness'], fake(exists)).code, 1);
    const f = fake({ 'POST labels': {} });
    assert.equal(gh(['label', 'create', 'EP-1', '--force'], f).code, 0);
    assert.deepEqual(JSON.parse(f.calls[0].input), { name: 'EP-1' });
  });
});

describe('pr checks', () => {
  const routes = (runs, statuses = []) => ({
    'GET pulls/160': pull(),
    'GET commits/head1/check-runs?per_page=100': { check_runs: runs },
    'GET commits/head1/status': { statuses },
  });
  const run = (name, status, conclusion = null) => ({ name, status, conclusion, html_url: `https://x/${name}` });

  it('buckets every check like gh and exits 0 when all passed or skipped', () => {
    const f = fake(routes([run('Biome', 'completed', 'success'), run('Mutation', 'completed', 'skipped'), run('Lint', 'completed', 'neutral')], [{ context: 'agent-review', state: 'success' }]));
    const r = gh(['pr', 'checks', '160', '--json', 'name,bucket'], f);
    assert.equal(r.code, 0);
    assert.deepEqual(JSON.parse(r.stdout), [
      { name: 'Biome', bucket: 'pass' },
      { name: 'Mutation', bucket: 'skipping' },
      { name: 'Lint', bucket: 'skipping' },
      { name: 'agent-review', bucket: 'pass' },
    ]);
  });

  it('exits 1 on a failure and 8 while one is pending', () => {
    const failed = fake(routes([run('Biome', 'completed', 'failure'), run('Build', 'completed', 'cancelled')]));
    const r = gh(['pr', 'checks', '160', '--json', 'name,bucket'], failed);
    assert.equal(r.code, 1);
    assert.deepEqual(JSON.parse(r.stdout).map((c) => c.bucket), ['fail', 'cancel']);
    const pending = fake(routes([run('Biome', 'completed', 'failure'), run('E2E', 'queued')], [{ context: 'agent-review', state: 'pending' }]));
    assert.equal(gh(['pr', 'checks', '160'], pending).code, 8);
  });

  it('keeps only the latest run of a check in the same workflow, like gh', () => {
    // A re-triggered workflow cancels its earlier run: both stay on the commit.
    const at = (c, suite, started_at) => ({ ...c, check_suite: { id: suite }, started_at });
    const f = fake({
      ...routes([
        at(run('body', 'completed', 'success'), 2, '2026-10-06T17:54:52Z'),
        at(run('body', 'completed', 'cancelled'), 1, '2026-10-06T17:54:47Z'),
        at(run('body', 'completed', 'failure'), 3, '2026-10-06T17:50:00Z'),
        at(run('Biome', 'completed', 'success'), 4, '2026-10-06T17:54:00Z'),
      ]),
      'GET actions/runs?head_sha=head1&per_page=100': {
        workflow_runs: [
          { check_suite_id: 1, name: 'PR template' },
          { check_suite_id: 2, name: 'PR template' },
          { check_suite_id: 3, name: 'Other' },
          { check_suite_id: 4, name: 'CI' },
        ],
      },
    });
    const r = gh(['pr', 'checks', '160', '--json', 'name,bucket'], f);
    assert.deepEqual(JSON.parse(r.stdout), [
      { name: 'body', bucket: 'pass' },
      { name: 'body', bucket: 'fail' },
      { name: 'Biome', bucket: 'pass' },
    ]);
    assert.equal(r.code, 1);
  });

  it('keeps every run when the workflows cannot be read', () => {
    const at = (c, suite, started_at) => ({ ...c, check_suite: { id: suite }, started_at });
    const f = fake(routes([at(run('body', 'completed', 'success'), 2, '2026-10-06T17:54:52Z'), at(run('body', 'completed', 'cancelled'), 1, '2026-10-06T17:54:47Z')]));
    const r = gh(['pr', 'checks', '160', '--json', 'name,bucket'], f);
    assert.deepEqual(JSON.parse(r.stdout).map((c) => c.bucket), ['pass', 'cancel']);
    assert.equal(r.code, 1);
  });

  // @traces 1344-FR-010
  it("names each check's workflow under --json from the suite map, even when no name repeats", () => {
    const at = (c, suite) => ({ ...c, check_suite: { id: suite } });
    const f = fake({
      ...routes([at(run('Biome', 'completed', 'success'), 4), at(run('scripts', 'in_progress'), 9), at(run('lone', 'completed', 'success'), 7)], [{ context: 'agent-review', state: 'success' }]),
      'GET actions/runs?head_sha=head1&per_page=100': { workflow_runs: [{ check_suite_id: 4, name: 'CI' }, { check_suite_id: 9, name: 'Mutation' }] },
    });
    const r = gh(['pr', 'checks', '160', '--json', 'name,workflow'], f);
    assert.deepEqual(JSON.parse(r.stdout), [
      { name: 'Biome', workflow: 'CI' },
      { name: 'scripts', workflow: 'Mutation' },
      { name: 'lone', workflow: '' },
      { name: 'agent-review', workflow: '' },
    ]);
  });

  // @traces 1344-FR-010
  it('names no workflow when the runs cannot be read, keeping every check (fail open)', () => {
    const f = fake({ ...routes([run('Biome', 'completed', 'success')]), 'GET actions/runs?head_sha=head1&per_page=100': { code: 1, stderr: 'gh: HTTP 502' } });
    const r = gh(['pr', 'checks', '160', '--json', 'name,workflow'], f);
    assert.deepEqual(JSON.parse(r.stdout), [{ name: 'Biome', workflow: '' }]);
  });

  // @traces 1230-FR-010
  it("carries each check's link under --json, a status's target URL included, as gh does", () => {
    const f = fake(routes([run('Biome', 'completed', 'success')], [{ context: 'agent-review', state: 'pending', target_url: 'https://github.com/o/r/actions/runs/77' }]));
    const r = gh(['pr', 'checks', '160', '--json', 'name,bucket,link'], f);
    assert.deepEqual(JSON.parse(r.stdout), [
      { name: 'Biome', bucket: 'pass', link: 'https://x/Biome' },
      { name: 'agent-review', bucket: 'pending', link: 'https://github.com/o/r/actions/runs/77' },
    ]);
  });

  it('prints name, bucket and link per line without --json', () => {
    const f = fake(routes([run('Biome', 'completed', 'success')]));
    assert.equal(gh(['pr', 'checks', '160'], f).stdout, 'Biome\tpass\thttps://x/Biome\n');
  });

  it('says so when nothing is reported', () => {
    const r = gh(['pr', 'checks', '160'], fake(routes([])));
    assert.equal(r.code, 1);
    assert.match(r.stderr, /no checks reported on the '766-cloud-rest-fallback' branch/);
  });

  it('hands a --jq beyond a plain path to the jq binary', () => {
    const seen = [];
    const f = fake(routes([run('Biome', 'completed', 'failure')]), {
      jq: (args, input) => {
        seen.push([args, JSON.parse(input)]);
        return { code: 0, stdout: 'Biome: fail\n', stderr: '' };
      },
    });
    const expr = '.[] | select(.bucket != "pass") | "\\(.name): \\(.bucket)"';
    const r = gh(['pr', 'checks', '160', '--json', 'name,bucket', '--jq', expr], f);
    assert.equal(r.stdout, 'Biome: fail\n');
    assert.deepEqual(seen, [[['-r', expr], [{ name: 'Biome', bucket: 'fail' }]]]);
  });

  it('names jq when it is missing', () => {
    const r = gh(['pr', 'checks', '160', '--json', 'name', '--jq', '.[] | .name'], fake(routes([run('Biome', 'completed', 'success')])));
    assert.equal(r.code, 1);
    assert.match(r.stderr, /jq/);
  });

  it('--watch polls every 10 s until nothing is pending', () => {
    let lap = 0;
    const sleeps = [];
    const f = fake({
      'GET pulls/160': pull(),
      'GET commits/head1/check-runs?per_page=100': () => ({ check_runs: [lap++ < 2 ? run('E2E', 'in_progress') : run('E2E', 'completed', 'success')] }),
      'GET commits/head1/status': { statuses: [] },
    });
    const r = gh(['pr', 'checks', '160', '--watch'], f, CLOUD, { sleep: (ms) => sleeps.push(ms) });
    assert.equal(r.code, 0);
    assert.deepEqual(sleeps, [10000, 10000]);
    assert.equal(r.stdout, 'E2E\tpass\thttps://x/E2E\n');
  });
});

describe('ghSync', () => {
  it('returns stdout, or throws with gh exit status and stderr', () => {
    const ok = fake({ 'GET pulls/160': pull() });
    assert.equal(ghSync(['pr', 'view', '160', '--json', 'url', '-q', '.url'], { run: ok.run, env: CLOUD }), `${URL}\n`);
    const none = fake(byBranch([]));
    assert.throws(
      () => ghSync(['pr', 'view', BRANCH, '--json', 'number'], { run: none.run, env: CLOUD }),
      (err) => err.status === 1 && /no pull requests found/.test(err.stderr),
    );
  });
});

describe('gh.mjs', () => {
  it('passes stdout, stderr and the exit code through', () => {
    const out = [];
    const err = [];
    const io = { run: fake(byBranch([])).run, env: CLOUD, stdout: (s) => out.push(s), stderr: (s) => err.push(s), sleep: () => {} };
    assert.equal(main(['pr', 'view', BRANCH, '--json', 'number'], io), 1);
    assert.deepEqual(out, []);
    assert.match(err.join(''), /no pull requests found/);
    const ok = { ...io, run: fake({ 'GET pulls/160': pull() }).run };
    assert.equal(main(['pr', 'view', '160', '--json', 'number', '-q', '.number'], ok), 0);
    assert.deepEqual(out, ['160\n']);
  });
});
