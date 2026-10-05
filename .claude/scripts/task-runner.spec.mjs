import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// The story, tail and watch agents run as one definition whose first turn
// carries only the tools those runs use. A general-purpose dispatch, or a
// prompt that sends the agent to re-read the rules CLAUDE.md already loaded,
// brings back the cost this definition removes.

const root = join(import.meta.dirname, '..', '..');
const read = (rel) => readFileSync(join(root, rel), 'utf8');
const AGENT = '.claude/agents/task-runner.md';

const frontmatter = (text) => text.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '';
const field = (fm, key) => fm.match(new RegExp(`^${key}:\\s*(.*)$`, 'm'))?.[1];
const list = (value) => (value ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const sectionFrom = (text, marker) => {
  const start = text.indexOf(marker);
  assert.notEqual(start, -1, `no "${marker}"`);
  const next = text.indexOf('\n## ', start + marker.length);
  return text.slice(start, next === -1 ? undefined : next);
};

const NEEDED = ['Bash', 'Read', 'Edit', 'Write', 'Grep', 'Glob', 'Skill', 'Agent', 'ToolSearch', 'Monitor', 'TaskStop', 'EnterWorktree', 'PushNotification'];
const HEAVY = ['Artifact', 'mcp__Claude_Browser', 'mcp__claude-in-chrome', 'mcp__chrome-devtools', 'mcp__Claude_Code_iOS_Simulator', 'mcp__visualize', 'mcp__ccd_session', 'mcp__ccd_session_mgmt'];
const REREAD = /\b(follow|read|re-read)\s+(the current\s+)?(AGENTS\.md|CLAUDE\.local\.md)/i;

const denies = (denied, tool) => denied.some((d) => tool === d || tool.startsWith(`${d}__`));

describe('the task-runner definition', () => {
  it('exists', () => assert.ok(existsSync(join(root, AGENT)), `${AGENT} is missing`));

  it('runs on Opus with a deny list and no allowlist', () => {
    const fm = frontmatter(read(AGENT));
    assert.equal(field(fm, 'name'), 'task-runner');
    assert.equal(field(fm, 'model'), 'opus');
    assert.equal(field(fm, 'tools'), undefined, 'an allowlist cannot match the Notion connector under every id');
    const denied = list(field(fm, 'disallowedTools'));
    for (const tool of HEAVY) assert.ok(denies(denied, tool), `${tool} is not denied`);
    for (const tool of NEEDED) assert.ok(!denies(denied, tool), `${tool} is denied`);
    assert.ok(!denied.some((d) => /notion/i.test(d)), 'a Notion server or tool is denied');
    assert.ok(!denied.some((d) => d.includes('*')), 'a wildcard in the list is ignored by the harness');
  });

  it('says the rules are in context and gives the delta command', () => {
    const body = read(AGENT);
    assert.doesNotMatch(body, REREAD);
    assert.match(body, /git diff -R origin\/main -- AGENTS\.md CLAUDE\.local\.md/);
    assert.match(body, /constitution-card\.md/);
  });
});

describe('the dispatches', () => {
  const auto = read('.claude/skills/speckit-auto/SKILL.md');
  const watch = read('.claude/skills/speckit-watch/SKILL.md');

  it('send the story agent as task-runner', () => {
    assert.match(sectionFrom(auto, '**Parallel runs.**'), /subagent_type: task-runner/);
  });

  it('send the tail as task-runner', () => {
    assert.match(sectionFrom(auto, '## The tail'), /subagent_type: task-runner/);
  });

  it('send every watch fix as task-runner, merge on Sonnet', () => {
    const step = sectionFrom(watch, '## One pass');
    assert.match(step, /subagent_type: task-runner/);
    assert.match(step, /`merge`[\s\S]{0,40}model: "sonnet"|model: "sonnet"[\s\S]{0,200}`merge`/);
  });

  it('never name general-purpose in speckit-auto or speckit-watch', () => {
    assert.doesNotMatch(auto, /general-purpose/);
    assert.doesNotMatch(watch, /general-purpose/);
  });

  it('ask no agent to re-read AGENTS.md or CLAUDE.local.md', () => {
    assert.doesNotMatch(auto, REREAD);
    assert.doesNotMatch(watch, REREAD);
    for (const name of readdirSync(join(root, '.claude', 'agents')).filter((f) => f.endsWith('.md')))
      assert.doesNotMatch(read(`.claude/agents/${name}`), REREAD, name);
  });

  it('are named in AGENTS.md', () => {
    assert.match(read('AGENTS.md'), /`task-runner`/);
  });
});

describe('the constitution', () => {
  const auto = read('.claude/skills/speckit-auto/SKILL.md');

  it('reaches the authors as the card', () => {
    const preflight = sectionFrom(auto, '## Preflight');
    assert.match(preflight, /constitution-card\.md/);
    assert.doesNotMatch(preflight, /Read `\.specify\/memory\/constitution\.md`/);
    const phase1 = auto.slice(auto.indexOf('### 1. Constitution'), auto.indexOf('### 2. Specify'));
    assert.match(phase1, /constitution-card\.md/);
  });

  it('reaches the reviewers and the PR tester in full', () => {
    for (const name of ['spec-reviewer', 'code-reviewer', 'pr-tester']) {
      const text = read(`.claude/agents/${name}.md`);
      assert.match(text, /\.specify\/memory\/constitution\.md/, name);
      assert.doesNotMatch(text, /constitution-card/, name);
    }
  });
});
