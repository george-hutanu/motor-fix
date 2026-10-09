// @traces 1018-FR-007
// @traces 1018-FR-008
// @traces 1018-FR-009
// @traces 1018-FR-010
// @traces 1018-FR-011
// @traces 1018-FR-012
// @traces 1018-FR-013
import { afterEach, beforeEach, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

import { EPICS, EXCLUDED, run } from './notion-export.mjs';
import { STORIES } from './notion-sync.mjs';
import { FILE_HOST, IDS, space, TOKEN } from './notion-export/fixtures/space.mjs';

let root;
let docs;
let fx;

function checkout({ moved = true } = {}) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'notion-export-')));
  const clone = join(dir, '.motor-fix-specs');
  mkdirSync(join(clone, 'docs'), { recursive: true });
  writeFileSync(join(clone, 'docs', 'README.md'), 'docs\n');
  if (moved) {
    mkdirSync(join(clone, 'specs', '100-old'), { recursive: true });
    writeFileSync(join(clone, 'specs', '100-old', 'spec.md'), '# old\n');
  } else {
    mkdirSync(join(clone, '100-old'));
    writeFileSync(join(clone, '100-old', 'spec.md'), '# old\n');
  }
  const git = (...args) => execFileSync('git', args, { cwd: clone, stdio: 'ignore' });
  git('init', '-q', '-b', 'trunk');
  git('add', '-A');
  git('-c', 'user.name=t', '-c', 'user.email=t@x', 'commit', '-q', '-m', 'seed');
  return dir;
}

const exportDocs = (argv = [], env = { NOTION_TOKEN: TOKEN }) =>
  run({ argv, env, root, fetchImpl: fx.fetchImpl, rootPage: IDS.root, sleep: async () => {} });

function tree(dir = docs) {
  const out = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out.push(relative(docs, p));
    }
  };
  if (existsSync(dir)) walk(dir);
  return out.sort();
}
const read = (path) => readFileSync(join(docs, path), 'utf8');
const mtimes = () => Object.fromEntries(tree().map((p) => [p, statSync(join(docs, p)).mtimeMs]));

const EXPORTED = [
  'index.md',
  'overview/index.md',
  'overview/index.files/diagram.png',
  'overview/vision.md',
  'overview/vision-3d000000.md',
  `overview/${IDS.untitled}.md`,
  'delivery/index.md',
  'delivery/motorfix-stories.md',
  'delivery/motorfix-epics.md',
  'delivery/roadmap-view.md',
  'delivery/decisions-view.md',
  'decisions/index.md',
  'decisions/use-postgres.md',
];

