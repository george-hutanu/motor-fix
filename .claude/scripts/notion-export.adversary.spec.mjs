import { afterEach, beforeEach, describe, it, vi } from 'vitest';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

import { EPICS, MAX_FILE_BYTES, run, slugify } from './notion-export.mjs';
import { STORIES } from './notion-sync.mjs';
import { dashed, frontMatter, notionId, renderBlocks, renderProperty, richText } from './notion-export/render.mjs';
import { FILE_HOST, IDS, space, TOKEN } from './notion-export/fixtures/space.mjs';

vi.setConfig({ testTimeout: 30000 });

let base;
let root;
let docs;
let outside;
let fx;
let logs;

function checkout({ moved = true } = {}) {
  base = realpathSync(mkdtempSync(join(tmpdir(), 'notion-adv-')));
  root = join(base, 'checkout');
  outside = join(base, 'outside');
  mkdirSync(outside);
  writeFileSync(join(outside, 'precious.txt'), 'keep me\n');
  const clone = join(root, '.motor-fix-specs');
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
}

let fetchImpl;
const exportDocs = (argv = [], env = { NOTION_TOKEN: TOKEN }, fetcher = fetchImpl) =>
  run({ argv, env, root, fetchImpl: fetcher, rootPage: IDS.root, sleep: async () => {}, log: (line) => logs.push(String(line)) });

function walk(dir, out = [], skipGit = true) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (skipGit && e.name === '.git') continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out, skipGit);
    else out.push(p);
  }
  return out;
}
const tree = () => walk(docs).map((p) => relative(docs, p)).sort();
const read = (path) => readFileSync(join(docs, path), 'utf8');
const mtimes = () => Object.fromEntries(tree().map((p) => [p, statSync(join(docs, p)).mtimeMs]));
const markdown = () => tree().filter((p) => p.endsWith('.md'));
const stray = () =>
  walk(base)
    .map((p) => relative(base, p))
    .filter((p) => !p.startsWith(join('checkout', '.motor-fix-specs', 'docs') + '/') && !p.startsWith(join('checkout', '.motor-fix-specs', 'specs') + '/') && p !== join('outside', 'precious.txt'));

const compact = (id) => id.replaceAll('-', '');
const annotations = { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: 'default' };
const textPart = (s) => ({ type: 'text', plain_text: s, href: null, text: { content: s, link: null }, annotations });

function addChild(parentId, id, title, blocks = []) {
  fx.pages.get(parentId).blocks.push({ object: 'block', id, type: 'child_page', has_children: false, child_page: { title } });
  fx.pages.set(id, {
    page: {
      object: 'page',
      id,
      url: `https://www.notion.so/${compact(id)}`,
      last_edited_time: '2026-10-01T10:00:00.000Z',
      parent: { type: 'page_id', page_id: parentId },
      properties: { title: { id: 'title', type: 'title', title: title ? [textPart(title)] : [] } },
    },
    blocks,
  });
}
const nid = (n) => `${n.toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`;
const sameHead = (n) => `abcdef12-${n.toString(16).padStart(4, '0')}-4000-8000-000000000000`;
const countIn = (needle) => markdown().filter((p) => read(p).includes(needle)).length;

