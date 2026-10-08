import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Constitution II allows one form of requirement id in source: a `// @traces`
// line in a test file, which the traceability matrix reads. Every file that
// tells an agent where ids may go states that exception, and none keeps the
// wording that forbade the tag outright.

const repo = join(import.meta.dirname, '..', '..');
const read = (rel) => readFileSync(join(repo, rel), 'utf8');

const QUOTING = [
  '.claude/skills/speckit-tests/SKILL.md',
  '.claude/skills/speckit-implement/SKILL.md',
  '.claude/skills/speckit-review/SKILL.md',
  '.claude/skills/speckit-harden/SKILL.md',
  '.claude/skills/speckit-bug-fix/SKILL.md',
  '.claude/skills/speckit-auto/phases-build.md',
  '.claude/skills/speckit-auto/report.md',
  '.claude/skills/speckit-auto/commit-protocol.md',
  '.claude/agents/code-reviewer.md',
  '.claude/agents/spec-reviewer.md',
  '.claude/agents/test-adversary.md',
  '.claude/hooks/red-first-gate.mjs',
  '.claude/hooks/pre-commit-check.sh',
];
const OLD = [
  'No `// @traces',
  'Traceability is reported, not tagged in code',
  'source carries no FR markers',
  'the tokens were\n// removed repo-wide',
  'removed from the test suite deliberately',
  'constitution v1.2.1',
];

const constitution = read('.specify/memory/constitution.md');
const version = constitution.match(/^\*\*Version\*\*: (\d+\.\d+\.\d+)/m)?.[1];

describe('the one requirement id allowed in source', () => {
  it('is stated in Principle II of the constitution and on the card', () => {
    const second = constitution.slice(constitution.indexOf('### II.'), constitution.indexOf('### III.'));
    assert.match(second, /`\/\/ @traces <feature>-FR-<n>`/);
    assert.match(second, /test file/);
    const cardLine = read('.specify/memory/constitution-card.md')
      .split('\n')
      .find((line) => line.startsWith('- **II.'));
    assert.match(cardLine, /`\/\/ @traces`/);
  });

  it('lands as a minor amendment no older than 1.11.0, pinned the same in the workflow notes', () => {
    const [major, minor] = version.split('.').map(Number);
    assert.ok(major > 1 || minor >= 11, version);
    const reports = constitution.slice(0, constitution.indexOf('-->'));
    assert.match(reports, new RegExp(`^Sync Impact Report \\(v${version.replaceAll('.', '\\.')}\\)`, 'm'));
    assert.match(reports, /^Previous report \(v1\.10\.0\)/m);
    assert.match(read('CLAUDE.local.md'), new RegExp(`Constitution v${version.replaceAll('.', '\\.')} `));
  });

  it('is named by every file that tells an agent where ids may go', () => {
    for (const rel of QUOTING) assert.match(read(rel), /@traces/, rel);
  });

  it('is no longer forbidden by any of them', () => {
    for (const rel of QUOTING) for (const phrase of OLD) assert.ok(!read(rel).includes(phrase), `${rel}: ${phrase}`);
  });
});
