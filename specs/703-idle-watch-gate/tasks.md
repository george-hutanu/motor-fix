# Tasks - 703-idle-watch-gate

- [x] T001 Red: .claude/scripts/watch.spec.mjs covers FR-001 (clean fixture: exit 0, nothing on stdout or stderr), FR-002 (each stale kind: an agent fix in the plan, a dead holder, a finished clean worktree, an orphan lock, a prunable record; exit 2 and one line naming the fix), FR-003 (the gate fires exactly when `--fix --json` would plan or act, over the same fixtures; claimed and capped items stay silent), FR-004 (no repository and `--gate --fix`/`--json`/`--wait` exit 1).
- [x] T002 Red: .claude/scripts/watch.spec.mjs covers FR-005 (fake clock: polls only while an interval fits, fires with the lines, re-arm line at the limit, never sleeps past it, limit < interval and unknown flags are usage errors) and FR-006 (the record is written and removed, a live holder refuses a second wait, a dead or foreign pid is taken over).
- [x] T003 Red: .claude/hooks/session-watch-reminder.spec.mjs covers FR-008 (new line names neither CronList nor a cron string; nothing printed while a wait holds the record); a skill/AGENTS wording spec covers FR-007, FR-008 and FR-009 (no CronCreate instruction for the watch, the wait and its endings named, one wait and never from a worktree session).
- [x] T004 Green: watch.mjs dueFixes() shared by applyFixes and the gate, gate lines, --gate in main().
- [x] T005 Green: watch.mjs waitHolder(), the wait loop and --wait in main(); usage line and header updated.
- [x] T006 Green: session-watch-reminder.mjs line and armed check; doctor --bless-hooks after reading the diff.
- [x] T007 Green: speckit-watch/SKILL.md (scheduling, step 1, empty pass; FR-007, FR-009) and the AGENTS.md watch bullet.
- [x] T008 Measure: run a real `--wait` as a background command in this session, read its notification turn's usage from the transcript; record before and after (per tick and per idle hour) and the method in auto-run.md and the PR body (SC-001, SC-002). doctor.mjs, harness-eval --check and npm run test:harness green (SC-003).
- [x] T009 Follow-up: speckit-auto/SKILL.md "Parallel runs" still names the cron schedule (off limits here): file it in deferred.md.