beforeEach(() => {
  checkout();
  docs = join(root, '.motor-fix-specs', 'docs');
  fx = space({ stories: STORIES, epics: EPICS });
  fetchImpl = fx.fetchImpl;
  logs = [];
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

describe('command line', () => {
  it('rejects --dry-run together with --check', async () => {
    const r = await exportDocs(['--dry-run', '--check']);
    assert.equal(r.code, 64);
    assert.deepEqual(tree(), ['README.md']);
    assert.equal(fx.calls.length, 0);
  });

  it('rejects --root with no value and a stray positional argument', async () => {
    assert.equal((await exportDocs(['--root'])).code, 64);
    assert.equal((await exportDocs(['please'])).code, 64);
    assert.equal(fx.calls.length, 0);
  });

  it('treats an empty NOTION_TOKEN as not set', async () => {
    const r = await exportDocs([], { NOTION_TOKEN: '' });
    assert.equal(r.code, 3);
    assert.equal(r.error, 'NOTION_TOKEN is not set');
    assert.equal(fx.calls.length, 0);
  });

  it('refuses an unmoved clone in every mode and writes nothing', async () => {
    rmSync(base, { recursive: true, force: true });
    checkout({ moved: false });
    docs = join(root, '.motor-fix-specs', 'docs');
    for (const argv of [[], ['--dry-run'], ['--check']]) {
      const r = await exportDocs(argv);
      assert.equal(r.code, 1, argv.join(' '));
    }
    assert.deepEqual(tree(), ['README.md']);
  });

  it('exports into a moved clone whose docs folder does not exist yet', async () => {
    rmSync(docs, { recursive: true });
    const r = await exportDocs();
    assert.equal(r.code, 0, JSON.stringify(r));
    assert.ok(existsSync(join(docs, 'index.json')));
  });
});

describe('read-only guarantee in every mode', () => {
  it('sends only GET and data source queries in a full run, a dry run, a check and a failing run', async () => {
    await exportDocs();
    await exportDocs(['--dry-run']);
    await exportDocs(['--check']);
    fx.fail(new RegExp(`/pages/${IDS.vision}$`));
    fx.edit(IDS.overview, [fx.para('x')]);
    await exportDocs();
    assert.ok(fx.calls.length > 0);
    for (const { method, url } of fx.calls) {
      const ok = method === 'GET' || (method === 'POST' && /\/data_sources\/[^/]+\/query$/.test(new URL(url).pathname));
      assert.ok(ok, `${method} ${url}`);
    }
  });

  it('never calls the tracker data sources, even with the Stories and Epics views reachable from other pages', async () => {
    await exportDocs(['--dry-run']);
    await exportDocs(['--check']);
    assert.ok(!fx.calls.some((c) => c.url.includes(STORIES) || c.url.includes(EPICS)));
  });

  it('does not send the Notion token to the file host', async () => {
    const seen = [];
    const spy = (url, init = {}) => {
      if (String(url).startsWith(FILE_HOST)) seen.push(JSON.stringify(init.headers ?? {}).toLowerCase());
      return fx.fetchImpl(url, init);
    };
    await exportDocs([], { NOTION_TOKEN: TOKEN }, spy);
    assert.ok(seen.length > 0);
    for (const headers of seen) {
      assert.ok(!headers.includes('authorization') && !headers.includes(TOKEN.toLowerCase()), headers);
    }
  });

  const lookalikes = {
    'S3 name as a prefix of another host': 'https://amazonaws.com.evil.example/x/a.png?X-Amz-Signature=a',
    'Notion name as a prefix of another host': 'https://notion.so.evil.example/x/b.png?X-Amz-Signature=b',
    'an unrelated host carrying a signature': 'https://internal.example/x/c.png?X-Amz-Signature=c',
  };
  for (const [label, url] of Object.entries(lookalikes)) {
    it(`never requests a hosted-looking URL on ${label}`, async () => {
      fx.edit(IDS.vision2, [{ object: 'block', id: nid(0x900), type: 'image', has_children: false, image: { type: 'file', file: { url }, caption: [] } }]);
      const r = await exportDocs();
      assert.ok(!fx.calls.some((c) => /evil\.example|internal\.example/.test(c.url)), fx.calls.map((c) => c.url).join('\n'));
      assert.equal(r.code, 0, JSON.stringify(r));
      assert.match(read('overview/vision-3d000000.md'), new RegExp(`\\]\\(${url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)`));
    });
  }

  it('keeps the token out of the report, the logs and every written file, on success and on failure', async () => {
    const ok = await exportDocs();
    fx.fail(new RegExp(`/pages/${IDS.vision2}$`));
    fx.edit(IDS.overview, [{ object: 'block', id: IDS.vision2, type: 'child_page', has_children: false, child_page: { title: 'Vision' } }]);
    const bad = await exportDocs();
    for (const text of [JSON.stringify(ok), JSON.stringify(bad), logs.join('\n'), ...tree().map((p) => (p.endsWith('.png') ? '' : read(p)))]) {
      assert.ok(!text.includes(TOKEN));
    }
  });
});

describe('an unreliable API', () => {
  it('retries a call rate-limited once and ends with the same tree as an undisturbed run', async () => {
    await exportDocs();
    const expected = tree();
    rmSync(docs, { recursive: true });
    mkdirSync(docs);
    writeFileSync(join(docs, 'README.md'), 'docs\n');
    const seen = new Set();
    const limited = (url, init = {}) => {
      const key = `${init.method ?? 'GET'} ${url}`;
      if (!seen.has(key) && !String(url).startsWith(FILE_HOST)) {
        seen.add(key);
        return Promise.resolve(new Response(JSON.stringify({ object: 'error', status: 429, code: 'rate_limited', message: 'slow down' }), { status: 429, headers: { 'Retry-After': '0', 'Content-Type': 'application/json' } }));
      }
      return fx.fetchImpl(url, init);
    };
    const r = await exportDocs([], { NOTION_TOKEN: TOKEN }, limited);
    assert.equal(r.code, 0, JSON.stringify(r));
    assert.deepEqual(tree(), expected);
  });

  it('gives up on a permanently rate-limited API with exit 1 and no index, after a bounded number of calls', async () => {
    let calls = 0;
    const always = () => {
      calls += 1;
      return Promise.resolve(new Response('{"object":"error","status":429,"code":"rate_limited"}', { status: 429, headers: { 'Retry-After': '0', 'Content-Type': 'application/json' } }));
    };
    const r = await exportDocs([], { NOTION_TOKEN: TOKEN }, always);
    assert.equal(r.code, 1);
    assert.ok(calls < 200, `${calls} calls`);
    assert.equal(existsSync(join(docs, 'index.json')), false);
  });

  it('turns a network error into exit 1 and no index instead of throwing', async () => {
    const down = () => Promise.reject(new TypeError('fetch failed'));
    const r = await exportDocs([], { NOTION_TOKEN: TOKEN }, down);
    assert.equal(r.code, 1);
    assert.equal(existsSync(join(docs, 'index.json')), false);
  });

  it('turns an HTML 200 answer into exit 1 instead of throwing', async () => {
    const html = () => Promise.resolve(new Response('<html>gateway</html>', { status: 200, headers: { 'Content-Type': 'text/html' } }));
    const r = await exportDocs([], { NOTION_TOKEN: TOKEN }, html);
    assert.equal(r.code, 1);
    assert.deepEqual(tree(), ['README.md']);
  });

  it('does not put a signed file URL in the report, the error or the log when a download fails', async () => {
    const forbidden = (url, init) => {
      if (String(url).startsWith(FILE_HOST)) return Promise.resolve(new Response('denied', { status: 403 }));
      return fx.fetchImpl(url, init);
    };
    const r = await exportDocs([], { NOTION_TOKEN: TOKEN }, forbidden);
    const everything = JSON.stringify(r) + logs.join('\n');
    assert.ok(!/X-Amz-/.test(everything), everything);
    for (const path of markdown()) assert.ok(!/X-Amz-/.test(read(path)), path);
    if (r.code !== 0) assert.equal(existsSync(join(docs, 'index.json')), false);
  });

  it('terminates on a page that lists an ancestor as its child', async () => {
    fx.pages.get(IDS.vision).blocks.push({ object: 'block', id: IDS.overview, type: 'child_page', has_children: false, child_page: { title: 'Overview' } });
    const r = await Promise.race([exportDocs(), new Promise((_, no) => setTimeout(() => no(new Error('crawl did not end')), 15000))]);
    assert.equal(r.code, 0, JSON.stringify(r));
    assert.equal(JSON.parse(read('index.json')).files[IDS.overview], 'overview/index.md');
  }, 20000);
});

describe('titles that are hostile as file names', () => {
  const hostile = {
    'dot dot slash': '../../escape',
    'absolute path': '/etc/passwd',
    'only dots': '..',
    'single dot': '.',
    'backslashes': 'a\\b\\..\\c',
    'null byte': 'null\u0000byte',
    'newline': 'two\nlines',
    'emoji only': '🚗🔧',
    'punctuation only': '!!!',
    'windows device name': 'CON',
    'index': 'index',
    'Index with capitals': 'INDEX',
    'readme': 'README',
    'right to left text': '‮exe.md',
    'combining marks': 'Ăîșț Cafe Ünïcode',
    'very long': 'x'.repeat(10000),
    'very long with spaces': 'word '.repeat(2000),
  };
  for (const [label, title] of Object.entries(hostile)) {
    it(`exports a page titled ${label} inside docs, losing no page and keeping names legal`, async () => {
      addChild(IDS.overview, nid(0x501), title, [fx.para('MARKER-hostile-one')]);
      addChild(IDS.root, nid(0x502), title, [fx.para('MARKER-hostile-two')]);
      const r = await exportDocs();
      assert.equal(r.code, 0, JSON.stringify(r));
      assert.deepEqual(stray(), []);
      assert.equal(countIn('MARKER-hostile-one'), 1);
      assert.equal(countIn('MARKER-hostile-two'), 1);
      assert.equal(countIn('Second vision'), 1);
      assert.equal(countIn('No title'), 1);
      assert.equal(read('README.md'), 'docs\n');
      for (const path of markdown().filter((p) => p !== 'README.md')) {
        for (const part of path.split('/')) {
          assert.ok(Buffer.byteLength(part) <= 255, `${part.length} bytes: ${part.slice(0, 40)}`);
          assert.match(part, /^[a-z0-9-]+(\.md|\.files)?$/, path);
        }
      }
      const paths = Object.values(JSON.parse(read('index.json')).files);
      assert.equal(new Set(paths).size, paths.length, 'two ids share one path');
    }, 20000);
  }

  it('names a page by its Notion id when the title has no letters or digits, and keeps the real title in the front matter', async () => {
    addChild(IDS.overview, nid(0x503), '🚗🔧', [fx.para('car')]);
    await exportDocs();
    assert.ok(tree().includes(`overview/${nid(0x503)}.md`), tree().join('\n'));
    assert.match(read(`overview/${nid(0x503)}.md`), /🚗🔧/);
  });

  it('keeps the front matter to four keys when a title holds quotes, newlines and dashes', async () => {
    const title = 'He said "hi"\nnotion_id: evil\n---\nbody: x';
    addChild(IDS.overview, nid(0x504), title, [fx.para('after')]);
    await exportDocs();
    const file = markdown().find((p) => read(p).includes('notion_id: ' + nid(0x504)));
    assert.ok(file, 'the page has a file');
    const lines = read(file).split('\n');
    assert.equal(lines[0], '---');
    assert.deepEqual(lines.slice(1, 5).map((l) => l.split(':')[0]), ['title', 'notion_id', 'notion_url', 'last_edited']);
    assert.equal(lines[5], '---');
    assert.equal(JSON.parse(lines[1].slice('title: '.length)), title);
  });

  it('keeps both pages when two titles clash and their ids share the first eight characters', async () => {
    addChild(IDS.overview, sameHead(1), 'Twin', [fx.para('MARKER-twin-1')]);
    addChild(IDS.overview, sameHead(2), 'Twin', [fx.para('MARKER-twin-2')]);
    addChild(IDS.overview, sameHead(3), 'Twin', [fx.para('MARKER-twin-3')]);
    const r = await exportDocs();
    assert.equal(r.code, 0, JSON.stringify(r));
    for (const n of [1, 2, 3]) assert.equal(countIn(`MARKER-twin-${n}`), 1, `twin ${n}`);
    const files = JSON.parse(read('index.json')).files;
    assert.equal(new Set([sameHead(1), sameHead(2), sameHead(3)].map((i) => files[i])).size, 3);
  });

  it('keeps a page whose title equals the suffixed name of a clashing sibling', async () => {
    addChild(IDS.overview, nid(0x505), 'Vision 3d000000', [fx.para('MARKER-lookalike')]);
    const r = await exportDocs();
    assert.equal(r.code, 0);
    assert.equal(countIn('MARKER-lookalike'), 1);
    assert.equal(countIn('Second vision'), 1);
  });

  it('exports three hundred siblings with one title as three hundred files', async () => {
    for (let i = 0; i < 300; i += 1) addChild(IDS.overview, nid(0x1000 + i), 'Same', [fx.para(`MARKER-bulk-${i}`)]);
    const r = await exportDocs();
    assert.equal(r.code, 0, JSON.stringify(r));
    assert.equal(markdown().filter((p) => p.startsWith('overview/same')).length, 300);
    assert.equal(countIn('MARKER-bulk-299'), 1);
  }, 60000);
});

describe('slugify', () => {
  it('folds accents to ASCII and joins words with single hyphens', () => {
    assert.equal(slugify('Ăîșț Cafe Ünïcode'), 'aist-cafe-unicode');
    assert.equal(slugify('  Hello,   World!! '), 'hello-world');
  });

  it('returns nothing usable for titles with no letters or digits', () => {
    for (const title of ['', '   ', '🚗', '!!!', '///', '..']) assert.equal(String(slugify(title) ?? ''), '', JSON.stringify(title));
  });

  it('never emits a path separator, a dot or an uppercase letter', () => {
    for (const title of ['../../x', 'a/b', 'a\\b', 'Ünï.CODE', 'A\u0000B', 'x'.repeat(5000)]) {
      assert.match(String(slugify(title) ?? ''), /^[a-z0-9-]*$/, JSON.stringify(title.slice(0, 20)));
    }
  });

  it('returns the same slug for the same title', () => {
    assert.equal(slugify('Same Title'), slugify('Same Title'));
  });
});

describe('files that stay inside docs', () => {
  it('does not write through a symlinked folder that points outside the tree', async () => {
    symlinkSync(outside, join(docs, 'overview'));
    const r = await exportDocs();
    assert.deepEqual(readdirSync(outside), ['precious.txt'], `exit ${r.code}`);
    assert.equal(readFileSync(join(outside, 'precious.txt'), 'utf8'), 'keep me\n');
  });

  it('does not follow an orphan symlink out of docs when it deletes orphans', async () => {
    await exportDocs();
    symlinkSync(outside, join(docs, 'linked-dir'));
    symlinkSync(join(outside, 'precious.txt'), join(docs, 'linked-file.md'));
    fx.edit(IDS.vision2, [fx.para('changed')]);
    await exportDocs();
    assert.equal(readFileSync(join(outside, 'precious.txt'), 'utf8'), 'keep me\n');
    assert.deepEqual(readdirSync(outside), ['precious.txt']);
  });

  it('check on a tree holding symlinks resolves and leaves the targets alone', async () => {
    await exportDocs();
    symlinkSync(outside, join(docs, 'linked-dir'));
    const r = await exportDocs(['--check']);
    assert.equal(typeof r.code, 'number');
    assert.equal(r.code, 1, 'a link nothing explains is an orphan');
    assert.ok(r.report.orphans.includes('linked-dir') || r.report.orphans.some((p) => p.startsWith('linked-dir')), JSON.stringify(r.report));
    assert.deepEqual(readdirSync(outside), ['precious.txt']);
  });

  it('keeps a hosted file name with traversal characters under the page files folder', async () => {
    const url = `${FILE_HOST}/ws/x4/..%2F..%2F..%2Fevil.sh?X-Amz-Signature=z`;
    fx.edit(IDS.vision2, [{ object: 'block', id: nid(0x601), type: 'file', has_children: false, file: { type: 'file', file: { url }, caption: [], name: '../../../evil.sh' } }]);
    const served = (u, init) => (String(u).startsWith(FILE_HOST) && String(u).includes('evil') ? Promise.resolve(new Response('#!/bin/sh', { status: 200, headers: { 'Content-Length': '9' } })) : fx.fetchImpl(u, init));
    const r = await exportDocs([], { NOTION_TOKEN: TOKEN }, served);
    assert.equal(r.code, 0, JSON.stringify(r));
    assert.deepEqual(stray(), []);
  });

  it('keeps two hosted files of one page with the same name apart', async () => {
    fx.edit(IDS.vision2, ['a', 'b'].map((k, i) => ({ object: 'block', id: nid(0x700 + i), type: 'image', has_children: false, image: { type: 'file', file: { url: `${FILE_HOST}/ws/${k}/image.png?X-Amz-Signature=${k}` }, caption: [] } })));
    const served = (u, init) => {
      const m = String(u).match(/\/ws\/([ab])\/image\.png/);
      return m ? Promise.resolve(new Response(`BODY-${m[1]}`, { status: 200, headers: { 'Content-Length': '6' } })) : fx.fetchImpl(u, init);
    };
    const r = await exportDocs([], { NOTION_TOKEN: TOKEN }, served);
    assert.equal(r.code, 0, JSON.stringify(r));
    const bodies = tree().filter((p) => p.startsWith('overview/vision-3d000000.files/')).map((p) => read(p)).sort();
    assert.deepEqual(bodies, ['BODY-a', 'BODY-b']);
    const refs = [...read('overview/vision-3d000000.md').matchAll(/\]\(([^)]+\.files\/[^)]+)\)/g)].map((m) => m[1]);
    assert.equal(new Set(refs).size, 2, refs.join(','));
  });
});

