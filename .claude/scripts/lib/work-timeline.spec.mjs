import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

import { NOTION_VERSION, notionClient } from './notion.mjs';
import { syncWorkTimeline, WORK_TIMELINE, WORK_TIMELINE_VERSION } from './work-timeline.mjs';

const NOW = new Date('2026-10-07T10:00:00.000Z');
const LATER = '2026-10-07T12:00:00.000Z';
const PR = 'https://github.com/george-hutanu/motor-fix/pull/233';
const respond = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
const date = (start) => ({ type: 'date', date: start ? { start } : null });

const story = (dates = {}) => ({
  object: 'page',
  id: 'story849',
  properties: {
    Status: { type: 'select', select: { name: 'Planning' } },
    Started: date(dates.started),
    'QA from': date(dates.qa),
    'Merged at': date(dates.merged),
    Session: { type: 'select', select: { name: 'Chief' } },
  },
});
const row = (state, dates = {}) => ({
  object: 'page',
  id: 'row849',
  properties: {
    Key: { type: 'rich_text', rich_text: [{ plain_text: 'ST-849' }] },
    State: { type: 'select', select: { name: state } },
    Session: { type: 'select', select: { name: 'Lane 2' } },
    Started: date(dates.started),
    'QA from': date(dates.qa),
    'Merged at': date(dates.merged),
  },
});

/** Both Notion clients over one fake fetch that records every call; `fail` answers a call instead. */
function notion({ rows = [], fail = () => null } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const path = url.slice('https://api.notion.com/v1'.length);
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ method: init.method, path, body, version: init.headers['Notion-Version'] });
    const failed = fail(init.method, path);
    if (failed) return failed;
    if (init.method === 'POST' && path === `/data_sources/${WORK_TIMELINE}/query`) return respond({ results: rows, has_more: false });
    if (init.method === 'PATCH') return respond({ object: 'page', id: path.slice(7) });
    if (init.method === 'POST' && path === '/pages') return respond({ object: 'page', id: 'new' });
    return respond({ code: 'invalid_request_url', message: 'no route' }, 400);
  };
  const opts = { token: 't', fetchImpl, sleep: async () => {}, maxRetries: 0 };
  return { calls, client: notionClient(opts), timelineClient: notionClient({ ...opts, version: WORK_TIMELINE_VERSION }) };
}

const sync = (n, event, page, extra = {}) =>
  syncWorkTimeline({ client: n.client, timelineClient: n.timelineClient, event, key: 'ST-849', story: page, pr: PR, now: NOW, ...extra });
const storyWrite = (n) => n.calls.find((c) => c.path === '/pages/story849')?.body;
const rowWrite = (n) => n.calls.find((c) => c.path === '/pages/row849' || c.path === '/pages')?.body;
const took = (text) => ({ rich_text: [{ type: 'text', text: { content: text } }] });

describe('the upsert by Key', () => {
  it('creates the row when no row has the key, under the 2025-09-03 version', async () => {
    const n = notion();
    const line = await sync(n, 'start', story());
    assert.equal(line, 'created In progress');
    assert.deepEqual(n.calls[0], {
      method: 'POST',
      path: `/data_sources/${WORK_TIMELINE}/query`,
      body: { page_size: 1, filter: { property: 'Key', rich_text: { equals: 'ST-849' } } },
      version: '2025-09-03',
    });
    const create = n.calls.find((c) => c.path === '/pages');
    assert.equal(create.method, 'POST');
    assert.equal(create.version, '2025-09-03');
    assert.deepEqual(create.body.parent, { type: 'data_source_id', data_source_id: WORK_TIMELINE });
    assert.deepEqual(create.body.icon, { type: 'emoji', emoji: '🔨' });
    assert.deepEqual(create.body.properties, {
      Task: { title: [{ type: 'text', text: { content: 'ST-849' } }] },
      Key: { rich_text: [{ type: 'text', text: { content: 'ST-849' } }] },
      Ticket: { relation: [{ id: 'story849' }] },
      State: { select: { name: 'In progress' } },
      When: { date: { start: NOW.toISOString(), end: LATER } },
      Started: { date: { start: NOW.toISOString() } },
      Took: took('0m so far'),
      PR: { url: PR },
    });
  });

  it('updates the first row with the key instead of creating another', async () => {
    const n = notion({ rows: [row('In progress', { started: '2026-10-07T08:55:00.000Z' })] });
    const line = await sync(n, 'qa', story({ started: '2026-10-07T08:55:00.000Z' }));
    assert.equal(line, 'In progress → QA');
    assert.equal(n.calls.filter((c) => c.path === '/pages').length, 0);
    const update = n.calls.find((c) => c.path === '/pages/row849');
    assert.equal(update.method, 'PATCH');
    assert.equal(update.version, '2025-09-03');
  });

  it('never sends Session, to the row or to the story', async () => {
    const n = notion({ rows: [row('QA', { started: '2026-10-07T07:00:00.000Z', qa: '2026-10-07T09:15:00.000Z' })] });
    await sync(n, 'finish', story({ started: '2026-10-07T07:00:00.000Z', qa: '2026-10-07T09:15:00.000Z' }));
    assert.equal(n.calls.filter((c) => c.method !== 'POST' || c.path === '/pages').length, 2);
    for (const c of n.calls) assert.ok(!('Session' in (c.body?.properties ?? {})), `${c.method} ${c.path} sent Session`);
  });

  it('omits PR when the event knows none, and never clears it', async () => {
    const n = notion();
    await sync(n, 'start', story(), { pr: null });
    assert.ok(!('PR' in rowWrite(n).properties));
  });
});

