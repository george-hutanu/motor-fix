import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { chooseBaseline, diffShots, fetchBaseline, readReport, visualOutcome } from './baseline.mjs';

const require = createRequire(import.meta.url);
const sharp = require('sharp');

const REPO = 'george-hutanu/motor-fix';
const HEAD = 'b'.repeat(40);
const ok = (v) => ({ code: 0, stdout: typeof v === 'string' ? v : JSON.stringify(v), stderr: '' });
const fail = (stderr) => ({ code: 1, stdout: '', stderr });
const run = (id, pr, sha, lap = 1, conclusion = 'success', createdAt = '2026-10-05T10:00:00Z') => ({
  databaseId: id,
  displayTitle: `PR QA #${pr} at ${sha} lap ${lap} n${id}`,
  conclusion,
  createdAt,
});
const report = (over = {}) => ({ pr: 1, sha: 'c'.repeat(40), lap: 1, findings: [], ...over });

/** A gh that answers `run list`, `run download` and `compare` from tables. */
function fakeGh({ runs = [], artifacts = {}, compare = {} } = {}) {
  const calls = [];
  const gh = (args) => {
    calls.push(args.join(' '));
    const line = args.join(' ');
    if (/^run list/.test(line)) return ok(runs);
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
  return { gh, calls };
}

describe('chooseBaseline, base first (the visual diff)', () => {
  const mainSha = 'a'.repeat(40);
  const otherSha = 'd'.repeat(40);
  const earlier = 'e'.repeat(40);

  it('takes the newest finished run of a commit on the base branch before this PR\'s earlier run', () => {
    const { gh } = fakeGh({
      runs: [run(30, 7, earlier, 1, 'success', '2026-10-05T12:00:00Z'), run(20, 5, mainSha, 2, 'success', '2026-10-05T11:00:00Z'), run(10, 4, otherSha, 1, 'failure', '2026-10-05T09:00:00Z')],
      artifacts: { 20: { 'report.json': JSON.stringify(report({ pr: 5, sha: mainSha, lap: 2 })) } },
      compare: { [mainSha]: 'behind', [otherSha]: 'behind' },
    });
    const got = chooseBaseline({ gh, repo: REPO, pr: 7, head: HEAD, base: 'main', prefer: 'base' });
    assert.equal(got.id, 20);
    assert.match(got.label, /run 20 · PR #5 · commit aaaaaaa · lap 2/);
  });

  it('skips a run whose commit is not on the base and one still in progress', () => {
    const { gh } = fakeGh({
      runs: [run(40, 5, otherSha, 1, null, '2026-10-05T13:00:00Z'), run(30, 6, otherSha, 1, 'success', '2026-10-05T12:00:00Z'), run(20, 5, mainSha, 1, 'failure', '2026-10-05T11:00:00Z')],
      artifacts: { 20: { 'report.json': JSON.stringify(report({ sha: mainSha })) }, 30: { 'report.json': JSON.stringify(report()) } },
      compare: { [mainSha]: 'identical', [otherSha]: 'diverged' },
    });
    assert.equal(chooseBaseline({ gh, repo: REPO, pr: 7, head: HEAD, base: 'main', prefer: 'base' }).id, 20);
  });

  it('falls back to this PR\'s earlier run when no run of the base is left', () => {
    const { gh } = fakeGh({
      runs: [run(30, 7, earlier, 1, 'success', '2026-10-05T12:00:00Z')],
      artifacts: { 30: { 'report.json': JSON.stringify(report({ pr: 7, sha: earlier })) } },
    });
    assert.equal(chooseBaseline({ gh, repo: REPO, pr: 7, head: HEAD, base: 'main', prefer: 'base' }).id, 30);
  });

  it('names why there is none, listing an expired artifact as skipped', () => {
    const { gh } = fakeGh({ runs: [run(20, 5, mainSha)], compare: { [mainSha]: 'behind' } });
    const got = chooseBaseline({ gh, repo: REPO, pr: 7, head: HEAD, base: 'main', prefer: 'base' });
    assert.match(got.none, /no finished run/);
    assert.match(got.skipped[0], /run 20: download failed/);
  });
});

describe('fetchBaseline (the workflow step)', () => {
  it('copies the chosen artifact into --out and writes baseline.json', () => {
    const sha = 'a'.repeat(40);
    const { gh } = fakeGh({
      runs: [run(20, 5, sha, 3)],
      artifacts: { 20: { 'report.json': JSON.stringify(report({ pr: 5, sha, lap: 3 })), 'shots/home-desktop-light-ro.png': 'x' } },
      compare: { [sha]: 'behind' },
    });
    const out = join(mkdtempSync(join(tmpdir(), 'bl-')), 'baseline');
    const res = fetchBaseline({ gh, repo: REPO, pr: 7, head: HEAD, base: 'main', out });
    assert.equal(res.line, 'baseline: run 20 · PR #5 · commit aaaaaaa · lap 3');
    assert.ok(existsSync(join(out, 'report.json')));
    assert.ok(existsSync(join(out, 'shots/home-desktop-light-ro.png')));
    assert.deepEqual(JSON.parse(readFileSync(join(out, 'baseline.json'), 'utf8')), { run: 20, pr: 5, sha, lap: 3 });
  });

  it('writes the reason when there is none, and still succeeds', () => {
    const out = join(mkdtempSync(join(tmpdir(), 'bl-')), 'baseline');
    const res = fetchBaseline({ gh: fakeGh().gh, repo: REPO, pr: 7, head: HEAD, base: 'main', out });
    assert.match(res.line, /^no baseline: /);
    assert.match(JSON.parse(readFileSync(join(out, 'baseline.json'), 'utf8')).none, /no finished run/);
  });
});

const W = 64;
const H = 48;
async function png(path, { width = W, height = H, rects = [] } = {}) {
  mkdirSync(dirname(path), { recursive: true });
  const raw = Buffer.alloc(width * height * 4, 255);
  for (const r of rects)
    for (let y = r.y; y < r.y + r.h; y++)
      for (let x = r.x; x < r.x + r.w; x++) {
        const i = (y * width + x) * 4;
        raw[i] = 0;
        raw[i + 1] = 0;
        raw[i + 2] = 0;
      }
  await sharp(raw, { raw: { width, height, channels: 4 } }).png().toFile(path);
}

describe('diffShots', () => {
  const dirs = () => {
    const root = mkdtempSync(join(tmpdir(), 'diff-'));
    return { cur: join(root, 'cur'), base: join(root, 'base'), out: join(root, 'cur') };
  };

  it('loads the image library from the tested checkout and names it when that checkout has none', async () => {
    const d = dirs();
    await png(join(d.cur, 'shots/a.png'));
    await png(join(d.base, 'shots/a.png'));
    await assert.rejects(diffShots(d.cur, d.base, d.out, { root: mkdtempSync(join(tmpdir(), 'no-sharp-')) }), /sharp/);
  });

  it('sorts shots into identical, changed, new and removed', async () => {
    const d = dirs();
    await png(join(d.cur, 'shots/same.png'));
    await png(join(d.base, 'shots/same.png'));
    await png(join(d.cur, 'shots/block.png'), { rects: [{ x: 16, y: 16, w: 32, h: 16 }] });
    await png(join(d.base, 'shots/block.png'));
    await png(join(d.cur, 'shots/added.png'));
    await png(join(d.base, 'shots/gone.png'));
    const res = await diffShots(d.cur, d.base, d.out);
    assert.equal(res['shots/same.png'].status, 'identical');
    assert.equal(res['shots/added.png'].status, 'new');
    assert.equal(res['shots/gone.png'].status, 'removed');
    assert.equal(res['shots/block.png'].status, 'changed');
    assert.deepEqual(res['shots/block.png'].regions, [{ x: 16, y: 16, width: 32, height: 16 }]);
    assert.equal(res['shots/block.png'].diff, 'diff/block.png');
    assert.ok(existsSync(join(d.out, 'diff/block.png')));
    assert.ok(!existsSync(join(d.out, 'diff/same.png')));
  });

  it('ignores a one-pixel speck', async () => {
    const d = dirs();
    await png(join(d.cur, 'shots/a.png'), { rects: [{ x: 5, y: 5, w: 1, h: 1 }] });
    await png(join(d.base, 'shots/a.png'));
    assert.equal((await diffShots(d.cur, d.base, d.out))['shots/a.png'].status, 'identical');
  });

  it('reports a taller page as a region at the bottom', async () => {
    const d = dirs();
    await png(join(d.cur, 'shots/a.png'), { height: H + 32 });
    await png(join(d.base, 'shots/a.png'));
    const got = (await diffShots(d.cur, d.base, d.out))['shots/a.png'];
    assert.equal(got.status, 'changed');
    assert.deepEqual(got.regions, [{ x: 0, y: H, width: W, height: 32 }]);
  });
});

describe('what the run makes of the baseline', () => {
  const dir = () => mkdtempSync(join(tmpdir(), 'bl-'));

  it('reads the baseline report, or none when it is missing or broken', () => {
    const d = dir();
    assert.equal(readReport(d), null);
    writeFileSync(join(d, 'report.json'), '{broken');
    assert.equal(readReport(d), null);
    writeFileSync(join(d, 'report.json'), JSON.stringify(report({ layout: true, findings: [{ kind: 'layout', rule: 'grid' }] })));
    assert.deepEqual(readReport(d).findings, [{ kind: 'layout', rule: 'grid' }]);
    assert.equal(readReport(d).layout, true);
  });

  const shots = {
    'shots/a.png': { status: 'changed', regions: [{ x: 0, y: 0, width: 32, height: 16 }, { x: 0, y: 64, width: 16, height: 32 }], diff: 'diff/a.png' },
    'shots/b.png': { status: 'identical' },
    'shots/c.png': { status: 'new' },
  };
  const meta = { run: 20, pr: 5, sha: 'a'.repeat(40), lap: 3 };

  it('notes the counts against the baseline run and keeps visual.json', () => {
    const got = visualOutcome({ meta, shots, web: true });
    assert.deepEqual(got.notes, ['Visual: 1 changed, 1 identical, 1 new against run 20 of aaaaaaa.']);
    assert.deepEqual(got.findings, []);
    assert.deepEqual(got.visual, { baseline: meta, shots });
  });

  it('reports a medium visual finding per changed shot only when the PR touches no web file', () => {
    const got = visualOutcome({ meta, shots, web: false });
    assert.deepEqual(got.findings, [
      {
        kind: 'visual',
        severity: 'medium',
        title: 'Unintended visual change: shots/a.png, 2 regions',
        evidence: 'diff/a.png',
        key: 'visual|shots/a.png',
        steps: ['Compare shots/a.png with the baseline run 20 of aaaaaaa', 'See the changed regions in diff/a.png'],
      },
    ]);
  });

  it('says every shot is new when there is no baseline', () => {
    const got = visualOutcome({ meta: { none: 'no finished run of a commit on main' }, shots: null, web: true });
    assert.deepEqual(got.notes, ['No baseline: no finished run of a commit on main; every shot is new.']);
    assert.equal(got.visual, null);
  });
});
