import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseDeferred, taskFor } from './debt-tasks.mjs';
import { logLine, main, PLANS_PAGE, STORIES } from './notion-sync.mjs';
import { readState } from './run-state.mjs';

// Every run injects fetch and gh: nothing here reaches Notion or GitHub.
const TOKEN = 'ntn_SECRET_never_print_me';
const FEATURE = 'specs/687-notion-sync-script';
const PR_URL = 'https://github.com/george-hutanu/motor-fix/pull/139';
const API = 'https://api.notion.com/v1';
const TIMELINE = 'tl1';

const sel = (name) => ({ type: 'select', select: name ? { name } : null });
const text = (type, value) => ({ type, [type]: [{ plain_text: value }] });
const story = (n, status, { epic = 'epic1', pr = null, ticked = false, priority = 'Medium' } = {}) => ({
  object: 'page',
  id: `story${n}`,
  url: `https://www.notion.so/story${n}`,
  properties: {
    Story: text('title', `Story ${n}`),
    ID: { type: 'unique_id', unique_id: { prefix: 'ST', number: n } },
    Status: sel(status),
    Priority: sel(priority),
    'Ready to work': { type: 'checkbox', checkbox: ticked },
    PR: { type: 'url', url: pr },
    Epic: { type: 'relation', relation: epic ? [{ id: epic }] : [] },
    Feature: { type: 'relation', relation: [] },
  },
});
const epic = (status) => ({
  object: 'page',
  id: 'epic1',
  url: 'https://www.notion.so/epic1',
  properties: { Epic: text('title', 'Foundations'), ID: { type: 'unique_id', unique_id: { prefix: 'EP', number: 1 } }, Status: sel(status) },
});
const row = (id, st, storyId, status, blockedBy = []) => ({
  object: 'page',
  id,
  properties: {
    Item: text('title', st),
    ST: text('rich_text', st),
    Story: { type: 'relation', relation: storyId ? [{ id: storyId }] : [] },
    'Build status': sel(status),
    'Blocked by': { type: 'relation', relation: blockedBy.map((b) => ({ id: b })) },
  },
});
const SCHEMA = {
  Story: { type: 'title' },
  'Issue type': { type: 'select' },
  Role: { type: 'select' },
  Status: { type: 'select' },
  Priority: { type: 'select' },
  'User story': { type: 'rich_text' },
  Epic: { type: 'relation' },
  Feature: { type: 'relation' },
};

const respond = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

/** A Notion workspace in memory: answers the endpoints the script uses and records every call. */
function workspace({ stories, epicStatus = 'In progress', rows = [], fail = () => null }) {
  const pages = new Map([...stories, epic(epicStatus), ...rows].map((p) => [p.id, p]));
  pages.set(PLANS_PAGE, { object: 'page', id: PLANS_PAGE, properties: {} });
  const calls = [];
  const fetchImpl = async (url, init) => {
    const path = url.slice(API.length);
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ method: init.method, path, body, auth: init.headers.Authorization });
    const failed = fail(init.method, path, body);
    if (failed) return failed;
    if (init.method === 'POST' && path === `/data_sources/${STORIES}/query`) {
      let results = stories.map((s) => pages.get(s.id));
      const f = body.filter;
      if (f?.unique_id) results = results.filter((s) => s.properties.ID.unique_id.number === f.unique_id.equals);
      if (f?.relation) results = results.filter((s) => s.properties[f.property].relation.some((r) => r.id === f.relation.contains));
      if (body.page_size) results = results.slice(0, body.page_size);
      return respond({ results, has_more: false, next_cursor: null });
    }
    if (init.method === 'GET' && path === `/data_sources/${STORIES}`) return respond({ object: 'data_source', id: STORIES, properties: SCHEMA });
    if (init.method === 'POST' && path === '/search') {
      return respond({
        results: [
          { object: 'data_source', id: 'tl5', title: [{ plain_text: 'Garage workspace (EP-5) — build timeline' }] },
          { object: 'data_source', id: TIMELINE, title: [{ plain_text: 'Foundations (EP-1) — build timeline' }] },
        ],
        has_more: false,
      });
    }
    if (init.method === 'POST' && path === `/data_sources/${TIMELINE}/query`) return respond({ results: rows.map((r) => pages.get(r.id)), has_more: false });
    if (init.method === 'GET' && path.startsWith('/pages/')) {
      const page = pages.get(path.slice(7));
      return page ? respond(page) : respond({ code: 'object_not_found', message: 'gone' }, 404);
    }
    if (init.method === 'PATCH' && path.startsWith('/pages/')) {
      const page = pages.get(path.slice(7));
      for (const [name, value] of Object.entries(body.properties)) page.properties[name] = { type: Object.keys(value)[0], ...value };
      return respond(page);
    }
    if (init.method === 'POST' && path === '/comments') return respond({ object: 'comment', id: 'c1' });
    if (init.method === 'POST' && path === '/pages') return respond({ object: 'page', id: 'new1', url: 'https://www.notion.so/new1' });
    return respond({ code: 'invalid_request_url', message: `no route ${init.method} ${path}` }, 400);
  };
  return { calls, fetchImpl, pages };
}

