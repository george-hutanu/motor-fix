import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The owner's rule of 2026-10-16: no tech-debt tickets. Every verified
// finding is fixed in the current task's PR before ready or merge; one that
// needs an owner decision is a needs-confirmation question on the task. The
// rule files carry it verbatim, every file that routes findings names the
// question, and none keeps a defer route, so it cannot drift back.

const repo = join(import.meta.dirname, '..', '..');

// HTML comments (the constitution's Sync Impact Reports) are history, not rules.
const normalise = (text) => text.replace(/<!--[\s\S]*?-->/g, '').replace(/[*>`]/g, '').replace(/\s+/g, ' ');

const RULE = normalise(
  "every verified review, QA or harden finding is fixed in the current task's PR before ready or merge; one needing an owner decision becomes a needs-confirmation question on the task",
);

const VERBATIM = ['AGENTS.md', '.specify/memory/constitution.md'];
const ROUTERS = [
  'CLAUDE.local.md',
  '.claude/agents/code-reviewer.md',
  '.claude/agents/spec-reviewer.md',
  '.claude/scripts/jev.mjs',
  '.claude/skills/speckit-review/SKILL.md',
  '.claude/skills/speckit-harden/SKILL.md',
  '.claude/skills/speckit-auto/phases-close.md',
  '.claude/skills/speckit-auto/tail.md',
  '.claude/skills/speckit-pr-test/SKILL.md',
];
const QUIET = ['.claude/skills/speckit-auto/hand-off.md', '.claude/skills/speckit-tracker-sync/SKILL.md'];
const OLD = [
  'unless they are one-line fixes',
  'not this change — pre-existing, or out of scope',
  'instead of scope creep',
  'is NOT fixed, optimized, or extended',
  'Technical debt a review defers',
  'deferred.md',
  'tracker-sync debt',
  'tracker-sync.mjs debt',
  'only a large fix',
];

const read = (file) => normalise(readFileSync(join(repo, file), 'utf8'));

describe('the fix-in-PR rule', () => {
  // @traces 1324-FR-001
  // @traces 1324-FR-002
  it.each(VERBATIM)('%s carries the rule verbatim', (file) => {
    assert.ok(read(file).toLowerCase().includes(RULE.toLowerCase()), `${file} lacks the rule`);
  });

  // @traces 1324-FR-003
  // @traces 1324-FR-004
  it.each(ROUTERS)('%s routes an owner decision to a needs-confirmation question', (file) => {
    assert.match(read(file), /needs-confirmation/);
  });

  it.each([...VERBATIM, ...ROUTERS, ...QUIET])('%s keeps no defer route', (file) => {
    const text = read(file);
    for (const phrase of OLD) assert.ok(!text.includes(normalise(phrase)), `${file} still says "${phrase}"`);
  });

  // @traces 1324-FR-004
  it("jev's triage offers patch and decision only", () => {
    const text = read('.claude/scripts/jev.mjs');
    assert.match(text, /patch: "[^"]+"/);
    assert.doesNotMatch(text, /defer: "/);
  });
});
