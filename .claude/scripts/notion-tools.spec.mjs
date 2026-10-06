import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { check } from './notion-agent-tools.mjs';

// The real agents, against the rules notion-agent-tools.mjs enforces on
// fixtures. When the desktop connector comes back under a new id, the fix is
// `node .claude/scripts/notion-agent-tools.mjs detect`, then `add <id>`; the
// tests below then still pass, since adding an id never removes one.

const root = join(import.meta.dirname, '..', '..');
const read = (rel) => readFileSync(join(root, rel), 'utf8');
const agentTools = (name) =>
  (read(`.claude/agents/${name}.md`).match(/^tools:\s*(.+)$/m)?.[1] ?? '').split(',').map((t) => t.trim());

// The id the desktop connector carried when the agents last lost Notion.
const CURRENT = 'fd62790a-b7ca-480e-9cf5-9073c1192ba8';
const NO_TOOL = '[UNAVAILABLE: notion — no Notion tool in this agent; run node .claude/scripts/notion-agent-tools.mjs detect, then add <id>]';

// @traces 693-FR-001 693-FR-005 693-FR-006
describe('Notion tools the agents can reach', () => {
  it('agree across both agents and the permission allowlist, read tools only', () => {
    assert.deepEqual(check(root), []);
  });

  it('include the current connector', () => {
    assert.ok(agentTools('org-researcher').includes(`mcp__${CURRENT}__notion-fetch`));
    assert.ok(agentTools('spec-reviewer').includes(`mcp__${CURRENT}__notion-get-comments`));
  });

  it('say plainly when an agent starts with no Notion tool, and how to fix it', () => {
    for (const file of [
      '.claude/agents/org-researcher.md',
      '.claude/agents/spec-reviewer.md',
      '.claude/skills/speckit-context/SKILL.md',
      '.claude/skills/speckit-auto/phases-plan.md',
    ])
      assert.ok(read(file).includes(NO_TOOL), `${file} lacks the no-Notion-tool line`);
  });
});
