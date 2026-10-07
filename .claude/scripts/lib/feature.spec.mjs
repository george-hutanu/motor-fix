import { describe, it, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { activeFeature, branchFeatureDir } from './feature.mjs';

// A branch names its feature folder with or without the zero padding the
// folder's number carries: `83-sign-in` is `specs/083-sign-in`. Every caller of
// activeFeature, and the PR lifecycle gate, resolve it the same way.

let repo;
const spec = (name) => {
  mkdirSync(join(repo, 'specs', name), { recursive: true });
  writeFileSync(join(repo, 'specs', name, 'spec.md'), '# Spec\n');
};
const checkout = (branch) => spawnSync('git', ['checkout', '-q', '-b', branch], { cwd: repo });

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'feature-'));
  spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: repo });
  spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init'], { cwd: repo });
});
afterEach(() => rmSync(repo, { recursive: true, force: true }));

describe('branchFeatureDir', () => {
  it('takes specs/<branch> when it exists', () => {
    spec('83-sign-in');
    spec('083-sign-in');
    assert.equal(branchFeatureDir(repo, '83-sign-in'), join('specs', '83-sign-in'));
  });

  it('finds the zero-padded folder with the same number and slug', () => {
    spec('083-sign-in');
    assert.equal(branchFeatureDir(repo, '83-sign-in'), join('specs', '083-sign-in'));
  });

  it('never takes the same number with another slug', () => {
    spec('083-other');
    assert.equal(branchFeatureDir(repo, '83-sign-in'), null);
  });

  it('names nothing for a branch without a number, or without specs/', () => {
    assert.equal(branchFeatureDir(repo, '83-sign-in'), null);
    spec('083-sign-in');
    assert.equal(branchFeatureDir(repo, 'main'), null);
  });
});

describe('activeFeature on the branch', () => {
  it('resolves a branch without the padding to the padded folder', () => {
    spec('083-sign-in');
    checkout('83-sign-in');
    const feature = activeFeature(repo);
    assert.equal(feature?.name, '083-sign-in');
    assert.equal(feature?.num, '083');
  });

  it('finds nothing when only another slug carries the number', () => {
    spec('083-other');
    checkout('83-sign-in');
    assert.equal(activeFeature(repo), null);
  });

  it('still resolves an exact three-digit branch', () => {
    spec('050-x');
    checkout('050-x');
    assert.equal(activeFeature(repo)?.name, '050-x');
  });
});
