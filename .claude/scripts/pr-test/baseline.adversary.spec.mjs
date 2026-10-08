import { afterEach, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { chooseBaseline, diffShots, visualOutcome } from './baseline.mjs';

const require = createRequire(import.meta.url);
const sharp = require('sharp');

const REPO = 'george-hutanu/motor-fix';
const HEAD = 'b'.repeat(40);
const MAIN = 'a'.repeat(40);
const OWN = 'e'.repeat(40);
const ok = (v) => ({ code: 0, stdout: typeof v === 'string' ? v : JSON.stringify(v), stderr: '' });
const fail = (stderr) => ({ code: 1, stdout: '', stderr });
const run = (id, pr, sha, conclusion, createdAt) => ({ databaseId: id, displayTitle: `PR QA #${pr} at ${sha} lap 1 n${id}`, conclusion, createdAt });
const report = (pr, sha) => JSON.stringify({ pr, sha, lap: 1, findings: [] });

function fakeGh({ list, artifacts = {}, compare = {} }) {
  return (args) => {
    const line = args.join(' ');
    if (/^run list/.test(line)) return typeof list === 'function' ? list() : ok(list);
    if (/^run download/.test(line)) {
      const src = artifacts[args[2]];
      if (!src) return fail('no valid artifacts found to download');
      const dest = args[args.indexOf('-D') + 1];
      for (const [name, bytes] of Object.entries(src)) {
        mkdirSync(dirname(join(dest, name)), { recursive: true });
        writeFileSync(join(dest, name), bytes);
      }
      return ok('');
    }
    const cmp = line.match(/compare\/([^.]+)\.\.\.([0-9a-f]+)/);
    if (cmp) return compare[cmp[2]] ? ok({ status: compare[cmp[2]] }) : fail('Not Found (HTTP 404)');
    return fail(`unexpected: ${line}`);
  };
}

describe('chooseBaseline under hostile answers', () => {
  it('names a reason, and does not throw, when run list fails', () => {
    const got = chooseBaseline({ gh: fakeGh({ list: () => fail('HTTP 403 rate limit') }), repo: REPO, pr: 7, head: HEAD, base: 'main' });
    assert.match(got.none, /rate limit/);
  });

  it('names a reason when run list prints something that is not JSON or not a list', () => {
    for (const out of ['<html>bad gateway</html>', '{"message":"x"}', 'null', '']) {
      const got = chooseBaseline({ gh: fakeGh({ list: () => ok(out) }), repo: REPO, pr: 7, head: HEAD, base: 'main' });
      assert.equal(typeof got.none, 'string', out);
    }
  });

  it('ignores runs whose title does not name a PR, and entries with missing fields', () => {
    const list = [{ databaseId: 1, displayTitle: 'something else', conclusion: 'success', createdAt: '2026-10-05T10:00:00Z' }, { databaseId: 2 }, null];
    const got = chooseBaseline({ gh: fakeGh({ list }), repo: REPO, pr: 7, head: HEAD, base: 'main' });
    assert.equal(typeof got.none, 'string');
  });

  it('never picks the run being judged, a run of the same head, or a run newer than it', () => {
    const list = [run(50, 7, HEAD.slice(0, 7), 'success', '2026-10-05T12:00:00Z'), run(60, 5, MAIN, 'success', '2026-10-05T13:00:00Z'), run(40, 7, OWN, 'success', '2026-10-05T11:00:00Z')];
    const gh = fakeGh({
      list,
      artifacts: { 50: { 'report.json': report(7, HEAD) }, 60: { 'report.json': report(5, MAIN) }, 40: { 'report.json': report(7, OWN) } },
      compare: { [MAIN]: 'behind' },
    });
    const got = chooseBaseline({ gh, repo: REPO, pr: 7, head: HEAD, base: 'main', run: 50 });
    assert.equal(got.id, 40);
  });

  it('skips a run of a commit that is ahead of or diverged from the base', () => {
    for (const status of ['ahead', 'diverged']) {
      const gh = fakeGh({ list: [run(20, 5, MAIN, 'success', '2026-10-05T11:00:00Z')], artifacts: { 20: { 'report.json': report(5, MAIN) } }, compare: { [MAIN]: status } });
      assert.match(chooseBaseline({ gh, repo: REPO, pr: 7, head: HEAD, base: 'main' }).none, /no finished run/);
    }
  });

  it('skips a cancelled run and takes the next finished one', () => {
    const gh = fakeGh({
      list: [run(30, 5, MAIN, 'cancelled', '2026-10-05T12:00:00Z'), run(20, 6, MAIN, 'success', '2026-10-05T11:00:00Z')],
      artifacts: { 30: { 'report.json': report(5, MAIN) }, 20: { 'report.json': report(6, MAIN) } },
      compare: { [MAIN]: 'identical' },
    });
    assert.equal(chooseBaseline({ gh, repo: REPO, pr: 7, head: HEAD, base: 'main' }).id, 20);
  });

  it('prefers a run on the base for the visual diff, and this PR\'s own earlier run by default', () => {
    const gh = fakeGh({
      list: [run(30, 7, OWN, 'success', '2026-10-05T12:00:00Z'), run(20, 5, MAIN, 'success', '2026-10-05T11:00:00Z')],
      artifacts: { 30: { 'report.json': report(7, OWN) }, 20: { 'report.json': report(5, MAIN) } },
      compare: { [MAIN]: 'behind' },
    });
    assert.equal(chooseBaseline({ gh, repo: REPO, pr: 7, head: HEAD, base: 'main', prefer: 'base' }).id, 20);
    assert.equal(chooseBaseline({ gh, repo: REPO, pr: 7, head: HEAD, base: 'main' }).id, 30);
  });

  it('refuses an artifact whose report.json is not JSON, listing it as skipped', () => {
    const gh = fakeGh({ list: [run(20, 5, MAIN, 'success', '2026-10-05T11:00:00Z')], artifacts: { 20: { 'report.json': '{not json' } }, compare: { [MAIN]: 'behind' } });
    const got = chooseBaseline({ gh, repo: REPO, pr: 7, head: HEAD, base: 'main' });
    assert.equal(typeof got.none, 'string');
    assert.equal(got.skipped.length, 1);
  });

  it('answers an explicit folder without a report.json with a reason', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bl-adv-'));
    try {
      const got = chooseBaseline({ gh: fakeGh({ list: [] }), repo: REPO, pr: 7, head: HEAD, base: 'main', explicit: dir });
      assert.match(got.none, /no report\.json/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('answers an explicit run id that does not exist with a reason, not a throw', () => {
    const got = chooseBaseline({ gh: fakeGh({ list: [] }), repo: REPO, pr: 7, head: HEAD, base: 'main', explicit: '999999' });
    assert.equal(typeof got.none, 'string');
  });

  it('answers an unknown base with a reason', () => {
    const got = chooseBaseline({ gh: fakeGh({ list: [] }), repo: REPO, pr: 7, head: HEAD, base: undefined });
    assert.equal(typeof got.none, 'string');
  });
});

describe('diffShots under hostile images', () => {
  const roots = [];
  afterEach(() => {
    for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
  });
  const dirs = () => {
    const root = mkdtempSync(join(tmpdir(), 'diff-adv-'));
    roots.push(root);
    return { cur: join(root, 'cur'), base: join(root, 'base'), out: join(root, 'out') };
  };
  async function png(path, { width = 64, height = 48, rects = [], fill = 255 } = {}) {
    mkdirSync(dirname(path), { recursive: true });
    const raw = Buffer.alloc(width * height * 4, fill);
    for (let i = 3; i < raw.length; i += 4) raw[i] = 255;
    for (const r of rects)
      for (let y = r.y; y < Math.min(r.y + r.h, height); y++)
        for (let x = r.x; x < Math.min(r.x + r.w, width); x++) {
          const i = (y * width + x) * 4;
          raw[i] = raw[i + 1] = raw[i + 2] = 0;
        }
    await sharp(raw, { raw: { width, height, channels: 4 } }).png().toFile(path);
  }

  it('answers an empty object for two empty folders', async () => {
    const d = dirs();
    mkdirSync(d.cur, { recursive: true });
    mkdirSync(d.base, { recursive: true });
    assert.deepEqual(await diffShots(d.cur, d.base, d.out), {});
  });

  it('answers every shot as new when the baseline folder does not exist', async () => {
    const d = dirs();
    await png(join(d.cur, 'shots/a.png'));
    const got = await diffShots(d.cur, d.base, d.out);
    assert.equal(got['shots/a.png'].status, 'new');
  });

  it('calls a shot new, and does not throw, when the current file is not a PNG', async () => {
    const d = dirs();
    await png(join(d.base, 'shots/a.png'));
    mkdirSync(join(d.cur, 'shots'), { recursive: true });
    writeFileSync(join(d.cur, 'shots/a.png'), 'this is not an image');
    await png(join(d.cur, 'shots/b.png'));
    await png(join(d.base, 'shots/b.png'));
    const got = await diffShots(d.cur, d.base, d.out);
    assert.equal(got['shots/a.png'].status, 'new');
    assert.equal(got['shots/b.png'].status, 'identical');
  });

  it('calls a shot new when the baseline file is truncated or empty', async () => {
    const d = dirs();
    await png(join(d.cur, 'shots/a.png'));
    await png(join(d.cur, 'shots/b.png'));
    mkdirSync(join(d.base, 'shots'), { recursive: true });
    writeFileSync(join(d.base, 'shots/a.png'), '');
    writeFileSync(join(d.base, 'shots/b.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const got = await diffShots(d.cur, d.base, d.out);
    assert.equal(got['shots/a.png'].status, 'new');
    assert.equal(got['shots/b.png'].status, 'new');
  });

  it('reports a different width as changed without throwing', async () => {
    const d = dirs();
    await png(join(d.cur, 'shots/a.png'), { width: 96 });
    await png(join(d.base, 'shots/a.png'), { width: 64 });
    const got = (await diffShots(d.cur, d.base, d.out))['shots/a.png'];
    assert.equal(got.status, 'changed');
    assert.ok(existsSync(join(d.out, got.diff)));
  });

  it('reports a page that shrank as changed', async () => {
    const d = dirs();
    await png(join(d.cur, 'shots/a.png'), { height: 48 });
    await png(join(d.base, 'shots/a.png'), { height: 96 });
    const got = (await diffShots(d.cur, d.base, d.out))['shots/a.png'];
    assert.equal(got.status, 'changed');
    assert.ok(got.regions.length >= 1);
  });

  it('keeps every region inside the larger image', async () => {
    const d = dirs();
    await png(join(d.cur, 'shots/a.png'), { width: 70, height: 50, rects: [{ x: 60, y: 40, w: 10, h: 10 }, { x: 0, y: 0, w: 70, h: 50 }] });
    await png(join(d.base, 'shots/a.png'), { width: 70, height: 50 });
    const got = (await diffShots(d.cur, d.base, d.out))['shots/a.png'];
    for (const r of got.regions) {
      assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.width <= 70 && r.y + r.height <= 50, JSON.stringify(r));
    }
  });

  it('is idempotent: the same two folders give the same answer twice', async () => {
    const d = dirs();
    await png(join(d.cur, 'shots/a.png'), { rects: [{ x: 16, y: 16, w: 32, h: 16 }] });
    await png(join(d.base, 'shots/a.png'));
    const first = await diffShots(d.cur, d.base, d.out);
    const second = await diffShots(d.cur, d.base, d.out);
    assert.deepEqual(second, first);
  });

  it('writes nothing under the output folder for identical, new and removed shots', async () => {
    const d = dirs();
    await png(join(d.cur, 'shots/same.png'));
    await png(join(d.base, 'shots/same.png'));
    await png(join(d.cur, 'shots/new.png'));
    await png(join(d.base, 'shots/gone.png'));
    await diffShots(d.cur, d.base, d.out);
    assert.ok(!existsSync(d.out) || readdirSync(d.out).length === 0);
  });

  it('ignores files that are not PNGs in either folder', async () => {
    const d = dirs();
    await png(join(d.cur, 'shots/a.png'));
    await png(join(d.base, 'shots/a.png'));
    writeFileSync(join(d.cur, 'shots/notes.txt'), 'x');
    writeFileSync(join(d.base, 'shots/old.jpg'), 'x');
    assert.deepEqual(Object.keys(await diffShots(d.cur, d.base, d.out)), ['shots/a.png']);
  });

  it('handles shot names with spaces and unicode', async () => {
    const d = dirs();
    await png(join(d.cur, 'shots/cockpit ro-ă.png'), { rects: [{ x: 0, y: 0, w: 64, h: 48 }] });
    await png(join(d.base, 'shots/cockpit ro-ă.png'));
    const got = (await diffShots(d.cur, d.base, d.out))['shots/cockpit ro-ă.png'];
    assert.equal(got.status, 'changed');
    assert.ok(existsSync(join(d.out, got.diff)));
  });

  it('compares a tall, full-page capture in reasonable time', async () => {
    const d = dirs();
    await png(join(d.cur, 'shots/tall.png'), { width: 1440, height: 12000, rects: [{ x: 100, y: 9000, w: 300, h: 200 }] });
    await png(join(d.base, 'shots/tall.png'), { width: 1440, height: 12000 });
    const started = Date.now();
    const got = (await diffShots(d.cur, d.base, d.out))['shots/tall.png'];
    assert.equal(got.status, 'changed');
    assert.ok(Date.now() - started < 30000);
  });

  it('treats a change smaller than two cells as noise and a larger one as a region, with a custom cell size', async () => {
    const d = dirs();
    await png(join(d.cur, 'shots/a.png'), { rects: [{ x: 0, y: 0, w: 8, h: 8 }] });
    await png(join(d.base, 'shots/a.png'));
    assert.equal((await diffShots(d.cur, d.base, d.out, { cell: 8, minCells: 2 }))['shots/a.png'].status, 'identical');
    assert.equal((await diffShots(d.cur, d.base, d.out, { cell: 8, minCells: 1 }))['shots/a.png'].status, 'changed');
  });

  it('reports a shot as identical in the contract shape', async () => {
    const d = dirs();
    await png(join(d.cur, 'shots/a.png'));
    await png(join(d.base, 'shots/a.png'));
    const got = await diffShots(d.cur, d.base, d.out);
    assert.deepEqual(got['shots/a.png'], { status: 'identical' });
  });
});

describe('visualOutcome under odd input', () => {
  const meta = { run: 20, pr: 5, sha: MAIN, lap: 1 };

  it('says every shot is new for a missing meta, a none, or null shots', () => {
    for (const args of [{ meta: null, shots: {} }, { meta: { none: 'x' }, shots: {} }, { meta, shots: null }]) {
      const got = visualOutcome({ ...args, web: false });
      assert.equal(got.visual, null);
      assert.deepEqual(got.findings, []);
      assert.match(got.notes[0], /every shot is new/);
    }
  });

  it('counts zero everywhere for an empty set of shots', () => {
    const got = visualOutcome({ meta, shots: {}, web: false });
    assert.match(got.notes[0], /0 changed, 0 identical, 0 new/);
    assert.deepEqual(got.findings, []);
  });

  it('names a single region in the singular', () => {
    const shots = { 'shots/a.png': { status: 'changed', regions: [{ x: 0, y: 0, width: 32, height: 16 }], diff: 'diff/a.png' }, 'shots/gone.png': { status: 'removed' } };
    const got = visualOutcome({ meta, shots, web: false });
    assert.match(got.findings[0].title, /1 region$/);
  });

  it('gives each unintended change a distinct key and a diff image as evidence', () => {
    const shots = {
      'shots/a.png': { status: 'changed', regions: [{ x: 0, y: 0, width: 32, height: 16 }], diff: 'diff/a.png' },
      'shots/b.png': { status: 'changed', regions: [{ x: 0, y: 0, width: 32, height: 16 }], diff: 'diff/b.png' },
    };
    const got = visualOutcome({ meta, shots, web: false });
    assert.equal(new Set(got.findings.map((f) => f.key)).size, 2);
    assert.deepEqual(got.findings.map((f) => f.evidence), ['diff/a.png', 'diff/b.png']);
  });

  it('files no finding for new or removed shots of a PR with no web code', () => {
    const shots = { 'shots/n.png': { status: 'new' }, 'shots/r.png': { status: 'removed' } };
    assert.deepEqual(visualOutcome({ meta, shots, web: false }).findings, []);
  });
});
