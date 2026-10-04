import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Ready to work and the finish comment are written by skills, which are prose.
// These checks keep the prose wired: the sync runs the refresh and the comment,
// the archive refuses without the refresh, and the rule is where agents read it.

const root = join(import.meta.dirname, '..', '..');
const read = (rel) => readFileSync(join(root, rel), 'utf8');
const section = (text, heading) => {
  const start = text.indexOf(heading);
  assert.notEqual(start, -1, `no "${heading}" section`);
  const next = text.indexOf('\n## ', start + heading.length);
  return text.slice(start, next === -1 ? undefined : next);
};

describe('notion-ready', () => {
  const skill = read('.claude/skills/notion-ready/SKILL.md');

  it('writes the Ready to work checkbox and never Labels', () => {
    assert.match(skill, /Ready to work/);
    assert.match(skill, /never use Labels/i);
  });

  it('asks the tested decision instead of judging readiness in prose', () => {
    assert.match(skill, /notion-ready\.mjs decide/);
  });
});

describe('speckit-notion-sync', () => {
  const skill = read('.claude/skills/speckit-notion-sync/SKILL.md');

  it('refreshes readiness after start and finish, and logs it', () => {
    const step = section(skill, '## 2d. Ready to work');
    assert.match(step, /`start`/);
    assert.match(step, /`finish`/);
    assert.match(step, /notion-ready/);
    assert.match(step, /· ready ·/);
    assert.match(step, /PENDING/);
  });

  it('comments on a finished story only when there is something to record, and logs it', () => {
    const step = section(skill, '## 2e. Finish comment');
    assert.match(step, /notion-create-comment/);
    assert.match(step, /Build brief/);
    assert.match(step, /no comment/i);
    assert.match(step, /· comment ·/);
  });
});

describe('speckit-archive', () => {
  it('runs the archive check before closing', () => {
    assert.match(read('.claude/skills/speckit-archive/SKILL.md'), /notion-ready\.mjs check/);
  });
});

describe('AGENTS.md', () => {
  const agents = read('AGENTS.md');

  it('states the readiness rule and the finish comment rule', () => {
    assert.match(agents, /Ready to work/);
    assert.match(agents, /notion-ready/);
    assert.match(agents, /comments on the task when there is something to record/);
  });
});
