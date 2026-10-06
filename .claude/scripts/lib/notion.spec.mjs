import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { clientLimits, NOTION_API, NOTION_VERSION, NotionError, notionClient, notionToken, readProp, richText, writeProp } from './notion.mjs';

const TOKEN = 'ntn_SECRET_never_print_me';
const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...headers } });
const tmp = () => mkdtempSync(join(tmpdir(), 'notion-'));
/** A clock that only moves when the client sleeps, and the sleeps it asked for. */
const clock = () => {
  const c = { t: 0, waits: [] };
  c.now = () => c.t;
  c.sleep = async (ms) => {
    c.waits.push(ms);
    c.t += ms;
  };
  return c;
};
const isError = (short) => (error) => error instanceof NotionError && error.short === short;

describe('requests', () => {
  it('sends the bearer token, the pinned API version and a JSON body', async () => {
    const calls = [];
    const client = notionClient({
      token: TOKEN,
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return json({ object: 'page', id: 'p1' });
      },
    });
    const page = await client.request('PATCH', '/pages/p1', { properties: { PR: { url: 'u' } } });
    assert.equal(page.id, 'p1');
    assert.equal(NOTION_VERSION, '2026-03-11');
    assert.equal(calls[0].url, `${NOTION_API}/pages/p1`);
    assert.equal(calls[0].init.method, 'PATCH');
    assert.equal(calls[0].init.headers.Authorization, `Bearer ${TOKEN}`);
    assert.equal(calls[0].init.headers['Notion-Version'], '2026-03-11');
    assert.equal(calls[0].init.headers['Content-Type'], 'application/json');
    assert.deepEqual(JSON.parse(calls[0].init.body), { properties: { PR: { url: 'u' } } });
    assert.ok(calls[0].init.signal, 'every request carries a timeout signal');
  });

  it('queries a data source page by page until has_more is false', async () => {
    const bodies = [];
    const client = notionClient({
      token: TOKEN,
      fetchImpl: async (url, init) => {
        const body = JSON.parse(init.body);
        bodies.push({ url, body });
        return body.start_cursor
          ? json({ results: [{ id: 'b' }], has_more: false, next_cursor: null })
          : json({ results: [{ id: 'a' }], has_more: true, next_cursor: 'c2' });
      },
    });
    const rows = await client.query('ds1', { filter: { property: 'Epic', relation: { contains: 'e1' } } });
    assert.deepEqual(rows.map((r) => r.id), ['a', 'b']);
    assert.equal(bodies[0].url, `${NOTION_API}/data_sources/ds1/query`);
    assert.deepEqual(bodies[0].body, { page_size: 100, filter: { property: 'Epic', relation: { contains: 'e1' } } });
    assert.deepEqual(bodies[1].body, { page_size: 100, filter: { property: 'Epic', relation: { contains: 'e1' } }, start_cursor: 'c2' });
  });
});

describe('rate limits and timeouts', () => {
  it('waits Retry-After seconds on a 429, then retries', async () => {
    const waits = [];
    let n = 0;
    const client = notionClient({
      token: TOKEN,
      sleep: async (ms) => waits.push(ms),
      fetchImpl: async () => (++n === 1 ? json({ code: 'rate_limited', message: 'slow down' }, 429, { 'Retry-After': '2' }) : json({ id: 'ok' })),
    });
    assert.equal((await client.request('GET', '/pages/p1')).id, 'ok');
    assert.deepEqual(waits, [2000]);
    assert.equal(n, 2);
  });

  it('gives up after three retries with the rate-limit error', async () => {
    const { now, sleep, waits } = clock();
    const client = notionClient({
      token: TOKEN,
      now,
      sleep,
      fetchImpl: async () => json({ code: 'rate_limited', message: 'slow down' }, 429, { 'Retry-After': '1' }),
    });
    await assert.rejects(client.request('GET', '/pages/p1'), (error) => error instanceof NotionError && error.short === '429 rate_limited');
    assert.equal(waits.length, 3);
  });

  it('turns a request that outlives the timeout into a timeout error', async () => {
    const client = notionClient({
      token: TOKEN,
      timeoutMs: 10,
      sleep: async () => {},
      fetchImpl: (_url, init) =>
        new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason))),
    });
    await assert.rejects(client.request('GET', '/pages/p1'), (error) => error instanceof NotionError && error.short === 'timeout');
  });

  it('names a Notion error by status and code, never by the token', async () => {
    const client = notionClient({
      token: TOKEN,
      fetchImpl: async () => json({ code: 'unauthorized', message: `API token ${TOKEN} is invalid.` }, 401),
    });
    await assert.rejects(client.request('GET', '/pages/p1'), (error) => {
      assert.equal(error.short, '401 unauthorized');
      assert.ok(!error.message.includes(TOKEN));
      assert.ok(!JSON.stringify(error).includes(TOKEN));
      return true;
    });
  });
});

