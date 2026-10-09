import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildPacket } from './packet.mjs';

const REPO = 'george-hutanu/motor-fix';
const HEAD = 'b'.repeat(40);
const ok = (stdout) => ({ code: 0, stdout: typeof stdout === 'string' ? stdout : JSON.stringify(stdout), stderr: '' });
const fail = (stderr) => ({ code: 1, stdout: '', stderr });

const artifact = () => {
  const dir = mkdtempSync(join(tmpdir(), 'packet-adv-'));
  writeFileSync(join(dir, 'report.json'), JSON.stringify({ pr: 137, repo: REPO, sha: HEAD, lap: 1, verdict: 'success', summary: 's', booted: true, notes: [], screenshots: [], findings: [] }));
  return dir;
};
const pr = (branch, paths = ['a.mjs']) => ({ number: 137, title: 'chore(harness): a change', headRefName: branch, headRefOid: HEAD, baseRefName: 'main', files: paths.map((path) => ({ path, additions: 1, deletions: 0 })) });

function gh({ branch = '001-thing', contents = {}, errors = {} }) {
  const calls = [];
  const fn = (args) => {
    const line = args.join(' ');
    calls.push(line);
    if (/^pr view/.test(line)) return ok(pr(branch));
    if (/^pr diff/.test(line)) return fail('no diff');
    if (/^run list/.test(line)) return ok([]);
    const path = line.match(/contents\/(\S+?)\?ref=/);
    if (path) {
      if (path[1] in errors) return fail(errors[path[1]]);
      return path[1] in contents ? ok(contents[path[1]]) : fail('Not Found (HTTP 404)');
    }
    return fail(`unexpected: ${line}`);
  };
  return { fn, calls };
}
const packet = (out) => readFileSync(join(out, 'packet.md'), 'utf8');

describe('the feature files in the specs repository', () => {
  // @traces 1018-FR-005
  it('falls back to the old root for the spec text as well as the tasks', () => {
    const out = artifact();
    const g = gh({ contents: { '001-thing/tasks.md': '- [x] T1 a.mjs (FR-001)\n', '001-thing/spec.md': '- **FR-001**: Must work at the old root.\n' } });
    buildPacket({ out, pr: 137, repo: REPO, gh: g.fn });
    assert.match(packet(out), /FR-001: Must work at the old root/);
  });

  // @traces 1018-FR-005
  it('does not read the old root when the moved path fails for a reason other than not found', () => {
    const out = artifact();
    const g = gh({
      contents: { '001-thing/tasks.md': '- [x] T1 a.mjs (FR-001)\n' },
      errors: { 'specs/001-thing/tasks.md': 'HTTP 500: server error' },
    });
    buildPacket({ out, pr: 137, repo: REPO, gh: g.fn });
    assert.match(packet(out), /500/);
    assert.ok(!g.calls.some((c) => c.includes('contents/001-thing/tasks.md')), 'a 500 was read as "not moved"');
  });

  // @traces 1018-FR-005
  it('names the moved path and the error when neither location holds the tasks file', () => {
    const out = artifact();
    const g = gh({});
    buildPacket({ out, pr: 137, repo: REPO, gh: g.fn });
    assert.match(packet(out), /001-thing\/tasks\.md.*not found|not found.*001-thing\/tasks\.md/is);
  });

  // @traces 1018-FR-005
  it('reads the newest committed lap report from specs/ on a moved trunk', () => {
    const out = artifact();
    const g = gh({
      contents: {
        'specs/001-thing/pr-review': JSON.stringify([{ name: 'lap1' }, { name: 'lap3' }, { name: 'lap10' }]),
        'specs/001-thing/pr-review/lap10/report.json': JSON.stringify({ findings: [{ severity: 'low', kind: 'sweep', title: 'Tenth lap finding' }] }),
        'specs/001-thing/pr-review/lap3/report.json': JSON.stringify({ findings: [{ severity: 'low', kind: 'sweep', title: 'Third lap finding' }] }),
      },
    });
    buildPacket({ out, pr: 137, repo: REPO, gh: g.fn });
    assert.ok(!/Third lap finding/.test(packet(out)), 'laps compared as text, not as numbers');
  });

  // @traces 1018-FR-005
  it('reads the committed lap report from the old root when specs/ has none', () => {
    const out = artifact();
    const g = gh({
      contents: {
        '001-thing/pr-review': JSON.stringify([{ name: 'lap1' }]),
        '001-thing/pr-review/lap1/report.json': JSON.stringify({ findings: [{ severity: 'low', kind: 'sweep', title: 'Old root finding' }] }),
      },
    });
    buildPacket({ out, pr: 137, repo: REPO, gh: g.fn });
    assert.ok(g.calls.some((c) => c.includes('contents/001-thing/pr-review/lap1/report.json')));
  });
});
