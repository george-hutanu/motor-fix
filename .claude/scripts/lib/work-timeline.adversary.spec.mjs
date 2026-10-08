import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

import { notionClient } from './notion.mjs';
import { syncWorkTimeline, WORK_TIMELINE, WORK_TIMELINE_VERSION, whenEnd } from './work-timeline.mjs';

const NOW = new Date('2026-10-07T10:00:00.000Z');
const PR = 'https://github.com/george-hutanu/motor-fix/pull/233';
const WRITING = ['start', 'implement', 'qa', 'finish', 'blocked', 'unblock'];
const respond = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
const date = (start) => ({ type: 'date', date: start ? { start } : null });
const took = (text) => ({ rich_text: [{ type: 'text', text: { content: text } }] });

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
const row = (state, dates = {}, id = 'row849') => ({
  object: 'page',
  id,
  properties: {
    Key: { type: 'rich_text', rich_text: [{ plain_text: 'ST-849' }] },
    State: { type: 'select', select: { name: state } },
    Session: { type: 'select', select: { name: 'Lane 2' } },
    Started: date(dates.started),
    'QA from': date(dates.qa),
    'Merged at': date(dates.merged),
  },
});

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
const rowWrite = (n) => n.calls.find((c) => c.path === '/pages/row849' || c.path === '/pages')?.body;
const storyWrite = (n) => n.calls.find((c) => c.path === '/pages/story849')?.body;
const iso = (minutesBefore) => new Date(NOW.getTime() - minutesBefore * 60_000).toISOString();
const tookOf = async (event, dates, state = 'In progress') => {
  const n = notion({ rows: [row(state)] });
  await sync(n, event, story(dates));
  return rowWrite(n).properties.Took;
};

describe('never throws', () => {
  const broken = {
    'a client whose request throws synchronously': () => {
      const boom = { request: () => { throw new Error('sync boom'); }, query: () => { throw new Error('sync boom'); } };
      return { client: boom, timelineClient: boom };
    },
    'missing clients': () => ({ client: undefined, timelineClient: undefined }),
    'a fetch that resolves to nothing': () => {
      const f = async () => undefined;
      const o = { token: 't', fetchImpl: f, sleep: async () => {}, maxRetries: 0 };
      return { client: notionClient(o), timelineClient: notionClient({ ...o, version: WORK_TIMELINE_VERSION }) };
    },
    'a fetch that returns null': () => {
      const f = async () => null;
      const o = { token: 't', fetchImpl: f, sleep: async () => {}, maxRetries: 0 };
      return { client: notionClient(o), timelineClient: notionClient({ ...o, version: WORK_TIMELINE_VERSION }) };
    },
  };
  for (const [name, make] of Object.entries(broken)) {
    for (const event of WRITING) {
      it(`${event} resolves with a failed line on ${name}`, async () => {
        const line = await syncWorkTimeline({ ...make(), event, key: 'ST-849', story: story(), pr: PR, now: NOW });
        assert.match(line, /^failed — /);
      });
    }
  }

  it('a story without properties resolves normally', async () => {
    const n = notion();
    const line = await sync(n, 'start', { id: 'story849' });
    assert.equal(typeof line, 'string');
  });

  it('a story that is null resolves to a string instead of throwing', async () => {
    const n = notion();
    const line = await sync(n, 'start', null);
    assert.equal(typeof line, 'string');
  });

  it('an invalid now date resolves to a string instead of throwing', async () => {
    const n = notion();
    const line = await sync(n, 'start', story(), { now: new Date('nonsense') });
    assert.equal(typeof line, 'string');
  });

  it('result rows that are null or lack properties are survived', async () => {
    const n = notion({ rows: [{ id: 'row849' }] });
    const line = await sync(n, 'qa', story({ started: iso(30) }));
    assert.equal(typeof line, 'string');
    const n2 = notion({ rows: [null] });
    assert.equal(typeof (await sync(n2, 'qa', story({ started: iso(30) }))), 'string');
  });

  it('a failure message holding newlines still logs as one line', async () => {
    const n = notion({ fail: () => respond({ code: 'validation_error', message: 'line one\nline two\r\nline three' }, 400) });
    const line = await sync(n, 'start', story());
    assert.match(line, /^failed — /);
    assert.ok(!/[\r\n]/.test(line), `multi-line log text: ${JSON.stringify(line)}`);
  });

  it('a thrown error holding newlines still logs as one line', async () => {
    const n = notion({ fail: () => { throw new Error('a\nb'); } });
    const line = await sync(n, 'start', story());
    assert.ok(!/[\r\n]/.test(line), JSON.stringify(line));
  });

  it('the failure line never contains the token', async () => {
    const n = notion({ fail: () => respond({ code: 'unauthorized', message: 'Bearer t rejected' }, 401) });
    const line = await sync(n, 'start', story());
    assert.match(line, /^failed — 401/);
  });
});

