import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel) => readFileSync(fileURLToPath(new URL(`../../../${rel}`, import.meta.url)), 'utf8');
const agent = read('.claude/agents/pr-tester.md');
const skill = read('.claude/skills/speckit-pr-test/SKILL.md');
const PACKET = 'node .claude/scripts/pr-test/packet.mjs';

/** `## ` sections of a Markdown file: [{ heading, body }]. */
const sections = (md) =>
  md
    .split(/^## /m)
    .slice(1)
    .map((s) => ({ heading: s.split('\n')[0], body: s }));
const section = (md, re) => sections(md).find((s) => re.test(s.heading))?.body ?? '';

describe('the tester starts from the packet', () => {
  it('builds it once the run is downloaded, into the same folder', () => {
    assert.ok(agent.includes(PACKET), 'the agent runs packet.mjs');
    assert.match(agent, new RegExp(`${PACKET.replaceAll('.', '\\.')} --pr <PR> --out <scratchpad>/pr-<PR>-lap<LAP>`));
    const dispatchAt = agent.indexOf('node .claude/scripts/pr-test/dispatch.mjs');
    assert.ok(dispatchAt >= 0 && dispatchAt < agent.indexOf(PACKET), 'the packet comes after the download');
  });

  it('reads packet.md before the report, the screenshots, the spec and the diff', () => {
    const review = section(agent, /Review/);
    assert.match(review, /packet\.md/);
    const first = review.indexOf('packet.md');
    for (const later of ['report.json', 'shots/', 'spec.md', 'constitution']) {
      const at = review.indexOf(later);
      assert.ok(at > first, `${later} is read after the packet`);
    }
  });

  it('opens only the screenshots the packet names, not the whole set', () => {
    const review = section(agent, /Review/);
    assert.match(review, /only\s+the\s+screenshots\s+the\s+packet\s+(names|lists)/);
    assert.doesNotMatch(review, /screenshots of every viewport/);
  });

  it('reads the review diff the packet wrote instead of its own diff, report and spec', () => {
    const review = section(agent, /Review/);
    assert.match(review, /<out>\/review\.diff/);
    assert.match(review, /replaces your own\s+reading of the report, the spec and the diff/);
  });

  it('gives the findings file its shape, so the tester never reads post.mjs for it', () => {
    const post = section(agent, /Post/);
    assert.match(post, /"kind": "review"/);
    assert.match(post, /"severity":\s+"blocker" \| "high" \| "medium" \| "low"/);
  });

  it('no longer reads the whole diff up front', () => {
    const change = section(agent, /Read the change/);
    assert.doesNotMatch(change, /^gh pr diff <PR>$/m);
  });

  it('keeps Opus, the full constitution review, the verdict rules and post.mjs', () => {
    assert.match(agent.split('---')[1], /^model: opus$/m);
    const review = section(agent, /Review/);
    assert.match(review, /\.specify\/memory\/constitution\.md/);
    assert.match(review, /Principle I/);
    assert.match(review, /III–VII/);
    assert.match(review, /`high`/);
    assert.ok(agent.includes('node .claude/scripts/pr-test/post.mjs --report <out>/report.json'));
    assert.match(agent, /^VERDICT: success \| failure$/m);
  });
});

describe('the skill names the packet step', () => {
  it('in its Test step', () => {
    const test = section(skill, /Procedure/).split(/^\d+\. \*\*/m).find((s) => s.startsWith('Test'));
    assert.ok(test, 'the Test step exists');
    assert.match(test, /packet\.mjs/);
    assert.match(test, /packet\.md/);
  });
});

describe('the merge gate and the carry do not depend on the packet', () => {
  it('neither reads it', () => {
    for (const rel of ['.claude/hooks/merge-gate.mjs', '.claude/scripts/pr-test/carry.mjs']) {
      assert.doesNotMatch(read(rel), /packet/, `${rel} stays independent of the packet`);
    }
  });
});
