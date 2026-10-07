import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The PR tester takes a screenshot per viewport, colour scheme and language on
// every lap. Committed, they grow every clone by hundreds of kilobytes a lap,
// forever, since a merge keeps them in history. The evidence that stays in the
// repo is the report; the screenshots stay in the tester's --out directory.

const root = join(import.meta.dirname, '..', '..');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });

describe('QA evidence keeps screenshots out of the repo', () => {
  it('ignores an image written into any pr-review folder', () => {
    for (const path of [
      'specs/051-cockpit-gauges/pr-review/lap1/cockpit-mobile-dark-ro.png',
      'specs/434-agent-pr-review/pr-review/pr-21-lap1/shots/home-mobile-light-en.png',
      'specs/052-chart-style/pr-review/lap3/chart.jpg',
    ])
      assert.equal(git('check-ignore', '--no-index', path).trim(), path, `${path} is not ignored`);
  });

  // the report is kept in the private motor-fix-specs repo, whose own
  // .gitignore refuses the images; the public repo tracks nothing under specs/.
  // @traces 815-FR-001
  it('tracks nothing under specs/ in the public repo', () => {
    assert.match(readFileSync(join(root, '.gitignore'), 'utf8'), /^\/specs\/$/m);
    assert.equal(git('ls-files', 'specs').trim(), '');
  });

  it('tells the QA step to copy the report and not the screenshots', () => {
    const skill = readFileSync(join(root, '.claude/skills/speckit-pr-test/SKILL.md'), 'utf8');
    const evidence = skill.split('## Evidence')[1].split('\n## ')[0];
    assert.doesNotMatch(evidence, /one screenshot per viewport/);
    assert.match(evidence, /never commit/i);
  });
});

describe('the screen-review rules in AGENTS.md', () => {
  const section = () => readFileSync(join(root, 'AGENTS.md'), 'utf8').split('## Reviewing a change that has screens')[1].split('\n## ')[0];

  // A pushed branch can only be rebased by a forced push, which Constitution
  // VII and bash-guard forbid; lifecycle step 5 merges origin/main instead.
  it('brings a waiting PR up to date by merging main, never by a rebase', () => {
    assert.doesNotMatch(section(), /\brebases\b/i);
    assert.match(section(), /merges\s+`origin\/main`/);
  });
});