describe('the upsert never duplicates', () => {
  for (const event of WRITING) {
    it(`${event} on an existing row makes one query and one row update, no create`, async () => {
      const n = notion({ rows: [row('In progress', { started: iso(90) })] });
      await sync(n, event, story({ started: iso(90) }));
      assert.equal(n.calls.filter((c) => c.method === 'POST' && c.path === '/pages').length, 0);
      assert.equal(n.calls.filter((c) => c.path === `/data_sources/${WORK_TIMELINE}/query`).length, 1);
      assert.equal(n.calls.filter((c) => c.path === '/pages/row849').length, 1);
    });

    it(`${event} on a missing row makes one create and no row update`, async () => {
      const n = notion();
      await sync(n, event, story({ started: iso(90) }));
      assert.equal(n.calls.filter((c) => c.method === 'POST' && c.path === '/pages').length, 1);
      assert.equal(n.calls.filter((c) => c.method === 'PATCH' && c.path !== '/pages/story849').length, 0);
    });
  }

  it('with a hand-made duplicate only the first returned row is written', async () => {
    const n = notion({ rows: [row('QA', {}, 'first'), row('QA', {}, 'second')] });
    await sync(n, 'blocked', story({ started: iso(30) }));
    assert.ok(n.calls.some((c) => c.path === '/pages/first'));
    assert.ok(!n.calls.some((c) => c.path === '/pages/second'));
    assert.ok(!n.calls.some((c) => c.method === 'DELETE' || c.body?.in_trash || c.body?.archived));
  });

  it('the same event twice sends the same row write both times and never creates', async () => {
    const a = notion({ rows: [row('In progress', { started: iso(90) })] });
    const b = notion({ rows: [row('In progress', { started: iso(90) })] });
    await sync(a, 'blocked', story({ started: iso(90) }));
    await sync(b, 'blocked', story({ started: iso(90) }));
    assert.deepEqual(rowWrite(a), rowWrite(b));
  });

  it('the query filters on the exact key, so a key that is a prefix of another is not matched', async () => {
    const n = notion();
    await syncWorkTimeline({ client: n.client, timelineClient: n.timelineClient, event: 'start', key: 'ST-84', story: story(), pr: PR, now: NOW });
    assert.deepEqual(n.calls[0].body.filter, { property: 'Key', rich_text: { equals: 'ST-84' } });
  });

  it('a key with quotes and unicode goes through as data, in both Task and Key', async () => {
    const n = notion();
    const key = 'ST-8"49\' ✓ é';
    await syncWorkTimeline({ client: n.client, timelineClient: n.timelineClient, event: 'start', key, story: story(), pr: PR, now: NOW });
    const create = n.calls.find((c) => c.path === '/pages').body;
    assert.equal(create.properties.Task.title[0].text.content, key);
    assert.equal(create.properties.Key.rich_text[0].text.content, key);
  });
});

