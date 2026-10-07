# auto-run — ST-108

Description: ST-108 "Move through the six steps with the step list in view" (EP-2, Highest). Notion: https://app.notion.com/p/3ee607bff0d281de8506f7904b959b0a
Start commit: ec74ab0654afa31c0e6bb27e0b56bd7a2c5ea933 (origin/main), worktree .worktrees/108-step-list-in-view
Preflight: typecheck, lint, test green (exit 0).

## 0 Size
- level 2 (classifier 0.80; boards 1, points 3)

## 1 Constitution
- v1.8.2, no placeholders

## 2 Specify
- agent fable: STATUS success — 12 FRs, 11 autonomous defaults, draft PR #192, design.md from Notion text (mock artifact not reachable: UNAVAILABLE), level check 2 unchanged (fr-count)

## 3 Context
- org-researcher: success — 15 findings, 4 mild contradictions, 3 proposed clarifications, no open decision blocks

## 4 Clarify
- spec-challenger: 5 findings, all taken as the 5 questions
- Q1 path per language? → one path `list-your-garage` under /ro and /en (app.routes.ts:46; brief proposed /ro/listeaza-service)
- Q2 scroll-spy rule → last heading past the header/bar bottom; 1 before any; 6 at end
- Q3 one nav or two → one nav, CSS layout at 768 px
- Q4 bar list → disclosure (aria-expanded), Escape returns focus to the bar
- Q5 tick → out of scope, to the validation story (Principle I; brief scenario 8 proposed, not designed) — deviation for the finish comment
- level check: 2 unchanged

## 5 Plan
- before_plan: design.md current (Checked 2026-10-07; mock artifact not shared with this account, logged in design.md); nothing to commit
- plan.md, research.md (R1–R10 with evidence), data-model.md, contracts/page.md, quickstart.md
- structure: lazy public child `list-your-garage` under `:lang` + PUBLIC_PATHS; `public/steps.ts` (STEPS, currentStep) and `public/list-your-garage.ts`; texts group `listing` in libs/i18n public ro/en; one `nav` laid out by CSS at 768 px; Playwright `list-your-garage.spec.ts`, routes added to phone.spec.ts, sitemap spec gains the addresses
- decision beyond the spec's literal rule: the tapped step is held current while the jump's scroll settles (R5), since empty shells cannot always bring a heading to the line
- after_plan: commit b4a43469 pushed; agent-context update grew CLAUDE.local.md 136→138 lines, ratchet refused, reverted; the existing `Active plan` line now points at specs/108-step-list-in-view/plan.md (size held)

## 5 Plan
- agent fable: success — steps.ts + list-your-garage.ts in apps/web public, route + PUBLIC_PATHS, i18n listing group, e2e spec; agent-context block refused by the ratchet (+2 lines), Active plan line repointed

## 6 Checklist
- agent sonnet: success — ux.md 33 items, 8 fixed by edit, 3 struck, 0 unchecked

## 7 Tasks
- agent sonnet: success — 19 tasks, tests first, FR→test table; level 2 unchanged

## 8. Analyze (inline, opus)

- artifact-lint: 0 errors, 0 warnings, after the remediation of this phase: `.specify/capabilities/garage-listing.md` stub created (delta-unknown-capability) and Spec Delta Adds written as `FR-001–FR-012`.
- Coverage: 12/12 FRs and 6/6 SCs have at least one task (tasks.md:80). US4 (FR-009) has no task of its own by design (tasks.md:64): T005, T013, T014 test it on the one component instance.
- Consistency: the 150 ms hold on the tapped step (plan.md:102, research R5) matches FR-006 "stays current until the next scroll". No placeholders. No constitution conflict.
- Findings: 0 CRITICAL, 0 HIGH, 0 MEDIUM. One round, no re-run needed.

## 9. Tests (inline, opus)

- Written: steps.spec.ts (6), list-your-garage.spec.ts (20), addresses.spec.ts (+1), search.spec.ts (sitemap list extended), phone.spec.ts (+2 routes), web-e2e list-your-garage.spec.ts (14). test-adversary added steps.adversary.spec.ts and list-your-garage.adversary.spec.ts (17 cases).
- RED: `jest steps list-your-garage addresses search` gave 4 of 4 suites failing. Two suites cannot find their module, and 2 new assertions fail (address and sitemap). The other 25 tests pass.
- Decision: the end-of-page rule counts only once the page has scrolled (scrollY > 0), so an empty-shell page that fits the window opens on step 1 (FR-005, "step 1 before any"). The e2e gives sections the height of later content with a test-only style.

## Phase 10 — Implement

- Built: `steps.ts`, `list-your-garage.ts`, route + `PUBLIC_PATHS`, `listing` texts RO/EN. Commit f9c7a0ad `feat(web)`, pushed.
- Fixes on the way to green: entry text rendered as one text node (Angular drops whitespace between elements), current-step marker moved to `button::before` with empty alt text; step marks carry their full catalogue key (the i18n workspace check refuses a concatenated key); the pre-existing `search.adversary.spec.ts` sitemap lists gained the two new addresses; e2e heading checks accept the catalogue's non-breaking hyphens.
- Verified: `nx run-many -t test typecheck -p web web-e2e i18n` green; Biome clean; pre-commit (affected typecheck/test/lint over 8 projects) green after `prisma generate` (the worktree lacked the generated client).
- T019: Biome, typecheck and unit tests green here; the Playwright specs are left to CI's E2E job — a local run would reuse other worktrees' servers on ports 3000/4200 (`reuseExistingServer`).

## Phase 11 — Converge

- Converged, cycle 1: FR-001–FR-012 and SC-001–SC-006 checked against the code (`list-your-garage.ts`, `steps.ts`, `addresses.ts`, `app.routes.ts`, the `listing` catalogue); every Cockpit token used exists in `cockpit.css`. No task appended. Ticket re-read deferred to phase 13 (Notion is the tracker; the skill's Jira lane does not apply here).

## Phase 12 — Harden

| Check | Before | After |
|-------|--------|-------|
| diff-audit errors | 1 | 0 |
| artifact-lint errors | 0 | 0 |
| mutation score | not run locally (CI nightly only) | — |
| tests (public steps + page) | 42 | 42 |

- test-adversary ran in phase 9 (17 cases, all green after phase 10). code-reviewer: APPROVE, 2 MEDIUM + 2 LOW.
- Fixed: dead `Step` export removed; fragment landing now asserts the list highlights step 4; the button-role unit test renamed to what it checks.
- Deferred: scroll spy coalescing (LOW) → `deferred.md`, to file as debt before the merge.
- Repair laps: 1.

## Phase 13 — Ticket refresh

- org-researcher (background): no new evidence. ST-108 has no comments, the brief is unchanged, and the status is now Implementing. `## Refresh` appended to context.md.

## Phase 14 — Review

- spec-reviewer: APPROVE. Two MEDIUM and one LOW: the deferred.md shape was fixed; the redundant catalogue test was deleted; T019 kept `[X]` (decision: CI's E2E job, waited on by the tail before the merge, is the proof).
- code-reviewer: BLOCK on one HIGH. On a phone the jump landed headings 8 px below the spy's line (scroll margin 52 px vs. bar bottom 44 px). Fixed with a phone margin of `var(--mf-tap)` and a Playwright check (jump to 5, scroll 2 px, the bar stays on 5). Two LOW redundant adversary tests were deleted.
- Re-review: APPROVE. Two LOW items remain, kept: i18n key parity is enforced by `libs/i18n/src/check.ts`, and the e2e fixed waits bracket a single wheel event.
- Repair laps: 2.
