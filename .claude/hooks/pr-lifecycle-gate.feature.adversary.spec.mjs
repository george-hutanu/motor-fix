import { describe, it, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { decide, featureDir } from './pr-lifecycle-gate.mjs';

let cwd;
const pointer = (value) => {
  mkdirSync(join(cwd, '.specify'), { recursive: true });
  writeFileSync(join(cwd, '.specify', 'feature.json'), typeof value === 'string' ? value : JSON.stringify(value));
};
const folder = (...parts) => mkdirSync(join(cwd, ...parts), { recursive: true });

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'gate-feature-adv-'));
  spawnSync('git', ['init', '-q', '-b', 'main'], { cwd });
});
afterEach(() => rmSync(cwd, { recursive: true, force: true }));

describe('featureDir pointer handling', () => {
  // @traces 486-FR-003
  it('falls back to the branch folder when the pointer names a file', () => {
    folder('specs', '083-x');
    writeFileSync(join(cwd, 'notes.md'), 'a file');
    pointer({ feature_directory: 'notes.md' });
    assert.equal(featureDir(cwd, '83-x'), join('specs', '083-x'));
  });

  // @traces 486-FR-003
  it('falls back to specs/<branch> when the pointer names a file and no folder matches', () => {
    writeFileSync(join(cwd, 'notes.md'), 'a file');
    pointer({ feature_directory: 'notes.md' });
    assert.equal(featureDir(cwd, '5-nothing'), join('specs', '5-nothing'));
  });

  // @traces 486-FR-003
  it('falls back when the pointer names a file under specs', () => {
    folder('specs');
    writeFileSync(join(cwd, 'specs', '9-file'), 'a file');
    pointer({ feature_directory: 'specs/9-file' });
    assert.equal(featureDir(cwd, '9-file'), join('specs', '9-file'));
  });

  // @traces 486-FR-003
  it('takes a pointer that names a folder', () => {
    folder('specs', '12-a');
    folder('specs', '13-b');
    pointer({ feature_directory: 'specs/12-a' });
    assert.equal(featureDir(cwd, '13-b'), join('specs', '12-a'));
  });

  // @traces 486-FR-003
  it('takes a pointer that is a symlink to a folder', () => {
    folder('specs', '12-a');
    symlinkSync(join(cwd, 'specs', '12-a'), join(cwd, 'specs', '12-link'));
    pointer({ feature_directory: 'specs/12-link' });
    assert.equal(featureDir(cwd, '13-b'), join('specs', '12-link'));
  });

  // @traces 486-FR-003
  it('falls back when the pointer is a dangling symlink', () => {
    folder('specs');
    symlinkSync(join(cwd, 'gone'), join(cwd, 'specs', '12-dead'));
    pointer({ feature_directory: 'specs/12-dead' });
    assert.equal(featureDir(cwd, '13-b'), join('specs', '13-b'));
  });

  // @traces 486-FR-003
  it('finds the old clone layout specs/specs/<feature> for a pointer to specs/<feature>', () => {
    folder('specs', 'specs', '012-a');
    pointer({ feature_directory: 'specs/012-a' });
    assert.equal(featureDir(cwd, '13-b'), join('specs', 'specs', '012-a'));
  });

  // @traces 486-FR-003
  it('falls back when the old layout path is a file', () => {
    folder('specs', 'specs');
    writeFileSync(join(cwd, 'specs', 'specs', '012-a'), 'file');
    pointer({ feature_directory: 'specs/012-a' });
    assert.equal(featureDir(cwd, '13-b'), join('specs', '13-b'));
  });

  for (const [title, value] of [
    ['a number', { feature_directory: 42 }],
    ['null', { feature_directory: null }],
    ['an array', { feature_directory: ['specs/12-a'] }],
    ['an object', { feature_directory: { a: 1 } }],
    ['an empty string', { feature_directory: '' }],
    ['missing', {}],
    ['a JSON null document', 'null'],
    ['a JSON array document', '[]'],
    ['malformed JSON', '{not json'],
    ['an empty file', ''],
  ]) {
    it(`falls back to the branch folder when the pointer is ${title}`, () => {
      folder('specs', '083-x');
      pointer(value);
      assert.equal(featureDir(cwd, '83-x'), join('specs', '083-x'));
    });
  }

  it('falls back when .specify/feature.json is itself a folder', () => {
    folder('.specify', 'feature.json');
    assert.equal(featureDir(cwd, '5-x'), join('specs', '5-x'));
  });

  it('falls back when the pointer names a folder that is gone', () => {
    pointer({ feature_directory: 'specs/12-gone' });
    assert.equal(featureDir(cwd, '5-x'), join('specs', '5-x'));
  });

  // @traces 486-FR-005
  it('prefers specs/083-x over specs/83-x for branch 83-x without a pointer', () => {
    folder('specs', '83-x');
    folder('specs', '083-x');
    assert.equal(featureDir(cwd, '83-x'), join('specs', '083-x'));
  });
});