describe('Session and unnamed properties are never sent', () => {
  const ALLOWED_ROW = new Set(['Task', 'Key', 'Ticket', 'State', 'Started', 'QA from', 'Merged at', 'When', 'PR', 'Took']);
  const ALLOWED_STORY = new Set(['Work', 'Started', 'QA from', 'Merged at', 'Took']);

  for (const event of WRITING) {
    for (const existing of [true, false]) {
      it(`${event} ${existing ? 'updating' : 'creating'} sends only mapped properties and no Session text anywhere`, async () => {
        const n = notion({ rows: existing ? [row('QA', { started: iso(120), qa: iso(60) })] : [] });
        await sync(n, event, story({ started: iso(120), qa: iso(60) }));
        for (const c of n.calls) {
          assert.ok(!JSON.stringify(c.body ?? {}).includes('Session'), `${c.method} ${c.path} mentions Session`);
        }
        const rw = rowWrite(n).properties;
        for (const k of Object.keys(rw)) assert.ok(ALLOWED_ROW.has(k), `row sent ${k}`);
        for (const k of Object.keys(storyWrite(n).properties)) assert.ok(ALLOWED_STORY.has(k), `story sent ${k}`);
      });
    }
  }

  it('never writes Status or Queued to the row, whatever state the row was in', async () => {
    for (const event of WRITING) {
      const n = notion({ rows: [row('Queued')] });
      await sync(n, event, story({ started: iso(10) }));
      assert.notEqual(rowWrite(n).properties.State.select.name, 'Queued');
      assert.ok(!('Status' in rowWrite(n).properties));
      assert.notEqual(rowWrite(n).icon.emoji, '⏳');
    }
  });

  it('an update never sends Session', async () => {
    const n = notion({ rows: [row('In progress', { started: iso(10) })] });
    await sync(n, 'qa', story({ started: iso(10) }));
    assert.deepEqual(Object.keys(rowWrite(n).properties).filter((k) => k === 'Session'), []);
  });
});

describe('unknown and non-writing events', () => {
  for (const event of ['review', 'pr', 'debt', 'ready', 'log', 'check', 'bogus', '', undefined, null, 'START', 'Finish']) {
    it(`${JSON.stringify(event)} makes no request and returns null`, async () => {
      const n = notion();
      assert.equal(await sync(n, event, story()), null);
      assert.equal(n.calls.length, 0);
    });
  }
});

describe('PR handling', () => {
  for (const pr of [undefined, null, '']) {
    it(`a PR of ${JSON.stringify(pr)} is omitted from the row, never sent empty`, async () => {
      const n = notion();
      await sync(n, 'start', story(), { pr });
      assert.ok(!('PR' in rowWrite(n).properties));
    });
  }

  it('a known PR is sent on an update as well', async () => {
    const n = notion({ rows: [row('In progress', { started: iso(10) })] });
    await sync(n, 'qa', story({ started: iso(10) }));
    assert.deepEqual(rowWrite(n).properties.PR, { url: PR });
  });
});

