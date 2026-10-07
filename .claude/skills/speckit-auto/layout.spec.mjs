import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Every story agent loads SKILL.md on every turn, so it holds only the run
// order, the contract and the stops; each phase's detail sits in a reference
// file read at the point the run reaches it. The inventory below is the rule
// list of the single-file skill: each rule must survive the split exactly
// once, in the file where it applies, and no gate's phrase may be lost.

const dir = import.meta.dirname;
const FILES = [
  'SKILL.md',
  'preflight.md',
  'phases-plan.md',
  'phases-build.md',
  'phases-close.md',
  'commit-protocol.md',
  'hand-off.md',
  'tail.md',
  'report.md',
];
const SKILL_BUDGET = 15000;

const flat = (text) => text.replace(/\s+/g, ' ');
const read = (name) => {
  const path = join(dir, name);
  return existsSync(path) ? flat(readFileSync(path, 'utf8')) : '';
};
const count = (text, phrase) => text.split(phrase).length - 1;

// [phrase, file it belongs in]. Each phrase occurs once in the whole layout.
const RULES = [
  // SKILL.md: contract, sizing, run state, stops, notifying, report envelope.
  ['Never wait for the user.', 'SKILL.md'],
  ['The recommendation is the answer.', 'SKILL.md'],
  ['Assumptions are written down, not held in memory.', 'SKILL.md'],
  ['Hook prompts are yes.', 'SKILL.md'],
  ['A blocked tool call is an instruction, not a question.', 'SKILL.md'],
  ['Finish the run.', 'SKILL.md'],
  ['A level chooses phases, never gates.', 'SKILL.md'],
  ['Use exactly these phase names:', 'SKILL.md'],
  ['Conditions: `dirty-tree`, `red-suite`', 'SKILL.md'],
  ['Five laps without convergence is not one lap away', 'SKILL.md'],
  ['This list is exhaustive', 'SKILL.md'],
  ['Empty feature description.', 'SKILL.md'],
  ['The same test failing after 3 distinct fix attempts', 'SKILL.md'],
  ['A scope change only the user can decide', 'SKILL.md'],
  ['On any hard stop the run log and every commit already made stay in place', 'SKILL.md'],
  ['Call `PushNotification`', 'SKILL.md'],
  ['at most 10 lines in all', 'SKILL.md'],
  ['the phase skill wins; when they disagree on whether to stop and ask, this file wins', 'SKILL.md'],
  ['After a context compaction, re-read', 'SKILL.md'],
  // preflight.md
  ['the tree MUST be clean', 'preflight.md'],
  ['the repo MUST start green', 'preflight.md'],
  ['This is the one time the full suite runs', 'preflight.md'],
  ['know the drift baseline before you start moving code', 'preflight.md'],
  ['`CronList` first, so it never doubles up', 'preflight.md'],
  ['never a re-read of those files', 'preflight.md'],
  // phases-plan.md: phases 1-8
  ['Do **not** invoke `/speckit-constitution`', 'phases-plan.md'],
  ['marked `(autonomous default)`', 'phases-plan.md'],
  ['The overwrite prompt is answered **overwrite**', 'phases-plan.md'],
  ['The story remains the only source of scope', 'phases-plan.md'],
  ['log all five question/answer pairs together', 'phases-plan.md'],
  ['Watch the import-extension rule', 'phases-plan.md'],
  ['drive it to zero unchecked items', 'phases-plan.md'],
  ['Its `after_tasks` hook dispatches `speckit.analyze`', 'phases-plan.md'],
  ['Treat a linter ERROR exactly as a CRITICAL analyze finding', 'phases-plan.md'],
  ['Loop limit: 2 re-runs', 'phases-plan.md'],
  // phases-build.md: phases 9-12
  ['No internal identifier goes into the source', 'phases-build.md'],
  ['Tests that pass before any implementation exist are not red-first', 'phases-build.md'],
  ['Expect `post-edit-check.sh` to report failures', 'phases-build.md'],
  ["Step 2's checklist gate", 'phases-build.md'],
  ['Batch the independent tool calls of `[P]` tasks', 'phases-build.md'],
  ['Loop limit: 2 converge cycles', 'phases-build.md'],
  ['A suppression is never the fix', 'phases-build.md'],
  ['Mutation testing is not part of this phase', 'phases-build.md'],
  ['A finding that needs a behavior change is Hard Stop 7', 'phases-build.md'],
  // phases-close.md: phases 13-17
  ['An empty refresh is a complete phase', 'phases-close.md'],
  ['New evidence is reported, never built.', 'phases-close.md'],
  ['must exist. The `after_specify` and `before_implement` hooks write it', 'phases-close.md'],
  ['`verified` or `use a workflow`', 'phases-close.md'],
  ['CRITICAL/HIGH findings that survive the re-review block completion', 'phases-close.md'],
  ['The active plan is not written into a tracked file', 'phases-close.md'],
  ['retro-evidence.mjs --since <start-commit> --jev', 'phases-close.md'],
  ['instincts.mjs triggered --since <start-commit>', 'phases-close.md'],
  ['`--since` is not optional.', 'phases-close.md'],
  // commit-protocol.md
  ['One Conventional Commit per implementation slice', 'commit-protocol.md'],
  ['Never merge mid-run', 'commit-protocol.md'],
  ['A red suite cannot be committed.', 'commit-protocol.md'],
  ['Behavior commits must move the spec.', 'commit-protocol.md'],
  ['Traceability is reported, not tagged in code.', 'commit-protocol.md'],
  ['are never forced in', 'commit-protocol.md'],
  // hand-off.md
  ['This run ends here', 'hand-off.md'],
  ['Start the QA run, beside CI, and do not wait for it.', 'hand-off.md'],
  ['A run that ends on a Hard Stop before the hand-off does none of this', 'hand-off.md'],
  // tail.md: the wait and the tail
  ['No agent is alive while CI and the QA run work.', 'tail.md'],
  ['it stays on Opus', 'tail.md'],
  ['it never waits on either', 'tail.md'],
  ['**An unusable run**', 'tail.md'],
  ['**A failing lap**', 'tail.md'],
  ['None of these steps asks the user.', 'tail.md'],
  ['A PR with no checks, or one still failing at the limit, is a Hard Stop', 'tail.md'],
  // report.md: the report's sections and the completion checklist
  ["Phases run, with each one's outcome in a line.", 'report.md'],
  ['Retrospective evidence (unjudged): both command outputs verbatim', 'report.md'],
  ['Red-first proven before implementation', 'report.md'],
  ['No Stryker disable added', 'report.md'],
];