function repoWith({ deferred, body } = {}) {
  const repo = mkdtempSync(join(tmpdir(), 'notion-sync-'));
  mkdirSync(join(repo, FEATURE), { recursive: true });
  mkdirSync(join(repo, '.specify'), { recursive: true });
  writeFileSync(join(repo, FEATURE, 'spec.md'), '# Spec\n');
  writeFileSync(join(repo, '.specify', 'feature.json'), JSON.stringify({ feature_directory: FEATURE }));
  if (deferred) writeFileSync(join(repo, FEATURE, 'deferred.md'), deferred);
  if (body) writeFileSync(join(repo, 'comment.md'), body);
  return repo;
}

async function run(argv, { repo = repoWith(), ws, env = { NOTION_TOKEN: TOKEN }, ghOut = {} } = {}) {
  const out = [];
  const err = [];
  const gh = [];
  const code = await main(argv, {
    repo,
    env,
    fetchImpl: ws?.fetchImpl ?? (async () => assert.fail('fetch must not be called')),
    gh: (args) => {
      gh.push(args);
      if (args[0] === 'pr' && args[1] === 'view') return args.includes('.url') ? `${PR_URL}\n` : '139\n';
      return ghOut[args.slice(0, 2).join(' ')] ?? '';
    },
    now: () => new Date(2026, 9, 5, 12),
    sleep: async () => {},
    stdout: (s) => out.push(s),
    stderr: (s) => err.push(s),
  });
  const logFile = join(repo, FEATURE, 'notion-sync.md');
  let log = '';
  try {
    log = readFileSync(logFile, 'utf8');
  } catch {}
  return { code, out, err, gh, log, lines: log.split('\n').filter((l) => l.startsWith('- ')), repo, json: out.at(-1)?.startsWith('{') ? JSON.parse(out.at(-1)) : null };
}

/** The requests that change Notion, as `METHOD path body`. */
const writes = (calls) =>
  calls
    .filter((c) => c.method === 'PATCH' || (c.method === 'POST' && (c.path === '/comments' || c.path === '/pages')))
    .map((c) => `${c.method} ${c.path} ${JSON.stringify(c.body)}`);
const requests = (calls) => calls.map((c) => `${c.method} ${c.path}`);

const STAGE_REMOVALS = (keep) => ['planning', 'in development', 'QA', 'blocked'].filter((l) => !keep.includes(l)).flatMap((l) => ['--remove-label', l]);
const READS = [`POST /data_sources/${STORIES}/query`, 'GET /pages/epic1', 'POST /search', `POST /data_sources/${TIMELINE}/query`];