describe('Took maths', () => {
  it('59 minutes is 59m', async () => assert.deepEqual(await tookOf('blocked', { started: iso(59) }), took('59m so far')));
  it('exactly 60 minutes is 1h00', async () => assert.deepEqual(await tookOf('blocked', { started: iso(60) }), took('1h00 so far')));
  it('61 minutes is 1h01', async () => assert.deepEqual(await tookOf('blocked', { started: iso(61) }), took('1h01 so far')));
  it('119 minutes is 1h59', async () => assert.deepEqual(await tookOf('blocked', { started: iso(119) }), took('1h59 so far')));
  it('25 hours is 25h00, not rolled into days', async () => assert.deepEqual(await tookOf('blocked', { started: iso(25 * 60) }), took('25h00 so far')));
  it('59 seconds is 0m', async () => assert.deepEqual(await tookOf('blocked', { started: new Date(NOW.getTime() - 59_000).toISOString() }), took('0m so far')));
  it('61 seconds is 1m', async () => assert.deepEqual(await tookOf('blocked', { started: new Date(NOW.getTime() - 61_000).toISOString() }), took('1m so far')));
  it('an offset timestamp counts the same instant as its UTC form', async () => {
    assert.deepEqual(await tookOf('blocked', { started: '2026-10-07T12:00:00+03:00' }), took('1h00 so far'));
  });
  it('a Started in the future never prints a negative duration', async () => {
    const t = await tookOf('blocked', { started: new Date(NOW.getTime() + 3_600_000).toISOString() });
    assert.ok(!JSON.stringify(t).includes('-'), JSON.stringify(t));
  });
  it('a date-only Started does not turn Took into NaN', async () => {
    const t = await tookOf('blocked', { started: '2026-10-07' });
    assert.ok(!JSON.stringify(t ?? '').includes('NaN'), JSON.stringify(t));
  });

  it('in QA, build and QA add up: 3h build then 0m', async () => {
    assert.deepEqual(await tookOf('qa', { started: iso(180) }), took('build 3h00 · in QA 0m'));
  });
  it('finish: total equals build plus QA at the 59/60 minute edge', async () => {
    const t = await tookOf('finish', { started: iso(120), qa: iso(61) }, 'QA');
    assert.deepEqual(t, took('2h00 total · build 59m · QA 1h01'));
  });
  it('finish minutes carry with two-digit padding: 1h05', async () => {
    assert.deepEqual(await tookOf('finish', { started: iso(65) }, 'In progress'), took('1h05 total · build 1h05 · QA 0m'));
  });
  it('finish ignores a stale Merged at and stamps now', async () => {
    const n = notion({ rows: [row('Merged', { started: iso(120), merged: iso(1000) })] });
    await sync(n, 'finish', story({ started: iso(120), merged: iso(1000) }));
    assert.deepEqual(rowWrite(n).properties['Merged at'], { date: { start: NOW.toISOString() } });
    assert.deepEqual(rowWrite(n).properties.When, { date: { start: iso(120), end: NOW.toISOString() } });
  });
  it('a story date wins over a different row date', async () => {
    const n = notion({ rows: [row('In progress', { started: iso(500) })] });
    await sync(n, 'blocked', story({ started: iso(30) }));
    assert.deepEqual(rowWrite(n).properties.Took, took('30m so far'));
  });
  it('a row with no Started and no story Started has no Took, on create too', async () => {
    const n = notion();
    await sync(n, 'qa', story());
    assert.ok(!('Took' in storyWrite(n).properties));
  });
});

