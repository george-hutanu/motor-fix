import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The GitHub tracker's skill is prose an agent follows, and the spec-kit hooks
// and lifecycle docs call it: these checks keep every event on the script, the
// Notion path only for a feature that started there, and the hooks on it.

const root = join(import.meta.dirname, '..', '..');
const read = (path) => readFileSync(join(root, path), 'utf8');
const skill = read('.claude/skills/speckit-tracker-sync/SKILL.md');

describe('speckit-tracker-sync', () => {
  // @traces 1036-FR-016
  it('runs every event through the script', () => {
    for (const event of ['start', 'implement', 'pr <n>', 'qa', 'finish', 'blocked', 'unblock', 'debt', 'ready', 'file', 'check'])
      assert.ok(skill.includes(`tracker-sync.mjs ${event}`), `no script call for ${event}`);
  });

  // @traces 1036-FR-013
  it('sends a feature that started on Notion to speckit-notion-sync, and no other', () => {
    assert.match(skill, /notion-sync\.md/);
    assert.match(skill, /tracker-sync\.md/);
    assert.match(skill, /speckit-notion-sync/);
    assert.doesNotMatch(skill, /notion-update-page|notion-create-comment/, 'the GitHub path writes nothing to Notion');
  });

  // @traces 1036-FR-012
  it('names the token order and the scope fix, never the owner-only config dir', () => {
    assert.match(skill, /GH_PROJECT_TOKEN/);
    assert.match(skill, /gh auth token -u george-hutanu/);
    assert.match(skill, /gh auth refresh -h github\.com -u george-hutanu -s project,read:project/);
    assert.doesNotMatch(skill, /gh-motorfix/);
  });

  // @traces 1036-FR-010
  it('keeps the hold review before a ready label goes on', () => {
    assert.match(skill, /--tick/);
    assert.match(skill, /closed or Done/);
  });
});

describe('the spec-kit hooks', () => {
  const hooks = read('.specify/extensions.yml');

  // @traces 1036-FR-016
  it('run the tracker sync at after_specify and before_implement, never the Notion one', () => {
    assert.match(hooks, /command: speckit\.tracker\.sync/);
    assert.doesNotMatch(hooks, /command: speckit\.notion\.sync/);
  });
});

describe('the lifecycle docs', () => {
  // @traces 1036-FR-016
  it.each([
    '.claude/skills/speckit-auto/hand-off.md',
    '.claude/skills/speckit-auto/tail.md',
    '.claude/skills/speckit-auto/phases-close.md',
    '.claude/skills/speckit-review/SKILL.md',
    '.claude/skills/speckit-archive/SKILL.md',
    '.claude/skills/speckit-git-commit/SKILL.md',
    '.claude/skills/speckit-pr-test/SKILL.md',
    '.claude/skills/notion-ready/SKILL.md',
  ])('%s names the tracker sync', (path) => {
    assert.match(read(path), /speckit-tracker-sync|tracker-sync\.mjs/);
  });
});
