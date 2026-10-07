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
