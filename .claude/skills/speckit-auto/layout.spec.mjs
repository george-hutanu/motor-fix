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
  ['starts its first line with the UTC minute `YYYY-MM-DD HH:MM`', 'SKILL.md'],
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
  ['`post-edit-check.sh` answers a red-first spec', 'phases-build.md'],
  ["Step 2's checklist count asks nothing", 'phases-build.md'],
  ['Batch the independent tool calls of `[P]` tasks', 'phases-build.md'],
  ['Loop limit: 2 converge cycles', 'phases-build.md'],
  ['A suppression is never the fix', 'phases-build.md'],
  ['Mutation testing is not part of this phase', 'phases-build.md'],
  ['dispatches no Mutation workflow run and waits for none', 'phases-build.md'],
  ['no Mutation run dispatched or waited for', 'report.md'],
  ['A finding that needs a behavior change is Hard Stop 7', 'phases-build.md'],
  // phases-close.md: phases 13-17
  ['An empty refresh is a complete phase', 'phases-close.md'],
  ['New evidence is reported, never built.', 'phases-close.md'],
  ['must exist. The `after_specify` and `before_implement` hooks write it', 'phases-close.md'],
  ['`verified` or `use a workflow`', 'phases-close.md'],
  ['CRITICAL/HIGH findings that survive the re-review block completion', 'phases-close.md'],
  ['One read-only command, with the same `<start-commit>` the Final Report quotes', 'phases-close.md'],
  ['`--since` is not optional.', 'phases-close.md'],
  // commit-protocol.md
  ['One Conventional Commit per implementation slice', 'commit-protocol.md'],
  ['Never merge mid-run', 'commit-protocol.md'],
  ['A red suite is not committed.', 'commit-protocol.md'],
  ['Behavior commits must move the spec.', 'commit-protocol.md'],
  ['Traceability is read from `// @traces` lines, never a commit gate.', 'commit-protocol.md'],
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
  ["Retrospective evidence (unjudged): the command's output verbatim", 'report.md'],
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
  ['precheck.mjs --flows', 'hand-off.md'],
  ['handoff.md', 'hand-off.md'],
  ['dispatch the tail yourself', 'hand-off.md'],
  ['ci-wait.mjs <n> --run <id>', 'tail.md'],
  ['watch.mjs claim <worktree> tail', 'tail.md'],
  ['QA run only', 'tail.md'],
  ['NEXT: merge #<n> after CI', 'tail.md'],
  ['watch.mjs claim <worktree> merge', 'tail.md'],
  ['does not hold the review', 'tail.md'],
  ['merge-main.mjs', 'tail.md'],
  ['run_in_background', 'tail.md'],
  ['/speckit-pr-test <n>', 'tail.md'],
  ['run-state.mjs repair', 'tail.md'],
  ['--missing', 'tail.md'],
  ['RUN', 'tail.md'],
  ['stays on Opus', 'tail.md'],
  ["tracker's `finish`", 'tail.md'],
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
  ['Jira', 'the tracker is GitHub issues'],
  ['`mutation-runner` per touched package', 'mutation runs only in CI'],
  ['instincts.mjs triggered', 'instincts left the auto chain'],
  ['retro-evidence.mjs --since <start-commit> --jev', 'phase 16 runs without the Jev lane'],
  ['`agent-context`,', 'phase 15 left the story path'],
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

  // @traces 1344-FR-002
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

// The text each preflight and archive rule puts in a skill, template or agent, where a run reads it.
describe('the preflight and archive text lands where the run reads it', () => {
  const root = join(dir, '..', '..', '..');
  const at = (path) => flat(readFileSync(join(root, path), 'utf8'));
  const has = (path, ...phrases) => {
    const text = at(path);
    for (const phrase of phrases) assert.ok(text.includes(phrase), `${path} lacks: ${phrase}`);
  };

  // @traces 1358-FR-001 1358-FR-002
  it('preflight picks the suite from the environment and logs it; Hard Stop 2 names it', () => {
    has('.claude/skills/speckit-auto/preflight.md',
      'SUITE=$([ -n "$DATABASE_URL" ] && [ -n "$REDIS_URL" ] && echo test || echo test:unit)',
      '`Preflight suite: unit <sha7>` or `Preflight suite: full <sha7>`',
      'so it runs and logs `full`');
    has('.claude/skills/speckit-auto/SKILL.md', 'the stop naming the suite that ran (`unit` or `full`');
  });

  // @traces 1358-FR-003 1358-FR-005
  it('phase 1 uses the preflight grep; phase 2 validates the Spec Delta', () => {
    has('.claude/skills/speckit-auto/preflight.md', "grep -nE '^\\*\\*Version\\*\\*|\\[[A-Z_]+\\]' .specify/memory/constitution.md");
    has('.claude/skills/speckit-auto/phases-plan.md', "use the preflight grep's result", 'node .claude/scripts/capabilities.mjs validate --check');
  });

  // @traces 1358-FR-004 1358-FR-007
  it('the spec template carries the Spec Delta and the spec reviewer judges it', () => {
    has('.specify/templates/spec-template.md', '## Spec Delta', 'project-local addition', '- **Modifies**:');
    has('.claude/agents/spec-reviewer.md', 'is a Modifies naming that requirement in the `## Spec Delta`, not an Adds.');
  });

  // @traces 1358-FR-008 1358-FR-013
  it('specify reads the GitHub story; archive reads the diff and leaves the retro manual', () => {
    has('.claude/skills/speckit-specify/SKILL.md', 'gh issue view <n> --repo george-hutanu/motor-fix-specs --comments', 'the Jira and Figma steps (0 and 0b) are cut');
    has('.claude/skills/speckit-archive/SKILL.md', 'read `git diff -- .specify/capabilities/`', '`/speckit-retro` is manual only in the `/speckit-auto` chain');
  });
});

