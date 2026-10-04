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

  it('still tracks the report', () => {
    assert.throws(() => git('check-ignore', '--no-index', 'specs/051-cockpit-gauges/pr-review/lap1/report.md'));
  });

  it('tracks no screenshot under specs/', () => {
    const tracked = git('ls-files', 'specs').split('\n').filter((f) => /\.(png|jpe?g|webp)$/i.test(f));
    assert.deepEqual(tracked, []);
  });

  it('tells the QA step to copy the report and not the screenshots', () => {
    const skill = readFileSync(join(root, '.claude/skills/speckit-pr-test/SKILL.md'), 'utf8');
    const evidence = skill.split('## Evidence')[1].split('\n## ')[0];
    assert.doesNotMatch(evidence, /one screenshot per viewport/);
    assert.match(evidence, /never commit/i);
  });
});
