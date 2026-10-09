import { afterEach, beforeEach, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const HOOK = join(import.meta.dirname, 'github-identity.sh');

let dir;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'gh-identity-'));
  mkdirSync(join(dir, '.husky'));
  writeFileSync(join(dir, '.husky', 'identity.sh'), 'exit 0\n');
  mkdirSync(join(dir, '.claude', 'scripts'), { recursive: true });
  writeFileSync(
    join(dir, '.claude', 'scripts', 'specs-repo.mjs'),
    "import { writeFileSync } from 'node:fs';\nwriteFileSync('ensured', process.argv.slice(2).join(' '));\nconsole.log('{\"ok\":true}');\n",
  );
  mkdirSync(join(dir, 'bin'));
  writeFileSync(join(dir, 'bin', 'gh'), '#!/bin/sh\nexit 0\n');
  chmodSync(join(dir, 'bin', 'gh'), 0o755);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const runHook = () =>
  spawnSync('bash', [HOOK], {
    cwd: dir,
    input: '{}',
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir, CLAUDE_ENV_FILE: '', PATH: `${join(dir, 'bin')}:${process.env.PATH}` },
  });
const ensured = () => (existsSync(join(dir, 'ensured')) ? readFileSync(join(dir, 'ensured'), 'utf8') : null);

// @traces 1018-FR-005
describe('github-identity: the specs clone at session start', () => {
  it('runs ensure --soft for a checkout with no clone', () => {
    assert.equal(runHook().status, 0);
    assert.equal(ensured(), 'ensure --soft');
  });

  it('runs ensure --soft for an old clone at specs/, so it is moved to .motor-fix-specs', () => {
    mkdirSync(join(dir, 'specs', '.git'), { recursive: true });
    const r = runHook();
    assert.equal(r.status, 0);
    assert.equal(ensured(), 'ensure --soft');
    assert.match(r.stdout, /motor-fix-specs/);
  });

  it('leaves a clone at .motor-fix-specs with its specs link alone: no network at session start', () => {
    mkdirSync(join(dir, '.motor-fix-specs', '.git'), { recursive: true });
    symlinkSync('.motor-fix-specs', join(dir, 'specs'));
    assert.equal(runHook().status, 0);
    assert.equal(ensured(), null);
  });

  it('runs ensure --soft for a clone at .motor-fix-specs whose specs link is missing', () => {
    mkdirSync(join(dir, '.motor-fix-specs', '.git'), { recursive: true });
    assert.equal(runHook().status, 0);
    assert.equal(ensured(), 'ensure --soft');
  });
});
