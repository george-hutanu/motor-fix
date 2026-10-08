import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { main, PLANS_PAGE, STORIES } from './notion-sync.mjs';
import { readyLogged } from './notion-ready.mjs';

const TOKEN = 'ntn_SECRET_never_print_me';
const FEATURE = 'specs/687-notion-sync-script';
const PR_URL = 'https://github.com/george-hutanu/motor-fix/pull/139';
const API = 'https://api.notion.com/v1';
const NO_EPIC = '(the story has no epic)';

const sel = (name) => ({ type: 'select', select: name ? { name } : null });
const text = (type, value) => ({ type, [type]: [{ plain_text: value }] });
const story = (n, status, { epic = null, pr = null, ticked = false, feature = null } = {}) => ({
  object: 'page',
  id: `story${n}`,
  url: `https://www.notion.so/story${n}`,
  properties: {
    Story: text('title', `Story ${n}`),
    ID: { type: 'unique_id', unique_id: { prefix: 'ST', number: n } },
    Status: sel(status),
    Priority: sel('Medium'),
    'Ready to work': { type: 'checkbox', checkbox: ticked },
    PR: { type: 'url', url: pr },
    Epic: { type: 'relation', relation: epic ? [{ id: epic }] : [] },
    Feature: { type: 'relation', relation: feature ? [{ id: feature }] : [] },
  },
});
const epicPage = {
  object: 'page',
  id: 'epic1',
  url: 'https://www.notion.so/epic1',
  properties: { Epic: text('title', 'Foundations'), ID: { type: 'unique_id', unique_id: { prefix: 'EP', number: 1 } }, Status: sel('In progress') },
};
const SCHEMA = {
  Story: { type: 'title' }, 'Issue type': { type: 'select' }, Role: { type: 'select' }, Status: { type: 'select' },
  Priority: { type: 'select' }, 'User story': { type: 'rich_text' }, Epic: { type: 'relation' }, Feature: { type: 'relation' },
};
const respond = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

function workspace({ stories, failPages = false }) {
  const pages = new Map([...stories, epicPage].map((p) => [p.id, p]));
  pages.set(PLANS_PAGE, { object: 'page', id: PLANS_PAGE, properties: {} });
  const calls = [];
  let created = 0;
  const fetchImpl = async (url, init) => {
    const path = url.slice(API.length);
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ method: init.method, path, body });
    if (init.method === 'POST' && path === `/data_sources/${STORIES}/query`) {
      let results = stories.map((s) => pages.get(s.id));
      const f = body.filter;
      if (f?.unique_id) results = results.filter((s) => s.properties.ID.unique_id.number === f.unique_id.equals);
      if (f?.relation) results = results.filter((s) => s.properties[f.property].relation.some((r) => r.id === f.relation.contains));
      return respond({ results, has_more: false, next_cursor: null });
    }
    if (init.method === 'GET' && path === `/data_sources/${STORIES}`) return respond({ object: 'data_source', id: STORIES, properties: SCHEMA });
    if (init.method === 'POST' && path === '/search') return respond({ results: [{ object: 'data_source', id: 'tl1', title: [{ plain_text: 'Foundations (EP-1) — build timeline' }] }], has_more: false });
    if (init.method === 'POST' && path === '/data_sources/tl1/query') return respond({ results: [], has_more: false });
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
    if (init.method === 'POST' && path === '/pages') {
      if (failPages && created === 0) {
        created++;
        return respond({ code: 'validation_error', message: 'boom' }, 400);
      }
      created++;
      return respond({ object: 'page', id: `new${created}`, url: `https://www.notion.so/new${created}` });
    }
    return respond({ code: 'invalid_request_url', message: `no route ${init.method} ${path}` }, 400);
  };
  return { calls, fetchImpl };
}

function repoWith({ deferred, log } = {}) {
  const repo = mkdtempSync(join(tmpdir(), 'notion-sync-adv-'));
  mkdirSync(join(repo, FEATURE), { recursive: true });
  mkdirSync(join(repo, '.specify'), { recursive: true });
  writeFileSync(join(repo, FEATURE, 'spec.md'), '# Spec\n');
  writeFileSync(join(repo, '.specify', 'feature.json'), JSON.stringify({ feature_directory: FEATURE }));
  if (deferred) writeFileSync(join(repo, FEATURE, 'deferred.md'), deferred);
  if (log) writeFileSync(join(repo, FEATURE, 'notion-sync.md'), log);
  return repo;
}