describe('start', () => {
  it('moves the story, its row and its epic, sets the stage label and refreshes Ready to work', async () => {
    const ws = workspace({
      epicStatus: 'To do',
      stories: [story(687, 'To do', { ticked: true }), story(20, 'To do'), story(30, 'To do')],
      rows: [row('r687', 'ST-687', 'story687', 'Not started'), row('r20', 'ST-20', 'story20', 'Not started', ['r687'])],
    });
    const r = await run(['start'], { ws });
    assert.equal(r.code, 0);
    assert.deepEqual(requests(ws.calls), [
      ...READS,
      'PATCH /pages/story687',
      'PATCH /pages/r687',
      'PATCH /pages/epic1',
      `POST /data_sources/${STORIES}/query`,
      'PATCH /pages/story687',
    ]);
    assert.deepEqual(ws.calls[0].body, { filter: { property: 'ID', unique_id: { equals: 687 } } });
    assert.deepEqual(ws.calls[2].body, { query: '(EP-1) — build timeline', filter: { property: 'object', value: 'data_source' } });
    assert.deepEqual(ws.calls[7].body, { filter: { property: 'Epic', relation: { contains: 'epic1' } } });
    assert.deepEqual(writes(ws.calls), [
      'PATCH /pages/story687 {"properties":{"Status":{"select":{"name":"Planning"}}}}',
      'PATCH /pages/r687 {"properties":{"Build status":{"select":{"name":"Planning"}}}}',
      'PATCH /pages/epic1 {"properties":{"Status":{"select":{"name":"In progress"}}}}',
      'PATCH /pages/story687 {"properties":{"Ready to work":{"checkbox":false}}}',
    ]);
    assert.deepEqual(r.gh, [
      ['pr', 'view', '--json', 'number', '-q', '.number'],
      ['pr', 'edit', '139', '--add-label', 'planning', ...STAGE_REMOVALS(['planning'])],
    ]);
    assert.deepEqual(r.lines, [
      '- 2026-10-05 · start · ST-687 · To do → Planning',
      '- 2026-10-05 · start · timeline · Not started → Planning',
      '- 2026-10-05 · start · EP-1 · To do → In progress',
      '- 2026-10-05 · labels · PR #139 · planning',
      '- 2026-10-05 · ready · Foundations · −ST-687, review: ST-30',
    ]);
    assert.deepEqual(r.json.ready, { tick: [], untick: ['ST-687'], review: ['ST-30'], held: [{ id: 'ST-20', reason: 'waits on ST-687 (Planning)' }] });
    assert.equal(r.out.length, 1, 'one JSON line');
    assert.ok(ws.calls.every((c) => c.auth === `Bearer ${TOKEN}`));
  });

  it('writes nothing to a story already Planning and an epic already In progress', async () => {
    const ws = workspace({ stories: [story(687, 'Planning')], rows: [row('r687', 'ST-687', 'story687', 'Planning')] });
    const r = await run(['start'], { ws });
    assert.deepEqual(writes(ws.calls), []);
    assert.deepEqual(r.lines.slice(0, 2), ['- 2026-10-05 · start · ST-687 · Planning unchanged', '- 2026-10-05 · start · EP-1 · In progress (unchanged)']);
    assert.equal(r.lines.at(-1), '- 2026-10-05 · ready · Foundations · no change');
  });

  it('logs a story with no timeline row', async () => {
    const ws = workspace({ stories: [story(687, 'To do')] });
    const r = await run(['start'], { ws });
    assert.ok(r.lines.includes('- 2026-10-05 · start · timeline · no row for ST-687'));
  });
});

describe('implement, qa and review', () => {
  for (const [event, from, to, stage] of [
    ['implement', 'Planning', 'Implementing', 'in development'],
    ['qa', 'Implementing', 'QA', 'QA'],
    ['review', 'Implementing', 'QA', 'QA'],
  ]) {
    it(`${event} moves ${from} to ${to}, the row with it, and leaves the epic and readiness alone`, async () => {
      const ws = workspace({ stories: [story(687, from)], rows: [row('r687', 'ST-687', 'story687', from)] });
      const r = await run([event], { ws });
      assert.deepEqual(requests(ws.calls), [...READS, 'PATCH /pages/story687', 'PATCH /pages/r687']);
      assert.deepEqual(writes(ws.calls), [
        `PATCH /pages/story687 {"properties":{"Status":{"select":{"name":"${to}"}}}}`,
        `PATCH /pages/r687 {"properties":{"Build status":{"select":{"name":"${to}"}}}}`,
      ]);
      assert.deepEqual(r.gh.at(-1), ['pr', 'edit', '139', '--add-label', stage, ...STAGE_REMOVALS([stage])]);
      assert.deepEqual(r.lines, [
        `- 2026-10-05 · ${event} · ST-687 · ${from} → ${to}`,
        `- 2026-10-05 · ${event} · timeline · ${from} → ${to}`,
        `- 2026-10-05 · labels · PR #139 · ${stage}`,
      ]);
    });
  }

  it('takes the PR number from --pr instead of asking gh', async () => {
    const ws = workspace({ stories: [story(687, 'Planning')] });
    const r = await run(['implement', '--pr', '77'], { ws });
    assert.deepEqual(r.gh, [['pr', 'edit', '77', '--add-label', 'in development', ...STAGE_REMOVALS(['in development'])]]);
  });

  it('takes the story from --story instead of the feature number', async () => {
    const ws = workspace({ stories: [story(12, 'Planning')] });
    await run(['implement', '--story', 'ST-12'], { ws });
    assert.deepEqual(ws.calls[0].body, { filter: { property: 'ID', unique_id: { equals: 12 } } });
  });
});

