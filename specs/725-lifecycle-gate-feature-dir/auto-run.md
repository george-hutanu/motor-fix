# Auto run — 725-lifecycle-gate-feature-dir

Level 1 (one-session). ST-725. Start commit 69f9260 (origin/main).

- **Size**: level 1 — classifier unsure; intent fully stated by the bug report (cause, fix, tests named), one hook.
- **Notion**: ST-725 created (Bug, Medium, Role System, epic Foundations, 1 point), Planning; Foundations timeline row created. Ready refresh pending: the connector's Query Data Source hit its usage limit.
- **Verify**: confirmed — `prLinked` reads `specs/<branch>` only (`pr-lifecycle-gate.mjs:165`); `handedOff` has no number fallback.
- **Specify**: spec.md (FR-001–FR-003, Spec Delta), tasks.md (T001–T006). No screens (design.md).
- **Decisions taken**: the fallback matches the slug too, not the number alone (spec Assumptions); no eval case, since the eval cases declare the state and never reach the folder lookup.
- **Tests first**: 5 new specs red at 8005bd2 (`featureDir`/`prLinked` not exported; `handedOff` missed `specs/083-…`). Stale-pointer spec red at 5198a7f.
- **Implement** (2f92334, 7a6c0bd): `featureDir(cwd, branch)` — the pointer when it names an existing folder, then `specs/<branch>`, then the `specs/` folder with the same number (leading zeros ignored) and slug; `prLinked` and `handedOff` read through it. Checked against the real `83-sign-in-apple-google` worktree: `specs/083-sign-in-apple-google`, PR #136 linked.
- **Harden**: diff-audit clean; artifact-lint clean after the Spec Delta fix. `trace-matrix` does not scan `.claude/` specs, so FR coverage is the `@traces` tags plus tasks.md's table.
- **Proof**: `npm run test:harness` 1486/1486; `harness-eval.mjs --check` 81/81 (in a worktree with open tasks `red-first-leaves-main-alone` fails, on main too; passes once tasks are ticked); `doctor.mjs` 16 ok after `--bless-hooks` (diff read first).
- **Review**: spec-reviewer APPROVE (LOW: two cases untagged, patched). code-reviewer BLOCK → APPROVE on re-review: HIGH stale pointer trusted (fixed, tested), MEDIUM non-string pointer (fixed), MEDIUM second resolver beside `lib/feature.mjs` (deferred.md). Repair laps: 1.
- **Retrospective evidence (unjudged)**: 6 commits since 69f9260; Jev lane unavailable, no suggested verdict; no instincts triggered.
- **Archive**: Spec Delta merged into `.specify/capabilities/platform.md` (+3).

## Final Report

ST-725, PR #148. Level 1. Gate fixed and tested; reviews APPROVE; one MEDIUM deferred (shared resolver with `lib/feature.mjs`). Notion: Query Data Source limit reached, so the Ready to work refresh is logged PENDING.