describe('When range', () => {
  it('end is now plus two hours exactly for an unmerged row', async () => {
    const n = notion({ rows: [row('In progress')] });
    await sync(n, 'implement', story({ started: iso(30) }));
    assert.deepEqual(rowWrite(n).properties.When, { date: { start: iso(30), end: '2026-10-07T12:00:00.000Z' } });
  });
  it('a step after finish ends at now plus two hours, not at the old Merged at', async () => {
    for (const event of WRITING.filter((e) => e !== 'finish')) {
      const n = notion({ rows: [row('Merged', { started: iso(300), merged: iso(100) })] });
      await sync(n, event, story({ started: iso(300), merged: iso(100) }));
      const when = { date: { start: iso(300), end: '2026-10-07T12:00:00.000Z' } };
      assert.deepEqual(rowWrite(n).properties.When, when, `${event} row`);
      assert.deepEqual(storyWrite(n).properties.Work, when, `${event} story`);
    }
  });
  it('an old Merged at only on the row still leaves a blocked step open', async () => {
    const n = notion({ rows: [row('Merged', { started: iso(300), merged: iso(100) })] });
    await sync(n, 'blocked', story({ started: iso(300) }));
    assert.deepEqual(rowWrite(n).properties.When, { date: { start: iso(300), end: '2026-10-07T12:00:00.000Z' } });
  });
  it('the story gets the same Work range as the row', async () => {
    const n = notion({ rows: [row('QA')] });
    await sync(n, 'blocked', story({ started: iso(30) }));
    assert.deepEqual(storyWrite(n).properties.Work, rowWrite(n).properties.When);
  });
  it('only finish writes Merged at', async () => {
    for (const event of WRITING.filter((e) => e !== 'finish')) {
      const n = notion({ rows: [row('QA')] });
      await sync(n, event, story({ started: iso(30), qa: iso(10) }));
      assert.ok(!('Merged at' in rowWrite(n).properties), `${event} wrote Merged at`);
    }
  });
  it('start and implement and blocked never write QA from', async () => {
    for (const event of ['start', 'implement', 'blocked']) {
      const n = notion({ rows: [row('In progress')] });
      await sync(n, event, story({ started: iso(30) }));
      assert.ok(!('QA from' in rowWrite(n).properties), `${event} wrote QA from`);
    }
  });
  // A Merged state with no Merged at cannot come out of sync() today (finish
  // always stamps it), so the end is checked where it is computed.
  it('a Merged row with no Merged at value ends at now plus two hours', () => {
    for (const merged of [null, undefined, ''])
      assert.equal(whenEnd('Merged', merged, NOW), '2026-10-07T12:00:00.000Z', JSON.stringify(merged));
  });
  it('a Merged row with a Merged at value ends at it', () => {
    assert.equal(whenEnd('Merged', iso(100), NOW), iso(100));
  });
  it('a row in any other state ends at now plus two hours, whatever Merged at it holds', () => {
    for (const state of ['In progress', 'QA', 'Blocked']) assert.equal(whenEnd(state, iso(100), NOW), '2026-10-07T12:00:00.000Z', state);
  });
});

describe('unblock', () => {
  it('reads QA from the row when the story lacks it', async () => {
    const n = notion({ rows: [row('Blocked', { started: iso(100), qa: iso(50) })] });
    assert.equal(await sync(n, 'unblock', story({ started: iso(100) })), 'Blocked → QA');
  });
  it('with no row yet, goes to In progress and creates', async () => {
    const n = notion();
    assert.equal(await sync(n, 'unblock', story({ started: iso(100) })), 'created In progress');
  });
  it('does not stamp QA from or Started that were empty', async () => {
    const n = notion({ rows: [row('Blocked', { started: iso(100) })] });
    await sync(n, 'unblock', story({ started: iso(100) }));
    assert.ok(!('QA from' in rowWrite(n).properties));
  });
});

describe('partial failure', () => {
  it('a failing create after a good query returns a failed line and does not retry the create', async () => {
    const n = notion({ fail: (m, p) => (p === '/pages' ? respond({ code: 'internal_server_error', message: 'x' }, 500) : null) });
    const line = await sync(n, 'start', story());
    assert.match(line, /^failed — /);
    assert.equal(n.calls.filter((c) => c.path === '/pages').length, 1);
  });
  it('a failing row update with a good story write still returns a failed line', async () => {
    const n = notion({ rows: [row('In progress')], fail: (m, p) => (p === '/pages/row849' ? respond({ code: 'conflict_error', message: 'x' }, 409) : null) });
    const line = await sync(n, 'qa', story());
    assert.match(line, /failed — 409/);
    assert.ok(storyWrite(n));
  });
  it('a 429 on the query is a failed line, not a throw', async () => {
    const n = notion({ fail: (m, p) => (p.startsWith('/data_sources/') ? respond({ code: 'rate_limited', message: 'slow' }, 429) : null) });
    assert.match(await sync(n, 'start', story()), /^failed — 429/);
  });
  it('a query returning a non-array results is a failed line', async () => {
    const n = notion({ fail: (m, p) => (p.startsWith('/data_sources/') ? respond({ results: 'nope' }) : null) });
    assert.match(await sync(n, 'start', story()), /^failed — /);
  });
});
