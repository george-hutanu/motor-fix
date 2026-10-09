import { afterEach, beforeEach, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { EPICS, run } from './notion-export.mjs';
import { STORIES } from './notion-sync.mjs';
import { FILE_HOST, IDS, space, TOKEN } from './notion-export/fixtures/space.mjs';

let base;
let root;
let docs;
let fx;
let logs;

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), 'notion-dl-')));
  root = join(base, 'checkout');
  const clone = join(root, '.motor-fix-specs');
  docs = join(clone, 'docs');
  mkdirSync(join(docs), { recursive: true });
  mkdirSync(join(clone, 'specs', '100-old'), { recursive: true });
  writeFileSync(join(clone, 'specs', '100-old', 'spec.md'), '# old\n');
  writeFileSync(join(docs, 'README.md'), 'docs\n');
  const git = (...args) => execFileSync('git', args, { cwd: clone, stdio: 'ignore' });
  git('init', '-q', '-b', 'trunk');
  git('add', '-A');
  git('-c', 'user.name=t', '-c', 'user.email=t@x', 'commit', '-q', '-m', 'seed');
  fx = space({ stories: STORIES, epics: EPICS });
  logs = [];
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

const exportDocs = (argv, fetcher) =>
  run({ argv, env: { NOTION_TOKEN: TOKEN, NOTION_SYNC_TIMEOUT_MS: '2000' }, root, fetchImpl: fetcher ?? fx.fetchImpl, rootPage: IDS.root, sleep: async () => {}, log: (l) => logs.push(String(l)) });

const walk = (dir, out = []) => {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
};
const everythingWritten = () => walk(docs).map((p) => readFileSync(p, 'latin1')).join('\n');
const hostOnly = (fn) => (url, init) => (String(url).startsWith(FILE_HOST) ? fn(url, init) : fx.fetchImpl(url, init));
const SIGNED = /X-Amz-|Signature=|\.amazonaws\.com/;

describe('a file host that misbehaves', () => {
  // @traces 1018-FR-011
  it('gives up on a host that never answers and ends with exit 1 and no index', async () => {
    const hang = hostOnly(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal.reason ?? new Error('aborted')));
        }),
    );
    let timer;
    const guard = new Promise((resolve) => {
      timer = setTimeout(() => resolve('hung'), 20000);
    });
    const outcome = await Promise.race([exportDocs([], hang), guard]);
    clearTimeout(timer);
    assert.notEqual(outcome, 'hung', 'the export waited past 20 s for a download');
    assert.equal(outcome.code, 1);
    assert.equal(existsSync(join(docs, 'index.json')), false);
  }, 30000);

  // @traces 1018-FR-011
  it('gives up on a body that stalls after the headers', async () => {
    const stall = hostOnly((_url, init) => {
      const body = new ReadableStream({
        start(controller) {
          init?.signal?.addEventListener('abort', () => controller.error(init.signal.reason ?? new Error('aborted')));
        },
      });
      return Promise.resolve(new Response(body, { status: 200, headers: { 'Content-Length': '10' } }));
    });
    let timer;
    const guard = new Promise((resolve) => {
      timer = setTimeout(() => resolve('hung'), 20000);
    });
    const outcome = await Promise.race([exportDocs([], stall), guard]);
    clearTimeout(timer);
    assert.notEqual(outcome, 'hung', 'the export waited past 20 s for a body');
    assert.equal(outcome.code, 1);
  }, 30000);

  for (const status of [500, 502, 404, 403]) {
    // @traces 1018-FR-007 1018-FR-013
    it(`answers ${status} from the file host with exit 1, no index and no signed URL anywhere`, async () => {
      const r = await exportDocs([], hostOnly(() => Promise.resolve(new Response('nope', { status }))));
      assert.equal(r.code, 1, JSON.stringify(r));
      assert.equal(existsSync(join(docs, 'index.json')), false);
      assert.ok(!SIGNED.test(JSON.stringify(r) + logs.join('\n') + everythingWritten()));
    });
  }

  // @traces 1018-FR-007
  it('keeps a signed URL out of the report and the log when the network error message quotes it', async () => {
    const quoting = hostOnly((url) => Promise.reject(new TypeError(`fetch failed: GET ${url} ECONNRESET`)));
    const r = await exportDocs([], quoting);
    assert.equal(r.code, 1, JSON.stringify(r));
    assert.ok(!SIGNED.test(JSON.stringify(r) + logs.join('\n') + everythingWritten()), JSON.stringify(r));
  });

  // @traces 1018-FR-007
  it('keeps a signed URL out of every written file on a successful run', async () => {
    const r = await exportDocs([]);
    assert.equal(r.code, 0, JSON.stringify(r));
    assert.ok(!SIGNED.test(everythingWritten()));
    assert.ok(!SIGNED.test(JSON.stringify(r) + logs.join('\n')));
  });

  // @traces 1018-FR-007
  it('does not copy a signed file URL into a page that links to it as text', async () => {
    const url = `${FILE_HOST}/ws/zz/leak.pdf?X-Amz-Signature=sig&X-Amz-Expires=3600`;
    const ann = { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: 'default' };
    fx.edit(IDS.vision2, [
      { object: 'block', id: 'aaaaaaaa-0000-4000-8000-000000000001', type: 'paragraph', has_children: false, paragraph: { rich_text: [{ type: 'text', plain_text: 'the spec', href: url, text: { content: 'the spec', link: { url } }, annotations: ann }] } },
    ]);
    const r = await exportDocs([]);
    assert.equal(r.code, 0, JSON.stringify(r));
    assert.ok(!SIGNED.test(everythingWritten()), 'a signed URL was written into a page body');
  });

  // @traces 1018-FR-011
  it('writes the note for a too-large file without its URL or its signed query', async () => {
    const big = hostOnly(() => Promise.resolve(new Response('x', { status: 200, headers: { 'Content-Length': String(60 * 1024 * 1024) } })));
    const r = await exportDocs([], big);
    assert.equal(r.code, 0, JSON.stringify(r));
    assert.ok(r.report.tooLarge.length >= 1);
    assert.ok(!SIGNED.test(JSON.stringify(r) + everythingWritten()));
  });

  // @traces 1018-FR-011
  it('treats a Content-Length that is not a number as unknown and still bounds the body', async () => {
    const odd = hostOnly(() => Promise.resolve(new Response('tiny', { status: 200, headers: { 'Content-Length': 'abc' } })));
    const r = await exportDocs([], odd).catch((e) => ({ code: 'threw', error: String(e) }));
    assert.equal(r.code, 0, JSON.stringify(r));
  });

  // @traces 1018-FR-011
  it('does not write a half file when a download fails after others succeeded', async () => {
    let n = 0;
    const second = hostOnly((url, init) => (++n === 2 ? Promise.resolve(new Response('x', { status: 500 })) : fx.fetchImpl(url, init)));
    const r = await exportDocs([], second);
    assert.equal(r.code, 1, JSON.stringify(r));
    assert.deepEqual(walk(docs).filter((p) => p.endsWith('.tmp') || p.includes('.part')), []);
    assert.equal(existsSync(join(docs, 'index.json')), false);
  });
});
