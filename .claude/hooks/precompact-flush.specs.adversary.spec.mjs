import { describe, it, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const HOOK = new URL('./precompact-flush.mjs', import.meta.url).pathname;
const FEATURE = 'specs/900-demo';
const GIT = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();

let repo;
let bin;
const git = (...args) => execFileSync('git', args, { cwd: repo, stdio: 'ignore' });
const put = (rel, content = 'x') => {
  mkdirSync(join(repo, rel, '..'), { recursive: true });
  writeFileSync(join(repo, rel), content);
};
const run = () => {
  const env = { ...process.env, CLAUDE_PROJECT_DIR: repo, PATH: bin };
  delete env.CLAUDE_CODE_REMOTE;
  return spawnSync(process.execPath, [HOOK], { cwd: repo, input: '{"trigger":"auto"}', encoding: 'utf8', env });
};
const log = () => readFileSync(join(repo, FEATURE, 'auto-run.md'), 'utf8');

beforeEach(() => {
  repo = realpathSync(mkdtempSync(join(tmpdir(), 'flush-specs-adv-')));
  bin = realpathSync(mkdtempSync(join(tmpdir(), 'flush-specs-bin-')));
  symlinkSync(GIT, join(bin, 'git'));
  git('init', '-q', '-b', '900-demo');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 't');
  put('.specify/feature.json', JSON.stringify({ feature_directory: FEATURE }));
  put(`${FEATURE}/spec.md`, '# Spec\n\n**Status**: In progress\n');
  put(`${FEATURE}/auto-run.md`, '# Auto run\n');
  put(`${FEATURE}/plan.md`, '# Plan\n');
  put('a.txt', 'a');
  git('add', '.');
  git('commit', '-q', '-m', 'init');
});
afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
  rmSync(bin, { recursive: true, force: true });
});

describe('pre-compact flush, uncommitted list and the spec folder', () => {
  // @traces 486-FR-006
  it('leaves out a tracked spec file that was modified, including the log it appended to', () => {
    run();
    assert.match(log(), /- working tree clean/);
  });

  // @traces 486-FR-006
  it('leaves out an untracked file in another feature folder', () => {
    put('specs/901-other/spec.md');
    run();
    assert.match(log(), /- working tree clean/);
  });

  // @traces 486-FR-006
  it('leaves out a deleted spec file', () => {
    rmSync(join(repo, FEATURE, 'plan.md'));
    run();
    assert.match(log(), /- working tree clean/);
  });

  // @traces 486-FR-006
  it('lists a file in a folder whose name only starts with specs', () => {
    put('specs-extra/notes.md');
    run();
    assert.match(log(), /- uncommitted \(1\):\n {2}- \?\? specs-extra\/\n/);
  });

  // @traces 486-FR-006
  it('lists a file at specs-notes.txt beside the root', () => {
    put('specs-notes.txt');
    run();
    assert.match(log(), /\?\? specs-notes\.txt/);
  });

  // @traces 486-FR-006
  it('lists a specs folder nested below the root', () => {
    put('libs/specs/helper.ts');
    run();
    assert.match(log(), /- uncommitted \(1\):\n {2}- \?\? libs\/\n/);
  });

  // @traces 486-FR-006
  it('counts only the changes beside the spec folder', () => {
    put('specs/901-other/spec.md');
    put('a.txt', 'changed');
    put('b.txt', 'new');
    run();
    assert.match(log(), /- uncommitted \(2\):/);
    assert.match(log(), /M a\.txt/);
    assert.match(log(), /\?\? b\.txt/);
    assert.doesNotMatch(log(), /901-other/);
  });

  // @traces 486-FR-006
  it('lists a file renamed out of the spec folder by its code-side path', () => {
    git('mv', `${FEATURE}/plan.md`, 'moved-plan.md');
    run();
    assert.match(log(), /moved-plan\.md/);
  });

  // @traces 486-FR-006
  it('lists a file with a space and non-ASCII characters in its name', () => {
    put('dir with space/é ü.txt');
    run();
    assert.match(log(), /dir with space/);
  });

  // @traces 486-FR-006
  it('says clean twice in a row when run twice', () => {
    run();
    run();
    const hits = log().match(/- working tree clean/g) ?? [];
    assert.equal(hits.length, 2);
  });
});
