import { describe, it, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { activeFeature, branchFeatureDir } from './feature.mjs';

let repo;
const spec = (name, withSpec = true) => {
  mkdirSync(join(repo, 'specs', name), { recursive: true });
  if (withSpec) writeFileSync(join(repo, 'specs', name, 'spec.md'), '# Spec\n');
};
const checkout = (branch) => spawnSync('git', ['checkout', '-q', '-b', branch], { cwd: repo });

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'feature-adv-'));
  spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: repo });
  spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init'], { cwd: repo });
});
afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe('branchFeatureDir, padded and unpadded numbers', () => {
  // @traces 486-FR-005
  it('names specs/083-x for branch 83-x when specs/83-x and specs/083-x both exist', () => {
    spec('83-x');
    spec('083-x');
    assert.equal(branchFeatureDir(repo, '83-x'), join('specs', '083-x'));
  });

  // @traces 486-FR-005
  it('names specs/0083-x over specs/83-x for branch 83-x', () => {
    spec('83-x');
    spec('0083-x');
    assert.equal(branchFeatureDir(repo, '83-x'), join('specs', '0083-x'));
  });

  // @traces 486-FR-005
  it('takes specs/<branch> for branch 83-x when no padded folder exists', () => {
    spec('83-x');
    assert.equal(branchFeatureDir(repo, '83-x'), join('specs', '83-x'));
  });

  // @traces 486-FR-005
  it('finds specs/083-x for branch 83-x when it is the only folder', () => {
    spec('083-x');
    assert.equal(branchFeatureDir(repo, '83-x'), join('specs', '083-x'));
  });

  // @traces 486-FR-005
  it('does not take a padded folder with a different slug', () => {
    spec('083-y');
    assert.equal(branchFeatureDir(repo, '83-x'), null);
  });

  // @traces 486-FR-005
  it('does not take a padded folder with a different number', () => {
    spec('084-x');
    assert.equal(branchFeatureDir(repo, '83-x'), null);
  });

  // @traces 486-FR-005
  it('does not match a slug that only has the branch slug as a prefix', () => {
    spec('083-x-extra');
    assert.equal(branchFeatureDir(repo, '83-x'), null);
  });

  // @traces 486-FR-005
  it('takes specs/486-x for branch 486-x even when specs/0486-x exists', () => {
    spec('486-x');
    spec('0486-x');
    assert.equal(branchFeatureDir(repo, '486-x'), join('specs', '486-x'));
  });

  // @traces 486-FR-005
  it('finds the zero-padded folder for branch 7-x with a four-digit folder', () => {
    spec('0007-x');
    assert.equal(branchFeatureDir(repo, '7-x'), join('specs', '0007-x'));
  });

  it('returns null for a branch with no number', () => {
    spec('083-x');
    assert.equal(branchFeatureDir(repo, 'main'), null);
    assert.equal(branchFeatureDir(repo, 'feature/x'), null);
  });

  it('returns null when there is no specs folder at all', () => {
    assert.equal(branchFeatureDir(repo, '83-x'), null);
  });

  it('returns null for an empty branch name', () => {
    spec('083-x');
    assert.equal(branchFeatureDir(repo, ''), null);
  });

  // @traces 486-FR-005
  it('treats a slug containing regex characters literally', () => {
    spec('083-a.b');
    assert.equal(branchFeatureDir(repo, '83-aXb'), null);
    assert.equal(branchFeatureDir(repo, '83-a.b'), join('specs', '083-a.b'));
  });

  // @traces 486-FR-005
  it('gives the same answer when called twice', () => {
    spec('83-x');
    spec('083-x');
    assert.equal(branchFeatureDir(repo, '83-x'), branchFeatureDir(repo, '83-x'));
  });
});

describe('activeFeature on a short-numbered branch', () => {
  // @traces 486-FR-005
  it('reads specs/083-x when both folders exist and the branch is 83-x', () => {
    spec('83-x');
    spec('083-x');
    checkout('83-x');
    const found = activeFeature(repo);
    assert.equal(found.name, '083-x');
    assert.equal(found.num, '083');
  });

  // @traces 486-FR-005
  it('reads nothing when the only same-number folder has a different slug', () => {
    spec('083-y');
    checkout('83-x');
    assert.equal(activeFeature(repo), null);
  });

  // @traces 486-FR-005
  it('agrees with branchFeatureDir on the folder it names', () => {
    spec('83-x');
    spec('083-x');
    checkout('83-x');
    assert.equal(activeFeature(repo).dir.endsWith(branchFeatureDir(repo, '83-x')), true);
  });

  it('yields no feature for a short-numbered folder alone, whose number is under three digits', () => {
    spec('83-x');
    checkout('83-x');
    assert.equal(activeFeature(repo), null);
  });
});