describe('limits', () => {
  it('stops paginating at the page cap instead of looping forever', async () => {
    let calls = 0;
    const client = notionClient({
      token: TOKEN,
      maxPages: 3,
      fetchImpl: async () => {
        calls++;
        return json({ results: [{ id: `r${calls}` }], has_more: true, next_cursor: `c${calls}` });
      },
    });
    await assert.rejects(client.query('ds1'), (error) => error instanceof NotionError && error.short === 'too many pages');
    assert.equal(calls, 3);
  });

  it('does not sleep through a Retry-After above the cap: the 429 is the error', async () => {
    const waits = [];
    const client = notionClient({
      token: TOKEN,
      sleep: async (ms) => waits.push(ms),
      fetchImpl: async () => json({ code: 'rate_limited', message: 'later' }, 429, { 'Retry-After': '3600' }),
    });
    await assert.rejects(client.request('GET', '/pages/p1'), (error) => error.short === '429 rate_limited');
    assert.deepEqual(waits, []);
  });

  it('times out a response whose body never arrives', async () => {
    const client = notionClient({
      token: TOKEN,
      timeoutMs: 10,
      sleep: async () => {},
      fetchImpl: async () => ({ ok: true, status: 200, headers: new Headers(), json: () => new Promise(() => {}) }),
    });
    await assert.rejects(client.request('GET', '/pages/p1'), (error) => error instanceof NotionError && error.short === 'timeout');
  });

  it('retries as many times as maxRetries allows', async () => {
    const waits = [];
    const client = notionClient({
      token: TOKEN,
      maxRetries: 1,
      sleep: async (ms) => waits.push(ms),
      fetchImpl: async () => json({ code: 'rate_limited', message: 'slow' }, 429, { 'Retry-After': '1' }),
    });
    await assert.rejects(client.request('GET', '/pages/p1'));
    assert.equal(waits.length, 1);
  });

  it('reads every limit from the environment, ignoring nonsense', () => {
    const defaults = { timeoutMs: 30000, maxRetries: 3, maxPages: 100, maxWaitS: 60 };
    assert.deepEqual(clientLimits({}), defaults);
    assert.deepEqual(
      clientLimits({ NOTION_SYNC_TIMEOUT_MS: '5000', NOTION_SYNC_MAX_RETRIES: '0', NOTION_SYNC_MAX_PAGES: '7', NOTION_SYNC_MAX_WAIT_S: '0' }),
      { timeoutMs: 5000, maxRetries: 0, maxPages: 7, maxWaitS: 0 },
    );
    assert.deepEqual(
      clientLimits({ NOTION_SYNC_TIMEOUT_MS: 'soon', NOTION_SYNC_MAX_RETRIES: '-2', NOTION_SYNC_MAX_PAGES: '0', NOTION_SYNC_MAX_WAIT_S: 'x' }),
      defaults,
    );
  });

  it('does not wait longer than maxWaitS allows', async () => {
    const waits = [];
    const client = notionClient({
      token: TOKEN,
      maxWaitS: 5,
      sleep: async (ms) => waits.push(ms),
      fetchImpl: async () => json({ code: 'rate_limited', message: 'later' }, 429, { 'Retry-After': '10' }),
    });
    await assert.rejects(client.request('GET', '/pages/p1'), (error) => error.short === '429 rate_limited');
    assert.deepEqual(waits, []);
  });

  it('names a successful answer it cannot parse a bad response', async () => {
    const client = notionClient({ token: TOKEN, fetchImpl: async () => new Response('<html>proxy</html>', { status: 200 }) });
    await assert.rejects(client.request('GET', '/pages/p1'), (error) => error instanceof NotionError && error.short === 'bad response');
  });

  it('names a query answer without a results list a bad response', async () => {
    const client = notionClient({ token: TOKEN, fetchImpl: async () => json({ object: 'list', has_more: false }) });
    await assert.rejects(client.query('ds1'), (error) => error instanceof NotionError && error.short === 'bad response');
  });
});

