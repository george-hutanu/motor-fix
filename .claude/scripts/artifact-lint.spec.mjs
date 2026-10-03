import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const script = join(import.meta.dirname, 'artifact-lint.mjs');
const diffAudit = join(import.meta.dirname, 'diff-audit.mjs');

/**
 * A feature with one requirement and one task, in a directory that has no
 * `.env`. No key means the lane reports itself unavailable instead of calling
 * out — which is exactly what makes the flag matrix testable offline: the
 * unavailable NOTE is the proof that the lane was ATTEMPTED.
 */
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'artifact-lint-'));
  mkdirSync(join(dir, '.specify'), { recursive: true });
  mkdirSync(join(dir, 'specs', '020-a-feature'), { recursive: true });
  writeFileSync(join(dir, '.specify', 'feature.json'), JSON.stringify({ feature_directory: "specs/020-a-feature", level: 2 }));
  writeFileSync(
    join(dir, 'specs', '020-a-feature', 'spec.md'),
    '## Requirements\n\n- **FR-001**: The scanner MUST exit non-zero when a rule fails.\n',
  );
  writeFileSync(join(dir, 'specs', '020-a-feature', 'tasks.md'), '- [x] T001 implement FR-001\n');
  writeFileSync(join(dir, 'specs', '020-a-feature', 'plan.md'), '# Plan\n');
  return dir;
}

const run = (file, args, cwd) =>
  spawnSync(process.execPath, [file, ...args], {
    cwd,
    encoding: 'utf8',
    // Both names cleared: the lane must find no credential whatever this
    // machine exports, or the spec would pass or fail by accident.
    env: { ...process.env, TYPESAFE_API_KEY: '', JEV: '', CLAUDE_PROJECT_DIR: cwd },
  });

const attempted = (result) => /jev-unavailable/.test(result.stdout);

describe('artifact-lint — the semantic lane default', () => {
  it('runs the lane for a plain report', () => {
    const result = run(script, [], fixture());
    assert.equal(result.status, 0);
    assert.equal(attempted(result), true);
  });

  it('does NOT run the lane under --check, which is what every gate passes', () => {
    const dir = fixture();
    const result = run(script, ['--check'], dir);
    assert.equal(result.status, 0);
    assert.equal(attempted(result), false, 'a --check run must make no network call');
  });

  it('does not run the lane under --no-jev', () => {
    assert.equal(attempted(run(script, ['--no-jev'], fixture())), false);
  });

  it('lets --no-jev win over an explicit --jev', () => {
    assert.equal(attempted(run(script, ['--jev', '--no-jev'], fixture())), false);
  });

  it('lets an explicit --jev force the lane on under --check, without touching the exit code', () => {
    const result = run(script, ['--jev', '--check'], fixture());
    assert.equal(attempted(result), true);
    // Every lane finding is a WARN, and --check exits on ERRORs alone. This
    // is the whole reason forcing it here is safe.
    assert.equal(result.status, 0);
  });

  it('still resolves a named feature directory once the flags are stripped', () => {
    const result = run(script, ['specs/020-a-feature', '--no-jev'], fixture());
    assert.equal(result.status, 0);
    assert.match(result.stdout, /artifact-lint: 020-a-feature/);
  });

  it('says the lane was unavailable rather than printing a clean report', () => {
    const result = run(script, [], fixture());
    assert.match(result.stdout, /no TYPESAFE_API_KEY \(or JEV\)/);
    assert.match(result.stdout, /mechanical findings only/);
  });

  it('reports "switched off" rather than "no key" when it was switched off', () => {
    const dir = fixture();
    const result = spawnSync(process.execPath, [script], {
      cwd: dir,
      encoding: 'utf8',
      env: { ...process.env, TYPESAFE_API_KEY: 'present', SPECKIT_JEV: '0', CLAUDE_PROJECT_DIR: dir },
    });
    assert.match(result.stdout, /switched off/);
    assert.doesNotMatch(result.stdout, /no TYPESAFE_API_KEY/);
  });
});

describe('diff-audit — the same default', () => {
  // Run against this repository: the audit needs a real git history, and the
  // assertion is about which branch the flags take, not about the findings.
  const repo = join(import.meta.dirname, '..', '..');

  it('does not run the lane under --check', () => {
    const result = run(diffAudit, ['--check'], repo);
    assert.equal(attempted(result), false);
  });

  it('accepts --no-jev without changing the mechanical findings', () => {
    const withLane = run(diffAudit, ['--no-jev'], repo);
    const asCheck = run(diffAudit, ['--check'], repo);
    assert.equal(
      withLane.stdout.split('\n').filter((l) => l.includes('[')).length,
      asCheck.stdout.split('\n').filter((l) => l.includes('[')).length,
    );
  });
});
