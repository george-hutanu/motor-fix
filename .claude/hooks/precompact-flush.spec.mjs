import { describe, it, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const HOOK = new URL('./precompact-flush.mjs', import.meta.url).pathname;
const FEATURE = 'specs/900-demo';
const LOG_SEED = '# Auto run\n';

let repo;
const git = (...args) => execFileSync('git', args, { cwd: repo, stdio: 'ignore' });
const setup = (status) => {
  git('init', '-q');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 't');
  mkdirSync(join(repo, FEATURE), { recursive: true });
  mkdirSync(join(repo, '.specify'), { recursive: true });
  writeFileSync(join(repo, '.specify/feature.json'), JSON.stringify({ feature_directory: FEATURE }));
  writeFileSync(join(repo, FEATURE, 'spec.md'), `# Spec\n\n**Status**: ${status}\n`);
  writeFileSync(join(repo, FEATURE, 'auto-run.md'), LOG_SEED);
  writeFileSync(join(repo, 'a.txt'), 'a');
  writeFileSync(join(repo, 'b.txt'), 'b');
  git('add', 'a.txt', 'b.txt');
  git('commit', '-q', '-m', 'init');
};
const run = () => spawnSync('node', [HOOK], { cwd: repo, input: '{"trigger":"auto"}', encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: repo } });
const log = () => readFileSync(join(repo, FEATURE, 'auto-run.md'), 'utf8');

beforeEach(() => {
  repo = realpathSync(mkdtempSync(join(tmpdir(), 'precompact-')));
});
afterEach(() => rmSync(repo, { recursive: true, force: true }));

describe('pre-compact flush', () => {
  for (const status of ['Archived', 'Archived (2026-10-04)']) {
    it(`leaves the run log of a feature marked "${status}" unchanged`, () => {
      setup(status);
      const result = run();
      assert.equal(result.status, 0);
      assert.equal(log(), LOG_SEED);
    });
  }

  it('appends a compaction block for a feature still in progress', () => {
    setup('In progress');
    assert.equal(run().status, 0);
    assert.match(log(), /## Compaction .*\(auto\)/);
    assert.match(log(), /- tasks: 0 done, 0 open/);
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