describe('blocked and unblock', () => {
  it('blocks with the reason on the story and the PR, then returns to where it was', async () => {
    const repo = repoWith();
    const ws = workspace({ stories: [story(687, 'Implementing')], rows: [row('r687', 'ST-687', 'story687', 'Implementing')] });
    const blocked = await run(['blocked', 'CI red: the e2e job needs a secret only the owner can add'], { ws, repo });
    assert.deepEqual(writes(ws.calls), [
      'POST /comments {"parent":{"page_id":"story687"},"markdown":"Blocked: CI red: the e2e job needs a secret only the owner can add"}',
      'PATCH /pages/story687 {"properties":{"Status":{"select":{"name":"Blocked"}}}}',
      'PATCH /pages/r687 {"properties":{"Build status":{"select":{"name":"Blocked"}}}}',
    ]);
    assert.deepEqual(blocked.gh.slice(1), [
      ['pr', 'comment', '139', '--body', 'Blocked: CI red: the e2e job needs a secret only the owner can add'],
      ['pr', 'edit', '139', '--add-label', 'in development', '--add-label', 'blocked', '--remove-label', 'planning', '--remove-label', 'QA'],
    ]);
    assert.equal(readState(repo).notion_prior_status, 'Implementing');
    assert.equal(blocked.lines[0], '- 2026-10-05 · blocked · ST-687 · Implementing → Blocked — CI red: the e2e job needs a secret only the owner can add');

    ws.calls.length = 0;
    const unblocked = await run(['unblock'], { ws, repo });
    assert.deepEqual(writes(ws.calls), [
      'PATCH /pages/story687 {"properties":{"Status":{"select":{"name":"Implementing"}}}}',
      'PATCH /pages/r687 {"properties":{"Build status":{"select":{"name":"Implementing"}}}}',
    ]);
    assert.equal(readState(repo).notion_prior_status, null);
    assert.equal(unblocked.lines.at(-3), '- 2026-10-05 · unblock · ST-687 · Blocked → Implementing');
  });

  it('refuses a blocked event with no reason', async () => {
    const r = await run(['blocked']);
    assert.equal(r.code, 64);
  });
});

