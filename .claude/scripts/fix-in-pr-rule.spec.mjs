import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The owner's rule of 2026-10-08: a verified finding whose fix is
// small or medium is fixed in the same PR; only a large fix is deferred. Every
// file that routes findings carries the size test, verbatim or as a pointer to
// AGENTS.md, and none keeps the old wording, so the rule cannot drift back.

const repo = join(import.meta.dirname, '..', '..');

const normalise = (text) => text.replace(/[*>`]/g, '').replace(/\s+/g, ' ');

const SIZE_TEST = normalise(
  'A fix is large when it needs its own design or decision, a data migration, a different area or epic, or work clearly bigger than the story itself.',
);

const VERBATIM = [
  'AGENTS.md',
  '.specify/memory/constitution.md',
  '.claude/agents/code-reviewer.md',
  '.claude/agents/spec-reviewer.md',
  '.specify/templates/deferred-template.md',
  '.claude/scripts/jev.mjs',
];
const POINTER = [
  'CLAUDE.local.md',
  '.claude/skills/speckit-review/SKILL.md',
  '.claude/skills/speckit-harden/SKILL.md',
  '.claude/skills/speckit-auto/phases-close.md',
  '.claude/skills/speckit-auto/tail.md',
  '.claude/skills/speckit-auto/hand-off.md',
  '.claude/skills/speckit-pr-test/SKILL.md',
  '.claude/skills/speckit-notion-sync/SKILL.md',
];
const OLD = [
  'unless they are one-line fixes',
  'not this change — pre-existing, or out of scope',
  'instead of scope creep',
  'is NOT fixed, optimized, or extended',
];

const read = (file) => normalise(readFileSync(join(repo, file), 'utf8'));

describe('the fix-in-PR rule', () => {
  it.each(VERBATIM)('%s carries the size test verbatim', (file) => {
    assert.ok(read(file).includes(SIZE_TEST), `${file} lacks the size test`);
  });

  it.each(POINTER)('%s points at the size test in AGENTS.md', (file) => {
    const sentences = read(file).split(/\.\s/);
    assert.ok(
      sentences.some((s) => /size test/i.test(s) && s.includes('AGENTS.md')),
      `${file} has no sentence pointing at AGENTS.md's size test`,
    );
  });

  it.each([...VERBATIM, ...POINTER])('%s keeps none of the old routing wording', (file) => {
    const text = read(file);
    for (const phrase of OLD) assert.ok(!text.includes(normalise(phrase)), `${file} still says "${phrase}"`);
  });

  it('the deferred template no longer gives "pre-existing" as the reason', () => {
    assert.ok(!read('.specify/templates/deferred-template.md').includes('pre-existing:'));
  });

  it("jev's triage routes small and medium fixes to patch and large ones to defer", () => {
    const text = read('.claude/scripts/jev.mjs');
    const patch = text.match(/patch: "([^"]+)"/)?.[1] ?? '';
    const defer = text.match(/defer: "([^"]+)"/)?.[1] ?? '';
    assert.match(patch, /small or medium/);
    assert.match(patch, /pre-existing/);
    assert.ok(normalise(defer).includes(SIZE_TEST), 'jev defer description lacks the size test');
  });
});
