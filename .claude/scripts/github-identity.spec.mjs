import { afterEach, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The SessionStart hook pins gh to george-hutanu on the owner's laptop. In a
// cloud session (CLAUDE_CODE_REMOTE=true) a proxy injects the GitHub token and
// GH_TOKEN holds its placeholder, so the hook must leave GH_TOKEN alone.

const hook = fileURLToPath(new URL('../hooks/github-identity.sh', import.meta.url));
const identity = readFileSync(fileURLToPath(new URL('../../.husky/identity.sh', import.meta.url)), 'utf8');
const dirs = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A repo authored as george-hutanu, credentials not pinned, and a gh with no login on PATH. */
function setup() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'gh-identity-')));
  dirs.push(root);
  const repo = join(root, 'repo');
  const bin = join(root, 'bin');
  mkdirSync(join(repo, '.husky'), { recursive: true });
  mkdirSync(bin);
  writeFileSync(join(repo, '.husky/identity.sh'), identity);
  writeFileSync(join(bin, 'gh'), '#!/bin/sh\nexit 1\n');
  chmodSync(join(bin, 'gh'), 0o755);
  const envFile = join(root, 'env');
  writeFileSync(envFile, '');
  const base = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_') && k !== 'CLAUDE_CODE_REMOTE'));
  const env = { ...base, PATH: `${bin}:${process.env.PATH}`, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', CLAUDE_PROJECT_DIR: repo, CLAUDE_ENV_FILE: envFile };
  const git = (...args) => spawnSync('git', args, { cwd: repo, env, encoding: 'utf8' });
  git('init', '-q');
  git('config', 'user.name', 'george-hutanu');
  git('config', 'user.email', 'hutanugeorge40@gmail.com');
  const run = (extra = {}) => spawnSync('bash', [hook], { cwd: repo, input: '{}', encoding: 'utf8', env: { ...env, ...extra } });
  return { run, envFile, git };
}

// @traces 749-FR-001
describe('github-identity.sh', () => {
  it('in a cloud session writes nothing to CLAUDE_ENV_FILE and does not warn about a gh login', () => {
    const { run, envFile } = setup();
    const out = run({ CLAUDE_CODE_REMOTE: 'true', GH_TOKEN: 'proxy-injected' });
    assert.equal(out.status, 0, out.stderr);
    assert.equal(readFileSync(envFile, 'utf8'), '');
    assert.doesNotMatch(out.stdout, /gh has no login/);
    assert.match(out.stdout, /GitHub identity for this repo: george-hutanu <hutanugeorge40@gmail.com>/);
    // The author is right and the cloud check skips credential pinning: no drift.
    assert.doesNotMatch(out.stdout, /identity check failed/);
  });

  it('in a cloud session still reports an author that drifted', () => {
    const { run, git } = setup();
    git('config', 'user.email', 'someone@work.example');
    const out = run({ CLAUDE_CODE_REMOTE: 'true', GH_TOKEN: 'proxy-injected' });
    assert.match(out.stdout, /commit author/);
  });

  it('outside the cloud exports GH_TOKEN for george-hutanu and warns when gh has no login for it', () => {
    const { run, envFile } = setup();
    const out = run();
    assert.equal(out.status, 0, out.stderr);
    assert.match(readFileSync(envFile, 'utf8'), /^export GH_TOKEN="\$\(.*auth token --hostname github\.com --user george-hutanu/);
    assert.match(out.stdout, /gh has no login for george-hutanu/);
    assert.match(out.stdout, /not pinned to george-hutanu/);
  });
});