// @traces 745-FR-001
describe('pacing', () => {
  it('sends a burst of 3 at once, then paces the rest to 3 a second without waiting for a 429', async () => {
    const c = clock();
    let calls = 0;
    const client = notionClient({ token: TOKEN, now: c.now, sleep: c.sleep, fetchImpl: async () => (calls++, json({ id: 'ok' })) });
    for (let i = 0; i < 10; i++) await client.request('GET', `/pages/p${i}`);
    assert.equal(calls, 10);
    assert.equal(c.waits.length, 7);
    for (const w of c.waits) assert.ok(Math.abs(w - 1000 / 3) < 1e-6, `each paced request waits a third of a second, not ${w}`);
    assert.ok(c.t >= 7000 / 3 - 1e-6);
  });

  it('paces requests issued together as well as one after another', async () => {
    const c = clock();
    const client = notionClient({ token: TOKEN, now: c.now, sleep: c.sleep, fetchImpl: async () => json({ id: 'ok' }) });
    await Promise.all(Array.from({ length: 10 }, (_, i) => client.request('GET', `/pages/p${i}`)));
    assert.equal(c.waits.length, 7);
    assert.ok(c.waits.reduce((a, b) => a + b, 0) >= 7000 / 3 - 1e-6);
  });

  it('refills the burst after a quiet second', async () => {
    const c = clock();
    const client = notionClient({ token: TOKEN, now: c.now, sleep: c.sleep, fetchImpl: async () => json({ id: 'ok' }) });
    for (let i = 0; i < 3; i++) await client.request('GET', '/pages/p');
    c.t += 1000;
    for (let i = 0; i < 3; i++) await client.request('GET', '/pages/p');
    assert.deepEqual(c.waits, []);
  });

  it('puts a retry through the pacer too', async () => {
    const c = clock();
    let n = 0;
    const client = notionClient({
      token: TOKEN,
      now: c.now,
      sleep: c.sleep,
      fetchImpl: async () => (++n === 4 ? json({ code: 'rate_limited' }, 429, { 'Retry-After': '0' }) : json({ id: 'ok' })),
    });
    for (let i = 0; i < 4; i++) await client.request('GET', '/pages/p');
    assert.equal(n, 5);
    assert.equal(c.waits.length, 2, 'the fourth request and its retry each wait for a slot');
  });
});

