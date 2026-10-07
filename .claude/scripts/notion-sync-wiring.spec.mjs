import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// The sync skill is prose an agent follows: these checks keep it leading with
// the script, keep the connector path whole for when there is no token, and
// keep it shorter than the connector-only version it replaced.

const root = join(import.meta.dirname, '..', '..');
const SKILL = '.claude/skills/speckit-notion-sync/SKILL.md';
const skill = readFileSync(join(root, SKILL), 'utf8');

describe('speckit-notion-sync', () => {
  it('runs every event through the script', () => {
    for (const event of ['start', 'implement', 'pr <n>', 'qa', 'finish', 'blocked', 'unblock', 'debt']) {
      assert.ok(skill.includes(`notion-sync.mjs ${event}`), `no script call for ${event}`);
    }
  });

  it('calls the script before any connector step', () => {
    const script = skill.indexOf('notion-sync.mjs');
    const connector = skill.search(/notion-(update-page|fetch|create-comment|create-pages|search)/);
    assert.ok(script !== -1 && connector !== -1 && script < connector);
  });

  it('keeps the connector path for a missing token, logged through the same formatter', () => {
    assert.match(skill, /exit(s)? 3|exit code 3/i);
    assert.match(skill, /no NOTION_TOKEN, use the connector/);
    assert.match(skill, /notion-sync\.mjs log /);
    for (const tool of ['notion-update-page', 'notion-create-comment', 'notion-create-pages']) assert.ok(skill.includes(tool), `fallback lost ${tool}`);
  });

  it('keeps the finish comment at a fixed, git-ignored path that outlives a retry', () => {
    assert.match(skill, /specs\/<feature>\/finish-comment\.md/);
    assert.match(skill, /absolute path/i);
    assert.match(readFileSync(join(root, '.gitignore'), 'utf8'), /^\/specs\/$/m); // 815: and specs/.gitignore in motor-fix-specs
  });

  it('is shorter than the connector-only skill', () => {
    assert.ok(statSync(join(root, SKILL)).size < 14725);
  });
});

describe('.env.example', () => {
  it('ends with NOTION_TOKEN and says what the integration must be shared with', () => {
    const lines = readFileSync(join(root, '.env.example'), 'utf8').trimEnd().split('\n');
    assert.equal(lines.at(-1), 'NOTION_TOKEN=');
    assert.match(lines.at(-2), /^#.*shared with/i);
  });
});
