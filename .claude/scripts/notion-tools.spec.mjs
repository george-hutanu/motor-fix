import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The Notion connector's tool names carry the server id it was connected
// under, and that id differs per machine and per account. An agent whose
// frontmatter names only another machine's id gets no Notion tools at all and
// says nothing about it — every build agent on 2026-10-04 wrote context.md by
// hand because org-researcher could not reach Notion. These checks keep the
// agents and the permission allowlist naming the same connectors, this
// machine's included.

const root = join(import.meta.dirname, '..', '..');
const read = (rel) => readFileSync(join(root, rel), 'utf8');

const agentTools = (name) => {
  const line = read(`.claude/agents/${name}.md`).match(/^tools:\s*(.+)$/m)?.[1] ?? '';
  return line.split(',').map((t) => t.trim()).filter(Boolean);
};
const allowed = () => JSON.parse(read('.claude/settings.json')).permissions.allow;

const notion = (tools) => tools.filter((t) => /^mcp__.+__notion-/.test(t));
const server = (tool) => tool.match(/^mcp__(.+)__notion-/)[1];
const servers = (tools) => [...new Set(notion(tools).map(server))].sort();

// The connector this machine's Claude Code sessions expose Notion under.
const LOCAL = '828510aa-7547-4d43-8807-be1f9e5d3a0f';
const READS = ['notion-search', 'notion-fetch', 'notion-get-comments'];

describe('Notion tools the agents can reach', () => {
  it('names the same connectors in both agents and in the permission allowlist', () => {
    const expected = servers(allowed());
    assert.deepEqual(servers(agentTools('org-researcher')), expected);
    assert.deepEqual(servers(agentTools('spec-reviewer')), expected);
  });

  it("includes this machine's connector", () => {
    assert.ok(servers(allowed()).includes(LOCAL), `settings.json allows no mcp__${LOCAL}__notion-* tool`);
  });

  it('gives every connector the read tools each agent needs', () => {
    for (const agent of ['org-researcher', 'spec-reviewer']) {
      const tools = new Set(agentTools(agent));
      for (const id of servers(allowed()))
        for (const read of READS) assert.ok(tools.has(`mcp__${id}__${read}`), `${agent} lacks mcp__${id}__${read}`);
    }
  });

  it('keeps both agents read-only toward Notion', () => {
    for (const agent of ['org-researcher', 'spec-reviewer']) {
      const writes = notion(agentTools(agent)).filter((t) => /__notion-(create|update|move|delete|duplicate|upload)/.test(t));
      assert.deepEqual(writes, [], `${agent} must not hold a Notion write tool`);
    }
  });
});
