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
