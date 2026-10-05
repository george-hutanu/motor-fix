# speckit-auto run — 600-merge-gate-symlink

- Description: ST-600 make the merge gate (and the other hooks with the same entry-point idiom) run when started through a symlinked path; heavy.spec.mjs mkdirSync cleanup.
- Start commit: 53ddff0 (origin/main) · branch 600-merge-gate-symlink · PR #126 (draft)
- Level: 1 (one-session) — phases 2, 7, 9, 10, 12, 14, 16, plus archive and hand-off.

## Phase log
- size: level 1 — intent is defined by the task text (what is true when done, what is out of scope).
- constitution: v1.8.1 read, no placeholders.
- specify: spec.md written; 4 FRs; assumptions marked (autonomous default).
- start sync: ST-600 Planning; draft PR #126 opened from the template and linked on the task; timeline row created (Planning); ready refresh −ST-600 −ST-623.
- design: design.md — no screens.

## Tasks
- tasks.md by hand (level 1: no plan.md, setup_tasks.py needs one); analyze skipped at level 1. 8 tasks.

## Tests (red)
- `entry.spec.mjs` (new) fails to load: no `entry.mjs`. `merge-gate.spec.mjs` symlink case: real path exit 2, symlinked path exit 0 — 1 failed / 27 passed.

## Implement
- `.claude/scripts/lib/entry.mjs` `isEntryPoint`; six hooks switched; `heavy.spec.mjs` uses `mkdirSync`. Edited hooks' fingerprints re-recorded with `doctor --bless-hooks` after reading the diff.
- `npm run test:harness` 48 files / 989 tests green. doctor 16 ok. harness-eval 74/75 in this worktree: `red-first-leaves-main-alone` fails here on base too (feature branch with open tasks); 75/75 on main.

## Review
- spec-reviewer APPROVE (1 LOW, deferred); code-reviewer APPROVE (1 MEDIUM, deferred). Both filed as Tech debt in Notion (deferred.md carries the URLs).

## Archive
- Spec Delta (`platform`, Adds FR-001–FR-003; FR-004 is test setup only) merged into `.specify/capabilities/platform.md`; spec.md Archived.

## Final Report
- PR #126 ready (QA), head c332d9f; story and timeline row QA in Notion.
- Shared `isEntryPoint` check; six hooks use it; merge gate refuses through a symlinked path (red→green). Harness 989/989, doctor clean.
- Reviews APPROVE ×2; two deferred items filed as Tech debt.
- Hand-off: `specs/600-merge-gate-symlink/handoff.md`; NEXT: tail #126.
