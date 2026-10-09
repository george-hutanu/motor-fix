import { describe, it, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { activeFeature, branchFeatureDir, featureKey, featureLevel, featuresRoot, locateFeature } from './feature.mjs';

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

  it('resolves a story numbered past 999', () => {
    spec('1007-x');
    checkout('1007-x');
    assert.equal(activeFeature(repo)?.num, '1007');
  });
});

// ST-1026 moved the feature folders of motor-fix-specs under its specs/ tree.
// A checkout's clone moves to .motor-fix-specs/ with `specs` a link to its
// specs/ (`specs/<feature>` as before), but an old clone still at specs/ that
// has fast-forwarded past the move holds them at specs/specs/<feature>. The
// resolver finds a feature in either, whichever layout feature.json names.
describe('the moved specs layout', () => {
  const nested = (name) => {
    mkdirSync(join(repo, 'specs', 'specs', name), { recursive: true });
    writeFileSync(join(repo, 'specs', 'specs', name, 'spec.md'), '# Spec\n');
  };
  const pointer = (state) => {
    mkdirSync(join(repo, '.specify'), { recursive: true });
    writeFileSync(join(repo, '.specify', 'feature.json'), JSON.stringify(state));
  };

  it('puts the feature folders at specs/specs in an old clone past the move, else at specs', () => {
    assert.equal(featuresRoot(repo), 'specs');
    spec('083-sign-in');
    assert.equal(featuresRoot(repo), 'specs');
    nested('1017-x');
    assert.equal(featuresRoot(repo), join('specs', 'specs'));
  });

  it('finds the branch folder under specs/specs, padded or exact', () => {
    nested('083-sign-in');
    nested('1017-x');
    assert.equal(branchFeatureDir(repo, '83-sign-in'), join('specs', 'specs', '083-sign-in'));
    assert.equal(branchFeatureDir(repo, '1017-x'), join('specs', 'specs', '1017-x'));
  });

  it('resolves a feature.json naming specs/<feature> when the folder sits at specs/specs/<feature>', () => {
    nested('1017-x');
    pointer({ feature_directory: 'specs/1017-x', level: 3, level_for: 'specs/1017-x' });
    const feature = activeFeature(repo);
    assert.equal(feature?.dir, join(repo, 'specs', 'specs', '1017-x'));
    assert.equal(feature?.num, '1017');
    assert.equal(feature?.level, 3);
  });

  it('resolves a feature.json naming specs/specs/<feature> once specs is the link into the moved clone', () => {
    mkdirSync(join(repo, '.motor-fix-specs', 'specs', '1017-x'), { recursive: true });
    writeFileSync(join(repo, '.motor-fix-specs', 'specs', '1017-x', 'spec.md'), '# Spec\n');
    symlinkSync('.motor-fix-specs/specs', join(repo, 'specs'));
    pointer({ feature_directory: 'specs/specs/1017-x', level: 3, level_for: 'specs/specs/1017-x' });
    const feature = activeFeature(repo);
    assert.equal(feature?.dir, join(repo, 'specs', '1017-x'));
    assert.equal(feature?.level, 3);
    assert.equal(featuresRoot(repo), 'specs');
  });

  it('keys a feature the same in every layout', () => {
    for (const dir of ['specs/1017-x', 'specs/specs/1017-x', '.motor-fix-specs/specs/1017-x', `${repo}/specs/specs/1017-x/`, './specs/specs/1017-x']) {
      assert.equal(featureKey(repo, dir), 'specs/1017-x', dir);
    }
    assert.equal(featureKey(repo, 'specs/specs'), 'specs/specs');
  });

  it('reads the level sized for specs/<feature> on the folder at specs/specs/<feature>', () => {
    nested('1017-x');
    pointer({ feature_directory: 'specs/1017-x', level: 1, level_for: 'specs/1017-x' });
    assert.equal(featureLevel(repo, join(repo, 'specs', 'specs', '1017-x')), 1);
  });

  it('locates a folder as written, else by its name under the features folder, else leaves it', () => {
    nested('1017-x');
    assert.equal(locateFeature(repo, 'specs/1017-x'), join(repo, 'specs', 'specs', '1017-x'));
    assert.equal(locateFeature(repo, join(repo, 'specs', 'specs', '1017-x')), join(repo, 'specs', 'specs', '1017-x'));
    assert.equal(locateFeature(repo, 'specs/404-gone'), join(repo, 'specs', '404-gone'));
    spec('083-sign-in');
    assert.equal(locateFeature(repo, 'specs/083-sign-in'), join(repo, 'specs', '083-sign-in'));
  });
});