async function run(argv, { repo = repoWith(), ws } = {}) {
  const out = [];
  const gh = [];
  const code = await main(argv, {
    repo,
    env: { NOTION_TOKEN: TOKEN },
    fetchImpl: ws.fetchImpl,
    gh: (args) => {
      gh.push(args);
      if (args[0] === 'pr' && args[1] === 'view') return args.includes('.url') ? `${PR_URL}\n` : '139\n';
      return '';
    },
    now: () => new Date(2026, 9, 5, 12),
    workTimeline: async () => null,
    sleep: async () => {},
    stdout: (s) => out.push(s),
    stderr: () => {},
  });
  let log = '';
  try {
    log = readFileSync(join(repo, FEATURE, 'notion-sync.md'), 'utf8');
  } catch {}
  return { code, gh, log, repo, lines: log.split('\n').filter((l) => l.startsWith('- ')) };
}
const writes = (calls) => calls.filter((c) => c.method === 'PATCH' || (c.method === 'POST' && (c.path === '/comments' || c.path === '/pages')));
const readyLines = (r) => r.lines.filter((l) => l.split(' · ')[1] === 'ready');

describe('start, finish and ready for a story with no epic', () => {
  it('never reads an epic page or a build timeline', async () => {
    for (const argv of [['start'], ['ready'], ['finish', '--no-comment']]) {
      const ws = workspace({ stories: [story(687, 'QA', { pr: PR_URL })] });
      await run(argv, { ws });
      assert.deepEqual(ws.calls.filter((c) => c.path === '/search' || c.path.startsWith('/pages/epic1') || c.path.includes('tl1')), [], argv.join(' '));
    }
  });

  it('logs exactly one ready line per run', async () => {
    for (const argv of [['start'], ['ready'], ['finish', '--no-comment']]) {
      const ws = workspace({ stories: [story(687, 'QA', { pr: PR_URL })] });
      const r = await run(argv, { ws });
      assert.equal(readyLines(r).length, 1, argv.join(' '));
      assert.ok(readyLines(r)[0].endsWith(NO_EPIC), argv.join(' '));
    }
  });

  it('keeps Ready to work ticked on a story that is still To do', async () => {
    const ws = workspace({ stories: [story(687, 'To do', { ticked: true })] });
    const r = await run(['ready'], { ws });
    assert.equal(r.code, 0);
    assert.deepEqual(writes(ws.calls), []);
    assert.deepEqual(readyLines(r), [`- 2026-10-05 · ready · ST-687 · no change ${NO_EPIC}`]);
  });

  it('unticks a ticked story that has left To do, whatever stage it is in', async () => {
    for (const status of ['Planning', 'Implementing', 'QA', 'Blocked', 'Done']) {
      const ws = workspace({ stories: [story(687, status, { ticked: true })] });
      const r = await run(['ready'], { ws });
      assert.deepEqual(writes(ws.calls).map((c) => c.body), [{ properties: { 'Ready to work': { checkbox: false } } }], status);
      assert.deepEqual(readyLines(r), [`- 2026-10-05 · ready · ST-687 · −ST-687 ${NO_EPIC}`], status);
    }
  });

  it('writes nothing for an already unticked story past To do', async () => {
    const ws = workspace({ stories: [story(687, 'Implementing', { ticked: false })] });
    await run(['ready'], { ws });
    assert.deepEqual(writes(ws.calls), []);
  });

  it('is idempotent: a second ready run changes nothing and logs the no-change line', async () => {
    const ws = workspace({ stories: [story(687, 'Implementing', { ticked: true })] });
    const repo = repoWith();
    const first = await run(['ready'], { ws, repo });
    assert.match(readyLines(first)[0], /−ST-687/);
    const second = await run(['ready'], { ws, repo });
    assert.equal(readyLines(second).at(-1), `- 2026-10-05 · ready · ST-687 · no change ${NO_EPIC}`);
    assert.equal(writes(ws.calls).filter((c) => c.path === '/pages/story687').length, 1);
  });

  it('puts the ready line after the finish line so the archive check passes, comment or not', async () => {
    const repo = repoWith();
    writeFileSync(join(repo, 'comment.md'), "## Decisions taken on the owner's behalf\n- one thing\n");
    const ws = workspace({ stories: [story(687, 'QA', { pr: PR_URL })] });
    const r = await run(['finish', '--body-file', join(repo, 'comment.md')], { ws, repo });
    const events = r.lines.map((l) => l.split(' · ')[1]);
    assert.ok(events.indexOf('ready') > events.lastIndexOf('finish'));
    assert.deepEqual(readyLogged(r.log), { ok: true, reason: 'ready refreshed after finish' });
  });

  it('does not change what a finish logged on an earlier run when it is run again', async () => {
    const ws = workspace({ stories: [story(687, 'QA', { pr: PR_URL })] });
    const repo = repoWith();
    await run(['finish', '--no-comment'], { ws, repo });
    const second = await run(['finish', '--no-comment'], { ws, repo });
    assert.deepEqual(readyLogged(second.log), { ok: true, reason: 'ready refreshed after finish' });
  });

  it('keeps the epic path for a story that has an epic', async () => {
    const ws = workspace({ stories: [story(687, 'QA', { epic: 'epic1', pr: PR_URL })] });
    const r = await run(['finish', '--no-comment'], { ws });
    assert.ok(ws.calls.some((c) => c.path === '/pages/epic1' && c.method === 'GET'));
    assert.equal(r.log.includes(NO_EPIC), false);
    assert.match(readyLines(r)[0], /ready · Foundations ·/);
  });
});

