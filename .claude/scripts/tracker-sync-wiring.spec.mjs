import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The GitHub tracker's skill is prose an agent follows, and the spec-kit hooks
// and lifecycle docs call it: these checks keep every event on the script, the
// labels, finish comment, readiness and build plan in the skill, and the hooks
// on it.

const root = join(import.meta.dirname, '..', '..');
const read = (path) => readFileSync(join(root, path), 'utf8');
const skill = read('.claude/skills/speckit-tracker-sync/SKILL.md');

describe('speckit-tracker-sync', () => {
  // @traces 1036-FR-016
  it('runs every event through the script', () => {
    for (const event of ['start', 'implement', 'pr <n>', 'qa', 'finish', 'blocked', 'unblock', 'debt', 'ready', 'file', 'check'])
      assert.ok(skill.includes(`tracker-sync.mjs ${event}`), `no script call for ${event}`);
  });

  // @traces 1037-FR-003
  it('is the one tracker: every feature logs to tracker-sync.md', () => {
    assert.match(skill, /tracker-sync\.md/);
    assert.doesNotMatch(skill, /## 0\. Which tracker/);
  });

  // @traces 1037-FR-015
  it('carries the PR labels, the finish comment, the ready refresh and the build plan', () => {
    assert.match(skill, /## \d+[a-z]?\. PR labels/);
    assert.match(skill, /`dependencies`/);
    assert.match(skill, /## \d+[a-z]?\. Finish comment/);
    assert.match(skill, /Build brief/);
    assert.match(skill, /no comment/i);
    assert.match(skill, /tracker\/ready\.mjs/);
    assert.match(skill, /## \d+[a-z]?\. Build plan/);
    assert.match(skill, /docs\/reference\/build-plans\//);
    assert.match(skill, /llms\.txt/);
  });

  // @traces 1036-FR-012
  it('names the token order and the scope fix, never the owner-only config dir', () => {
    assert.match(skill, /GH_PROJECT_TOKEN/);
    assert.match(skill, /gh auth token -u george-hutanu/);
    assert.match(skill, /gh auth refresh -h github\.com -u george-hutanu -s project,read:project/);
    assert.doesNotMatch(skill, /gh-motorfix/);
  });

  // @traces 1036-FR-008
  it('keeps the hold review before a ready label goes on', () => {
    assert.match(skill, /--tick/);
    assert.match(skill, /closed or Done/);
  });
});

describe('the spec-kit hooks', () => {
  const hooks = read('.specify/extensions.yml');

  // @traces 1036-FR-016
  it('run the tracker sync at after_specify and before_implement', () => {
    assert.match(hooks, /command: speckit\.tracker\.sync/);
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
  ])('%s names the tracker sync', (path) => {
    assert.match(read(path), /speckit-tracker-sync|tracker-sync\.mjs/);
  });
});

describe('the archive and AGENTS.md', () => {
  // @traces 1037-FR-002
  it('the archive runs the ready check before closing', () => {
    assert.match(read('.claude/skills/speckit-archive/SKILL.md'), /tracker\/ready\.mjs check/);
  });

  // @traces 1037-FR-002
  it('AGENTS.md states the readiness rule and the finish comment rule', () => {
    const agents = read('AGENTS.md');
    assert.match(agents, /ready to work/i);
    assert.match(agents, /tracker\/ready\.mjs check -/);
    assert.match(agents, /comments on the task when there is something to record/);
  });
});

describe('the story context', () => {
  const context = read('.claude/skills/speckit-context/SKILL.md');
  const researcher = read('.claude/agents/org-researcher.md');

  // @traces 1037-FR-005
  it('/speckit-context writes the issue, its comments, the epic and its issues to story.md with gh', () => {
    assert.match(context, /specs\/<feature>\/story\.md/);
    assert.match(context, /gh issue view/);
    assert.match(context, /--comments/);
  });

  // @traces 1037-FR-005
  it('the researcher reads the tracker from story.md and has no tracker tool', () => {
    assert.match(researcher, /story\.md/);
    const tools = researcher.match(/^tools:\s*(.+)$/m)?.[1] ?? '';
    assert.doesNotMatch(tools, /mcp__/);
  });

  // @traces 1037-FR-016
  it('the design check reads the Design pointers from the issue', () => {
    const design = read('.claude/skills/speckit-design-check/SKILL.md');
    assert.match(design, /gh issue view/);
    assert.match(design, /Design boards/);
    assert.match(design, /docs\/reference\/design\//);
  });
});

describe('agents and settings', () => {
  // @traces 1037-FR-004
  it('name no tracker connector', () => {
    const settings = read('.claude/settings.json');
    assert.doesNotMatch(settings, /"mcp__claude_ai_|"mcp__[0-9a-f]{8}-/);
    for (const agent of ['org-researcher', 'spec-reviewer']) {
      const tools = read(`.claude/agents/${agent}.md`).match(/^tools:\s*(.+)$/m)?.[1] ?? '';
      assert.doesNotMatch(tools, /mcp__/, agent);
    }
  });
});
