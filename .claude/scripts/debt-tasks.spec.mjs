import { afterEach, describe, it, vi } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { main, markFiled, parseDeferred, taskFor } from './debt-tasks.mjs';

const DEFERRED = `# Deferred — feature

Verified findings that are real but not this change.

- [ ] \`.claude/scripts/pr-test/post.mjs:125\` — **medium** — \`--add\` writes the merged findings back (pr-tester lap 1 on PR #21, 2026-10-04).
- [ ] \`.claude/hooks/merge-gate.mjs\` — **low** — a merge through graphql is not gated (pr-tester lap 1). — Notion: https://app.notion.com/p/abc123
- [x] \`scripts/old.ts:3\` — **low** — already fixed (code-reviewer).
- LOW (code-reviewer): \`scripts/test-suites.spec.ts\` proves the split only for two projects.
- MEDIUM decision (code-reviewer): \`pull_request\` keeps its default types.
- \`.claude/scripts/artifact-lint.spec.mjs\` › diff-audit tests time out at 5 s locally: not touched by this change.
  A continuation line that belongs to the bullet above.
`;

const ctx = {
  story: 'https://app.notion.com/p/3ef607bff0d2812185effb0ff2095302',
  epic: 'https://app.notion.com/p/3ee607bff0d281188cb4c6724bd45707',
  pr: 'https://github.com/george-hutanu/motor-fix/pull/21',
  storyId: 'ST-434',
};

describe('reading deferred.md', () => {
  const entries = parseDeferred(DEFERRED);

  it('reads every bullet as one entry, whatever its wording', () => {
    assert.equal(entries.length, 6);
  });

  it('takes the severity, the place and the reviewer from the line', () => {
    assert.deepEqual(
      entries.map((e) => [e.severity, e.where, e.reviewer]),
      [
        ['medium', '.claude/scripts/pr-test/post.mjs:125', 'pr-tester'],
        ['low', '.claude/hooks/merge-gate.mjs', 'pr-tester'],
        ['low', 'scripts/old.ts:3', 'code-reviewer'],
        ['low', 'scripts/test-suites.spec.ts', 'code-reviewer'],
        ['medium', 'pull_request', 'code-reviewer'],
        ['low', '.claude/scripts/artifact-lint.spec.mjs', 'review'],
      ],
    );
  });

  it('knows which are already filed or resolved', () => {
    assert.equal(entries[1].notion, 'https://app.notion.com/p/abc123');
    assert.equal(entries[2].done, true);
    assert.deepEqual(entries.filter((e) => e.pending).map((e) => e.line), [entries[0].line, entries[3].line, entries[4].line, entries[5].line]);
  });
});

describe('the Notion task for a debt', () => {
  const [entry] = parseDeferred(DEFERRED);

  it('is a To do Task in MotorFix stories, with the epic, and a priority from the severity', () => {
    const t = taskFor(entry, ctx);
    assert.equal(t.properties['Issue type'], 'Task');
    assert.equal(t.properties.Status, 'To do');
    assert.equal(t.properties.Role, 'System');
    assert.equal(t.properties.Priority, 'Medium');
    assert.deepEqual(JSON.parse(t.properties.Epic), [ctx.epic]);
    assert.match(t.properties.Story, /^Tech debt \(ST-434\): /);
    assert.ok(t.properties.Story.length <= 120);
  });

  it('carries the severity, the place, the reviewer, the PR and the story it came from', () => {
    const t = taskFor(entry, ctx);
    for (const piece of ['medium', '.claude/scripts/pr-test/post.mjs:125', 'pr-tester', ctx.pr, ctx.story]) assert.ok(t.content.includes(piece), piece);
  });

  it('adds the feature relation only when one is known', () => {
    assert.equal(taskFor(entry, ctx).properties.Feature, undefined);
    assert.deepEqual(JSON.parse(taskFor(entry, { ...ctx, feature: 'https://app.notion.com/p/f1' }).properties.Feature), ['https://app.notion.com/p/f1']);
  });
});

describe('writing the task back', () => {
  it('appends the Notion URL to that line only, so a re-run files nothing twice', () => {
    const entries = parseDeferred(DEFERRED);
    const next = markFiled(DEFERRED, entries[0].line, 'https://app.notion.com/p/new1');
    const again = parseDeferred(next);
    assert.equal(again[0].notion, 'https://app.notion.com/p/new1');
    assert.equal(again[0].pending, false);
    assert.equal(next.split('\n').length, DEFERRED.split('\n').length);
    assert.equal(markFiled(next, entries[0].line, 'https://app.notion.com/p/other'), next);
  });
});

describe('the command line', () => {
  const dirs = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('plans the pending tasks as JSON and marks one filed', () => {
    const dir = mkdtempSync(join(tmpdir(), 'debt-'));
    dirs.push(dir);
    const file = join(dir, 'deferred.md');
    writeFileSync(file, DEFERRED);
    const out = [];
    vi.spyOn(console, 'log').mockImplementation((line) => out.push(line));
    assert.equal(main(['plan', file, '--story', ctx.story, '--epic', ctx.epic, '--pr', ctx.pr, '--id', 'ST-434']), 0);
    const plan = JSON.parse(out.at(-1));
    assert.equal(plan.length, 4);
    assert.equal(main(['mark', file, '--line', String(plan[0].line), '--url', 'https://app.notion.com/p/n1']), 0);
    assert.match(readFileSync(file, 'utf8'), /post\.mjs:125.*Notion: https:\/\/app\.notion\.com\/p\/n1/);
    out.length = 0;
    main(['plan', file, '--story', ctx.story, '--epic', ctx.epic, '--pr', ctx.pr, '--id', 'ST-434']);
    assert.equal(JSON.parse(out.at(-1)).length, 3);
  });
});
