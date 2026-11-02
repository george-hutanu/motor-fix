import { afterEach, beforeEach, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const HOOK = new URL('./stop-test-gate.sh', import.meta.url).pathname;

let repo;
const write = (path, content = '') => {
  mkdirSync(dirname(join(repo, path)), { recursive: true });
  writeFileSync(join(repo, path), content);
};
// A stub runner logs how it was called and exits as told; it stands in for
// the real one so the gate's choice of runner is what the test sees.
const stub = (name, exit) => {
  write(`node_modules/.bin/${name}`, `#!/bin/sh\necho "${name} $*" >> calls.log\nexit ${exit}\n`);
  chmodSync(join(repo, `node_modules/.bin/${name}`), 0o755);
};
const git = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { cwd: repo, stdio: 'ignore' });
const stop = () =>
  spawnSync('bash', [HOOK], {
    cwd: repo,
    input: '{}',
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: repo },
  });
const calls = () => readFileSync(join(repo, 'calls.log'), 'utf8');

beforeEach(() => {
  repo = realpathSync(mkdtempSync(join(tmpdir(), 'stop-gate-')));
  git('init', '-q');
  write('.gitignore', 'node_modules\ncalls.log\n');
  write('libs/nest/vitest.config.mts', 'export default {};\n');
  write('libs/nest/src/a.ts', 'export const a = 1;\n');
  write('libs/ng/jest.config.cts', 'module.exports = {};\n');
  write('libs/ng/src/b.ts', 'export const b = 1;\n');
  write('scripts/vitest.config.mts', 'export default {};\n');
  write('scripts/c.ts', 'export const c = 1;\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'base');
  write('calls.log');
});

afterEach(() => rmSync(repo, { recursive: true, force: true }));

// Each stop starts npx once or twice, which on a busy machine outlasts 5 s.
// @traces 1338-FR-014
describe('the stop gate with Vitest and Jest projects', { timeout: 30_000 }, () => {
  // @traces 1332-angular-vitest-FR-015
  it('runs the Vitest specs related to a changed file of a Vitest project, and asks Jest only about the rest', () => {
    stub('jest', 0);
    stub('vitest', 0);
    write('libs/nest/src/a.ts', 'export const a = 2;\n');

    let run = stop();

    assert.equal(run.status, 0, run.stderr);
    assert.doesNotMatch(calls(), /^jest/m);
    assert.match(calls(), /^vitest run --changed --config libs\/nest\/vitest\.config\.mts/m);

    write('libs/ng/src/b.ts', 'export const b = 2;\n');
    run = stop();

    assert.equal(run.status, 0, run.stderr);
    assert.match(calls(), /^jest --onlyChanged/m);
  });

  it('blocks the stop when those Vitest specs fail', () => {
    stub('jest', 0);
    stub('vitest', 1);
    write('libs/nest/src/a.ts', 'export const a = 2;\n');

    const run = stop();

    assert.equal(run.status, 2);
    assert.match(run.stderr, /vitest run --changed/);
  });

  it('runs the Vitest specs of a root-level project such as scripts/', () => {
    stub('jest', 0);
    stub('vitest', 0);
    write('scripts/c.ts', 'export const c = 2;\n');

    const run = stop();

    assert.equal(run.status, 0, run.stderr);
    assert.match(calls(), /^vitest run --changed --config scripts\/vitest\.config\.mts/m);
  });

  it('leaves Vitest out when only a Jest project changed', () => {
    stub('jest', 0);
    stub('vitest', 1);
    write('libs/ng/src/b.ts', 'export const b = 2;\n');

    const run = stop();

    assert.equal(run.status, 0, run.stderr);
    assert.doesNotMatch(calls(), /^vitest/m);
  });
});

// The two edit-time hooks map a path to its Vitest config with the same
// function; each is fingerprinted on its own, so they hold a copy each.
describe('vitest_config', () => {
  it('is the same function in post-edit-check.sh and stop-test-gate.sh', () => {
    const fn = (script) =>
      readFileSync(new URL(`./${script}`, import.meta.url), 'utf8').match(/^vitest_config\(\) \{[\s\S]*?^\}$/m)?.[0];
    assert.ok(fn('stop-test-gate.sh'));
    assert.equal(fn('post-edit-check.sh'), fn('stop-test-gate.sh'));
  });
});