describe('debt for a story with no epic', () => {
  it('files every pending bullet, none with an Epic, and marks each with its own url', async () => {
    const deferred = '# Deferred\n\n- **low** — `a.mjs` — one (code-reviewer)\n- **medium** — `b.mjs` — two (code-reviewer)\n';
    const repo = repoWith({ deferred });
    const ws = workspace({ stories: [story(687, 'QA', { pr: PR_URL })] });
    const r = await run(['debt'], { ws, repo });
    assert.equal(r.code, 0);
    const posts = ws.calls.filter((c) => c.method === 'POST' && c.path === '/pages');
    assert.equal(posts.length, 2);
    assert.ok(posts.every((p) => !('Epic' in p.body.properties)));
    const after = readFileSync(join(repo, FEATURE, 'deferred.md'), 'utf8').split('\n');
    assert.ok(after[2].endsWith('— Notion: https://www.notion.so/new1'));
    assert.ok(after[3].endsWith('— Notion: https://www.notion.so/new2'));
  });

  it('keeps the Feature relation when the story has a feature but no epic', async () => {
    const repo = repoWith({ deferred: '- **low** — `a.mjs` — one (code-reviewer)\n' });
    const ws = workspace({ stories: [story(687, 'QA', { pr: PR_URL, feature: 'feat1' })] });
    await run(['debt'], { ws, repo });
    const post = ws.calls.find((c) => c.path === '/pages');
    assert.equal('Epic' in post.body.properties, false);
    assert.deepEqual(post.body.properties.Feature, { relation: [{ id: 'feat1' }] });
  });

  it('does not mark a bullet whose filing Notion refused, and files the rest on a re-run', async () => {
    const deferred = '- **low** — `a.mjs` — one (code-reviewer)\n';
    const repo = repoWith({ deferred });
    const ws = workspace({ stories: [story(687, 'QA', { pr: PR_URL })], failPages: true });
    await run(['debt'], { ws, repo });
    assert.equal(readFileSync(join(repo, FEATURE, 'deferred.md'), 'utf8'), deferred);
    await run(['debt'], { ws, repo });
    assert.match(readFileSync(join(repo, FEATURE, 'deferred.md'), 'utf8'), /Notion: https:\/\/www\.notion\.so\/new2/);
  });

  it('files nothing and writes nothing for a file with no pending bullet', async () => {
    const repo = repoWith({ deferred: '# Deferred\n\n- **low** — `a.mjs` — done (code-reviewer) — Notion: https://www.notion.so/old\n' });
    const ws = workspace({ stories: [story(687, 'QA', { pr: PR_URL })] });
    const r = await run(['debt'], { ws, repo });
    assert.equal(r.code, 0);
    assert.deepEqual(writes(ws.calls), []);
  });
});