describe('each step', () => {
  it('start writes Started, the Work range and Took onto the story, under the stories version', async () => {
    const n = notion();
    await sync(n, 'start', story());
    const write = n.calls.find((c) => c.path === '/pages/story849');
    assert.equal(write.method, 'PATCH');
    assert.equal(write.version, NOTION_VERSION);
    assert.deepEqual(write.body, {
      properties: {
        Work: { date: { start: NOW.toISOString(), end: LATER } },
        Started: { date: { start: NOW.toISOString() } },
        Took: took('0m so far'),
      },
    });
  });

  it('start keeps a Started already set', async () => {
    const n = notion({ rows: [row('In progress')] });
    await sync(n, 'start', story({ started: '2026-10-07T08:55:00.000Z' }));
    assert.deepEqual(storyWrite(n).properties.Started, { date: { start: '2026-10-07T08:55:00.000Z' } });
    assert.deepEqual(storyWrite(n).properties.Took, took('1h05 so far'));
    assert.deepEqual(rowWrite(n).properties.When, { date: { start: '2026-10-07T08:55:00.000Z', end: LATER } });
  });

  it('implement is In progress and sets an empty Started', async () => {
    const n = notion({ rows: [row('In progress')] });
    await sync(n, 'implement', story());
    assert.deepEqual(rowWrite(n).properties.State, { select: { name: 'In progress' } });
    assert.deepEqual(rowWrite(n).icon, { type: 'emoji', emoji: '🔨' });
    assert.deepEqual(rowWrite(n).properties.Started, { date: { start: NOW.toISOString() } });
  });

  it('qa is QA from now when empty, with the build time and the time in QA', async () => {
    const n = notion({ rows: [row('In progress')] });
    await sync(n, 'qa', story({ started: '2026-10-07T07:00:00.000Z' }));
    const props = rowWrite(n).properties;
    assert.deepEqual(props.State, { select: { name: 'QA' } });
    assert.deepEqual(rowWrite(n).icon, { type: 'emoji', emoji: '🧪' });
    assert.deepEqual(props['QA from'], { date: { start: NOW.toISOString() } });
    assert.deepEqual(props.Took, took('build 3h00 · in QA 0m'));
    assert.deepEqual(storyWrite(n).properties['QA from'], { date: { start: NOW.toISOString() } });
  });

  it('qa keeps a QA from already set', async () => {
    const n = notion({ rows: [row('QA')] });
    await sync(n, 'qa', story({ started: '2026-10-07T07:00:00.000Z', qa: '2026-10-07T09:15:00.000Z' }));
    assert.deepEqual(rowWrite(n).properties['QA from'], { date: { start: '2026-10-07T09:15:00.000Z' } });
    assert.deepEqual(rowWrite(n).properties.Took, took('build 2h15 · in QA 45m'));
  });

  it('finish is Merged at now, the range ends there, and Took splits build and QA', async () => {
    const n = notion({ rows: [row('QA')] });
    const line = await sync(n, 'finish', story({ started: '2026-10-07T07:00:00.000Z', qa: '2026-10-07T09:15:00.000Z' }));
    assert.equal(line, 'QA → Merged');
    const props = rowWrite(n).properties;
    assert.deepEqual(props.State, { select: { name: 'Merged' } });
    assert.deepEqual(rowWrite(n).icon, { type: 'emoji', emoji: '✅' });
    assert.deepEqual(props['Merged at'], { date: { start: NOW.toISOString() } });
    assert.deepEqual(props.When, { date: { start: '2026-10-07T07:00:00.000Z', end: NOW.toISOString() } });
    assert.deepEqual(props.Took, took('3h00 total · build 2h15 · QA 45m'));
    assert.deepEqual(storyWrite(n).properties.Work, props.When);
    assert.deepEqual(storyWrite(n).properties['Merged at'], props['Merged at']);
  });

  it('finish without QA from counts no QA time', async () => {
    const n = notion({ rows: [row('In progress')] });
    await sync(n, 'finish', story({ started: '2026-10-07T07:00:00.000Z' }));
    assert.deepEqual(rowWrite(n).properties.Took, took('3h00 total · build 3h00 · QA 0m'));
  });

  it('blocked is Blocked; unblock returns to QA when the task reached QA, else In progress', async () => {
    const blocked = notion({ rows: [row('In progress')] });
    assert.equal(await sync(blocked, 'blocked', story({ started: '2026-10-07T09:30:00.000Z' })), 'In progress → Blocked');
    assert.deepEqual(rowWrite(blocked).icon, { type: 'emoji', emoji: '⛔' });
    assert.deepEqual(rowWrite(blocked).properties.Took, took('30m so far'));

    const back = notion({ rows: [row('Blocked')] });
    assert.equal(await sync(back, 'unblock', story({ started: '2026-10-07T07:00:00.000Z' })), 'Blocked → In progress');
    const toQa = notion({ rows: [row('Blocked')] });
    assert.equal(await sync(toQa, 'unblock', story({ started: '2026-10-07T07:00:00.000Z', qa: '2026-10-07T09:00:00.000Z' })), 'Blocked → QA');
    assert.deepEqual(rowWrite(toQa).icon, { type: 'emoji', emoji: '🧪' });
  });

  it('takes a date the story lacks from the row, so both agree', async () => {
    const n = notion({ rows: [row('In progress', { started: '2026-10-07T08:00:00.000Z' })] });
    await sync(n, 'qa', story());
    assert.deepEqual(storyWrite(n).properties.Started, { date: { start: '2026-10-07T08:00:00.000Z' } });
    assert.deepEqual(storyWrite(n).properties.Took, took('build 2h00 · in QA 0m'));
  });

  it('a step after start on a task with no Started writes no Started and no Took', async () => {
    const n = notion({ rows: [row('In progress')] });
    await sync(n, 'blocked', story());
    assert.ok(!('Started' in rowWrite(n).properties));
    assert.ok(!('Took' in rowWrite(n).properties));
    assert.deepEqual(rowWrite(n).properties.When, { date: { start: NOW.toISOString(), end: LATER } });
  });

  for (const event of ['review', 'pr', 'debt', 'ready', 'log', 'check']) {
    it(`${event} writes nothing`, async () => {
      const n = notion();
      assert.equal(await sync(n, event, story()), null);
      assert.equal(n.calls.length, 0);
    });
  }
});

