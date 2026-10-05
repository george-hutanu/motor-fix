import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { buildPacket, frIds, shotDelta } from './packet.mjs';

const REPO = 'george-hutanu/motor-fix';
const HEAD = 'b'.repeat(40);
const OLD = 'a'.repeat(40);
const MAIN_SHA = 'c'.repeat(40);

/** An artifact folder: report.json plus screenshots given as { 'shots/x.png': 'bytes' }. */
function artifact(report, shots = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'packet-'));
  writeFileSync(join(dir, 'report.json'), JSON.stringify(report));
  for (const [name, bytes] of Object.entries(shots)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), bytes);
  }
  return dir;
}

const report = (over = {}) => ({
  pr: 137,
  repo: REPO,
  sha: HEAD,
  lap: 2,
  verdict: 'failure',
  summary: '1 blocking finding',
  booted: true,
  notes: ['Ran on GitHub Actions.', 'No changed GET endpoint.'],
  screenshots: [],
  findings: [
    { severity: 'high', kind: 'sweep', title: 'Text clipped', route: '/', viewport: 'phone-320', scheme: 'dark', lang: 'ro', evidence: 'shots/home-phone-320-dark-ro.png', steps: ['open /'] },
    { severity: 'low', kind: 'sweep', title: 'Slow first paint', route: '/cockpit' },
  ],
  ...over,
});

const pr = (files) => ({
  number: 137,
  title: 'chore(harness): ST-1 a change',
  headRefName: '001-thing',
  headRefOid: HEAD,
  baseRefName: 'main',
  files,
});

const ok = (stdout) => ({ code: 0, stdout: typeof stdout === 'string' ? stdout : JSON.stringify(stdout), stderr: '' });
const fail = (stderr) => ({ code: 1, stdout: '', stderr });

/** A fake gh: the first rule whose pattern matches the joined args answers; downloads copy a fixture folder into -D. */
function fakeGh({ prView = ok(pr([])), runs = [], artifacts = {}, contents = {}, compare = {} } = {}) {
  const calls = [];
  const gh = (args) => {
    const line = args.join(' ');
    calls.push(line);
    if (/^pr view/.test(line)) return prView;
    if (/^run list/.test(line)) return ok(runs);
    if (/^run download/.test(line)) {
      const id = args[2];
      const src = artifacts[id];
      if (!src) return fail('no valid artifacts found to download');
      const dest = args[args.indexOf('-D') + 1];
      mkdirSync(dest, { recursive: true });
      for (const [name, bytes] of Object.entries(src.files)) {
        mkdirSync(dirname(join(dest, name)), { recursive: true });
        writeFileSync(join(dest, name), bytes);
      }
      return ok('');
    }
    const cmp = line.match(/compare\/([^.]+)\.\.\.([0-9a-f]+)/);
    if (cmp) return compare[cmp[2]] ? ok({ status: compare[cmp[2]] }) : fail('Not Found (HTTP 404)');
    const path = line.match(/contents\/(\S+?)\?ref=/);
    if (path) return path[1] in contents ? ok(contents[path[1]]) : fail('Not Found (HTTP 404)');
    return fail(`unexpected: ${line}`);
  };
  return { gh, calls };
}

const files = (paths) => paths.map((path, i) => ({ path, additions: i + 1, deletions: i }));
const run = (id, pr, sha, lap, conclusion = 'success', createdAt = '2026-10-05T10:00:00Z') => ({
  databaseId: id,
  displayTitle: `PR QA #${pr} at ${sha} lap ${lap} n${id}`,
  conclusion,
  createdAt,
});
const artifactFiles = (rep, shots = {}) => ({ files: { 'report.json': JSON.stringify(rep), ...shots } });
const packetOf = (out) => readFileSync(join(out, 'packet.md'), 'utf8');