const task = (pr) => ({ ahead: 2, branch: '486-x', pr, prLinked: true, unpushed: 0 });
const openPr = (over = {}) => ({
  number: 38,
  title: 'fix(harness): a change',
  state: 'OPEN',
  isDraft: false,
  mergeable: 'MERGEABLE',
  statusCheckRollup: [],
  labels: [{ name: 'bug' }, { name: 'QA' }],
  ...over,
});
const REMOTE = { env: { CLAUDE_CODE_REMOTE: 'true' } };
const LAPTOP = { env: {} };

describe('decide hints by environment', () => {
  const refusals = {
    'two stage labels': openPr({ labels: [{ name: 'QA' }, { name: 'in development' }, { name: 'bug' }] }),
    'a retired label': openPr({ labels: [{ name: 'in review' }, { name: 'bug' }] }),
    'a draft with no stage': openPr({ isDraft: true, labels: [{ name: 'bug' }] }),
    'a ready PR with no QA': openPr({ labels: [{ name: 'bug' }] }),
    'a missing type label': openPr({ labels: [{ name: 'QA' }] }),
    'a breaking title without the label': openPr({ title: 'feat(api)!: drop it', labels: [{ name: 'QA' }, { name: 'feature' }] }),
    'no PR at all': null,
  };
  for (const [title, pr] of Object.entries(refusals)) {
    // @traces 486-FR-004
    it(`names gh.mjs in the cloud for ${title}`, () => {
      const message = decide(task(pr), REMOTE);
      assert.match(message, /node \.claude\/scripts\/gh\.mjs pr (edit|create)/);
      assert.doesNotMatch(message, /(^|[^/\w.])gh pr (edit|create)/);
    });

    // @traces 486-FR-004
    it(`names plain gh on the laptop for ${title}`, () => {
      const message = decide(task(pr), LAPTOP);
      assert.doesNotMatch(message, /gh\.mjs/);
      assert.match(message, /\bgh pr (edit|create)\b/);
    });
  }

  // @traces 486-FR-004
  it('treats CLAUDE_CODE_REMOTE set to anything but true as the laptop', () => {
    for (const value of ['1', 'TRUE', 'True', 'yes', '', 'false', ' true']) {
      const message = decide(task(null), { env: { CLAUDE_CODE_REMOTE: value } });
      assert.doesNotMatch(message, /gh\.mjs/, JSON.stringify(value));
    }
  });

  // @traces 486-FR-004
  it('keeps plain gh for the merge hint in the cloud', () => {
    const ready = openPr({ statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'SUCCESS', name: 'ci' }, { state: 'SUCCESS', context: 'agent-review' }] });
    const message = decide(task(ready), REMOTE);
    assert.match(message ?? '', /gh pr merge 38/);
    assert.doesNotMatch(message ?? '', /gh\.mjs pr merge/);
  });

  // @traces 486-FR-004
  it('gives the same hint twice', () => {
    const pr = openPr({ labels: [{ name: 'in review' }] });
    assert.equal(decide(task(pr), REMOTE), decide(task(pr), REMOTE));
  });

  it('judges with no options argument at all, as on the laptop', () => {
    assert.match(decide(task(null)), /has no PR/);
  });
});
