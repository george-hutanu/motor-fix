import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { NOTION_API, NOTION_VERSION, NotionError, notionClient, notionToken, readProp, writeProp } from './notion.mjs';

const TOKEN = 'ntn_SECRET_never_print_me';
const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...headers } });
const tmp = () => mkdtempSync(join(tmpdir(), 'notion-'));

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
    assert.deepEqual(bodies[0].body, { filter: { property: 'Epic', relation: { contains: 'e1' } } });
    assert.deepEqual(bodies[1].body, { filter: { property: 'Epic', relation: { contains: 'e1' } }, start_cursor: 'c2' });
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
    const waits = [];
    const client = notionClient({
      token: TOKEN,
      sleep: async (ms) => waits.push(ms),
      fetchImpl: async () => json({ code: 'rate_limited', message: 'slow down' }, 429, { 'Retry-After': '1' }),
    });
    await assert.rejects(client.request('GET', '/pages/p1'), (error) => error instanceof NotionError && error.short === '429 rate_limited');
    assert.equal(waits.length, 3);
  });

  it('turns a request that outlives the timeout into a timeout error', async () => {
    const client = notionClient({
      token: TOKEN,
      timeoutMs: 10,
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
