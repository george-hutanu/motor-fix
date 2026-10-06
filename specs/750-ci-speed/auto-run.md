# /speckit-auto run — 750-ci-speed (ST-750)

Description: "how can you make the CI complete faster? what tasks can be run in parallel? also take into consideration other versions of node because im on a free tier on github and sometimes i have to wait to get a container to run my ci, in the evening especially being very crowded"
Start: main checkout dirty (.env.bak) → own worktree `.worktrees/750-ci-speed` from origin/main 4a499cd. Notion task ST-750 created for this work (none existed). Draft PR #157.

## Preflight
- typecheck + lint + test: exit 0 (Nx cache 10/11).

## 0. Size
- level 2 (classifier 0.80: touches workers, cache).

## 1. Constitution
- v1.8.1, card read.

## 2. Specify
- phase agent (fable): STATUS success — spec, requirements checklist, design.md (no screens), notion-sync.md; ST-750 Planning, PR linked.

## 3. Context
- [UNAVAILABLE: notion — org-researcher had no Notion tool in this session] context.md holds the marker; continued without a digest.

## 4. Clarify
- spec-challenger: 8 findings. Five asked and answered (spec § Clarifications): release collapse on `checks` only; one check per group with `!cancelled()` steps; CI OK ≤ ~11 min and E2E ≤ 7 min; main's `images` writes the gha cache; flaky e2e fails PR CI. Evidence-timing (finding 8) recorded as an assumption.
- Owner asked mid-run "run e2e only on merge?": answered no, recorded in Out of Scope with the reasons.

## 5. Plan
- phase agent: STATUS success — plan.md, quickstart.md. D1 Playwright workers 4 + failOnFlakyTests off-deploy; D2 ci.yml → changes, checks, tests, e2e, docker(web/api), ci-ok (7 jobs, 3 setups); D3 release `checks` concurrency + main `images` writes gha cache.

## 6. Checklist
- phase agent: STATUS success — checklists/ci-speed.md, 16/16 checked; added the cold-cache edge case.

## 7. Tasks
- phase agent: STATUS success — T001–T012.

## 8. Analyze
- artifact-lint: 10 fr-untasked + delta-missing. Remediated: FR ids on every task; Spec Delta under capability `platform` (Adds FR-001–FR-010). Re-run: 0 errors, delta merges.

## 9. Tests
- ci-workflow.spec.ts (new) and release-workflow.spec.ts extended: 24 red before implementation; the deployed Playwright case passed already (it pins today's behaviour).

## 10. Implement
- 3 slices: ci.yml six jobs + Playwright 4 workers (471e43a), release queue + docker cache (7f5d39e), docs (ef6ea90). pr-title-workflow.adversary.spec.ts updated to the new job ids (pinned the old list).

## 12. Harden
- artifact-lint 0/0, diff-audit 0/0; mutation n/a (no product source changed; CI-only anyway).
- test-adversary: 63 tests, 0 failing (2 Biome template warnings fixed without suppression).
- code-reviewer BLOCK → fixed: HIGH live.spec offline test changed the shared seeded driver's language for ~50 s, racing parallel sign-ins → own signed-up account (≈6 real sign-ups per run, under the 10/h limit); MEDIUM CI_WORKERS renamed WORKERS (applies locally too). LOW kept: the adversary spec overlaps ci-workflow.spec by design (independent view).
- Checks job serial chain measured 130 s on run 37491151921.

## Resumed in a cloud session (2026-10-06)
- Merged origin/main (26 commits, #158 cloud sessions) at 29cbee8, no conflicts. Lint 0, typecheck 0; harness 1789/1790 — the 1 is `cloud-setup.spec.mjs` "never lets sudo ask for a password", which fails only because this VM runs as root (main's ST-749 code, not this PR). cloud-setup.sh installed Node 24 into /usr/bin but /opt/node22/bin precedes it on PATH; worked around with PATH=/usr/bin first. Docker Hub answered 429, so no local integration run (CI runs them).

## 11. Converge / T012 — measured on this PR's CI
- Run 37492214599 (b8d520e): 7 jobs (SC-001 ≤ 8 ✓); installs in Checks, tests, E2E = 3 (SC-003 ≤ 4 ✓); E2E 305 s at 4 workers (SC-002 ≤ 7 min ✓, workers stay 4); CI OK 389 s from start (SC-007 ≤ ~11 min ✓). Recorded in plan.md D1 and docs/speed-and-cost-plan.md row 16.
- SC-006: not run live. A Biome violation cannot be committed without `--no-verify` (the pre-commit hook lints), and bypassing the gate is not taken on the owner's behalf. Covered statically: CI OK needs all five jobs and exits 1 on any result but success/skipped (ci-workflow.spec.ts "CI OK needs every job…"); a failed `!cancelled()` step still fails its job. SC-004 and SC-005 go to the merged PR's finish comment.

## 13. Ticket refresh
- org-researcher (Notion reachable): ST-750 has 0 comments; nothing narrows the ask. Three older pages disagree with the newer spec, which stands: ST-435 "separate parallel jobs" vs FR-002, ST-421 "one release at a time, in commit order" vs FR-006, the Testing table's "E2E before every release, on staging". ST-663 constraint (release and reset-staging in different groups): the new `release-checks` group covers the checks job only, not staging, so the race is not widened. Epic body and "Decisions and ideas" not fully read (tool size limit).

## 16. Retrospective evidence (unjudged)
- `retro-evidence.mjs --since 4a499cd --jev`: 10 FRs, Spec Delta platform +10; 1 open task at the time (T012, now done); 0 deferred; Jev lane unavailable (no key), so no suggested verdict. Its commit/diff range includes main's merged commits (ST-745, ST-749).
- `instincts.mjs triggered --since 4a499cd`: nothing triggered.

## 14. Review
- spec-reviewer BLOCK, code-reviewer BLOCK, both on one HIGH: the Checks job's install had no `if:`, so a Biome failure skipped `npm ci` and broke every later check (FR-003). Fixed in 4b15dab (install first, `npx biome ci`, setup-biome dropped, two specs). LOWs fixed: x-forwarded-for on the offline test's sign-up, ticket keys out of the docs rows, "five runners" on main. MEDIUM deferred: the e2e sign-up limit on a second local run (deferred.md, Notion task filed). MEDIUM kept, owner's call: the adversary spec repeats ci-workflow.spec cases (harden convention, as in pr-title-workflow and railway-deploy).
- Re-review (once, repair lap 1): spec-reviewer APPROVE, code-reviewer APPROVE. Its one MEDIUM (T012's live SC-006 check) accepted: the CI OK spec covers it; T012 reworded.
- **4b15dab is not on GitHub.** The cloud session's GitHub App lacks the `workflows` permission, so any push touching `.github/workflows/` is refused. It is held on the local branch `750-ci-workflow-fix` and posted on PR #157 as a patch; the PR stays draft until it is pushed from the laptop (or the app is granted `workflows`), then it goes ready.

## 15. Agent context
- CLAUDE.local.md's Active plan line points at specs/750-ci-speed/plan.md (held its size).

## 17. Archive
- Spec Delta merged into `.specify/capabilities/platform.md` (+10); spec.md Archived (2026-10-06). Retro left to the owner (phase 16 evidence only).