describe('failing open', () => {
  it('a fetch that rejects is a log text, never a throw', async () => {
    const n = notion({
      fail: () => {
        throw new Error('ECONNRESET');
      },
    });
    const line = await sync(n, 'start', story());
    assert.match(line, /^failed — /);
  });

  it('an error status on the query is a log text, and the story still gets its dates', async () => {
    const n = notion({ fail: (m, p) => (p.startsWith('/data_sources/') ? respond({ code: 'object_not_found', message: 'gone' }, 404) : null) });
    const line = await sync(n, 'start', story());
    assert.equal(line, 'failed — 404 object_not_found');
    assert.ok(storyWrite(n));
  });

  it('a body that is not JSON is a log text', async () => {
    const n = notion({ fail: (m, p) => (p === '/pages' ? new Response('<html>', { status: 200 }) : null) });
    assert.equal(await sync(n, 'start', story()), 'failed — bad response');
  });

  it('a failed story write is named, and the row is still written', async () => {
    const n = notion({ rows: [row('In progress')], fail: (m, p) => (p === '/pages/story849' ? respond({ code: 'validation_error', message: 'Work is not a property' }, 400) : null) });
    const line = await sync(n, 'qa', story());
    assert.equal(line, 'In progress → QA; story failed — 400 validation_error');
    assert.ok(rowWrite(n));
  });

  it('a query answer without a results list is a log text', async () => {
    const n = notion({ fail: (m, p) => (p.startsWith('/data_sources/') ? respond({ object: 'list' }) : null) });
    assert.equal(await sync(n, 'start', story()), 'failed — bad response');
  });
});
