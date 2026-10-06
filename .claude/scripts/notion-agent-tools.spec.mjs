import { describe, it, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { add, check, detect, projectSlug } from './notion-agent-tools.mjs';

// The Notion connector's tool names carry a server id that changes between
// desktop sessions, and an agent whose tools name only old ids silently gets
// no Notion tool. These build a throwaway repo and a throwaway Claude config
// dir; the real agents and transcripts are never touched.

const OLD = 'f3041bc4-d91f-4aa7-a3e8-b9172efcd78f';
const NEW = 'fd62790a-b7ca-480e-9cf5-9073c1192ba8';
const RESEARCHER = ['notion-search', 'notion-fetch', 'notion-get-comments', 'notion-query-data-sources', 'notion-get-tool-access'];
const REVIEWER = ['notion-search', 'notion-fetch', 'notion-get-comments'];

let repo;
let config;
const names = (id, reads) => reads.map((r) => `mcp__${id}__${r}`);
const agent = (name, base, notion) =>
  `---\nname: ${name}\ndescription: a test agent\ntools: ${[...base, ...notion].join(', ')}\nmodel: sonnet\n---\n\nBody of ${name}.\n`;
const write = (rel, body) => {
  const file = join(repo, rel);
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, body);
  return file;
};
const read = (rel) => readFileSync(join(repo, rel), 'utf8');
const tools = (name) =>
  read(`.claude/agents/${name}.md`)
    .match(/^tools:\s*(.+)$/m)[1]
    .split(',')
    .map((t) => t.trim());
const allow = () => JSON.parse(read('.claude/settings.json')).permissions.allow;

const seed = ({ researcher = names(OLD, RESEARCHER), reviewer = names(OLD, REVIEWER), settings = names(OLD, RESEARCHER) } = {}) => {
  write('.claude/agents/org-researcher.md', agent('org-researcher', ['Read', 'Write', 'ToolSearch'], researcher));
  write('.claude/agents/spec-reviewer.md', agent('spec-reviewer', ['Read', 'Grep', 'Bash', 'ToolSearch'], reviewer));
  write('.claude/agents/code-reviewer.md', agent('code-reviewer', ['Read', 'Grep'], []));
  write('.claude/settings.json', `${JSON.stringify({ permissions: { allow: ['Bash(git status)', ...settings, 'WebSearch'] } }, null, 2)}\n`);
};

const transcript = (slug, file, ids, mtime) => {
  const dir = join(config, 'projects', slug);
  mkdirSync(dir, { recursive: true });
  const lines = [
    JSON.stringify({ type: 'user', message: { content: 'mcp__typo-in-prose__notion-fetch is mentioned in prose only' } }),
    JSON.stringify({
      type: 'attachment',
      attachment: { type: 'deferred_tools_delta', addedNames: ['Monitor', ...ids.flatMap((id) => names(id, ['notion-fetch', 'notion-create-pages']))] },
    }),
  ];
  const path = join(dir, file);
  writeFileSync(path, `${lines.join('\n')}\n`);
  if (mtime) utimesSync(path, mtime, mtime);
};

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'notion-tools-repo-'));
  config = mkdtempSync(join(tmpdir(), 'notion-tools-config-'));
});
afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
  rmSync(config, { recursive: true, force: true });
});

// @traces 693-FR-002 693-FR-003
describe('check', () => {
  it('passes when every Notion agent and the allowlist name the same servers with their own read tools', () => {
    seed();
    assert.deepEqual(check(repo), []);
  });

  it('flags a server one agent has and another lacks', () => {
    seed({ reviewer: [...names(OLD, REVIEWER), ...names(NEW, REVIEWER)] });
    assert.match(check(repo).join('\n'), new RegExp(`org-researcher.*${NEW}`));
  });

  it('flags a server the agents have and the permission allowlist lacks', () => {
    seed({ researcher: [...names(OLD, RESEARCHER), ...names(NEW, RESEARCHER)], reviewer: [...names(OLD, REVIEWER), ...names(NEW, REVIEWER)] });
    assert.match(check(repo).join('\n'), new RegExp(`settings\\.json.*${NEW}`));
  });

  it('flags a read tool missing from an agent for a server it lists', () => {
    seed({ reviewer: names(OLD, ['notion-search', 'notion-fetch']) });
    assert.match(check(repo).join('\n'), /spec-reviewer.*notion-get-comments/);
  });

  it("flags a read tool outside the agent's own set", () => {
    seed({ reviewer: names(OLD, [...REVIEWER, 'notion-query-data-sources']) });
    assert.match(check(repo).join('\n'), /spec-reviewer.*notion-query-data-sources/);
  });

  it('flags a Notion write tool under any server id, a never-seen one included', () => {
    for (const write of ['notion-create-pages', 'notion-update-page', 'notion-create-comment', 'notion-move-pages', 'notion-duplicate-page']) {
      seed({ researcher: [...names(OLD, RESEARCHER), `mcp__0000-unknown__${write}`] });
      assert.match(check(repo).join('\n'), new RegExp(`org-researcher.*write tool.*${write}`), write);
    }
  });

  it('does not take notion-get-comments for a write tool', () => {
    seed();
    assert.doesNotMatch(check(repo).join('\n'), /write/);
  });
});

