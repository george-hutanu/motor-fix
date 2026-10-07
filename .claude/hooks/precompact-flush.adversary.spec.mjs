import { describe, it, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const HOOK = new URL('./precompact-flush.mjs', import.meta.url).pathname;
const FEATURE = 'specs/900-demo';
const LOG_SEED = '# Auto run\n';
const GIT = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();

let repo;
let bin;
const git = (...args) => execFileSync('git', args, { cwd: repo, stdio: 'ignore' });
const setup = ({ gh, branch = '900-demo' } = {}) => {
  git('init', '-q', '-b', branch);
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 't');
  mkdirSync(join(repo, FEATURE), { recursive: true });
  mkdirSync(join(repo, '.specify'), { recursive: true });
  writeFileSync(join(repo, '.specify/feature.json'), JSON.stringify({ feature_directory: FEATURE }));
  writeFileSync(join(repo, FEATURE, 'spec.md'), '# Spec\n\n**Status**: In progress\n');
  writeFileSync(join(repo, FEATURE, 'auto-run.md'), LOG_SEED);
  writeFileSync(join(repo, 'a.txt'), 'a');
  git('add', 'a.txt');
  git('commit', '-q', '-m', 'init');
  symlinkSync(GIT, join(bin, 'git'));
  if (gh) {
    writeFileSync(join(bin, 'gh'), `#!/bin/sh\n${gh}\n`);
    chmodSync(join(bin, 'gh'), 0o755);
  }
};
const run = () => {
  const env = { ...process.env, CLAUDE_PROJECT_DIR: repo, PATH: bin };
  delete env.CLAUDE_CODE_REMOTE;
  return spawnSync(process.execPath, [HOOK], { cwd: repo, input: '{"trigger":"auto"}', encoding: 'utf8', env });
};
const log = () => readFileSync(join(repo, FEATURE, 'auto-run.md'), 'utf8');

beforeEach(() => {
  repo = realpathSync(mkdtempSync(join(tmpdir(), 'precompact-adv-')));
  bin = realpathSync(mkdtempSync(join(tmpdir(), 'precompact-adv-bin-')));
});
afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
  rmSync(bin, { recursive: true, force: true });
});

describe('pre-compact flush, hostile inputs', () => {
  it('appends the block when the PR is closed without merging', () => {
    setup({ gh: `echo '{"state":"CLOSED"}'` });
    assert.equal(run().status, 0);
    assert.match(log(), /## Compaction .*\(auto\)/);
  });

  it('appends the block when gh prints something that is not JSON', () => {
    setup({ gh: 'echo "MERGED"' });
    assert.equal(run().status, 0);
    assert.match(log(), /## Compaction .*\(auto\)/);
  });

  it('appends the block when gh prints a merged state but exits non-zero', () => {
    setup({ gh: `echo '{"state":"MERGED"}'; exit 1` });
    assert.equal(run().status, 0);
    assert.match(log(), /## Compaction .*\(auto\)/);
  });

  it('appends the block when the word MERGED appears only in another field of an open PR', () => {
    setup({ gh: `echo '{"state":"OPEN","title":"MERGED"}'` });
    assert.equal(run().status, 0);
    assert.match(log(), /## Compaction .*\(auto\)/);
  });

  it('leaves the log unchanged on a branch with the same number but another slug', () => {
    setup({ gh: `echo '{"state":"OPEN"}'`, branch: '900-other' });
    assert.equal(run().status, 0);
    assert.equal(log(), LOG_SEED);
  });

  it('leaves the log unchanged on a branch whose number only starts like the feature number', () => {
    setup({ gh: `echo '{"state":"OPEN"}'`, branch: '9000-demo' });
    assert.equal(run().status, 0);
    assert.equal(log(), LOG_SEED);
  });
});
