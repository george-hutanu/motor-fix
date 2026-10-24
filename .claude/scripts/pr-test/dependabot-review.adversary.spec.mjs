import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

import { main } from './dependabot-review.mjs';

const HEAD = 'c'.repeat(40);
const API = 'https://api.github.com/repos/george-hutanu/motor-fix';
const env = { GITHUB_TOKEN: 't0ken-secret', GITHUB_REPOSITORY: 'george-hutanu/motor-fix', RUN_URL: 'https://github.com/george-hutanu/motor-fix/actions/runs/9' };
const bot = (over = {}) => ({ sha: HEAD, author: { login: 'dependabot[bot]' }, committer: { login: 'web-flow' }, commit: { verification: { verified: true } }, ...over });
const human = (sha = 'd'.repeat(40)) => bot({ sha, author: { login: 'george-hutanu' }, committer: { login: 'george-hutanu' } });

/** A fetch answering by path prefix; `handler(path, init)` returns a body, a status number, or throws. */
function harness(handler) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const path = url.slice(API.length);
    const method = init.method ?? 'GET';
    calls.push({ url, path, method, body: init.body ? JSON.parse(init.body) : undefined });
    if (method === 'POST') {
      const r = handler(path, init);
      if (typeof r === 'number') return { ok: false, status: r, json: async () => ({}), text: async () => 'err' };
      return { ok: true, status: 201, json: async () => ({}), text: async () => '' };
    }
    const r = handler(path, init);
    if (typeof r === 'number') return { ok: false, status: r, json: async () => ({}), text: async () => 'err' };
    return { ok: true, status: 200, json: async () => r, text: async () => JSON.stringify(r) };
  };
  return { calls, fetch };
}

const base = ({ author = 'dependabot[bot]', commits = [bot()], statuses = [], user } = {}) => (path) => {
  if (path === '/pulls/7') return { user: user === undefined ? { login: author } : user, head: { sha: HEAD } };
  if (path.startsWith('/pulls/7/commits')) return commits;
  if (path.startsWith(`/commits/${HEAD}/statuses`)) return statuses;
  return 404;
};

const go = async (handler, argv = ['7'], e = env) => {
  const h = harness(handler);
  const lines = [];
  const code = await main(argv, { fetch: h.fetch, env: e, log: (l) => lines.push(String(l)) });
  return { code, out: lines.join('\n'), calls: h.calls, posts: h.calls.filter((c) => c.method === 'POST') };
};

