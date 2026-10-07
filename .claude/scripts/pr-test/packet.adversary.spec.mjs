import { afterEach, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildPacket, findingDelta, frIds, parseRunName, shotDelta } from './packet.mjs';

const REPO = 'george-hutanu/motor-fix';
const HEAD = 'b'.repeat(40);
const OLD = 'a'.repeat(40);
const MAIN_SHA = 'c'.repeat(40);
const PACKET_URL = new URL('./packet.mjs', import.meta.url).href;
const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'packet.mjs');

const dirs = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true });
});
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'packet-adv-'));
  dirs.push(d);
  return d;
};
function artifact(report, shots = {}) {
  const dir = tmp();
  writeFileSync(join(dir, 'report.json'), typeof report === 'string' || Buffer.isBuffer(report) ? report : JSON.stringify(report));
  for (const [name, bytes] of Object.entries(shots)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), bytes);
  }
  return dir;
}
const report = (over = {}) => ({
  pr: 137, repo: REPO, sha: HEAD, lap: 2, verdict: 'failure', summary: 'one', booted: true, notes: [], screenshots: [], findings: [], ...over,
});
const pr = (files) => ({ number: 137, title: 't', headRefName: '001-thing', headRefOid: HEAD, baseRefName: 'main', files });
const ok = (stdout) => ({ code: 0, stdout: typeof stdout === 'string' ? stdout : JSON.stringify(stdout), stderr: '' });
const fail = (stderr) => ({ code: 1, stdout: '', stderr });
function fakeGh({ prView = ok(pr([])), runs = [], artifacts = {}, contents = {}, compare = {}, runList } = {}) {
  const calls = [];
  const gh = (args) => {
    const line = args.join(' ');
    calls.push(line);
    if (/^pr view/.test(line)) return prView;
    if (/^run list/.test(line)) return runList ?? ok(runs);
    if (/^run download/.test(line)) {
      const src = artifacts[args[2]];
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
const files = (paths) => paths.map((path) => ({ path, additions: 1, deletions: 1 }));
const run = (id, prNo, sha, lap, conclusion = 'success', createdAt = '2026-10-05T10:00:00Z') => ({
  databaseId: id, displayTitle: `PR QA #${prNo} at ${sha} lap ${lap} n${id}`, conclusion, createdAt,
});
const artifactFiles = (rep, shots = {}) => ({ files: { 'report.json': JSON.stringify(rep), ...shots } });
const packetOf = (out) => readFileSync(join(out, 'packet.md'), 'utf8');

describe('frIds on hostile lines', () => {
  it('returns nothing for an empty line', () => {
    assert.deepEqual(frIds(''), []);
  });
  it('lists a repeated id once', () => {
    assert.deepEqual(frIds('FR-002 FR-002 (FR-002)'), ['FR-002']);
  });
  it('expands a range written with a plain hyphen and keeps the zero padding', () => {
    assert.deepEqual(frIds('(FR-008-FR-010)'), ['FR-008', 'FR-009', 'FR-010']);
  });
  it('does not hang or run out of memory on an absurdly wide range', () => {
    const code = `import { frIds } from ${JSON.stringify(PACKET_URL)}; console.log(frIds('FR-001–FR-999999999').length);`;
    const file = join(tmp(), 'wide.mjs');
    writeFileSync(file, code);
    const res = spawnSync('node', ['--max-old-space-size=256', file], { encoding: 'utf8', timeout: 10000 });
    assert.equal(res.status, 0, `exit ${res.status} signal ${res.signal}`);
    assert.ok(Number(res.stdout) <= 100000, `returned ${res.stdout.trim()} ids`);
  });
});

describe('parseRunName on hostile titles', () => {
  it('returns null for null, undefined and the empty string', () => {
    assert.equal(parseRunName(null), null);
    assert.equal(parseRunName(undefined), null);
    assert.equal(parseRunName(''), null);
  });
  it('reads a full 40 character sha', () => {
    assert.deepEqual(parseRunName(`PR QA #12 at ${HEAD} lap 3 extra`), { pr: 12, sha: HEAD, lap: 3 });
  });
  it('rejects a sha that is not hex', () => {
    assert.equal(parseRunName('PR QA #12 at zzzzzzz lap 3'), null);
  });
  it('rejects a title with no lap', () => {
    assert.equal(parseRunName(`PR QA #12 at ${HEAD}`), null);
  });
});

describe('findingDelta edges', () => {
  it('is empty both ways for two empty lists', () => {
    assert.deepEqual(findingDelta([], []), { persisting: [], new: [], resolved: [] });
  });
  it('marks everything resolved when the current report has no findings', () => {
    const prev = [{ kind: 'sweep', title: 'A', route: '/' }];
    assert.deepEqual(findingDelta(prev, []).resolved, prev);
  });
  it('treats a missing route and an empty route as the same finding', () => {
    const d = findingDelta([{ kind: 'sweep', title: 'A' }], [{ kind: 'sweep', title: 'A', route: '' }]);
    assert.equal(d.persisting.length, 1);
    assert.equal(d.new.length, 0);
    assert.equal(d.resolved.length, 0);
  });
  it('treats a different route as a new finding and the old one as resolved', () => {
    const d = findingDelta([{ kind: 'sweep', title: 'A', route: '/a' }], [{ kind: 'sweep', title: 'A', route: '/b' }]);
    assert.equal(d.new.length, 1);
    assert.equal(d.resolved.length, 1);
  });
});

describe('shotDelta edges', () => {
  it('names only the cited screenshots with no baseline when the change has no web file', () => {
    const d = shotDelta({ current: { 'a.png': '1', 'b.png': '2' }, baseline: null, cited: ['b.png'], web: false });
    assert.deepEqual(d.look, ['b.png']);
  });
  it('treats an empty baseline as every screenshot new', () => {
    const d = shotDelta({ current: { 'a.png': '1' }, baseline: {}, cited: [] });
    assert.deepEqual(d.added, ['a.png']);
    assert.equal(d.unchanged, 0);
  });
  it('counts nothing for two empty sets', () => {
    const d = shotDelta({ current: {}, baseline: {}, cited: [] });
    assert.deepEqual(d, { changed: [], added: [], removed: [], unchanged: 0, look: [] });
  });
  it('lists a cited screenshot once even when it also changed', () => {
    const d = shotDelta({ current: { 'a.png': '2' }, baseline: { 'a.png': '1' }, cited: ['a.png', 'a.png'] });
    assert.deepEqual(d.look, ['a.png']);
  });
  it('names a cited unchanged screenshot even when the change has no web file', () => {
    const d = shotDelta({ current: { 'a.png': '1', 'b.png': '2' }, baseline: { 'a.png': '1', 'b.png': 'x' }, cited: ['a.png'], web: false });
    assert.deepEqual(d.look, ['a.png']);
    assert.deepEqual(d.changed, ['b.png']);
  });
});

describe('the packet against odd reports', () => {
  it('exits 2 and writes nothing for a report that is not JSON', () => {
    const out = artifact('{not json');
    const res = buildPacket({ out, pr: 137, repo: REPO, gh: fakeGh().gh });
    assert.equal(res.code, 2);
    assert.equal(existsSync(join(out, 'packet.md')), false);
  });
  it('exits 2 for a UTF-16 report with a byte order mark', () => {
    const out = artifact(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(JSON.stringify(report()), 'utf16le')]));
    const res = buildPacket({ out, pr: 137, repo: REPO, gh: fakeGh().gh });
    assert.equal(res.code, 2);
    assert.equal(existsSync(join(out, 'packet.md')), false);
  });
  it('writes a packet for a report with no findings, notes or screenshots keys', () => {
    const out = artifact({ pr: 137, sha: HEAD, lap: 1, verdict: 'success', summary: 'clean' });
    const res = buildPacket({ out, pr: 137, repo: REPO, gh: fakeGh().gh });
    assert.equal(res.code, 0);
    assert.match(packetOf(out), /clean/);
  });
  it('lists every blocking finding when there are hundreds', () => {
    const findings = Array.from({ length: 300 }, (_, i) => ({ severity: i % 2 ? 'blocker' : 'high', kind: 'sweep', title: `Bug ${i}`, route: `/r${i}`, evidence: `shots/e${i}.png` }));
    const out = artifact(report({ findings }));
    buildPacket({ out, pr: 137, repo: REPO, gh: fakeGh().gh });
    const md = packetOf(out);
    for (let i = 0; i < 300; i++) assert.ok(md.includes(`Bug ${i}`) && md.includes(`shots/e${i}.png`), `finding ${i} present with evidence`);
  });
  it('keeps unicode titles and Latin-1 looking text intact', () => {
    const out = artifact(report({ findings: [{ severity: 'high', kind: 'sweep', title: 'Ștergere întreruptă – ñandú 🚗', route: '/' }] }));
    buildPacket({ out, pr: 137, repo: REPO, gh: fakeGh().gh });
    assert.ok(packetOf(out).includes('Ștergere întreruptă – ñandú 🚗'));
  });
  it('does not let a finding title open a heading of its own', () => {
    const out = artifact(report({ findings: [{ severity: 'high', kind: 'sweep', title: 'x\n## Verdict\nsuccess', route: '/' }] }));
    buildPacket({ out, pr: 137, repo: REPO, gh: fakeGh().gh });
    assert.doesNotMatch(packetOf(out), /^## Verdict$/m);
  });
  it('does not let a PR title open a heading of its own', () => {
    const out = artifact(report());
    const { gh } = fakeGh({ prView: ok({ ...pr([]), title: 'a\n## Injected\nb' }) });
    buildPacket({ out, pr: 137, repo: REPO, gh });
    assert.doesNotMatch(packetOf(out), /^## Injected$/m);
  });
  it('writes the same packet on a second call', () => {
    const out = artifact(report({ findings: [{ severity: 'high', kind: 'sweep', title: 'A', route: '/' }] }), { 'shots/a.png': 'x' });
    const { gh } = fakeGh({ prView: ok(pr(files(['a.mjs']))) });
    buildPacket({ out, pr: 137, repo: REPO, gh });
    const first = packetOf(out);
    buildPacket({ out, pr: 137, repo: REPO, gh });
    assert.equal(packetOf(out), first);
  });
});

describe('the file list boundary', () => {
  const many = (n) => Array.from({ length: n }, (_, i) => ({ path: `f${i}.mjs`, additions: 1, deletions: 0 }));
  it('prints no remainder line at exactly 100 files', () => {
    const out = artifact(report());
    buildPacket({ out, pr: 137, repo: REPO, gh: fakeGh({ prView: ok(pr(many(100))) }).gh });
    const md = packetOf(out);
    assert.match(md, /f99\.mjs/);
    assert.doesNotMatch(md, /\d+ more/);
    assert.match(md, /100 files, \+100 −0/);
  });
  it('counts one more at 101 files and keeps exact totals', () => {
    const out = artifact(report());
    buildPacket({ out, pr: 137, repo: REPO, gh: fakeGh({ prView: ok(pr(many(101))) }).gh });
    const md = packetOf(out);
    assert.doesNotMatch(md, /f100\.mjs/);
    assert.match(md, /1 more/);
    assert.match(md, /101 files, \+101 −0/);
  });
  it('reports zero files for a PR with none', () => {
    const out = artifact(report());
    buildPacket({ out, pr: 137, repo: REPO, gh: fakeGh({ prView: ok(pr([])) }).gh });
    assert.match(packetOf(out), /0 files/);
  });
});

describe('gh failing in other ways', () => {
  it('survives a PR view that answers with text that is not JSON', () => {
    const out = artifact(report({ findings: [{ severity: 'high', kind: 'sweep', title: 'Clipped', route: '/' }] }));
    const res = buildPacket({ out, pr: 137, repo: REPO, gh: fakeGh({ prView: ok('<html>bad gateway</html>') }).gh });
    assert.equal(res.code, 0);
    assert.match(packetOf(out), /unavailable/i);
    assert.match(packetOf(out), /Clipped/);
  });
  it('survives a failing run list and says the baseline is unavailable', () => {
    const out = artifact(report());
    const res = buildPacket({ out, pr: 137, repo: REPO, gh: fakeGh({ runList: fail('HTTP 403 rate limit') }).gh });
    assert.equal(res.code, 0);
    assert.match(packetOf(out), /HTTP 403 rate limit/);
    assert.match(packetOf(out), /every screenshot/i);
  });
  it('survives a run list that is not JSON', () => {
    const out = artifact(report());
    const res = buildPacket({ out, pr: 137, repo: REPO, gh: fakeGh({ runList: ok('oops') }).gh });
    assert.equal(res.code, 0);
    assert.match(packetOf(out), /no baseline|unavailable/i);
  });
  it('survives a PR view with a null files list', () => {
    const out = artifact(report());
    const res = buildPacket({ out, pr: 137, repo: REPO, gh: fakeGh({ prView: ok({ ...pr([]), files: null }) }).gh });
    assert.equal(res.code, 0);
    assert.ok(existsSync(join(out, 'packet.md')));
  });
  it('writes nothing when the report is missing even though gh would fail', () => {
    const out = tmp();
    const { gh, calls } = fakeGh({ prView: fail('boom') });
    assert.equal(buildPacket({ out, pr: 137, repo: REPO, gh }).code, 2);
    assert.equal(existsSync(join(out, 'packet.md')), false);
    assert.equal(calls.length, 0, 'no gh call for a folder with no report');
  });
});

describe('requirements with missing pieces', () => {
  it('lists an id found in tasks even when the spec has no text for it', () => {
    const out = artifact(report());
    const { gh } = fakeGh({
      prView: ok(pr(files(['src/x.mjs']))),
      contents: { '001-thing/tasks.md': '- [ ] T1 src/x.mjs (FR-042)\n', '001-thing/spec.md': '- **FR-001**: other\n' },
    });
    const res = buildPacket({ out, pr: 137, repo: REPO, gh });
    assert.equal(res.code, 0);
    assert.match(packetOf(out), /FR-042/);
  });
  it('says so when no task line names a changed file', () => {
    const out = artifact(report());
    const { gh } = fakeGh({
      prView: ok(pr(files(['src/y.mjs']))),
      contents: { '001-thing/tasks.md': '- [ ] T1 src/x.mjs (FR-042)\n', '001-thing/spec.md': '- **FR-042**: text\n' },
    });
    buildPacket({ out, pr: 137, repo: REPO, gh });
    assert.doesNotMatch(packetOf(out), /FR-042/);
  });
  it('reads a tasks file with Windows line endings', () => {
    const out = artifact(report());
    const { gh } = fakeGh({
      prView: ok(pr(files(['src/x.mjs']))),
      contents: { '001-thing/tasks.md': '- [ ] T1 src/x.mjs (FR-007)\r\n', '001-thing/spec.md': '- **FR-007**: seven text\r\n' },
    });
    buildPacket({ out, pr: 137, repo: REPO, gh });
    assert.match(packetOf(out), /FR-007.*seven text/);
  });
});

describe('the previous lap source', () => {
  it('picks lap10 over lap2', () => {
    const out = artifact(report());
    const lap = (n, title) => report({ lap: n, findings: [{ severity: 'high', kind: 'review', title, route: '' }] });
    const { gh } = fakeGh({
      prView: ok(pr([])),
      contents: {
        '001-thing/pr-review': [{ name: 'lap2', type: 'dir' }, { name: 'lap10', type: 'dir' }, { name: 'lap1', type: 'dir' }],
        '001-thing/pr-review/lap1/report.json': lap(1, 'From one'),
        '001-thing/pr-review/lap2/report.json': lap(2, 'From two'),
        '001-thing/pr-review/lap10/report.json': lap(10, 'From ten'),
      },
    });
    buildPacket({ out, pr: 137, repo: REPO, gh });
    const md = packetOf(out);
    assert.match(md, /lap10\/report\.json/);
    assert.match(md, /resolved.*From ten/is);
    assert.doesNotMatch(md, /From two/);
  });
  it('marks the baseline fallback as the workflow findings only', () => {
    const out = artifact(report());
    const { gh } = fakeGh({
      prView: ok(pr([])),
      runs: [run(7, 137, OLD, 1, 'failure')],
      artifacts: { 7: artifactFiles(report({ sha: OLD, lap: 1 })) },
    });
    buildPacket({ out, pr: 137, repo: REPO, gh });
    assert.match(packetOf(out), /workflow'?s? findings only|workflow findings only|only the workflow/i);
  });
});

describe('choosing the baseline', () => {
  const shots = { 'shots/a.png': 'same' };
  it('takes the newest same-PR run whatever order gh lists them in', () => {
    const out = artifact(report(), shots);
    const { gh } = fakeGh({
      runs: [run(3, 137, OLD, 1, 'success', '2026-10-05T08:00:00Z'), run(5, 137, 'd'.repeat(40), 2, 'success', '2026-10-05T09:00:00Z'), run(9, 137, HEAD, 3, 'success', '2026-10-05T12:00:00Z')],
      artifacts: { 3: artifactFiles(report({ sha: OLD }), shots), 5: artifactFiles(report({ sha: 'd'.repeat(40) }), shots) },
    });
    buildPacket({ out, pr: 137, repo: REPO, run: 9, gh });
    assert.match(packetOf(out), /run 5/i);
  });
  it('skips another run at the same head as the one under review', () => {
    const out = artifact(report(), shots);
    const { gh, calls } = fakeGh({
      runs: [run(8, 137, HEAD, 2, 'success', '2026-10-05T09:00:00Z'), run(9, 137, HEAD, 2, 'success', '2026-10-05T12:00:00Z')],
      artifacts: { 8: artifactFiles(report(), shots) },
    });
    buildPacket({ out, pr: 137, repo: REPO, run: 9, gh });
    assert.ok(!calls.some((c) => /run download 8/.test(c)));
    assert.match(packetOf(out), /no baseline/i);
  });
  it('skips a candidate whose artifact has no report', () => {
    const out = artifact(report(), shots);
    const { gh } = fakeGh({
      runs: [run(7, 137, OLD, 1, 'failure')],
      artifacts: { 7: { files: { 'shots/a.png': 'same' } } },
    });
    buildPacket({ out, pr: 137, repo: REPO, gh });
    assert.match(packetOf(out), /no baseline/i);
    assert.match(packetOf(out), /run 7/i);
  });
  it('accepts a base-branch run whose commit is identical to the base head', () => {
    const out = artifact(report(), shots);
    const { gh } = fakeGh({
      runs: [run(4, 120, MAIN_SHA, 1)],
      artifacts: { 4: artifactFiles(report({ pr: 120, sha: MAIN_SHA }), shots) },
      compare: { [MAIN_SHA]: 'identical' },
    });
    buildPacket({ out, pr: 137, repo: REPO, gh });
    assert.match(packetOf(out), /run 4/i);
  });
  it('rejects a base-branch candidate that is ahead of the base branch', () => {
    const out = artifact(report(), shots);
    const { gh } = fakeGh({
      runs: [run(4, 120, MAIN_SHA, 1)],
      artifacts: { 4: artifactFiles(report({ pr: 120, sha: MAIN_SHA }), shots) },
      compare: { [MAIN_SHA]: 'ahead' },
    });
    buildPacket({ out, pr: 137, repo: REPO, gh });
    assert.match(packetOf(out), /no baseline/i);
  });
  it('ignores runs whose titles do not parse', () => {
    const out = artifact(report(), shots);
    const { gh } = fakeGh({ runs: [{ databaseId: 2, displayTitle: 'something else', conclusion: 'success', createdAt: '2026-10-05T01:00:00Z' }, { databaseId: 3, displayTitle: null, conclusion: 'success', createdAt: null }] });
    const res = buildPacket({ out, pr: 137, repo: REPO, gh });
    assert.equal(res.code, 0);
    assert.match(packetOf(out), /no baseline/i);
  });
  it('treats a baseline folder with no report as unusable and says so', () => {
    const empty = tmp();
    const out = artifact(report(), shots);
    const res = buildPacket({ out, pr: 137, repo: REPO, baseline: empty, gh: fakeGh().gh });
    assert.equal(res.code, 0);
    assert.match(packetOf(out), /no baseline|unavailable/i);
    assert.match(packetOf(out), /every screenshot/i);
  });
});

describe('the screenshots in a packet', () => {
  it('lists a cited unchanged screenshot', () => {
    const base = artifact(report({ sha: OLD }), { 'shots/a.png': 'same', 'shots/b.png': 'same' });
    const out = artifact(report({ findings: [{ severity: 'high', kind: 'sweep', title: 'C', route: '/', evidence: 'shots/a.png' }] }), { 'shots/a.png': 'same', 'shots/b.png': 'same' });
    buildPacket({ out, pr: 137, repo: REPO, baseline: base, gh: fakeGh().gh });
    const look = packetOf(out).split(/^## Screenshots$/m)[1];
    assert.match(look, /- shots\/a\.png/);
    assert.doesNotMatch(look, /- shots\/b\.png/);
  });
  it('reports a screenshot only in the baseline as removed, not unchanged', () => {
    const base = artifact(report({ sha: OLD }), { 'shots/gone.png': 'x', 'shots/a.png': 'same' });
    const out = artifact(report(), { 'shots/a.png': 'same' });
    buildPacket({ out, pr: 137, repo: REPO, baseline: base, gh: fakeGh().gh });
    const look = packetOf(out).split(/^## Screenshots$/m)[1];
    assert.match(look, /removed 1/);
    assert.match(look, /shots\/gone\.png/);
    assert.match(look, /unchanged 1/);
  });
  it('handles file names with spaces and unicode', () => {
    const base = artifact(report({ sha: OLD }), { 'shots/ținută mică.png': 'old' });
    const out = artifact(report(), { 'shots/ținută mică.png': 'new' });
    buildPacket({ out, pr: 137, repo: REPO, baseline: base, gh: fakeGh({ prView: ok(pr(files(['apps/web/src/main.ts']))) }).gh });
    assert.ok(packetOf(out).includes('shots/ținută mică.png'));
  });
  it('hashes a screenshot of tens of megabytes without failing', () => {
    const big = Buffer.alloc(40 * 1024 * 1024, 7);
    const base = artifact(report({ sha: OLD }), { 'shots/big.png': big });
    const out = artifact(report(), { 'shots/big.png': big });
    const res = buildPacket({ out, pr: 137, repo: REPO, baseline: base, gh: fakeGh().gh });
    assert.equal(res.code, 0);
    assert.match(packetOf(out), /changed 0/);
  });
  it('does not follow a symlinked screenshot out of the folder', () => {
    const outside = tmp();
    writeFileSync(join(outside, 'secret.png'), 'secret');
    const base = artifact(report({ sha: OLD }), {});
    const out = artifact(report(), {});
    mkdirSync(join(out, 'shots'), { recursive: true });
    symlinkSync(join(outside, 'secret.png'), join(out, 'shots', 'link.png'));
    const res = buildPacket({ out, pr: 137, repo: REPO, baseline: base, gh: fakeGh().gh });
    assert.equal(res.code, 0);
    assert.doesNotMatch(packetOf(out), /link\.png/);
  });
  it('survives a dangling symlink in the screenshot folder', () => {
    const base = artifact(report({ sha: OLD }), {});
    const out = artifact(report(), {});
    mkdirSync(join(out, 'shots'), { recursive: true });
    symlinkSync('/nonexistent/target.png', join(out, 'shots', 'dangling.png'));
    assert.equal(buildPacket({ out, pr: 137, repo: REPO, baseline: base, gh: fakeGh().gh }).code, 0);
  });
  it('never counts its own packet from an earlier call as a screenshot', () => {
    const out = artifact(report(), { 'shots/a.png': 'x' });
    buildPacket({ out, pr: 137, repo: REPO, gh: fakeGh().gh });
    buildPacket({ out, pr: 137, repo: REPO, gh: fakeGh().gh });
    assert.doesNotMatch(packetOf(out), /packet\.md/);
  });
});

describe('the command line', () => {
  const cli = (args) => spawnSync('node', [SCRIPT, ...args], { encoding: 'utf8' });
  it('exits 2 and writes nothing for a folder with no report', () => {
    const out = tmp();
    const res = cli(['--pr', '137', '--out', out, '--repo', REPO]);
    assert.equal(res.status, 2);
    assert.equal(existsSync(join(out, 'packet.md')), false);
  });
  it('prints usage and exits non-zero without arguments', () => {
    const res = cli([]);
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /usage/i);
  });
  it('prints usage when --pr has no value', () => {
    const res = cli(['--out', tmp(), '--pr']);
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /usage/i);
  });
  it('rejects a pr that is not a number', () => {
    const out = artifact(report());
    const res = cli(['--pr', 'abc; echo hi', '--out', out, '--repo', REPO]);
    assert.notEqual(res.status, 0);
    assert.equal(existsSync(join(out, 'packet.md')), false);
  });
});