beforeEach(() => {
  root = checkout();
  docs = join(root, '.motor-fix-specs', 'docs');
  fx = space({ stories: STORIES, epics: EPICS });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('the exported tree', () => {
  it('writes a folder per page with children, a file per leaf, a database folder and a file per row with a body', async () => {
    const r = await exportDocs();
    assert.equal(r.code, 0, JSON.stringify(r.report));
    assert.deepEqual(tree(), [...EXPORTED, 'README.md', 'index.json'].sort());
    assert.equal(read('README.md'), 'docs\n', 'the README the trunk move wrote is left alone');
    assert.equal(r.report.created, EXPORTED.length);
  });

  it('opens every Markdown file with the four front-matter keys, in order', async () => {
    await exportDocs();
    for (const path of EXPORTED.filter((p) => p.endsWith('.md'))) {
      const head = read(path).split('\n').slice(0, 6);
      assert.equal(head[0], '---', path);
      assert.match(head[1], /^title: ".*"$/, path);
      assert.match(head[2], /^notion_id: [0-9a-f-]{36}$/, path);
      assert.match(head[3], /^notion_url: https:\/\/www\.notion\.so\//, path);
      assert.match(head[4], /^last_edited: \d{4}-\d\d-\d\dT/, path);
      assert.equal(head[5], '---', path);
    }
    assert.match(read('overview/vision-3d000000.md'), new RegExp(`notion_id: ${IDS.vision2}`));
  });

  it('rewrites links inside the space to relative paths and leaves the rest unchanged', async () => {
    await exportDocs();
    assert.match(read('index.md'), /\[Overview\]\(overview\/index\.md\)/);
    assert.match(read('index.md'), /\[Decisions\]\(decisions\/index\.md\)/);
    const vision = read('overview/vision.md');
    assert.match(vision, /\[vision\]\(vision-3d000000\.md\)/);
    assert.match(vision, /\[a site\]\(https:\/\/example\.com\/read\)/);
    assert.match(vision, new RegExp(`\\[Outside the space\\]\\(https://www\\.notion\\.so/${IDS.outside.replaceAll('-', '')}\\)`));
    assert.match(read('overview/index.md'), /\[Vision\]\(vision\.md\)/);
    assert.match(read('overview/index.md'), /!\[\]\(https:\/\/example\.com\/outside\.png\)/);
  });

  it('writes a database as a table of every row, linking the rows that have a body', async () => {
    await exportDocs();
    const table = read('decisions/index.md');
    assert.match(table, /\| Name \| Status \| Related \|/);
    assert.match(table, /\| \[Use Postgres\]\(use-postgres\.md\) \| Accepted \| {2}\|/);
    assert.match(table, /\| Pick Redis \| Open \| \[use-postgres\]\(use-postgres\.md\) \|/);
    assert.match(read('decisions/use-postgres.md'), /Because PostGIS\./);
  });

  it('writes a linked view as a pointer: to the canonical folder in the space, else to its Notion URL', async () => {
    await exportDocs();
    assert.match(read('delivery/decisions-view.md'), /\(\.\.\/decisions\/index\.md\)/);
    assert.match(read('delivery/roadmap-view.md'), new RegExp(IDS.roadmapView.replaceAll('-', '')));
  });

  it('turns Stories and Epics into one pointer each and never queries or reads them', async () => {
    await exportDocs();
    for (const path of ['delivery/motorfix-stories.md', 'delivery/motorfix-epics.md']) {
      assert.match(read(path), /GitHub Project/);
      assert.match(read(path), /george-hutanu\/motor-fix-specs/);
    }
    assert.ok(!fx.calls.some((c) => c.url.includes(STORIES) || c.url.includes(EPICS)), fx.calls.map((c) => c.url).join('\n'));
  });

  it('downloads a hosted file next to its page, notes one over 50 MB without its URL, and keeps signed URLs out', async () => {
    const r = await exportDocs();
    assert.equal(readFileSync(join(docs, 'overview/index.files/diagram.png'), 'utf8'), 'PNGDATA');
    assert.match(read('overview/index.md'), /!\[Diagram\]\(index\.files\/diagram\.png\)/);
    const vision = read('overview/vision.md');
    assert.match(vision, /big\.zip \(60\.0 MB\) was not downloaded/);
    assert.deepEqual(r.report.tooLarge, [{ file: 'overview/vision.files/big.zip', bytes: 60 * 1024 * 1024 }]);
    assert.equal(existsSync(join(docs, 'overview/vision.files/big.zip')), false);
    for (const path of tree()) {
      const body = readFileSync(join(docs, path), 'utf8');
      assert.ok(!body.includes(TOKEN), `${path} holds the token`);
      assert.ok(!/X-Amz-|amazonaws\.com/.test(body), `${path} holds a signed URL`);
    }
  });

  it('comments an unknown block type and counts it in the report', async () => {
    const r = await exportDocs();
    assert.match(read('overview/vision.md'), /<!-- notion: ai_block -->/);
    assert.deepEqual(r.report.unknown, { ai_block: 1 });
  });

  it('only reads: every call is a GET, a data source query, or a GET to the file host', async () => {
    await exportDocs();
    assert.ok(fx.calls.length > 0);
    for (const { method, url } of fx.calls) {
      const ok = method === 'GET' || (method === 'POST' && /\/v1\/data_sources\/[^/]+\/query$/.test(new URL(url).pathname));
      assert.ok(ok, `${method} ${url}`);
      if (url.startsWith(FILE_HOST)) assert.equal(method, 'GET');
    }
  });

  it('maps every exported page, database, row, view and pointer to its path in index.json', async () => {
    await exportDocs();
    const index = JSON.parse(read('index.json'));
    assert.equal(index.root, IDS.root);
    assert.match(index.exported, /^\d{4}-\d\d-\d\dT/);
    assert.equal(index.files[IDS.root], 'index.md');
    assert.equal(index.files[IDS.decisions], 'decisions/index.md');
    assert.equal(index.files[IDS.row1], 'decisions/use-postgres.md');
    assert.equal(index.files[IDS.storiesDb], 'delivery/motorfix-stories.md');
    assert.equal(index.files[IDS.untitled], `overview/${IDS.untitled}.md`);
    assert.equal(index.files[IDS.row2], undefined, 'a row with no body has no file');
    assert.equal(Object.keys(index.files).length, EXPORTED.length - 1);
  });
});

describe('runs after the first', () => {
  it('a second run with nothing changed writes nothing, fetches no blocks and reports no change', async () => {
    await exportDocs();
    const before = mtimes();
    fx.calls.length = 0;
    const r = await exportDocs();
    assert.equal(r.code, 0);
    assert.deepEqual(mtimes(), before);
    assert.deepEqual([r.report.created, r.report.updated, r.report.deleted], [0, 0, 0]);
    assert.ok(!fx.calls.some((c) => c.url.includes('/blocks/')), 'unchanged pages skip their blocks');
    assert.ok(!fx.calls.some((c) => c.url.startsWith(FILE_HOST)), 'unchanged files are not downloaded again');
  });

  it('rewrites only an edited page, fetching only its blocks', async () => {
    await exportDocs();
    fx.edit(IDS.vision2, [fx.para('Second vision, edited')]);
    fx.calls.length = 0;
    const r = await exportDocs();
    assert.equal(r.report.updated, 1);
    assert.match(read('overview/vision-3d000000.md'), /Second vision, edited/);
    const blockCalls = fx.calls.filter((c) => c.url.includes('/blocks/')).map((c) => c.url);
    assert.deepEqual(blockCalls.map((u) => new URL(u).pathname), [`/v1/blocks/${IDS.vision2}/children`]);
  });

  it('removes the file of a page no longer in the space, leaving the excluded paths alone', async () => {
    await exportDocs();
    mkdirSync(join(docs, 'execution-plans'));
    writeFileSync(join(docs, 'execution-plans', 'ep-1.md'), 'plan\n');
    fx.remove(IDS.untitled);
    const r = await exportDocs();
    assert.equal(r.code, 0);
    assert.equal(existsSync(join(docs, `overview/${IDS.untitled}.md`)), false);
    assert.equal(r.report.deleted, 1);
    assert.equal(read('execution-plans/ep-1.md'), 'plan\n');
    assert.equal(read('README.md'), 'docs\n');
  });
});

describe('--dry-run', () => {
  it('lists what it would create, update and delete and writes nothing', async () => {
    const r = await exportDocs(['--dry-run']);
    assert.equal(r.code, 0);
    assert.equal(r.report.dryRun, true);
    assert.deepEqual([...r.report.create].sort(), EXPORTED.filter((p) => p.endsWith('.md')).concat('index.json').sort().filter((p) => p !== 'overview/index.files/diagram.png'));
    assert.deepEqual(tree(), ['README.md']);
    assert.ok(!fx.calls.some((c) => c.url.startsWith(FILE_HOST)), 'a dry run downloads nothing');

    await exportDocs();
    fx.remove(IDS.untitled);
    fx.edit(IDS.vision2, [fx.para('changed')]);
    const before = mtimes();
    const d = await exportDocs(['--dry-run']);
    assert.deepEqual(d.report.delete, [`overview/${IDS.untitled}.md`]);
    assert.ok(d.report.update.includes('overview/vision-3d000000.md'));
    assert.deepEqual(mtimes(), before);
  });
});

describe('--check', () => {
  it('exits 0 when every crawled page has its file and nothing else sits under docs/', async () => {
    await exportDocs();
    mkdirSync(join(docs, 'execution-plans'));
    writeFileSync(join(docs, 'execution-plans', 'ep-1.md'), 'plan\n');
    const r = await exportDocs(['--check']);
    assert.equal(r.code, 0, JSON.stringify(r.report));
    assert.deepEqual(r.report, { ok: true, missing: [], orphans: [], index: 'ok' });
  });

  it('exits 1 naming a missing page and an orphan, never the excluded paths or a file too large to download', async () => {
    await exportDocs();
    rmSync(join(docs, 'overview/vision.md'));
    writeFileSync(join(docs, 'stray.md'), 'x\n');
    for (const name of EXCLUDED) assert.ok(['README.md', 'index.json', 'execution-plans/'].includes(name));
    fx.calls.length = 0;
    const r = await exportDocs(['--check']);
    assert.equal(r.code, 1);
    assert.deepEqual(r.report.missing, ['overview/vision.md']);
    assert.deepEqual(r.report.orphans, ['stray.md']);
    assert.ok(!fx.calls.some((c) => c.url.startsWith(FILE_HOST)));
  });
});

describe('failures', () => {
  it('an API failure exits non-zero and leaves no index, and --check then says there is none', async () => {
    await exportDocs();
    fx.edit(IDS.overview, [fx.para('moved on')]);
    fx.fail(new RegExp(`/pages/${IDS.vision2}$`));
    fx.edit(IDS.overview, [{ object: 'block', id: IDS.vision2, type: 'child_page', has_children: false, child_page: { title: 'Vision' } }]);
    const r = await exportDocs();
    assert.equal(r.code, 1);
    assert.equal(r.report.ok, false);
    assert.equal(existsSync(join(docs, 'index.json')), false);
    const c = await exportDocs(['--check']);
    assert.equal(c.code, 1);
    assert.equal(c.report.index, 'absent');
  });

  it('stops every mode with one line and exit 3 when NOTION_TOKEN is not set, calling nothing', async () => {
    for (const argv of [[], ['--dry-run'], ['--check']]) {
      const r = await exportDocs(argv, {});
      assert.equal(r.code, 3);
      assert.equal(r.error, 'NOTION_TOKEN is not set');
    }
    assert.equal(fx.calls.length, 0);
  });

  it('refuses a clone that has not moved to the specs/ layout', async () => {
    rmSync(root, { recursive: true, force: true });
    root = checkout({ moved: false });
    docs = join(root, '.motor-fix-specs', 'docs');
    const r = await exportDocs();
    assert.equal(r.code, 1);
    assert.match(r.error, /layout/);
    assert.equal(fx.calls.length, 0);
  });

  it('refuses an unknown flag with exit 64', async () => {
    const r = await exportDocs(['--nope']);
    assert.equal(r.code, 64);
  });
});
