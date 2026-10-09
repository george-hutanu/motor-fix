// @traces 1018-FR-014
// @traces 1018-FR-015
// @traces 1018-FR-016
// @traces FR-020
// @traces FR-021
// @traces FR-022
// @traces FR-023
// @traces FR-024
// @traces FR-002
import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..');
const read = (path) => readFileSync(join(ROOT, path), 'utf8');

// The Notion space's name, matched across a line wrap.
const SPACE = /MotorFix\s+—\s+Product\s+documentation/;

const RULES = ['AGENTS.md', 'CLAUDE.local.md', '.specify/memory/constitution.md'];
const READERS = [
  '.claude/skills/speckit-context/SKILL.md',
  '.claude/skills/speckit-design-check/SKILL.md',
  '.claude/skills/speckit-notion-sync/SKILL.md',
  '.claude/agents/org-researcher.md',
  '.claude/agents/spec-reviewer.md',
];
// The readers that look documentation up by its Diátaxis area.
const BY_AREA = ['.claude/skills/speckit-context/SKILL.md', '.claude/agents/org-researcher.md', '.claude/agents/spec-reviewer.md'];

describe('the documentation source', () => {
  it('the rules files name the specs repo docs/ by its areas and llms.txt, never the Notion space or the export', () => {
    for (const path of RULES) {
      const body = read(path);
      assert.doesNotMatch(body.replace(/\s+/g, ' '), SPACE, `${path} still names the Notion space`);
      assert.doesNotMatch(body, /notion-export|docs\/execution-plans\//, `${path} still names the export or docs/execution-plans/`);
    }
    const agents = read('AGENTS.md');
    assert.match(agents, /llms\.txt/);
    assert.match(agents, /docs\/reference\/build-plans\//);
    assert.match(read('.specify/memory/constitution.md'), /llms\.txt/);
  });

  it('no reader names the Notion space or a fallback to it', () => {
    for (const path of READERS) {
      const body = read(path);
      assert.doesNotMatch(body.replace(/\s+/g, ' '), SPACE, `${path} names the Notion space`);
      assert.doesNotMatch(body, /fallback until docs\/ exists|docs\/ not exported yet/, `${path} keeps the Notion fallback`);
    }
  });

  it('the context readers start at llms.txt and look features and decisions up by their area', () => {
    for (const path of BY_AREA) {
      const body = read(path);
      for (const needle of ['llms.txt', 'docs/reference/features/', 'docs/explanation/decisions/']) {
        assert.ok(body.includes(needle), `${path} does not name ${needle}`);
      }
    }
  });

  it('design-check reads the boards from docs/reference/design/, the artifact only as a live view', () => {
    const body = read('.claude/skills/speckit-design-check/SKILL.md');
    assert.match(body, /docs\/reference\/design\//);
    assert.match(body, /live view/);
    assert.doesNotMatch(body, /Requires .*Artifact tool/);
  });

  it('org-researcher can search the docs files', () => {
    const tools = read('.claude/agents/org-researcher.md').match(/^tools: (.*)$/m)[1].split(/,\s*/);
    assert.ok(tools.includes('Grep') && tools.includes('Glob'), tools.join(', '));
  });

  it('plan writes the build plan under docs/reference/build-plans/, regenerates llms.txt, and creates no plan page in Notion', () => {
    const body = read('.claude/skills/speckit-notion-sync/SKILL.md');
    const plan = body.slice(body.indexOf('**`plan`**'));
    assert.match(plan, /docs\/reference\/build-plans\/ep-<n>-/);
    assert.match(plan, /docs-lint\.mjs --write/);
    assert.match(plan, /specs-repo\.mjs commit "docs: <EP-n> build plan" -- docs\/reference\/build-plans\/ep-<n>-<slug>\.md llms\.txt/);
    assert.doesNotMatch(body, /docs\/execution-plans\//);
    assert.doesNotMatch(plan, /execution plan` \(a page\)/);
  });

  it('the plan template cites the docs/ file, and context.md readers describe it as the docs digest, not the Notion space', () => {
    const template = read('.specify/templates/plan-template.md');
    assert.doesNotMatch(template.replace(/\s+/g, ' '), /Notion Architecture page|Notion choices/);
    assert.match(template.replace(/\s+/g, ' '), /cites its `docs\/` file/);
    for (const path of [
      '.claude/skills/speckit-plan/SKILL.md',
      '.claude/skills/speckit-clarify/SKILL.md',
      '.claude/skills/speckit-analyze/SKILL.md',
      '.claude/agents/spec-challenger.md',
    ]) {
      assert.doesNotMatch(read(path).replace(/\s+/g, ' '), /owner's Notion space|the Notion space's|the Notion evidence/, `${path} still says context.md comes from Notion`);
    }
  });

  it('the Notion export is gone, with every line that ran it', () => {
    for (const path of ['.claude/settings.json', 'package.json', ...READERS]) {
      assert.doesNotMatch(read(path), /notion-export/, `${path} still names notion-export`);
    }
  });
});
