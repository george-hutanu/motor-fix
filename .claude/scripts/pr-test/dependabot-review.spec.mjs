import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

import { DESCRIPTION, main } from './dependabot-review.mjs';

const HEAD = 'c'.repeat(40);
const API = 'https://api.github.com/repos/george-hutanu/motor-fix';
const RUN_URL = 'https://github.com/george-hutanu/motor-fix/actions/runs/9';
const env = { GITHUB_TOKEN: 't0ken', GITHUB_REPOSITORY: 'george-hutanu/motor-fix', RUN_URL };
const botCommit = (over = {}) => ({ sha: HEAD, author: { login: 'dependabot[bot]' }, committer: { login: 'web-flow' }, commit: { verification: { verified: true } }, ...over });

/** A fake fetch answering GETs from `routes` (path after the repo → body, or a status number), recording every call. */
function fakeFetch({ author = 'dependabot[bot]', commits = [botCommit()], statuses = [], fail = {} } = {}) {
  const calls = [];
  const routes = { '/pulls/7': { user: { login: author }, head: { sha: HEAD } }, '/pulls/7/commits?per_page=100': commits, [`/commits/${HEAD}/statuses?per_page=100&page=1`]: statuses };
  const fetch = async (url, init = {}) => {
    calls.push({ url, method: init.method ?? 'GET', headers: init.headers, body: init.body ? JSON.parse(init.body) : undefined });
    const path = url.slice(API.length);
    if (fail[path]) return { ok: false, status: fail[path], json: async () => ({}), text: async () => 'boom' };
    if ((init.method ?? 'GET') === 'POST') return { ok: true, status: 201, json: async () => ({}), text: async () => '' };
    if (!(path in routes)) return { ok: false, status: 404, json: async () => ({}), text: async () => 'not found' };
    return { ok: true, status: 200, json: async () => routes[path], text: async () => JSON.stringify(routes[path]) };
  };
  return { calls, fetch };
}

const run = async (opts) => {
  const lines = [];
  const f = fakeFetch(opts);
  const code = await main(['7'], { fetch: f.fetch, env, log: (l) => lines.push(l) });
  return { code, lines: lines.join('\n'), posts: f.calls.filter((c) => c.method === 'POST'), calls: f.calls };
};

describe('dependabot-review: the agent-review a Dependabot-only PR gets from a workflow', () => {
  // @traces 961-FR-002
  // @traces 961-FR-003
  it('posts one agent-review success on the head of an exempt PR, naming the exemption and the run', async () => {
    const { code, posts, calls } = await run();
    assert.equal(code, 0);
    assert.equal(posts.length, 1);
    assert.equal(posts[0].url, `${API}/statuses/${HEAD}`);
    assert.deepEqual(posts[0].body, { state: 'success', context: 'agent-review', description: DESCRIPTION, target_url: RUN_URL });
    assert.match(DESCRIPTION, /Dependabot/);
    assert.ok(calls.every((c) => c.headers?.authorization === 'Bearer t0ken'));
  });

  // @traces 961-FR-002
  it('posts nothing for a PR someone else opened, and says so', async () => {
    const { code, posts, lines } = await run({ author: 'george-hutanu' });
    assert.equal(code, 0);
    assert.equal(posts.length, 0);
    assert.match(lines, /george-hutanu/);
  });

  // @traces 961-FR-002
  it('posts nothing when a commit is not Dependabot\'s, and names that commit', async () => {
    const human = botCommit({ sha: 'd'.repeat(40), author: { login: 'george-hutanu' }, committer: { login: 'george-hutanu' } });
    const { code, posts, lines } = await run({ commits: [botCommit(), human] });
    assert.equal(code, 0);
    assert.equal(posts.length, 0);
    assert.match(lines, /ddddddd/);
    const unsigned = await run({ commits: [botCommit({ commit: { verification: { verified: false } } })] });
    assert.equal(unsigned.posts.length, 0);
    assert.match(unsigned.lines, /ccccccc/);
  });

  // @traces 961-FR-002
  it('never writes over an agent-review already on the head, whatever its state', async () => {
    for (const state of ['failure', 'pending', 'success']) {
      const { code, posts, lines } = await run({ statuses: [{ context: 'agent-review', state }] });
      assert.equal(code, 0);
      assert.equal(posts.length, 0, state);
      assert.match(lines, new RegExp(`already has agent-review ${state}`));
    }
  });

  // @traces 961-FR-003
  it('fails, posting nothing, when GitHub cannot be read', async () => {
    const { code, posts, lines } = await run({ fail: { '/pulls/7/commits?per_page=100': 502 } });
    assert.equal(code, 1);
    assert.equal(posts.length, 0);
    assert.match(lines, /502/);
  });

  it('refuses a missing PR number or token', async () => {
    const lines = [];
    assert.equal(await main([], { fetch: fakeFetch().fetch, env, log: (l) => lines.push(l) }), 64);
    assert.equal(await main(['7'], { fetch: fakeFetch().fetch, env: { ...env, GITHUB_TOKEN: '' }, log: (l) => lines.push(l) }), 64);
  });
});
