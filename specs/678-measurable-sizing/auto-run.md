# /speckit-auto run log: 678-measurable-sizing

Story: ST-678, Make /speckit-size measurable and self-correcting
(https://app.notion.com/p/3f0607bff0d2817d8a94d9a31fa161b4). Taken: Notion
Status was To do, no branch or worktree held 678.

Start: origin/main 621cb20, branch 678-measurable-sizing, worktree
.worktrees/678-measurable-sizing. Run as a dispatched task-runner (Opus).

## Preflight

- Rules diff `git diff 4492f18 origin/main -- AGENTS.md`: empty.
- Tree clean; typecheck, lint green; `npm run test` red only on domain
  integration specs (no database in the worktree: DATABASE_URL unset). Rerun
  of `domain:test` against the worktree's own services
  (`scripts/test-services.ts`): 87/87 suites, 2661/2661 tests. Start is green.
- Deviation: `npm install` for the fresh worktree ran outside `scripts/heavy.sh`.

## 0. Size

`level.mjs suggest … --set`: level 2 (classifier, 0.80, "touches token"),
recorded for next; carried onto the feature by `level.mjs point`.

## 1. Constitution

v1.8.1, no placeholders. Card read.

## 2. Specify

Phase agent task-runner, model fable. STATUS: success — 16 FRs, 4 stories,
Spec Delta against `platform`; open numbers recorded as autonomous-default
assumptions (FR threshold >5, story points >5, promotion target 2).

## 3. Org context

org-researcher dispatched without Notion tools (STATUS blocked). Story read by
the run through the connector; context.md written from it. Differences: the
ST-662 debt tasks stay out of scope; part 3 sits in the ready step.

## 4. Clarify

spec-challenger: 8 findings. Answered 5 as Clarifications (owed phases = level 2
minus level 1, proof `plan.md`; classifier runs before the Bug rule; a missing
property is a fact; level 0 promotion on stderr only; no per-slice check).
Applied silently: no env override for the FR threshold, Stop-granularity
attribution, absolute subagent tokens, Labels/Design facts only.