// @traces 745-FR-002
describe('retries', () => {
  const flaky = (first, { method = 'GET', ...options } = {}) => {
    const c = clock();
    let n = 0;
    const client = notionClient({
      token: TOKEN,
      now: c.now,
      sleep: c.sleep,
      random: () => 0,
      ...options,
      fetchImpl: async () => (++n === 1 ? first() : json({ id: 'ok' })),
    });
    return { c, calls: () => n, send: () => client.request(method, '/pages/p1', method === 'GET' ? undefined : { a: 1 }) };
  };

  for (const [status, code] of [[429, 'rate_limited'], [502, 'bad_gateway'], [503, 'service_unavailable'], [504, 'gateway_timeout'], [409, 'conflict_error']]) {
    it(`retries a ${status} ${code} once it has backed off`, async () => {
      const f = flaky(() => json({ code, message: 'again' }, status));
      assert.equal((await f.send()).id, 'ok');
      assert.equal(f.calls(), 2);
      assert.deepEqual(f.c.waits, [500]);
    });
  }

  it('does not retry a 409 that is not a conflict', async () => {
    const f = flaky(() => json({ code: 'validation_error', message: 'no' }, 409));
    await assert.rejects(f.send(), isError('409 validation_error'));
    assert.equal(f.calls(), 1);
  });

  for (const status of [400, 401, 403, 404, 500]) {
    it(`does not retry a ${status}`, async () => {
      const f = flaky(() => json({ code: 'nope', message: 'no' }, status));
      await assert.rejects(f.send(), isError(`${status} nope`));
      assert.equal(f.calls(), 1);
    });
  }

  it('backs off exponentially with jitter when there is no Retry-After', async () => {
    const c = clock();
    let n = 0;
    const client = notionClient({
      token: TOKEN,
      now: c.now,
      sleep: c.sleep,
      random: () => 0.5,
      fetchImpl: async () => (++n <= 3 ? json({ code: 'service_unavailable' }, 503) : json({ id: 'ok' })),
    });
    assert.equal((await client.request('GET', '/pages/p1')).id, 'ok');
    assert.deepEqual(c.waits, [750, 1500, 3000]);
  });

  it('keeps a jittered wait between one and two times the base', async () => {
    for (const [random, wait] of [[0, 500], [0.999, 999.5]]) {
      const f = flaky(() => json({ code: 'bad_gateway' }, 502), { random: () => random });
      await f.send();
      assert.deepEqual(f.c.waits, [wait]);
    }
  });

  it('clamps its own backoff to the wait cap and keeps retrying', async () => {
    const c = clock();
    let n = 0;
    const client = notionClient({
      token: TOKEN,
      now: c.now,
      sleep: c.sleep,
      random: () => 1,
      maxWaitS: 1,
      fetchImpl: async () => (++n <= 3 ? json({ code: 'service_unavailable' }, 503) : json({ id: 'ok' })),
    });
    assert.equal((await client.request('GET', '/pages/p1')).id, 'ok');
    assert.deepEqual(c.waits, [1000, 1000, 1000]);
  });

  it('retries without waiting when the wait cap is 0', async () => {
    const f = flaky(() => json({ code: 'service_unavailable' }, 503), { maxWaitS: 0 });
    assert.equal((await f.send()).id, 'ok');
    assert.deepEqual(f.c.waits, []);
  });

  it('backs off a 429 with no Retry-After instead of waiting a fixed second', async () => {
    const f = flaky(() => json({ code: 'rate_limited' }, 429));
    await f.send();
    assert.deepEqual(f.c.waits, [500]);
  });

  for (const header of ['soon', '-1', 'Wed, 21 Oct 2026 07:28:00 GMT']) {
    it(`treats a Retry-After of ${JSON.stringify(header)} as absent`, async () => {
      const f = flaky(() => json({ code: 'rate_limited' }, 429, { 'Retry-After': header }));
      await f.send();
      assert.deepEqual(f.c.waits, [500]);
    });
  }

  it('retries at once on a Retry-After of 0', async () => {
    const f = flaky(() => json({ code: 'rate_limited' }, 429, { 'Retry-After': '0' }));
    assert.equal((await f.send()).id, 'ok');
    assert.deepEqual(f.c.waits, []);
  });

  it('surfaces the second 503 when one retry is allowed', async () => {
    const c = clock();
    let n = 0;
    const client = notionClient({
      token: TOKEN,
      now: c.now,
      sleep: c.sleep,
      random: () => 0,
      maxRetries: 1,
      fetchImpl: async () => (++n, json({ code: 'service_unavailable', message: 'down' }, 503)),
    });
    await assert.rejects(client.request('GET', '/pages/p1'), isError('503 service_unavailable'));
    assert.equal(n, 2);
  });

  it('never retries when no retry is allowed', async () => {
    const f = flaky(() => json({ code: 'service_unavailable' }, 503), { maxRetries: 0 });
    await assert.rejects(f.send(), isError('503 service_unavailable'));
    assert.equal(f.calls(), 1);
  });

  // @traces 745-FR-003
  it('retries a read that timed out', async () => {
    const f = flaky(() => new Promise(() => {}), { timeoutMs: 10 });
    assert.equal((await f.send()).id, 'ok');
    assert.equal(f.calls(), 2);
  });

  // @traces 745-FR-003
  it('retries a read that failed on the network', async () => {
    const f = flaky(() => Promise.reject(new TypeError('fetch failed')));
    assert.equal((await f.send()).id, 'ok');
    assert.equal(f.calls(), 2);
  });

  for (const method of ['POST', 'PATCH', 'DELETE']) {
    // @traces 745-FR-003
    it(`never replays a ${method} that timed out or failed on the network: it may have landed`, async () => {
      const slow = flaky(() => new Promise(() => {}), { method, timeoutMs: 10 });
      await assert.rejects(slow.send(), isError('timeout'));
      assert.equal(slow.calls(), 1);
      const broken = flaky(() => Promise.reject(new TypeError('fetch failed')), { method });
      await assert.rejects(broken.send(), isError('network error'));
      assert.equal(broken.calls(), 1);
    });
  }
});

