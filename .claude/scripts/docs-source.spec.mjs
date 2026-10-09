// @traces 1018-FR-014
// @traces 1018-FR-015
// @traces 1018-FR-016
import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..');
const read = (path) => readFileSync(join(ROOT, path), 'utf8');

// The Notion space's name, matched across a line wrap.
const SPACE = /MotorFix\s+—\s+Product\s+documentation/;
const TAG = '(fallback until docs/ exists)';

const RULES = ['AGENTS.md', 'CLAUDE.local.md', '.specify/memory/constitution.md'];
const READERS = [
  '.claude/skills/speckit-context/SKILL.md',
  '.claude/skills/speckit-design-check/SKILL.md',
  '.claude/skills/speckit-notion-sync/SKILL.md',
  '.claude/agents/org-researcher.md',
  '.claude/agents/spec-reviewer.md',
];
const REWIRED = [
  '.claude/skills/speckit-context/SKILL.md',
  '.claude/agents/org-researcher.md',
  '.claude/agents/spec-reviewer.md',
  '.claude/skills/speckit-design-check/SKILL.md',
];

/** The lines the space's name sits on, a name wrapped over two lines counting as the second. */
function namedLines(body) {
  const lines = body.split('\n');
  return lines.filter((line, i) => SPACE.test(line) || (i > 0 && !SPACE.test(lines[i - 1]) && SPACE.test(`${lines[i - 1]} ${line}`)));
}

describe('the documentation source', () => {
  it('the rules files name the specs repo docs/, never the Notion space', () => {
    for (const path of RULES) {
      const body = read(path);
      assert.doesNotMatch(body.replace(/\s+/g, ' '), SPACE, `${path} still names the Notion space`);
    }
    assert.match(read('AGENTS.md'), /\.motor-fix-specs\/docs\//);
    assert.match(read('.specify/memory/constitution.md'), /docs\//);
  });

  it('a rewired skill or agent names the Notion space only on a line tagged as the fallback', () => {
    for (const path of READERS) {
      for (const line of namedLines(read(path))) {
        assert.ok(line.trimEnd().endsWith(TAG), `${path}: "${line.trim()}" names the Notion space without ${TAG}`);
      }
    }
  });

  it('each rewired reader reads the clone docs/ through docs/index.json', () => {
    for (const path of REWIRED) {
      const body = read(path);
      assert.match(body, /\.motor-fix-specs\/docs\//, `${path} does not name .motor-fix-specs/docs/`);
      assert.match(body, /docs\/index\.json/, `${path} does not name docs/index.json`);
    }
  });

  it('org-researcher can search the exported files', () => {
    const tools = read('.claude/agents/org-researcher.md').match(/^tools: (.*)$/m)[1].split(/,\s*/);
    assert.ok(tools.includes('Grep') && tools.includes('Glob'), tools.join(', '));
  });

  it('plan writes an execution plan under docs/execution-plans/ and creates no execution-plan page in Notion', () => {
    const body = read('.claude/skills/speckit-notion-sync/SKILL.md');
    const plan = body.slice(body.indexOf('**`plan`**'));
    assert.match(plan, /docs\/execution-plans\//);
    assert.match(plan, /specs-repo\.mjs commit "docs\(specs\): <EP-n> execution plan" -- docs\/execution-plans\//);
    assert.doesNotMatch(plan, /execution plan` \(a page\)/);
  });
});