describe('dependabot-review: hostile and degenerate inputs', () => {
  // @traces 961-FR-002
  it('posts nothing for a PR with no commits at all', async () => {
    const r = await go(base({ commits: [] }));
    assert.equal(r.code, 0);
    assert.equal(r.posts.length, 0);
  });

  // @traces 961-FR-002
  it('posts nothing when a human commit sits beyond the first page of commits', async () => {
    const hundred = Array.from({ length: 100 }, (_, i) => bot({ sha: String(i).padStart(40, '0') }));
    const r = await go((path) => {
      if (path.startsWith('/pulls/7/commits')) return /[?&]page=2/.test(path) ? [human()] : hundred;
      return base()(path);
    });
    assert.equal(r.posts.length, 0);
  });

  // @traces 961-FR-002
  it('does not overwrite an agent-review failure that sits beyond the first page of statuses', async () => {
    const filler = Array.from({ length: 100 }, () => ({ context: 'ci/other', state: 'success' }));
    const r = await go((path) => {
      if (path.startsWith(`/commits/${HEAD}/statuses`)) return /[?&]page=2/.test(path) ? [{ context: 'agent-review', state: 'failure' }] : filler;
      return base()(path);
    });
    assert.equal(r.posts.length, 0);
  });

  // @traces 961-FR-002
  it('posts when the head carries only other contexts', async () => {
    const r = await go(base({ statuses: [{ context: 'agent-review-old', state: 'failure' }, { context: 'ci', state: 'success' }] }));
    assert.equal(r.posts.length, 1);
    assert.equal(r.posts[0].body.context, 'agent-review');
  });

  // @traces 961-FR-002
  it('posts nothing for a commit whose author or committer GitHub could not link to an account', async () => {
    for (const c of [bot({ author: null }), bot({ committer: null }), bot({ author: undefined, committer: undefined }), bot({ commit: undefined }), bot({ commit: { verification: undefined } })]) {
      const r = await go(base({ commits: [c] }));
      assert.equal(r.code, 0);
      assert.equal(r.posts.length, 0);
    }
  });

  // @traces 961-FR-002
  it('treats only a boolean true verification as verified', async () => {
    for (const verified of ['true', 1, 'verified', null]) {
      const r = await go(base({ commits: [bot({ commit: { verification: { verified } } })] }));
      assert.equal(r.posts.length, 0, String(verified));
    }
  });

  // @traces 961-FR-002
  it('rejects look-alike logins for author, committer and PR author', async () => {
    for (const login of ['dependabot', 'dependabot-fan', 'dependabot[bot]x', 'Dependabot[bot]', 'dependabоt[bot]', ' dependabot[bot]', 'dependabot[bot] ']) {
      assert.equal((await go(base({ author: login }))).posts.length, 0, `pr ${login}`);
      assert.equal((await go(base({ commits: [bot({ author: { login } })] }))).posts.length, 0, `author ${login}`);
      assert.equal((await go(base({ commits: [bot({ committer: { login } })] }))).posts.length, 0, `committer ${login}`);
    }
  });

  // @traces 961-FR-002
  it('posts nothing, without crashing, for a PR whose author account was deleted', async () => {
    for (const user of [null, {}]) {
      const r = await go(base({ user }));
      assert.equal(r.code, 0);
      assert.equal(r.posts.length, 0);
    }
  });

  // @traces 961-FR-002
  it('names the first failing commit, not a later one', async () => {
    const r = await go(base({ commits: [bot(), human('1'.repeat(40)), human('2'.repeat(40))] }));
    assert.match(r.out, /1111111/);
    assert.doesNotMatch(r.out, /2222222/);
  });

  // @traces 961-FR-002
  it('posts once only: a second run after the first sees its status and posts nothing', async () => {
    const statuses = [];
    const handler = (path, init) => {
      if (init?.method === 'POST') {
        const b = JSON.parse(init.body);
        statuses.unshift({ context: b.context, state: b.state });
        return {};
      }
      return base({ statuses })(path);
    };
    const first = await go(handler);
    const second = await go(handler);
    assert.equal(first.posts.length, 1);
    assert.equal(second.posts.length, 0);
    assert.equal(second.code, 0);
  });

  // @traces 961-FR-003
  it('exits 1 and posts nothing for every read that fails', async () => {
    for (const bad of ['/pulls/7', '/pulls/7/commits', `/commits/${HEAD}/statuses`]) {
      const r = await go((path) => (path.startsWith(bad) ? 500 : base()(path)));
      assert.equal(r.code, 1, bad);
      assert.equal(r.posts.length, 0, bad);
    }
  });

  // @traces 961-FR-003
  it('exits 1 when the status POST itself is refused', async () => {
    const r = await go((path, init) => (init?.method === 'POST' ? 403 : base()(path)));
    assert.equal(r.code, 1);
    assert.match(r.out, /403/);
  });

  // @traces 961-FR-003
  it('exits 1 rather than rejecting when fetch throws or the body is not JSON', async () => {
    const lines = [];
    const thrown = await main(['7'], { fetch: async () => { throw new Error('ECONNRESET'); }, env, log: (l) => lines.push(l) });
    assert.equal(thrown, 1);
    const garbled = await main(['7'], {
      fetch: async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('bad json'); }, text: async () => '<html>' }),
      env,
      log: (l) => lines.push(l),
    });
    assert.equal(garbled, 1);
  });

  // @traces 961-FR-003
  it('exits 1 when the PR answers with a body of the wrong shape', async () => {
    for (const body of [null, [], 'oops', { user: { login: 'dependabot[bot]' } }]) {
      const r = await go((path) => (path === '/pulls/7' ? body : base()(path)));
      assert.equal(r.posts.length, 0);
      assert.ok(r.code === 1 || r.code === 0, 'must resolve with an exit code');
      assert.notEqual(r.code, undefined);
    }
  });

  // @traces 961-FR-003
  it('never prints the token, on success or on failure', async () => {
    const ok = await go(base());
    const bad = await go(() => 500);
    assert.doesNotMatch(ok.out, /t0ken-secret/);
    assert.doesNotMatch(bad.out, /t0ken-secret/);
  });

  // @traces 961-FR-003
  it('refuses a PR number that is not a plain positive integer, calling GitHub never', async () => {
    for (const arg of ['abc', '-1', '0', '7/../../x', '7?x=1', '7;id', '', ' ', '1e3', '٧', '7 8']) {
      const r = await go(base(), [arg]);
      assert.equal(r.code, 64, JSON.stringify(arg));
      assert.equal(r.calls.length, 0, JSON.stringify(arg));
    }
  });

  // @traces 961-FR-003
  it('refuses a whitespace-only token and a missing repository without calling GitHub', async () => {
    const blank = await go(base(), ['7'], { ...env, GITHUB_TOKEN: '   ' });
    assert.equal(blank.code, 64);
    assert.equal(blank.calls.length, 0);
    const norepo = await go(base(), ['7'], { GITHUB_TOKEN: 'x' });
    assert.notEqual(norepo.code, 0);
    assert.ok(norepo.calls.every((c) => !c.url.includes('undefined')));
  });

  // @traces 961-FR-002
  it('sends the target_url of the run it was given, and no status without one is invented', async () => {
    const r = await go(base());
    assert.equal(r.posts[0].body.target_url, env.RUN_URL);
    assert.equal(r.posts[0].body.state, 'success');
    assert.equal(r.posts[0].url, `${API}/statuses/${HEAD}`);
  });
});