describe('size limits', () => {
  const chunks = (parts) => parts.map((p) => p.text.content);

  // @traces 745-FR-004
  it('splits a long text into objects of at most 2,000 characters, in order', () => {
    const value = 'abcde'.repeat(1000);
    const parts = richText(value);
    assert.deepEqual(chunks(parts).map((c) => c.length), [2000, 2000, 1000]);
    assert.equal(chunks(parts).join(''), value);
    assert.ok(parts.every((p) => p.type === 'text'));
  });

  it('counts code points, never cutting a surrogate pair', () => {
    const value = `${'a'.repeat(1999)}😀b`;
    const [first, second] = chunks(richText(value));
    assert.equal(Array.from(first).length, 2000);
    assert.ok(first.endsWith('😀'));
    assert.equal(second, 'b');
  });

  it('keeps an empty text as one empty object', () => {
    assert.deepEqual(richText(''), [{ type: 'text', text: { content: '' } }]);
  });

  it('fills up to 100 objects and refuses a text that needs more', () => {
    assert.equal(richText('x'.repeat(200_000)).length, 100);
    assert.throws(() => richText('x'.repeat(200_001)), isError('text too long'));
  });

  it('splits a title or rich_text property the same way', () => {
    for (const type of ['title', 'rich_text']) {
      const parts = writeProp(type, 'y'.repeat(4001))[type];
      assert.deepEqual(chunks(parts).map((c) => c.length), [2000, 2000, 1]);
    }
  });

  // @traces 745-FR-006
  it('sends a relation of 100 ids and refuses 101 rather than cutting it', () => {
    const ids = Array.from({ length: 101 }, (_, i) => `p${i}`);
    assert.equal(writeProp('relation', ids.slice(0, 100)).relation.length, 100);
    assert.deepEqual(writeProp('relation', []), { relation: [] });
    assert.throws(() => writeProp('relation', ids), isError('relation too long'));
  });

  // @traces 745-FR-007
  it('refuses a body over 500 KB before sending it or waiting for a slot', async () => {
    const c = clock();
    let calls = 0;
    const client = notionClient({ token: TOKEN, now: c.now, sleep: c.sleep, fetchImpl: async () => (calls++, json({ id: 'ok' })) });
    for (let i = 0; i < 3; i++) await client.request('GET', '/pages/p');
    await assert.rejects(client.request('PATCH', '/pages/p1', { text: 'é'.repeat(256 * 1024) }), (error) => {
      assert.ok(error instanceof NotionError);
      assert.equal(error.short, 'body too large');
      assert.match(error.message, /500 KB/);
      return true;
    });
    assert.equal(calls, 3);
    assert.deepEqual(c.waits, []);
    await client.request('PATCH', '/pages/p1', { text: 'x'.repeat(400 * 1024) });
    assert.equal(calls, 4);
  });

  // @traces 745-FR-007
  it('appends block children 100 per request, in order', async () => {
    const sent = [];
    const client = notionClient({
      token: TOKEN,
      sleep: async () => {},
      fetchImpl: async (url, init) => {
        sent.push({ url, method: init.method, children: JSON.parse(init.body).children });
        return json({ results: [] });
      },
    });
    const children = Array.from({ length: 250 }, (_, i) => ({ type: 'paragraph', paragraph: { rich_text: richText(String(i)) } }));
    await client.appendChildren('b1', children);
    assert.deepEqual(sent.map((s) => s.children.length), [100, 100, 50]);
    assert.ok(sent.every((s) => s.method === 'PATCH' && s.url === `${NOTION_API}/blocks/b1/children`));
    assert.deepEqual(sent.flatMap((s) => s.children), children);
  });
});

