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
- Fix: harness-eval --check fell to 78/80: the reminder imported watch.mjs, whose imports are missing from the eval's fixture copy, so the hook exited 1. waitHolder moved to `.claude/scripts/lib/watch-wait.mjs` (Node and git only); re-blessed (7821bba7f396 → d70b4e5e9eaf); eval 80/80, test:harness 1256 passed.

## T008 Measurement (SC-001, SC-002)
- Method: Claude Code transcripts `~/.claude/projects/-Users-georgehutanu-projects-motor-fix/*.jsonl` (and this run's `subagents/agent-a1657b13d7f87d546.jsonl`); assistant `message.usage` grouped by the turn that started it, deduplicated by message id; fields input, cache_creation_input_tokens (cw), cache_read_input_tokens (cr), output.
- Before, per idle tick (scheduled `/speckit-watch`, sonnet, 06:45Z / 13:25Z / 18:56Z on 2026-10-05): 4–6 calls, cw 49k–142k, cr 430k–581k, out 1.8k–4.1k. Per idle 2 h: 8 ticks = 32–48 calls, cw 0.39M–1.14M, cr 3.4M–4.6M.
- After, real run: `watch.mjs --wait --every 1 --for 2` as a Bash background command on an idle fixture repo printed `watch: idle for 2 min; re-arm the wait`, exit 0, record removed; a second wait beside it printed `already armed (pid 76471)`. Its notification's first model call (19:37:02Z): 1 call, cw 915, cr 172k (this run's context), out 555. Earlier background-completion turns in the orchestrator: 1 call, cw 0.6k–1.8k, cr 36k–190k, out 38–114.
- After, per idle 2 h: idle polls cost 0 model calls; one wake at 110 min (≈1–2 calls: read the line, re-arm) instead of 8 full passes.

## 11–13. Converge, harden, refresh
- Converge: FR-001–FR-009 each built and tested; nothing unbuilt. Harden: harness-only (no Nx project, mutation not applicable); code-reviewer ran in phase 14. Refresh: Notion story unchanged since gathering (read by the run session; no comments).

## 14. Review (opus)
- spec-reviewer APPROVE (3 LOW); code-reviewer BLOCK (1 HIGH untested wait error path; MEDIUM check-then-write race, no timeouts in the record lib, test-only re-export). Lap 1 (repair 1/5): spec for a poll that throws (exit 1, record removed), exclusive-create record, 5 s timeouts on git/ps, re-export dropped, plan.md updated. test:harness 1257 passed, doctor 16 ok, eval 80/80.