describe('large and odd files', () => {
  const bigFile = (size, { length = true, body = size } = {}) => {
    const served = (u, init) => {
      if (String(u).includes('/ws/big/')) {
        const headers = length ? { 'Content-Length': String(size) } : {};
        return Promise.resolve(new Response(Buffer.alloc(body, 1), { status: 200, headers }));
      }
      return fx.fetchImpl(u, init);
    };
    fx.edit(IDS.vision2, [{ object: 'block', id: nid(0x801), type: 'file', has_children: false, file: { type: 'file', file: { url: `${FILE_HOST}/ws/big/blob.bin?X-Amz-Signature=q` }, caption: [], name: 'blob.bin' } }]);
    return served;
  };

  it('downloads a file of exactly the limit and lists nothing as too large', async () => {
    const r = await exportDocs([], { NOTION_TOKEN: TOKEN }, bigFile(MAX_FILE_BYTES));
    assert.equal(r.code, 0, JSON.stringify(r));
    assert.deepEqual(r.report.tooLarge.filter((t) => t.file.includes('blob.bin')), []);
    const saved = tree().find((p) => p.endsWith('blob.bin'));
    assert.ok(saved, tree().join('\n'));
    assert.equal(statSync(join(docs, saved)).size, MAX_FILE_BYTES);
  }, 60000);

  it('skips a file one byte over the limit, names it with its size and does not count it missing', async () => {
    const served = bigFile(MAX_FILE_BYTES + 1, { body: 10 });
    const r = await exportDocs([], { NOTION_TOKEN: TOKEN }, served);
    assert.equal(r.code, 0, JSON.stringify(r));
    assert.deepEqual(r.report.tooLarge.filter((t) => t.file.endsWith('blob.bin')).map((t) => t.bytes), [MAX_FILE_BYTES + 1]);
    assert.equal(tree().some((p) => p.endsWith('blob.bin')), false);
    const c = await exportDocs(['--check'], { NOTION_TOKEN: TOKEN }, served);
    assert.deepEqual(c.report.missing, []);
    assert.equal(c.code, 0);
  }, 60000);

  it('does not keep a body larger than the limit when the server sent no length', async () => {
    const served = bigFile(MAX_FILE_BYTES + 1, { length: false, body: MAX_FILE_BYTES + 1 });
    const r = await exportDocs([], { NOTION_TOKEN: TOKEN }, served);
    assert.equal(tree().some((p) => p.endsWith('blob.bin')), false, `exit ${r.code}`);
    assert.equal(r.report.tooLarge.length >= 1, true, JSON.stringify(r.report));
  }, 60000);

  it('writes a page of twenty thousand blocks whole and in order', async () => {
    fx.edit(IDS.vision2, Array.from({ length: 20000 }, (_, i) => fx.para(`line-${i}`)));
    const r = await exportDocs();
    assert.equal(r.code, 0);
    const body = read('overview/vision-3d000000.md');
    assert.ok(body.indexOf('line-0') < body.indexOf('line-10000') && body.indexOf('line-10000') < body.indexOf('line-19999'));
  }, 60000);

  it('reads every block of a page when the API answers in pages of one hundred', async () => {
    fx.edit(IDS.vision2, Array.from({ length: 250 }, (_, i) => fx.para(`row-${String(i).padStart(3, '0')}`)));
    const paged = async (u, init) => {
      const url = new URL(String(u));
      const m = url.pathname.match(/\/blocks\/([^/]+)\/children$/);
      if (!m || m[1] !== IDS.vision2) return fx.fetchImpl(u, init);
      const all = (await (await fx.fetchImpl(u, init)).json()).results;
      const start = Number(url.searchParams.get('start_cursor') ?? 0);
      const slice = all.slice(start, start + 100);
      const more = start + 100 < all.length;
      return new Response(JSON.stringify({ object: 'list', results: slice, has_more: more, next_cursor: more ? String(start + 100) : null }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    const r = await exportDocs([], { NOTION_TOKEN: TOKEN }, paged);
    assert.equal(r.code, 0, JSON.stringify(r));
    const body = read('overview/vision-3d000000.md');
    const found = [...body.matchAll(/row-(\d{3})/g)].map((m) => m[1]);
    assert.deepEqual(found, Array.from({ length: 250 }, (_, i) => String(i).padStart(3, '0')));
  });

  it('lists every row of a database whose query answers in pages of one hundred', async () => {
    const rowIds = Array.from({ length: 250 }, (_, i) => nid(0x2000 + i));
    for (const [i, id] of rowIds.entries()) {
      const title = `Row ${i}`;
      fx.pages.set(id, {
        page: {
          object: 'page',
          id,
          url: `https://www.notion.so/${compact(id)}`,
          last_edited_time: '2026-10-01T10:00:00.000Z',
          parent: { type: 'data_source_id', data_source_id: IDS.decisionsSource },
          properties: { Name: { id: 'title', type: 'title', title: [textPart(title)] }, Status: { id: 's', type: 'select', select: { name: 'Open' } }, Related: { id: 'r', type: 'relation', relation: [] } },
        },
        blocks: [],
      });
    }
    const paged = (u, init = {}) => {
      const url = new URL(String(u));
      if (init.method === 'POST' && url.pathname.endsWith(`/data_sources/${IDS.decisionsSource}/query`)) {
        fx.calls.push({ method: 'POST', url: String(u) });
        const cursor = init.body ? JSON.parse(init.body).start_cursor : undefined;
        const start = Number(cursor ?? 0);
        const everyone = [fx.pages.get(IDS.row1).page, fx.pages.get(IDS.row2).page, ...rowIds.map((id) => fx.pages.get(id).page)];
        const more = start + 100 < everyone.length;
        return Promise.resolve(new Response(JSON.stringify({ object: 'list', results: everyone.slice(start, start + 100), has_more: more, next_cursor: more ? String(start + 100) : null }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      }
      return fx.fetchImpl(u, init);
    };
    const r = await exportDocs([], { NOTION_TOKEN: TOKEN }, paged);
    assert.equal(r.code, 0, JSON.stringify(r));
    const rows = read('decisions/index.md').split('\n').filter((l) => l.startsWith('|'));
    assert.equal(rows.length, 2 + 252);
    assert.ok(rows.some((l) => l.includes('Row 249')));
  }, 60000);
});

describe('database tables and block text', () => {
  const unescapedPipes = (line) => (line.match(/(?<!\\)\|/g) ?? []).length;

  it('keeps a row title with a pipe and a newline in one table row of the right width', async () => {
    fx.pages.get(IDS.row2).page.properties.Name.title = [textPart('left | right\nsecond line')];
    await exportDocs();
    const lines = read('decisions/index.md').split('\n');
    const table = lines.filter((l) => l.startsWith('|'));
    assert.equal(table.length, 4, lines.join('\n'));
    const width = unescapedPipes(table[0]);
    for (const line of table) assert.equal(unescapedPipes(line), width, line);
  });

  it('counts an unknown block type once per occurrence across pages', async () => {
    fx.edit(IDS.vision2, [{ object: 'block', id: nid(0x901), type: 'ai_block', has_children: false, ai_block: {} }, { object: 'block', id: nid(0x902), type: 'ai_block', has_children: false, ai_block: {} }]);
    const r = await exportDocs();
    assert.equal(r.report.unknown.ai_block, 3, JSON.stringify(r.report.unknown));
  });
});

describe('runs after the first', () => {
  it('overwrites a hand-edited exported file once its page changes in Notion', async () => {
    await exportDocs();
    writeFileSync(join(docs, 'overview/vision-3d000000.md'), Buffer.from([0xff, 0xfe, 0x68, 0x00, 0xe9, 0x00]));
    fx.edit(IDS.vision2, [fx.para('Second vision, again')]);
    const r = await exportDocs();
    assert.equal(r.report.updated, 1);
    assert.match(read('overview/vision-3d000000.md'), /Second vision, again/);
    assert.ok(read('overview/vision-3d000000.md').startsWith('---\n'), 'no byte order mark');
  });

  it('deletes an orphan holding Latin-1 bytes, one holding binary data, and one nested deep', async () => {
    await exportDocs();
    mkdirSync(join(docs, 'old', 'deeper'), { recursive: true });
    writeFileSync(join(docs, 'latin.md'), Buffer.from('caf\xe9\n', 'latin1'));
    writeFileSync(join(docs, 'blob.md'), Buffer.from([0, 1, 2, 255, 254, 0]));
    writeFileSync(join(docs, 'old', 'deeper', 'x.md'), 'x\n');
    const c = await exportDocs(['--check']);
    assert.deepEqual([...c.report.orphans].sort(), ['blob.md', 'latin.md', 'old/deeper/x.md']);
    const r = await exportDocs();
    assert.equal(r.code, 0);
    assert.equal(r.report.deleted, 3);
    assert.deepEqual(tree().filter((p) => ['latin.md', 'blob.md', 'old/deeper/x.md'].includes(p)), []);
  });

  it('never deletes or reports a file kept for the plans folder, even one with an odd name', async () => {
    await exportDocs();
    mkdirSync(join(docs, 'execution-plans', 'sub'), { recursive: true });
    writeFileSync(join(docs, 'execution-plans', 'Epic One (v2).md'), 'plan\n');
    writeFileSync(join(docs, 'execution-plans', 'sub', 'x.md'), 'plan\n');
    fx.edit(IDS.vision2, [fx.para('moved')]);
    const r = await exportDocs();
    assert.equal(r.code, 0);
    assert.equal(r.report.deleted, 0);
    assert.equal(read('execution-plans/Epic One (v2).md'), 'plan\n');
    const d = await exportDocs(['--dry-run']);
    assert.deepEqual(d.report.delete, []);
    const c = await exportDocs(['--check']);
    assert.deepEqual(c.report.orphans, []);
  });

  it('does not treat a lookalike of an excluded name as excluded', async () => {
    await exportDocs();
    writeFileSync(join(docs, 'README.md.bak'), 'x\n');
    writeFileSync(join(docs, 'index.json.old'), 'x\n');
    mkdirSync(join(docs, 'execution-plans-old'));
    writeFileSync(join(docs, 'execution-plans-old', 'p.md'), 'x\n');
    const c = await exportDocs(['--check']);
    assert.deepEqual([...c.report.orphans].sort(), ['README.md.bak', 'execution-plans-old/p.md', 'index.json.old']);
  });

  it('a dry run after a full run lists nothing and a dry run before it matches what the run then creates', async () => {
    const d = await exportDocs(['--dry-run']);
    const r = await exportDocs();
    const written = tree().filter((p) => p !== 'README.md' && !p.includes('.files/'));
    assert.deepEqual([...d.report.create].sort(), written);
    assert.equal(r.report.created, tree().length - 2);
    const again = await exportDocs(['--dry-run']);
    assert.deepEqual(again.report, { ok: true, dryRun: true, create: [], update: [], delete: [] });
  });

  it('a second dry run reports the same plan as the first', async () => {
    const a = await exportDocs(['--dry-run']);
    const b = await exportDocs(['--dry-run']);
    assert.deepEqual(b.report, a.report);
    assert.deepEqual(tree(), ['README.md']);
  });

  it('a third full run after two identical ones still reports zero changes', async () => {
    await exportDocs();
    await exportDocs();
    const r = await exportDocs();
    assert.deepEqual([r.report.created, r.report.updated, r.report.deleted], [0, 0, 0]);
  });

  it('moves a page file when its title changes, leaving no orphan behind', async () => {
    await exportDocs();
    fx.pages.get(IDS.vision2).page.properties.title.title = [textPart('Renamed')];
    const parent = fx.pages.get(IDS.overview).blocks.find((b) => b.id === IDS.vision2);
    parent.child_page.title = 'Renamed';
    fx.edit(IDS.vision2, [fx.para('Second vision')]);
    fx.edit(IDS.overview, fx.pages.get(IDS.overview).blocks);
    const r = await exportDocs();
    assert.equal(r.code, 0, JSON.stringify(r));
    assert.ok(tree().includes('overview/renamed.md'), tree().join('\n'));
    assert.equal(tree().includes('overview/vision-3d000000.md'), false);
    assert.equal(tree().includes('overview/vision.md') && read('overview/vision.md').includes('notion_id: ' + IDS.vision2), false);
    const c = await exportDocs(['--check']);
    assert.deepEqual([c.code, c.report.orphans, c.report.missing], [0, [], []]);
  });
});

describe('--check', () => {
  it('names the file of a page added in Notion since the last export, and no false orphan', async () => {
    await exportDocs();
    addChild(IDS.overview, nid(0xa01), 'Brand New', [fx.para('fresh')]);
    fx.edit(IDS.overview, fx.pages.get(IDS.overview).blocks);
    const c = await exportDocs(['--check']);
    assert.equal(c.code, 1);
    assert.deepEqual(c.report.missing, ['overview/brand-new.md']);
    assert.deepEqual(c.report.orphans, []);
  });

  it('names the file of a page deleted in Notion as an orphan and leaves it on disk', async () => {
    await exportDocs();
    fx.remove(IDS.vision2);
    const c = await exportDocs(['--check']);
    assert.equal(c.code, 1);
    assert.deepEqual(c.report.orphans, ['overview/vision-3d000000.md']);
    assert.ok(existsSync(join(docs, 'overview/vision-3d000000.md')));
  });

  it('writes nothing, downloads nothing and fetches no block of an unchanged page', async () => {
    await exportDocs();
    const before = mtimes();
    fx.calls.length = 0;
    const c = await exportDocs(['--check']);
    assert.equal(c.code, 0);
    assert.deepEqual(mtimes(), before);
    assert.deepEqual(fx.calls.filter((x) => x.url.includes('/blocks/') || x.url.startsWith(FILE_HOST)), []);
  });

  it('with no index fetches the blocks of every page and names every file as missing', async () => {
    const c = await exportDocs(['--check']);
    assert.equal(c.code, 1);
    assert.equal(c.report.index, 'absent');
    assert.ok(c.report.missing.includes('overview/vision.md'), JSON.stringify(c.report));
    assert.deepEqual(tree(), ['README.md']);
  });

  it('exits 1 on an index that is not JSON instead of throwing', async () => {
    await exportDocs();
    writeFileSync(join(docs, 'index.json'), '{ not json');
    const c = await exportDocs(['--check']);
    assert.equal(c.code, 1);
    assert.notEqual(c.report.index, 'ok');
  });

  it('exits 1 on an empty index file', async () => {
    await exportDocs();
    writeFileSync(join(docs, 'index.json'), '');
    const c = await exportDocs(['--check']);
    assert.equal(c.code, 1);
  });

  it('a full run repairs a corrupt index and the next check is clean', async () => {
    await exportDocs();
    writeFileSync(join(docs, 'index.json'), '[1,2');
    const r = await exportDocs();
    assert.equal(r.code, 0, JSON.stringify(r));
    const c = await exportDocs(['--check']);
    assert.equal(c.code, 0, JSON.stringify(c.report));
  });
});

describe('index.json', () => {
  it('holds dashed ids mapped to files that exist, and none of the excluded paths', async () => {
    await exportDocs();
    const index = JSON.parse(read('index.json'));
    for (const [id, path] of Object.entries(index.files)) {
      assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      assert.ok(existsSync(join(docs, path)), path);
      assert.ok(!['README.md', 'index.json'].includes(path) && !path.startsWith('execution-plans/'), path);
      assert.ok(!path.startsWith('/') && !path.includes('..'), path);
    }
  });

  it('is written last: a failure on the last page leaves other files but no index', async () => {
    fx.fail(new RegExp(`/blocks/${IDS.row1}/children$`));
    const r = await exportDocs();
    assert.equal(r.code, 1);
    assert.equal(existsSync(join(docs, 'index.json')), false);
  });

  it('does not keep the old index when a later run fails halfway', async () => {
    await exportDocs();
    fx.edit(IDS.vision2, [fx.para('changed')]);
    fx.fail(new RegExp(`/blocks/${IDS.vision2}/children$`));
    const r = await exportDocs();
    assert.equal(r.code, 1);
    assert.equal(existsSync(join(docs, 'index.json')), false);
  });
});

describe('link rewriting', () => {
  it('leaves no in-space Notion URL in the body of any exported file', async () => {
    await exportDocs();
    const ids = Object.values(IDS).filter((id) => id !== IDS.outside);
    for (const path of markdown()) {
      const body = read(path).split('\n').filter((l) => !l.startsWith('notion_url:')).join('\n');
      for (const id of ids) {
        if (id === IDS.roadmapView || id === IDS.outside) continue;
        assert.ok(!body.includes(compact(id)), `${path} links ${id}`);
      }
    }
  });

  it('rewrites a link to a page whose URL carries a title slug and a peek query', async () => {
    fx.edit(IDS.vision2, [{ object: 'block', id: nid(0xb01), type: 'paragraph', has_children: false, paragraph: { rich_text: [{ type: 'text', plain_text: 'peek', href: `https://www.notion.so/ws/Vision-${compact(IDS.vision)}?p=${compact(IDS.row1)}&pm=s`, text: { content: 'peek', link: { url: `https://www.notion.so/ws/Vision-${compact(IDS.vision)}?p=${compact(IDS.row1)}&pm=s` } }, annotations } ] } }]);
    await exportDocs();
    assert.match(read('overview/vision-3d000000.md'), /\[peek\]\(vision\.md\)/);
  });
});

describe('rich text', () => {
  const ctx = () => ({ resolve: () => null, file: () => null, unknown: {} });
  const bold = { ...annotations, bold: true };

  it('renders nothing for an absent or empty list', () => {
    assert.equal(richText(undefined, ctx()), '');
    assert.equal(richText([], ctx()), '');
  });

  it('renders a part with no annotations object and no text object as its plain text', () => {
    assert.equal(richText([{ type: 'text', plain_text: 'bare' }], ctx()), 'bare');
  });

  it('does not emit empty emphasis markers for an empty bold part', () => {
    assert.equal(richText([{ ...textPart(''), annotations: bold }], ctx()), '');
  });

  it('keeps trailing whitespace outside the bold markers so the emphasis stays valid', () => {
    assert.equal(richText([{ ...textPart('word '), annotations: bold }], ctx()), '**word** ');
  });

  it('renders a user mention by its plain text', () => {
    const part = { type: 'mention', plain_text: '@Ana', mention: { type: 'user', user: { id: 'u1' } }, annotations };
    assert.match(richText([part], ctx()), /@Ana/);
  });
});

describe('Notion URLs', () => {
  const A = 'aaaaaaaa-1111-2222-3333-444444444444';
  const B = 'bbbbbbbb-1111-2222-3333-444444444444';

  it('reads no id from a host that only ends or starts like a Notion host', () => {
    for (const url of [
      `https://notion.so.evil.example/${compact(A)}`,
      `https://evilnotion.so/${compact(A)}`,
      `https://notion.so@evil.example/${compact(A)}`,
      `https://evil.example/?next=https://www.notion.so/${compact(A)}`,
      `javascript:alert(1)//notion.so/${compact(A)}`,
      'ftp://www.notion.so/',
      '',
    ]) {
      assert.equal(notionId(url), null, url);
    }
  });

  it('answers null for a value that is not a string', () => {
    for (const value of [null, undefined, 42, {}, []]) assert.equal(notionId(value), null, String(value));
  });

  it('takes the page id from the path, not from a peek or view query', () => {
    assert.equal(notionId(`https://www.notion.so/ws/Title-${compact(A)}?p=${compact(B)}&pm=s`), A);
    assert.equal(notionId(`https://www.notion.so/${compact(A)}?v=${compact(B)}`), A);
  });

  it('dashes a compact id and leaves a dashed one unchanged', () => {
    assert.equal(dashed(compact(A)), A);
    assert.equal(dashed(A), A);
  });
});

describe('front matter', () => {
  const lines = (opts) => frontMatter(opts).split('\n');

  it('holds four keys between two fences whatever the title is', () => {
    for (const title of ['plain', 'with "quotes"', 'two\nlines', '---', 'a: b', '', '🚗', "it's", 'back\\slash']) {
      const out = lines({ title, id: 'aaaaaaaa-1111-2222-3333-444444444444', url: 'https://www.notion.so/x', edited: '2026-10-01T10:00:00.000Z' });
      assert.equal(out[0], '---', JSON.stringify(title));
      assert.deepEqual(out.slice(1, 5).map((l) => l.split(':')[0]), ['title', 'notion_id', 'notion_url', 'last_edited'], JSON.stringify(title));
      assert.equal(out[5], '---', JSON.stringify(title));
      assert.equal(JSON.parse(out[1].slice('title: '.length)), title);
    }
  });

  it('writes the id dashed even when given the compact form', () => {
    const out = lines({ title: 't', id: 'aaaaaaaa111122223333444444444444', url: 'https://www.notion.so/x', edited: '2026-10-01T10:00:00.000Z' });
    assert.equal(out[2], 'notion_id: aaaaaaaa-1111-2222-3333-444444444444');
  });
});

describe('block rendering', () => {
  const ctx = (over = {}) => ({ resolve: () => null, file: () => null, unknown: {}, ...over });
  const block = (type, body = {}, children) => ({ object: 'block', id: `${type}-id`, type, has_children: Boolean(children), [type]: body, ...(children ? { children } : {}) });
  const rt = (s) => ({ rich_text: [textPart(s)] });

  it('fences a code block that itself holds a triple backtick with a longer fence', () => {
    const md = renderBlocks([block('code', { ...rt('a\n```\nb'), language: 'js' })], ctx());
    const fence = md.match(/^`+/)[0];
    assert.ok(fence.length >= 4, md);
    assert.ok(md.trimEnd().endsWith(fence), md);
  });

  it('renders a block whose body object is missing without failing', () => {
    const md = renderBlocks([{ object: 'block', id: 'p', type: 'paragraph', has_children: false }], ctx());
    assert.equal(md.trim(), '');
  });

  it('keeps the title of a child page that is outside the crawl', () => {
    const md = renderBlocks([block('child_page', { title: 'Gone page' })], ctx());
    assert.match(md, /Gone page/);
  });

  it('renders nested toggles two hundred deep down to the innermost text', () => {
    let inner = block('paragraph', rt('INNERMOST'));
    for (let i = 0; i < 200; i += 1) inner = block('toggle', rt(`level ${i}`), [inner]);
    assert.match(renderBlocks([inner], ctx()), /INNERMOST/);
  });

  it('counts an unknown block type in the context and comments its name', () => {
    const c = ctx();
    const md = renderBlocks([block('hologram'), block('hologram')], c);
    assert.equal(c.unknown.hologram, 2);
    assert.match(md, /<!--[^>]*hologram[^>]*-->/);
  });
});

describe('properties', () => {
  const ctx = () => ({ resolve: () => null, file: () => null, unknown: {} });

  it('renders a number of zero as 0, not as nothing', () => {
    assert.equal(renderProperty({ id: 'n', type: 'number', number: 0 }, ctx()), '0');
  });

  it('renders an unset select as nothing', () => {
    assert.equal(renderProperty({ id: 's', type: 'select', select: null }, ctx()), '');
  });

  it('comments an unknown property type and counts it', () => {
    const c = ctx();
    const out = renderProperty({ id: 'x', type: 'hologram', hologram: {} }, c);
    assert.match(out, /hologram/);
    assert.equal(c.unknown.hologram, 1);
  });
});
