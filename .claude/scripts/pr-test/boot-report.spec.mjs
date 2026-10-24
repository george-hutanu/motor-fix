// @traces 988-FR-003
import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkReport } from './dispatch.mjs';

// A PR QA run whose services never came up used to upload nothing, so the tester
// read "the run left no report" and had no finding to act on (#332). The workflow
// now runs boot-report.mjs when the run step was skipped after a failure.
const script = fileURLToPath(new URL('./boot-report.mjs', import.meta.url));
const SHA = 'a'.repeat(40);

function boot(reason) {
  const dir = mkdtempSync(join(tmpdir(), 'boot-report-'));
  const out = join(dir, 'nested', 'pr-qa');
  try {
    const r = spawnSync(process.execPath, [script, '--pr', '516', '--sha', SHA, '--lap', '2', '--out', out], {
      encoding: 'utf8',
      env: { ...process.env, REASON: reason },
    });
    const read = (name) => (existsSync(join(out, name)) ? readFileSync(join(out, name), 'utf8') : null);
    return { code: r.status, err: r.stderr, json: read('report.json'), md: read('report.md') };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('boot-report.mjs: a report when the run never started', () => {
  const reason = 'PostgreSQL did not come up; see "postgres.log"\nand the services step';
  const r = boot(reason);

  it('creates the folder and writes report.json and report.md', () => {
    assert.equal(r.code, 0, r.err);
    assert.ok(r.json, 'report.json');
    assert.ok(r.md, 'report.md');
  });

  it('gives the head, the lap, a failure verdict and one blocking step finding naming the reason', () => {
    const report = JSON.parse(r.json ?? '{}');
    assert.equal(report.pr, 516);
    assert.equal(report.sha, SHA);
    assert.equal(report.lap, 2);
    assert.equal(report.verdict, 'failure');
    assert.deepEqual(report.booted, []);
    assert.equal(report.findings.length, 1);
    assert.deepEqual(report.findings[0], { severity: 'blocker', kind: 'step', title: 'The run never started', steps: [reason] });
    assert.match(report.summary, /1 blocking finding/);
    assert.ok(report.notes.length > 0);
    assert.equal(report.markdown, r.md);
    assert.match(r.md ?? '', /Agent review: failure/);
    assert.match(r.md ?? '', /The run never started/);
  });

  it('is a report the dispatcher reads as a verdict for the head', () => {
    assert.equal(checkReport(JSON.parse(r.json ?? 'null'), SHA, 'failure'), null);
  });

  it('refuses to run without a reason', () => {
    assert.notEqual(boot('').code, 0);
  });
});
