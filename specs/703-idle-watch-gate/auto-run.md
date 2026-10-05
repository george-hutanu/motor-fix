# speckit-auto run — 703-idle-watch-gate

- Description: Idle watch tick without a model turn: watch.mjs --gate mode that exits 0 silently when nothing needs a fix; schedule wakes the model only when the gate fires.
- Story: ST-703 https://app.notion.com/p/3f0607bff0d2811c9381d8dee97c729c · PR #143 (draft)
- Start: branch 703-idle-watch-gate off origin/main 50cdaaa, worktree .worktrees/703-idle-watch-gate (EnterWorktree refused from the repo root; absolute paths).

## 0. Size
- level 2 (feature), classifier 0.80: all phases run.

## 1. Constitution
- v1.8.1 card read; no placeholders. Principle I and II carried.

## 2. Specify
- spec.md, checklist 16/16. before_specify branch hook skipped (branch pre-created). Notion: To do → Planning; PR #143 linked; design.md: no screens.
- Mechanism (autonomous default): Bash run_in_background wait (2 h limit) on `watch.mjs --wait`; Monitor caps at 30 min, a cron prompt still costs a model turn, a scheduled task opens a fresh session.
- Measured before (scheduled /speckit-watch ticks, this repo's transcripts): 4–6 calls, cache write 49k–142k, cache read 430k–581k, output 1.8k–4.1k per tick.
- Measured candidate after (background-task notification turns): 1 call, cache write 0.6k–1.8k, cache read 36k–190k, output 38–114.

## 3. Org context
- org-researcher had no Notion tools ([UNAVAILABLE]); the run session read the story read-only: no comments, no feature page. context.md written from that.

## 4. Clarify
- spec-challenger: 7 findings. Five answered with its recommendations (wait end and limit < interval; gone holder = dead pid or not `watch.mjs --wait`; unreachable gh = silence; reminder reads the record; `--wait` flags and line-keyed endings). SC-001 marked evidenced by SC-002.
- Coordinator: PR #140 merged (3486742); origin/main merged into the branch (4a94fe5).

## 5–8. Plan, checklist, tasks, analyze
- plan.md (dueFixes shared by the fixer and the gate; wait record in the git common dir; Atomics.wait sleep, injectable). Checklist 16/16. tasks.md T001–T009. artifact-lint --check 0 errors after fixing the Modifies line (`464-FR-011 → FR-009`) and tasking FR-009; capabilities validate clean.

## 9. Tests (red)
- watch.spec.mjs (--gate, dueFixes, --wait, waitHolder), session-watch-reminder.spec.mjs (new line, silent while armed), new watch-schedule-wiring.spec.mjs (skill and AGENTS text). Red: 24 failed, 92 passed across the 3 files.

## 10. Implement
- Notion: Planning → Implementing; PR label in development.
- watch.mjs: dueFixes() now drives applyFixes (same actions, same order, same `what` strings) and the gate; `--gate`, `--wait` (`--every`, `--for`), waitHolder(), record `<git common dir>/speckit-watch-wait.pid`. Reminder hook: new line, silent while a live wait holds the record; registry text updated; doctor --bless-hooks after reading the diff (6ea6fcba2b8e → 7821bba7f396). Skill "Keeping it scheduled" and the AGENTS.md bullet rewritten.
- Green: test:harness 1256 passed after making the wording spec wrap-tolerant. Smoke: `--gate` on this repo exit 2 with 5 lines in 10.5 s; a second real `--wait` beside a live one printed `already armed (pid …)`.