describe('the packet', () => {
  it('lists the PR, its changed files with totals, the verdict, notes and findings', () => {
    const out = artifact(report());
    const { gh } = fakeGh({ prView: ok(pr(files(['a.mjs', 'b.mjs']))) });
    const res = buildPacket({ out, pr: 137, repo: REPO, gh });
    assert.equal(res.code, 0);
    const md = packetOf(out);
    assert.match(md, /#137/);
    assert.match(md, /chore\(harness\): ST-1 a change/);
    assert.match(md, /001-thing/);
    assert.match(md, new RegExp(HEAD.slice(0, 7)));
    assert.match(md, /a\.mjs \+1 −0/);
    assert.match(md, /b\.mjs \+2 −1/);
    assert.match(md, /2 files, \+3 −1/);
    assert.match(md, /failure/);
    assert.match(md, /1 blocking finding/);
    assert.match(md, /No changed GET endpoint\./);
    assert.match(md, /Text clipped/);
    assert.match(md, /phone-320/);
    assert.match(md, /shots\/home-phone-320-dark-ro\.png/);
    assert.match(md, /open \//);
    assert.match(md, /Slow first paint/);
  });

  it('caps the file list and keeps the totals exact', () => {
    const out = artifact(report());
    const many = files(Array.from({ length: 150 }, (_, i) => `f${i}.mjs`));
    const { gh } = fakeGh({ prView: ok(pr(many)) });
    buildPacket({ out, pr: 137, repo: REPO, gh });
    const md = packetOf(out);
    assert.match(md, /f99\.mjs/);
    assert.doesNotMatch(md, /f100\.mjs/);
    assert.match(md, /50 more/);
    const adds = many.reduce((n, f) => n + f.additions, 0);
    const dels = many.reduce((n, f) => n + f.deletions, 0);
    assert.match(md, new RegExp(`150 files, \\+${adds} −${dels}`));
  });

  it('exits 2 and writes nothing when the folder has no report', () => {
    const out = mkdtempSync(join(tmpdir(), 'packet-'));
    const res = buildPacket({ out, pr: 137, repo: REPO, gh: fakeGh().gh });
    assert.equal(res.code, 2);
    assert.equal(existsSync(join(out, 'packet.md')), false);
  });

  it('still writes the packet when gh fails, marking the section unavailable', () => {
    const out = artifact(report());
    const { gh } = fakeGh({ prView: fail('HTTP 502') });
    const res = buildPacket({ out, pr: 137, repo: REPO, gh });
    assert.equal(res.code, 0);
    const md = packetOf(out);
    assert.match(md, /unavailable/i);
    assert.match(md, /HTTP 502/);
    assert.match(md, /Text clipped/);
  });
});

describe('requirements touched', () => {
  it('expands an id range', () => {
    assert.deepEqual(frIds('- [ ] T004 Green: x (FR-001–FR-003, FR-007)'), ['FR-001', 'FR-002', 'FR-003', 'FR-007']);
    assert.deepEqual(frIds('no ids here'), []);
  });

  it('lists the ids on task lines naming a changed file, with their text from the spec', () => {
    const out = artifact(report());
    const { gh } = fakeGh({
      prView: ok(pr(files(['.claude/scripts/pr-test/packet.mjs']))),
      contents: {
        'specs/001-thing/tasks.md': '- [x] T001 Green: `.claude/scripts/pr-test/packet.mjs` (FR-001–FR-002)\n- [x] T002 other.mjs (FR-009)\n',
        'specs/001-thing/spec.md': '- **FR-001**: The script MUST write a packet.\n- **FR-002**: The packet MUST list ids.\n- **FR-009**: Nothing else changes.\n',
      },
    });
    buildPacket({ out, pr: 137, repo: REPO, gh });
    const md = packetOf(out);
    assert.match(md, /FR-001.*MUST write a packet/);
    assert.match(md, /FR-002.*MUST list ids/);
    assert.doesNotMatch(md, /FR-009/);
  });

  it('says so when the feature has no tasks file', () => {
    const out = artifact(report());
    const { gh } = fakeGh({ prView: ok(pr(files(['x.mjs']))) });
    buildPacket({ out, pr: 137, repo: REPO, gh });
    assert.match(packetOf(out), /specs\/001-thing\/tasks\.md/);
  });
});

describe('the baseline run', () => {
  const shots = { 'shots/home-desktop-light-ro.png': 'same', 'shots/home-phone-320-dark-ro.png': 'same-too' };

  it('prefers the newest finished run of the same PR at another head', () => {
    const out = artifact(report(), shots);
    const { gh, calls } = fakeGh({
      prView: ok(pr([])),
      runs: [
        run(9, 137, HEAD, 2, 'success', '2026-10-05T12:00:00Z'),
        run(8, 137, OLD, 1, 'cancelled', '2026-10-05T11:30:00Z'),
        run(7, 137, OLD, 1, 'failure', '2026-10-05T11:00:00Z'),
        run(6, 120, MAIN_SHA, 1, 'success', '2026-10-05T11:10:00Z'),
      ],
      artifacts: { 7: artifactFiles(report({ sha: OLD, lap: 1 }), shots), 6: artifactFiles(report({ pr: 120, sha: MAIN_SHA }), shots) },
      compare: { [MAIN_SHA]: 'behind' },
    });
    buildPacket({ out, pr: 137, repo: REPO, run: 9, gh });
    const md = packetOf(out);
    assert.match(md, /run 7/i);
    assert.match(md, new RegExp(OLD.slice(0, 7)));
    assert.ok(!calls.some((c) => /run download 8/.test(c)), 'a cancelled run is never a baseline');
    assert.ok(!calls.some((c) => /run download 9/.test(c)), 'the run under review is never its own baseline');
  });

  it('skips a later run and an expired artifact, then falls back to a run already on the base branch', () => {
    const out = artifact(report(), shots);
    const { gh } = fakeGh({
      prView: ok(pr([])),
      runs: [
        run(10, 137, OLD, 1, 'success', '2026-10-05T13:00:00Z'),
        run(9, 137, HEAD, 2, 'success', '2026-10-05T12:00:00Z'),
        run(7, 137, OLD, 1, 'failure', '2026-10-05T11:00:00Z'),
        run(5, 131, 'd'.repeat(40), 1, 'success', '2026-10-05T10:30:00Z'),
        run(4, 120, MAIN_SHA, 1, 'success', '2026-10-05T10:00:00Z'),
      ],
      artifacts: { 10: artifactFiles(report({ sha: OLD })), 4: artifactFiles(report({ pr: 120, sha: MAIN_SHA }), shots) },
      compare: { [MAIN_SHA]: 'behind', ['d'.repeat(40)]: 'diverged' },
    });
    buildPacket({ out, pr: 137, repo: REPO, run: 9, gh });
    const md = packetOf(out);
    assert.match(md, /run 4/i);
    assert.match(md, /#120/);
    assert.match(md, /run 7.*(expired|download)/is);
  });

  it('says why there is none and asks for every screenshot', () => {
    const out = artifact(report(), shots);
    const { gh } = fakeGh({ prView: ok(pr(files(['apps/web/src/main.ts']))), runs: [] });
    buildPacket({ out, pr: 137, repo: REPO, gh });
    const md = packetOf(out);
    assert.match(md, /no baseline/i);
    assert.match(md, /shots\/home-desktop-light-ro\.png/);
    assert.match(md, /every screenshot/i);
  });

  it('uses an explicit baseline folder', () => {
    const base = artifact(report({ sha: OLD, lap: 1 }), { 'shots/home-desktop-light-ro.png': 'old' });
    const out = artifact(report(), { 'shots/home-desktop-light-ro.png': 'new' });
    const { gh, calls } = fakeGh({ prView: ok(pr([])) });
    buildPacket({ out, pr: 137, repo: REPO, baseline: base, gh });
    const md = packetOf(out);
    assert.match(md, new RegExp(OLD.slice(0, 7)));
    assert.match(md, /changed 1/);
    assert.ok(!calls.some((c) => /^run list/.test(c)));
  });
});

describe('the screenshot delta', () => {
  it('sorts screenshots by content and names the ones to look at', () => {
    const d = shotDelta({
      current: { 'shots/a.png': 'h1', 'shots/b.png': 'h2', 'shots/c.png': 'h3', 'shots/new.png': 'h4' },
      baseline: { 'shots/a.png': 'h1', 'shots/b.png': 'XX', 'shots/c.png': 'h3', 'shots/gone.png': 'h5' },
      cited: ['shots/c.png'],
    });
    assert.deepEqual(d.changed, ['shots/b.png']);
    assert.deepEqual(d.added, ['shots/new.png']);
    assert.deepEqual(d.removed, ['shots/gone.png']);
    assert.equal(d.unchanged, 2);
    assert.deepEqual(d.look, ['shots/b.png', 'shots/c.png', 'shots/new.png']);
  });

  it('names every screenshot when there is no baseline', () => {
    const d = shotDelta({ current: { 'shots/a.png': 'h1', 'shots/b.png': 'h2' }, baseline: null, cited: [] });
    assert.deepEqual(d.look, ['shots/a.png', 'shots/b.png']);
  });
});

describe('a change that touches no web file', () => {
  const shots = { 'shots/a.png': 'new-bytes', 'shots/b.png': 'same', 'shots/run.log': 'x' };
  const base = () => artifact(report({ sha: OLD, lap: 1 }), { 'shots/a.png': 'old-bytes', 'shots/b.png': 'same' });

  it('names only the screenshots a finding cites, still counting what differs', () => {
    const out = artifact(report({ findings: [{ severity: 'high', kind: 'sweep', title: 'Clipped', route: '/', evidence: 'shots/b.png' }] }), shots);
    const { gh } = fakeGh({ prView: ok(pr(files(['.claude/scripts/x.mjs']))) });
    buildPacket({ out, pr: 137, repo: REPO, baseline: base(), gh });
    const look = packetOf(out).split(/^## Screenshots$/m)[1];
    assert.match(look, /changed 1/);
    assert.match(look, /no web file/i);
    assert.match(look, /- shots\/b\.png/);
    assert.doesNotMatch(look, /- shots\/a\.png/);
  });

  it('names the changed ones when the change touches the web app, and never a file that is not an image', () => {
    const out = artifact(report({ findings: [] }), shots);
    const { gh } = fakeGh({ prView: ok(pr(files(['libs/ui-cockpit/src/button.ts']))) });
    buildPacket({ out, pr: 137, repo: REPO, baseline: base(), gh });
    const look = packetOf(out).split(/^## Screenshots$/m)[1];
    assert.match(look, /- shots\/a\.png/);
    assert.doesNotMatch(look, /run\.log/);
  });
});

describe('the previous lap', () => {
  const prev = report({
    sha: OLD,
    lap: 1,
    findings: [
      { severity: 'high', kind: 'sweep', title: 'Text clipped', route: '/' },
      { severity: 'high', kind: 'review', title: 'FR-003 untested', route: '' },
    ],
  });

  it('reads the committed report of the last lap and marks its findings', () => {
    const out = artifact(report());
    const { gh } = fakeGh({
      prView: ok(pr([])),
      contents: {
        'specs/001-thing/pr-review': [{ name: 'lap1', type: 'dir' }],
        'specs/001-thing/pr-review/lap1/report.json': prev,
      },
    });
    buildPacket({ out, pr: 137, repo: REPO, gh });
    const md = packetOf(out);
    assert.match(md, /pr-review\/lap1\/report\.json/);
    assert.match(md, /persisting.*Text clipped/is);
    assert.match(md, /new.*Slow first paint/is);
    assert.match(md, /resolved.*FR-003 untested/is);
  });

  it('falls back to the baseline run report', () => {
    const out = artifact(report());
    const { gh } = fakeGh({
      prView: ok(pr([])),
      runs: [run(7, 137, OLD, 1, 'failure')],
      artifacts: { 7: artifactFiles(prev) },
    });
    buildPacket({ out, pr: 137, repo: REPO, gh });
    const md = packetOf(out);
    assert.match(md, /run 7/i);
    assert.match(md, /resolved.*FR-003 untested/is);
  });

  it('never takes another PR\'s findings as this PR\'s previous lap', () => {
    const out = artifact(report());
    const { gh } = fakeGh({
      prView: ok(pr([])),
      runs: [run(4, 120, MAIN_SHA, 1, 'failure')],
      artifacts: { 4: artifactFiles({ ...prev, pr: 120, sha: MAIN_SHA }) },
      compare: { [MAIN_SHA]: 'behind' },
    });
    buildPacket({ out, pr: 137, repo: REPO, gh });
    const md = packetOf(out);
    const section = md.slice(md.indexOf('## Previous lap'), md.indexOf('## Baseline'));
    assert.match(md, /run 4/i);
    assert.doesNotMatch(section, /FR-003 untested/);
    assert.match(section, /None/);
  });
});