describe('finish', () => {
  it('closes the story, the row and the last open epic, posts the comment and refreshes readiness', async () => {
    const repo = repoWith({ body: '## Decisions taken on the owner\'s behalf\n- exit 3 for no token (spec.md)\n- `plan` stays on the connector (spec.md)\n' });
    const ws = workspace({ stories: [story(687, 'QA'), story(20, 'Done')], rows: [row('r687', 'ST-687', 'story687', 'QA')] });
    const r = await run(['finish', '--body-file', join(repo, 'comment.md')], { ws, repo });
    assert.equal(r.code, 0);
    assert.deepEqual(requests(ws.calls), [
      ...READS,
      'PATCH /pages/story687',
      'PATCH /pages/r687',
      `POST /data_sources/${STORIES}/query`,
      'PATCH /pages/epic1',
      'POST /comments',
    ]);
    assert.deepEqual(writes(ws.calls).slice(0, 3), [
      'PATCH /pages/story687 {"properties":{"Status":{"select":{"name":"Done"}}}}',
      'PATCH /pages/r687 {"properties":{"Build status":{"select":{"name":"Merged"}}}}',
      'PATCH /pages/epic1 {"properties":{"Status":{"select":{"name":"Done"}}}}',
    ]);
    assert.deepEqual(ws.calls.at(-1).body, { parent: { page_id: 'story687' }, markdown: readFileSync(join(repo, 'comment.md'), 'utf8') });
    assert.deepEqual(r.gh.at(-1), ['pr', 'edit', '139', ...STAGE_REMOVALS([])]);
    assert.deepEqual(r.lines, [
      '- 2026-10-05 · finish · ST-687 · QA → Done',
      '- 2026-10-05 · finish · timeline · QA → Merged',
      '- 2026-10-05 · finish · EP-1 · In progress → Done',
      '- 2026-10-05 · comment · ST-687 · posted (2 items)',
      '- 2026-10-05 · labels · PR #139 · none',
      '- 2026-10-05 · ready · Foundations · no change',
    ]);
  });

  it('keeps the epic open while another story is not Done, and logs a finish with nothing to record', async () => {
    const ws = workspace({ stories: [story(687, 'QA'), story(20, 'Implementing')] });
    const r = await run(['finish', '--no-comment'], { ws });
    assert.ok(!writes(ws.calls).some((w) => w.startsWith('PATCH /pages/epic1')));
    assert.ok(!ws.calls.some((c) => c.path === '/comments'));
    assert.ok(r.lines.includes('- 2026-10-05 · finish · EP-1 · In progress (unchanged)'));
    assert.ok(r.lines.includes('- 2026-10-05 · comment · ST-687 · nothing to record'));
  });

  it('never posts the finish comment twice', async () => {
    const repo = repoWith({ body: '- one\n' });
    writeFileSync(join(repo, FEATURE, 'notion-sync.md'), '# Notion sync\n\n- 2026-10-05 · comment · ST-687 · posted (1 items)\n');
    const ws = workspace({ stories: [story(687, 'Done')] });
    await run(['finish', '--body-file', join(repo, 'comment.md')], { ws, repo });
    assert.ok(!ws.calls.some((c) => c.path === '/comments'));
  });

  it('needs a body file or --no-comment: an absent comment is a decision', async () => {
    const r = await run(['finish']);
    assert.equal(r.code, 64);
  });
});