describe('add', () => {
  it("gives every Notion agent the new server's read tools, each its own set, and the allowlist the union", () => {
    seed();
    const changed = add(repo, NEW);
    assert.deepEqual(changed.sort(), ['.claude/agents/org-researcher.md', '.claude/agents/spec-reviewer.md', '.claude/settings.json']);
    for (const t of names(NEW, RESEARCHER)) assert.ok(tools('org-researcher').includes(t), t);
    for (const t of names(NEW, REVIEWER)) assert.ok(tools('spec-reviewer').includes(t), t);
    assert.ok(!tools('spec-reviewer').includes(`mcp__${NEW}__notion-query-data-sources`));
    for (const t of names(NEW, RESEARCHER)) assert.ok(allow().includes(t), t);
    assert.deepEqual(check(repo), []);
  });

  it('accepts any mcp tool name of the server instead of the bare id', () => {
    seed();
    add(repo, `mcp__${NEW}__notion-create-pages`);
    assert.ok(tools('spec-reviewer').includes(`mcp__${NEW}__notion-fetch`));
    assert.ok(!tools('spec-reviewer').some((t) => t.includes('create')));
  });

  it('keeps the other tools, the frontmatter order and the body, and appends after the last Notion tool', () => {
    seed();
    add(repo, NEW);
    const text = read('.claude/agents/spec-reviewer.md');
    assert.match(text, /^---\nname: spec-reviewer\ndescription: a test agent\ntools: Read, Grep, Bash, ToolSearch, mcp__/);
    assert.match(text, /\nmodel: sonnet\n---\n\nBody of spec-reviewer\.\n$/);
    assert.deepEqual(tools('spec-reviewer').slice(-3), names(NEW, REVIEWER));
    const list = allow();
    assert.equal(list.at(-1), 'WebSearch');
    assert.equal(list.indexOf(`mcp__${NEW}__notion-search`), list.indexOf(`mcp__${OLD}__notion-get-tool-access`) + 1);
  });

  it('is a no-op the second time', () => {
    seed();
    add(repo, NEW);
    const before = [read('.claude/agents/org-researcher.md'), read('.claude/agents/spec-reviewer.md'), read('.claude/settings.json')];
    assert.deepEqual(add(repo, NEW), []);
    assert.deepEqual([read('.claude/agents/org-researcher.md'), read('.claude/agents/spec-reviewer.md'), read('.claude/settings.json')], before);
  });

  it('leaves agents with no Notion tool alone', () => {
    seed();
    const before = read('.claude/agents/code-reviewer.md');
    add(repo, NEW);
    assert.equal(read('.claude/agents/code-reviewer.md'), before);
  });

  it('refuses an invalid settings.json before it writes any agent', () => {
    seed();
    write('.claude/settings.json', '{ not json');
    const before = [read('.claude/agents/org-researcher.md'), read('.claude/agents/spec-reviewer.md')];
    assert.throws(() => add(repo, NEW), /not valid JSON/);
    assert.deepEqual([read('.claude/agents/org-researcher.md'), read('.claude/agents/spec-reviewer.md')], before);
  });

  it('refuses something that is not a server id', () => {
    seed();
    assert.throws(() => add(repo, 'not an id!'), /server id/);
    assert.throws(() => add(repo, ''), /server id/);
  });
});

describe('detect', () => {
  it("names a server this project's sessions carried that the agents lack", () => {
    seed();
    transcript(projectSlug(repo), 'a.jsonl', [NEW]);
    const found = detect(repo, { configDir: config });
    assert.deepEqual(found.missing, [NEW]);
  });

  it('reads only the deferred tool lists, not prose', () => {
    seed();
    transcript(projectSlug(repo), 'a.jsonl', []);
    assert.deepEqual(detect(repo, { configDir: config }).missing, []);
  });

  it('finds nothing missing once the server is added', () => {
    seed();
    transcript(projectSlug(repo), 'a.jsonl', [NEW, OLD]);
    add(repo, NEW);
    assert.deepEqual(detect(repo, { configDir: config }).missing, []);
  });

  it('reads the main checkout slug as well as a worktree one', () => {
    seed();
    transcript(projectSlug('/somewhere/main-checkout'), 'a.jsonl', [NEW]);
    const found = detect(repo, { configDir: config, roots: [repo, '/somewhere/main-checkout'] });
    assert.deepEqual(found.missing, [NEW]);
  });

  it('reads only the newest 20 transcripts', () => {
    seed();
    const slug = projectSlug(repo);
    transcript(slug, 'old.jsonl', ['aaaa1111-0000-0000-0000-000000000000'], new Date('2020-01-01'));
    for (let i = 0; i < 20; i += 1) transcript(slug, `new-${i}.jsonl`, [NEW]);
    assert.deepEqual(detect(repo, { configDir: config }).missing, [NEW]);
  });

  it('reports no transcript with a note, and nothing missing', () => {
    seed();
    const found = detect(repo, { configDir: config });
    assert.deepEqual(found.missing, []);
    assert.match(found.note, /no transcript/);
  });

  it('turns a project path into the desktop app slug', () => {
    assert.equal(projectSlug('/Users/me/projects/motor-fix'), '-Users-me-projects-motor-fix');
    assert.equal(projectSlug('/Users/me/motor-fix/.worktrees/693-x'), '-Users-me-motor-fix--worktrees-693-x');
  });
});
