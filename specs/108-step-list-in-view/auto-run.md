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