describe('pr', () => {
  it('links the PR, labels the epic and logs the line the lifecycle gate reads', async () => {
    const ws = workspace({ stories: [story(687, 'Planning')] });
    const r = await run(['pr', '139'], { ws });
    assert.deepEqual(requests(ws.calls), [`POST /data_sources/${STORIES}/query`, 'PATCH /pages/story687', 'GET /pages/epic1']);
    assert.deepEqual(writes(ws.calls), [`PATCH /pages/story687 {"properties":{"PR":{"url":"${PR_URL}"}}}`]);
    assert.deepEqual(r.gh, [
      ['pr', 'view', '139', '--json', 'url', '-q', '.url'],
      ['label', 'create', 'EP-1', '--force'],
      ['pr', 'edit', '139', '--add-label', 'EP-1'],
    ]);
    assert.deepEqual(r.lines, [`- 2026-10-05 · pr · ST-687 · PR #139 ${PR_URL}`]);
    assert.match(r.lines[0], /· pr · .*#139\b/);
  });

  it('leaves an equal link alone', async () => {
    const ws = workspace({ stories: [story(687, 'Planning', { pr: PR_URL })] });
    const r = await run(['pr', '139'], { ws });
    assert.deepEqual(writes(ws.calls), []);
    assert.deepEqual(r.lines, [`- 2026-10-05 · pr · ST-687 · PR #139 ${PR_URL} (unchanged)`]);
  });

  it('keeps the first PR and comments a follow-up', async () => {
    const first = 'https://github.com/george-hutanu/motor-fix/pull/100';
    const ws = workspace({ stories: [story(687, 'Planning', { pr: first })] });
    const r = await run(['pr', '139'], { ws });
    assert.deepEqual(writes(ws.calls), [`POST /comments {"parent":{"page_id":"story687"},"markdown":"Follow-up PR: ${PR_URL}"}`]);
    assert.deepEqual(r.lines, [`- 2026-10-05 · pr · ST-687 · PR #139 ${PR_URL} (follow-up; PR keeps ${first})`]);
  });
});

describe('debt', () => {
  it('files each pending deferred bullet as the task debt-tasks builds, then marks it', async () => {
    const deferred = [
      '# Deferred',
      '',
      '- **medium** — `.claude/scripts/notion-sync.mjs` — bundle several events in one call (code-reviewer)',
      '- **low** — `x.mjs` — already filed (spec-reviewer) — Notion: https://www.notion.so/old',
      '',
    ].join('\n');
    const repo = repoWith({ deferred });
    const ws = workspace({ stories: [story(687, 'QA', { pr: PR_URL })] });
    const r = await run(['debt'], { ws, repo });
    const [entry] = parseDeferred(deferred).filter((e) => e.pending);
    const task = taskFor(entry, { story: 'https://www.notion.so/story687', epic: 'epic1', pr: PR_URL, storyId: 'ST-687' });
    assert.deepEqual(requests(ws.calls), [`POST /data_sources/${STORIES}/query`, `GET /data_sources/${STORIES}`, 'POST /pages']);
    assert.deepEqual(ws.calls[2].body, {
      parent: { type: 'data_source_id', data_source_id: STORIES },
      properties: {
        Story: { title: [{ type: 'text', text: { content: task.properties.Story } }] },
        'Issue type': { select: { name: 'Tech debt' } },
        Role: { select: { name: 'System' } },
        Status: { select: { name: 'To do' } },
        Priority: { select: { name: 'Medium' } },
        'User story': { rich_text: [{ type: 'text', text: { content: task.properties['User story'] } }] },
        Epic: { relation: [{ id: 'epic1' }] },
      },
      markdown: task.content,
    });
    const after = readFileSync(join(repo, FEATURE, 'deferred.md'), 'utf8').split('\n');
    assert.equal(after[2], `${deferred.split('\n')[2]} — Notion: https://www.notion.so/new1`);
    assert.deepEqual(r.lines, ['- 2026-10-05 · debt · ST-687 · deferred.md line 2 → https://www.notion.so/new1']);

    ws.calls.length = 0;
    await run(['debt'], { ws, repo });
    assert.ok(!ws.calls.some((c) => c.path === '/pages'), 'a marked bullet is never filed twice');
  });
});

describe('ready', () => {
  it('ticks only the candidates confirmed after the hold review', async () => {
    const ws = workspace({ stories: [story(687, 'Planning'), story(30, 'To do'), story(31, 'To do')] });
    const r = await run(['ready', '--tick', 'ST-30'], { ws });
    assert.deepEqual(requests(ws.calls), [...READS, `POST /data_sources/${STORIES}/query`, 'PATCH /pages/story30']);
    assert.deepEqual(writes(ws.calls), ['PATCH /pages/story30 {"properties":{"Ready to work":{"checkbox":true}}}']);
    assert.deepEqual(r.lines, ['- 2026-10-05 · ready · Foundations · +ST-30']);
    assert.deepEqual(r.json.ready.held.map((h) => h.id), ['ST-31']);
  });
});

describe('failing open', () => {
  it('without a token writes nothing and exits 3 with the fallback line', async () => {
    for (const argv of [['start'], ['pr', '139'], ['finish', '--no-comment'], ['debt'], ['check']]) {
      const r = await run(argv, { env: {} });
      assert.equal(r.code, 3);
      assert.deepEqual(r.out, ['notion-sync: no NOTION_TOKEN, use the connector']);
      assert.deepEqual(r.gh, []);
      assert.equal(r.log, '');
    }
  });

  it('logs a Notion error as PENDING, exits 0, and the next run retries it first', async () => {
    const repo = repoWith();
    const down = workspace({
      stories: [story(687, 'Planning')],
      fail: (method) => (method === 'PATCH' ? respond({ code: 'internal_server_error', message: 'boom' }, 500) : null),
    });
    const r = await run(['implement'], { ws: down, repo });
    assert.equal(r.code, 0);
    assert.deepEqual(r.lines, ['- [NOTION-SYNC PENDING: implement ST-687 — 500 internal_server_error] retry: ["implement"]']);
    assert.equal(r.json.pending, 'implement ST-687 — 500 internal_server_error');

    const up = workspace({ stories: [story(687, 'Planning')] });
    const next = await run(['qa'], { ws: up, repo });
    assert.equal(next.code, 0);
    assert.deepEqual(writes(up.calls).filter((w) => w.includes('"Status"')), [
      'PATCH /pages/story687 {"properties":{"Status":{"select":{"name":"Implementing"}}}}',
      'PATCH /pages/story687 {"properties":{"Status":{"select":{"name":"QA"}}}}',
    ]);
    assert.match(next.log, /^- \[NOTION-SYNC RETRIED 2026-10-05: implement ST-687 — 500 internal_server_error\]/m);
    assert.doesNotMatch(next.log, /NOTION-SYNC PENDING/);
  });

  it('names a failed ready refresh so the archive check still sees it', async () => {
    const ws = workspace({
      stories: [story(687, 'To do', { ticked: true })],
      fail: (method, path, body) => (method === 'PATCH' && body.properties['Ready to work'] ? respond({ code: 'service_unavailable', message: 'x' }, 503) : null),
    });
    const r = await run(['start'], { ws });
    assert.equal(r.lines.at(-1), '- [NOTION-SYNC PENDING: ready Foundations — 503 service_unavailable] retry: ["start"]');
  });

  it('never prints or logs the token, even when Notion echoes it', async () => {
    const echo = () => respond({ code: 'unauthorized', message: `token ${TOKEN} rejected` }, 401);
    for (const argv of [['start'], ['implement'], ['pr', '139'], ['finish', '--no-comment'], ['debt'], ['check'], ['blocked', 'x']]) {
      const ws = workspace({ stories: [story(687, 'Planning')], fail: echo });
      const r = await run(argv, { ws });
      assert.ok(![...r.out, ...r.err, r.log].join('\n').includes(TOKEN), `${argv[0]} leaked the token`);
    }
  });
});

describe('the connector path writes the same line', () => {
  it('log formats exactly as the event does', async () => {
    const ws = workspace({ stories: [story(687, 'To do')] });
    const scripted = await run(['start'], { ws });
    const repo = repoWith();
    const logged = await run(['log', 'start', 'ST-687', 'To do → Planning'], { repo, env: {} });
    assert.equal(logged.code, 0);
    assert.equal(logged.lines[0], scripted.lines[0]);
    assert.equal(logLine({ date: '2026-10-05', event: 'start', item: 'ST-687', text: 'To do → Planning' }), scripted.lines[0]);
  });

  it('logs a connector failure as a PENDING line', async () => {
    const r = await run(['log', '--pending', 'ready', 'Foundations', 'usage limit'], { env: {} });
    assert.deepEqual(r.lines, ['- [NOTION-SYNC PENDING: ready Foundations — usage limit]']);
  });

  it('starts a new log with its heading', async () => {
    const r = await run(['log', 'start', 'ST-687', 'x'], { env: {} });
    assert.ok(r.log.startsWith('# Notion sync — 687-notion-sync-script\n\n'));
  });
});

describe('check', () => {
  it('reads the stories data source, the Plans page and one story, and writes nothing', async () => {
    const ws = workspace({ stories: [story(687, 'QA')] });
    const r = await run(['check'], { ws });
    assert.equal(r.code, 0);
    assert.deepEqual(requests(ws.calls), [`GET /data_sources/${STORIES}`, `GET /pages/${PLANS_PAGE}`, `POST /data_sources/${STORIES}/query`, 'GET /pages/story687']);
    assert.deepEqual(ws.calls[2].body, { page_size: 1 });
    assert.deepEqual(r.json, { check: 'ok', stories: 'ok', plans: 'ok', page: 'ok' });
    assert.equal(r.log, '');
  });

  it('exits 1 naming what it could not reach', async () => {
    const ws = workspace({ stories: [story(687, 'QA')], fail: (m, path) => (path === `/pages/${PLANS_PAGE}` ? respond({ code: 'object_not_found', message: 'x' }, 404) : null) });
    const r = await run(['check'], { ws });
    assert.equal(r.code, 1);
    assert.deepEqual(r.json, { check: 'failed', stories: 'ok', plans: '404 object_not_found', page: 'ok' });
  });
});

describe('usage', () => {
  it('answers an unknown event with 64', async () => {
    assert.equal((await run(['launch'])).code, 64);
  });
});