describe('the refresh gate and closer text lands where the run reads it', () => {
  const root = join(dir, '..', '..', '..');
  const at = (path) => flat(readFileSync(join(root, path), 'utf8'));
  const has = (path, ...phrases) => {
    const text = at(path);
    for (const phrase of phrases) assert.ok(text.includes(phrase), `${path} lacks: ${phrase}`);
  };

  // @traces 1360-FR-004
  it('phase 13 runs the model-free gate before any researcher', () => {
    has('.claude/skills/speckit-auto/phases-close.md',
      'Run `node .claude/scripts/context-refresh-gate.mjs specs/<feature>` first.',
      'append `## Refresh <UTC time>` and `gate: no change` to `context.md`, log it, and run no `speckit-context`.',
      '`dispatch <reason>`: log the reason in `auto-run.md` and invoke `speckit-context --since`.');
  });

  // @traces 1360-FR-010 1360-FR-014 1360-FR-015
  it('stops a level-1 story after harden and keeps levels 2 and 3 in one agent', () => {
    has('.claude/skills/speckit-auto/SKILL.md',
      '| 1 one-session | 2, 7, 9, 10, 12, then a closer: 14, 16',
      'Levels 2 and 3 keep one agent from preflight through the hand-off',
      '`converge`, `harden`, `closer`, `refresh`');
    has('.claude/skills/speckit-auto/phases-close.md',
      '## Level 1: the stop after harden',
      '`## Decisions for the closer`', '`### Gates self-answered`', '`### Deviations`', '`### Open items`',
      'node .claude/scripts/run-state.mjs set --status in-progress --phase closer',
      'the PR stays a draft', '`NEXT: resume <feature>`',
      'A cloud session (`CLAUDE_CODE_REMOTE=true`) does not split');
  });

  // @traces 1360-FR-013 1360-FR-015
  it('gives the closer its reading list, its first act and who dispatches it', () => {
    has('.claude/skills/speckit-auto/phases-close.md',
      '## The closer',
      'First act: `node .claude/scripts/run-state.mjs set --status in-progress --phase refresh`',
      '`auto-run.md` with its `## Decisions for the closer`, `spec.md`, `tasks.md`, `node .claude/scripts/run-state.mjs show`, `git log --oneline <start>..HEAD`',
      'the phases the level owes from 13 on and the hand-off');
    has('.claude/skills/speckit-auto/preflight.md', '`watch.mjs claim <worktree> resume`', 'as the closer');
    has('.claude/skills/speckit-auto/lifecycle.md', "A level-1 story's agent ends at phase 12 and a closer");
    has('.claude/skills/speckit-auto/hand-off.md', 'runs the hand-off, or on level 1 the closer');
    has('.claude/skills/speckit-watch/SKILL.md', 'At run-state phase `closer`');
    has('.claude/skills/speckit-auto/report.md', '`NEXT: resume <feature>`');
  });

  // @traces 1360-FR-006 1360-FR-008
  it('phase 15 is retired to the session start and phase 16 runs one command', () => {
    has('.claude/skills/speckit-auto/SKILL.md',
      '| 15 | Agent context (retired) | none: the session start runs the context-file audit |',
      'Phases 13 and 16 run beside phase 14\'s reviewers');
    has('.claude/skills/speckit-auto/phases-close.md',
      'Nothing runs here. The SessionStart hook (`session-context.mjs`) runs the context-file audit',
      'node .claude/scripts/retro-evidence.mjs --since <start-commit>\n'.trim(),
      'learn, evolve and `instincts.mjs` run by hand, outside the chain');
    assert.ok(!at('.claude/skills/speckit-auto/phases-close.md').includes('--jev'));
  });

  // @traces 1360-FR-005
  it('speckit-context stamps Gathered with the time and the specs trunk sha, and finds the epic by its title', () => {
    has('.claude/skills/speckit-context/SKILL.md',
      '- **Gathered**: <UTC ISO 8601 time to the second> · specs trunk <sha>',
      'Gathered: <UTC time> · specs trunk <sha>.',
      'gh issue list -R $R --label epic --state all --search "EP-<k> in:title" --json number,title',
      'an epic carries `epic`, not its own `EP-<k>`');
  });
});
