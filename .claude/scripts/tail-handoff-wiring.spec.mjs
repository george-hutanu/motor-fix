import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The hand-off and the finish log are prose in skills. These checks keep it
// wired: a story's agent ends at ready with a note and `NEXT: tail`, a fresh
// tail agent takes the PR from there, and a feature's records ride in its own
// PR, with what follows the merge in a comment on it, never a docs PR.

const root = join(import.meta.dirname, '..', '..');
const read = (rel) => readFileSync(join(root, rel), 'utf8');
const section = (text, heading) => {
  const start = text.indexOf(heading);
  assert.notEqual(start, -1, `no "${heading}" section`);
  const next = text.indexOf('\n## ', start + heading.length);
  return text.slice(start, next === -1 ? undefined : next);
};

// speckit-auto keeps the hand-off and the tail beside SKILL.md, read when the run reaches them.
const auto = ['hand-off.md', 'tail.md'].map((f) => read(`.claude/skills/speckit-auto/${f}`)).join('\n');

describe('the hand-off', () => {

  it('ends the story agent at ready with a hand-off note and NEXT: tail', () => {
    const handoff = section(auto, '## Hand-off');
    assert.match(handoff, /lifecycle\.mjs ready --body-file/);
    assert.match(handoff, /Notion\s+`qa`/);
    assert.match(handoff, /handoff\.md/);
    assert.match(handoff, /NEXT: tail #<n>/);
    // Run in the owner's session, nobody reads that NEXT: the run sends its own tail.
    assert.match(handoff, /dispatch the tail yourself/);
    assert.doesNotMatch(handoff, /gh pr merge|lifecycle\.mjs merge/);
  });

  it('gives the tail lifecycle steps 5-7, on the default model', () => {
    const tail = section(auto, '## The tail');
    for (const step of [/run_in_background/, /\/speckit-pr-test <n>/, /run-state\.mjs repair/, /lifecycle\.mjs merge --pr <n>/, /Notion `finish`/, /notion-ready|archive check/])
      assert.match(tail, step);
    assert.match(tail, /stays on Opus/);
    assert.doesNotMatch(tail, /model: "sonnet"/);
  });

  it('is dispatched by the watcher as its tail fix', () => {
    const watch = read('.claude/skills/speckit-watch/SKILL.md');
    assert.match(watch, /\| `tail` \|/);
    assert.match(watch, /`tail`, `rerun-qa` and\s+`fix-ci` write or judge code and keep the default model/);
  });

  it('is stated in AGENTS.md, and the note never reaches git', () => {
    const agents = read('AGENTS.md');
    assert.match(agents, /tail agent/);
    assert.match(agents, /NEXT: tail #<n>/);
    execFileSync('git', ['check-ignore', '--no-index', '-q', 'specs/901-x/handoff.md'], { cwd: root });
  });
});

describe('the finish log rides in the story PR', () => {
  it('commits the log before ready and comments it on the PR after the merge', () => {
    const step = section(read('.claude/skills/speckit-notion-sync/SKILL.md'), '## 3. Record it');
    assert.match(step, /gh pr comment/);
    assert.match(step, /Before the merge/);
    assert.match(step, /After the merge/);
  });

  it('archives on the branch and checks the PR comments after the merge', () => {
    const phase = section(read('.claude/skills/speckit-archive/SKILL.md'), '## Phase 4');
    assert.match(phase, /before its PR goes ready/);
    assert.match(phase, /gh pr view <n> --json comments/);
    assert.match(phase, /notion-ready\.mjs check -/);
  });

  it('commits a retrospective on the open PR, and only a failing QA lap report', () => {
    assert.match(read('.claude/skills/speckit-retro/SKILL.md'), /rides in that PR/);
    assert.match(section(read('.claude/skills/speckit-pr-test/SKILL.md'), '## Evidence'), /passing lap's is not\s+committed/);
  });
});

describe('no agent holds its context across the CI and QA wait', () => {
  const steps = (text) => text.split(/\n(?=\d+\. )/);

  it('starts the QA run at hand-off without waiting, records it in the note and ends', () => {
    const handoff = section(auto, '## Hand-off');
    assert.match(handoff, /dispatch\.mjs <n> --no-wait/);
    assert.match(handoff, /- QA run: <id> · head <sha> · lap <n> · <url>/);
    assert.match(handoff, /NEXT: tail #<n> after QA run <id>/);
    assert.match(handoff, /\.specify\/\.cache\/qa-flows-<n>\.mjs/);
    assert.doesNotMatch(handoff, /--watch|gh run watch/);
  });

  it('lets the session, not an agent, hold the one background wait before the tail', () => {
    const wait = section(auto, '## The wait');
    assert.match(wait, /run_in_background/);
    assert.match(wait, /gh pr checks <n> --watch/);
    assert.match(wait, /gh run watch <id>/);
    assert.match(wait, /watch\.mjs claim <worktree> tail/);
  });

  it('runs the tester on the finished run, and ends a fix lap with a new run instead of waiting', () => {
    const tail = section(auto, '## The tail');
    assert.match(tail, /RUN/);
    assert.match(tail, /--no-wait/);
    assert.match(tail, /run-state\.mjs repair/);
    assert.match(tail, /NEXT: tail #<n> after QA run <id>/);
    assert.match(tail, /--missing/);
    // The only wait a tail holds is CI on a docs-only head, which runs two short jobs.
    for (const step of steps(tail).filter((s) => /--watch|gh run watch/.test(s))) assert.match(step, /docs-only/);
  });
});