// Phrases the other harness specs grep for, and the file they read.
const GATES = [
  // tail-handoff-wiring.spec.mjs
  ['dispatch.mjs <n> --no-wait', 'hand-off.md'],
  ['- QA run: <id> · head <sha> · lap <n> · <url>', 'hand-off.md'],
  ['NEXT: tail #<n> after QA run <id>', 'hand-off.md'],
  ['.specify/.cache/qa-flows-<n>.mjs', 'hand-off.md'],
  ['handoff.md', 'hand-off.md'],
  ['dispatch the tail yourself', 'hand-off.md'],
  ['gh pr checks <n> --watch', 'tail.md'],
  ['gh run watch <id>', 'tail.md'],
  ['watch.mjs claim <worktree> tail', 'tail.md'],
  ['run_in_background', 'tail.md'],
  ['/speckit-pr-test <n>', 'tail.md'],
  ['run-state.mjs repair', 'tail.md'],
  ['--missing', 'tail.md'],
  ['RUN', 'tail.md'],
  ['stays on Opus', 'tail.md'],
  ['Notion `finish`', 'tail.md'],
  // lifecycle-wiring.spec.mjs
  ['node .claude/scripts/lifecycle.mjs ready --body-file', 'hand-off.md'],
  ['node .claude/scripts/lifecycle.mjs merge --pr <n>', 'tail.md'],
  // phase-dispatch.spec.mjs: the lead before phase 0, and the pinned phases
  ['phases 2, 5, 6 and 7', 'SKILL.md'],
  ['subagent_type: task-runner', 'SKILL.md'],
  ['run_in_background: false', 'SKILL.md'],
  ['pin miss', 'SKILL.md'],
  ['Phase agent: `model: fable`.', 'phases-plan.md'],
  ['Phase agent: `model: sonnet`.', 'phases-plan.md'],
  // task-runner.spec.mjs
  ['subagent_type: task-runner', 'preflight.md'],
  ['subagent_type: task-runner', 'tail.md'],
  ['constitution-card.md', 'preflight.md'],
  ['constitution-card.md', 'phases-plan.md'],
  // agent-replies.spec.mjs
  ['STATUS: success | failure | blocked | partial — <one line: what happened>', 'SKILL.md'],
  ['auto-run.md', 'SKILL.md'],
  ['envelope', 'SKILL.md'],
];

const FORBIDDEN = [
  ['general-purpose', 'task-runner.spec.mjs'],
  ['apps/server', 'stale app name'],
  ['apps/client', 'stale app name'],
  ['git-excluded', 'specs/ is tracked'],
  ['.git/info/exclude', 'specs/ is tracked'],
  ['Jira', 'the tracker is Notion'],
  ['`mutation-runner` per touched package', 'mutation runs only in CI'],
];

describe('speckit-auto layout', () => {
  const texts = Object.fromEntries(FILES.map((f) => [f, read(f)]));
  const all = Object.values(texts).join('\n');

  it('keeps every reference file beside SKILL.md', () => {
    for (const f of FILES) assert.ok(existsSync(join(dir, f)), `${f} is missing`);
  });

  it('keeps SKILL.md within its byte budget', () => {
    const bytes = statSync(join(dir, 'SKILL.md')).size;
    assert.ok(bytes <= SKILL_BUDGET, `SKILL.md is ${bytes} bytes, budget ${SKILL_BUDGET}`);
  });

  it('points SKILL.md at every reference file', () => {
    for (const f of FILES.slice(1)) assert.ok(texts['SKILL.md'].includes(f), `SKILL.md never names ${f}`);
  });

  it('gives every phase 0-17 one row in the run order, naming where its detail lives', () => {
    const skill = readFileSync(join(dir, 'SKILL.md'), 'utf8');
    for (let n = 0; n <= 17; n++) {
      const rows = skill.split('\n').filter((l) => l.startsWith(`| ${n} |`));
      assert.equal(rows.length, 1, `phase ${n}: ${rows.length} rows`);
      assert.match(rows[0], /[\w-]+\.md/, `phase ${n} names no file`);
    }
  });

  it('keeps every rule exactly once, in the file it applies to', () => {
    const lost = [];
    for (const [phrase, file] of RULES) {
      const n = count(all, phrase);
      if (n !== 1 || !texts[file].includes(phrase)) lost.push(`${file}: "${phrase}" (x${n})`);
    }
    assert.deepEqual(lost, []);
  });

  it('keeps every phrase a gate reads where the gate reads it', () => {
    const lost = GATES.filter(([phrase, file]) => !texts[file].includes(phrase));
    assert.deepEqual(lost, []);
  });

  it('carries none of the stale or forbidden text', () => {
    const found = FORBIDDEN.filter(([phrase]) => all.includes(phrase));
    assert.deepEqual(found, []);
  });
});
