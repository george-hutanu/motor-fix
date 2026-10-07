import { describe, it, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const HOOK = new URL('./precompact-flush.mjs', import.meta.url).pathname;
const FEATURE = 'specs/900-demo';
const LOG_SEED = '# Auto run\n';
const GIT = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();

// The hook runs with only this directory on PATH, so the real gh (on a CI
// runner it sits in /usr/bin) can never answer in its place.
const GH = {
  MERGED: 'echo \'{"state":"MERGED"}\'',
  OPEN: 'echo \'{"state":"OPEN"}\'',
  failing: 'echo "no pull requests found" >&2; exit 1',
  stalled: 'exec /bin/sleep 10',
};

let repo;
let bin;
let feature;
const git = (...args) => execFileSync('git', args, { cwd: repo, stdio: 'ignore' });
const setup = (status, { gh, branch = '900-demo', dir = FEATURE } = {}) => {
  feature = dir;
  git('init', '-q', '-b', branch);
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 't');
  mkdirSync(join(repo, feature), { recursive: true });
  mkdirSync(join(repo, '.specify'), { recursive: true });
  writeFileSync(join(repo, '.specify/feature.json'), JSON.stringify({ feature_directory: feature }));
  writeFileSync(join(repo, feature, 'spec.md'), `# Spec\n\n**Status**: ${status}\n`);
  writeFileSync(join(repo, feature, 'auto-run.md'), LOG_SEED);
  writeFileSync(join(repo, 'a.txt'), 'a');
  writeFileSync(join(repo, 'b.txt'), 'b');
  git('add', 'a.txt', 'b.txt');
  git('commit', '-q', '-m', 'init');
  symlinkSync(GIT, join(bin, 'git'));
  if (gh) {
    writeFileSync(join(bin, 'gh'), `#!/bin/sh\necho "$@" >> "${join(bin, 'calls')}"\n${GH[gh]}\n`);
    chmodSync(join(bin, 'gh'), 0o755);
  }
};
const run = () => {
  const env = { ...process.env, CLAUDE_PROJECT_DIR: repo, PATH: bin };
  delete env.CLAUDE_CODE_REMOTE;
  return spawnSync(process.execPath, [HOOK], { cwd: repo, input: '{"trigger":"auto"}', encoding: 'utf8', env });
};
const log = () => readFileSync(join(repo, feature, 'auto-run.md'), 'utf8');
const ghCalled = () => existsSync(join(bin, 'calls'));
const appended = () => assert.match(log(), /## Compaction .*\(auto\)/);
const untouched = (result) => {
  assert.equal(result.status, 0);
  assert.equal(log(), LOG_SEED);
};

beforeEach(() => {
  repo = realpathSync(mkdtempSync(join(tmpdir(), 'precompact-')));
  bin = realpathSync(mkdtempSync(join(tmpdir(), 'precompact-bin-')));
});
afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
  rmSync(bin, { recursive: true, force: true });
});

describe('pre-compact flush', () => {
  for (const status of ['Archived', 'Archived (2026-10-04)']) {
    it(`appends a compaction block on the feature branch of a feature marked "${status}" whose PR is open`, () => {
      setup(status, { gh: 'OPEN' });
      assert.equal(run().status, 0);
      appended();
    });
  }

  it('appends a compaction block for a feature still in progress', () => {
    setup('In progress', { gh: 'OPEN' });
    assert.equal(run().status, 0);
    appended();
    assert.match(log(), /- tasks: 0 done, 0 open/);
    assert.match(log(), /- branch `900-demo` at `[0-9a-f]+`/);
  });

  it('leaves the run log unchanged once the PR is merged', () => {
    setup('Archived', { gh: 'MERGED' });
    untouched(run());
    assert.match(readFileSync(join(bin, 'calls'), 'utf8'), /^pr view 900-demo --json state$/m);
  });

  it('appends the block when the PR cannot be read', () => {
    setup('Archived', { gh: 'failing' });
    assert.equal(run().status, 0);
    appended();
  });

  it('appends the block without waiting out the timeout when gh is not installed', () => {
    setup('Archived');
    const started = Date.now();
    assert.equal(run().status, 0);
    assert.ok(Date.now() - started < 3000);
    appended();
  });

  it('appends the block after the timeout when gh hangs', () => {
    setup('Archived', { gh: 'stalled' });
    const started = Date.now();
    assert.equal(run().status, 0);
    const took = Date.now() - started;
    assert.ok(took >= 3000 && took < 6000, `took ${took} ms`);
    appended();
  }, 15000);

  it('leaves the run log unchanged on another branch without asking gh', () => {
    setup('In progress', { gh: 'OPEN', branch: 'main' });
    untouched(run());
    assert.equal(ghCalled(), false);
  });

  it('leaves the run log unchanged on a detached HEAD without asking gh', () => {
    setup('In progress', { gh: 'OPEN' });
    git('checkout', '-q', '--detach');
    untouched(run());
    assert.equal(ghCalled(), false);
  });

  it('counts a branch without the leading zeros of its feature number as the feature branch', () => {
    setup('In progress', { gh: 'OPEN', branch: '83-x', dir: 'specs/083-x' });
    assert.equal(run().status, 0);
    appended();
  });

  it('leaves the run log unchanged when no feature is active', () => {
    setup('In progress', { gh: 'OPEN', branch: 'scratch' });
    rmSync(join(repo, '.specify/feature.json'));
    untouched(run());
    assert.equal(ghCalled(), false);
  });

  it('keeps both status columns on every uncommitted entry', () => {
    setup('Draft');
    writeFileSync(join(repo, 'a.txt'), 'changed');
    writeFileSync(join(repo, 'b.txt'), 'changed');
    run();
    assert.match(log(), /^ {2}- {2}M a\.txt$/m);
    assert.match(log(), /^ {2}- {2}M b\.txt$/m);
  });

  it('says the working tree is clean when only the spec folder differs', () => {
    setup('Draft');
    git('add', '.');
    git('commit', '-q', '-m', 'all');
    run();
    assert.match(log(), /- working tree clean/);
  });
});