// @traces 745-FR-008
describe('paging', () => {
  it("lets a caller's own page_size win", async () => {
    const bodies = [];
    const client = notionClient({ token: TOKEN, fetchImpl: async (_url, init) => (bodies.push(JSON.parse(init.body)), json({ results: [], has_more: false })) });
    await client.query('ds1', { page_size: 1 });
    assert.deepEqual(bodies, [{ page_size: 1 }]);
  });

  it('reads block children 100 at a time, following the cursor', async () => {
    const urls = [];
    const client = notionClient({
      token: TOKEN,
      fetchImpl: async (url) => {
        urls.push(url);
        return url.includes('start_cursor') ? json({ results: [{ id: 'b' }], has_more: false }) : json({ results: [{ id: 'a' }], has_more: true, next_cursor: 'c2' });
      },
    });
    const blocks = await client.children('p1');
    assert.deepEqual(blocks.map((b) => b.id), ['a', 'b']);
    assert.deepEqual(urls, [`${NOTION_API}/blocks/p1/children?page_size=100`, `${NOTION_API}/blocks/p1/children?page_size=100&start_cursor=c2`]);
  });

  it('stops reading block children at the page cap', async () => {
    let calls = 0;
    const client = notionClient({ token: TOKEN, maxPages: 2, fetchImpl: async () => (calls++, json({ results: [], has_more: true, next_cursor: 'c' })) });
    await assert.rejects(client.children('p1'), isError('too many pages'));
    assert.equal(calls, 2);
  });
});

describe('the token', () => {
  it('comes from the environment first', () => {
    const repo = tmp();
    writeFileSync(join(repo, '.env'), 'NOTION_TOKEN=from-file\n');
    assert.equal(notionToken(repo, { NOTION_TOKEN: 'from-env' }), 'from-env');
  });

  it("falls back to the repo's .env", () => {
    const repo = tmp();
    writeFileSync(join(repo, '.env'), '# comment\nNOTION_TOKEN=from-file\n');
    assert.equal(notionToken(repo, {}), 'from-file');
  });

  it("in a worktree, falls back to the main checkout's .env", () => {
    const main = tmp();
    const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, stdio: 'ignore' });
    git(main, 'init', '-q');
    git(main, 'commit', '-q', '--allow-empty', '-m', 'init');
    const worktree = join(tmp(), 'wt');
    git(main, 'worktree', 'add', '-q', worktree);
    writeFileSync(join(main, '.env'), 'NOTION_TOKEN=from-main\n');
    assert.equal(notionToken(worktree, {}), 'from-main');
  });

  it('is empty when nothing holds it', () => {
    assert.equal(notionToken(tmp(), {}), '');
  });
});

describe('property values', () => {
  it('reads the values the events need', () => {
    const page = {
      properties: {
        Status: { type: 'select', select: { name: 'QA' } },
        Phase: { type: 'status', status: { name: 'In progress' } },
        Empty: { type: 'select', select: null },
        ID: { type: 'unique_id', unique_id: { prefix: 'ST', number: 687 } },
        Story: { type: 'title', title: [{ plain_text: 'Notion ' }, { plain_text: 'sync' }] },
        ST: { type: 'rich_text', rich_text: [{ plain_text: 'ST-687' }] },
        PR: { type: 'url', url: 'https://x/pull/1' },
        Ready: { type: 'checkbox', checkbox: true },
        Epic: { type: 'relation', relation: [{ id: 'e1' }, { id: 'e2' }] },
      },
    };
    assert.equal(readProp(page, 'Status'), 'QA');
    assert.equal(readProp(page, 'Phase'), 'In progress');
    assert.equal(readProp(page, 'Empty'), null);
    assert.equal(readProp(page, 'ID'), 'ST-687');
    assert.equal(readProp(page, 'Story'), 'Notion sync');
    assert.equal(readProp(page, 'ST'), 'ST-687');
    assert.equal(readProp(page, 'PR'), 'https://x/pull/1');
    assert.equal(readProp(page, 'Ready'), true);
    assert.deepEqual(readProp(page, 'Epic'), ['e1', 'e2']);
    assert.equal(readProp(page, 'Missing'), null);
  });

  it('writes a value in the shape of the property it replaces', () => {
    assert.deepEqual(writeProp('select', 'Done'), { select: { name: 'Done' } });
    assert.deepEqual(writeProp('status', 'Done'), { status: { name: 'Done' } });
    assert.deepEqual(writeProp('checkbox', false), { checkbox: false });
    assert.deepEqual(writeProp('url', 'https://x'), { url: 'https://x' });
    assert.deepEqual(writeProp('title', 'T'), { title: [{ type: 'text', text: { content: 'T' } }] });
    assert.deepEqual(writeProp('rich_text', 'R'), { rich_text: [{ type: 'text', text: { content: 'R' } }] });
    assert.deepEqual(writeProp('relation', ['e1']), { relation: [{ id: 'e1' }] });
    assert.deepEqual(writeProp('number', 3), { number: 3 });
  });
});
