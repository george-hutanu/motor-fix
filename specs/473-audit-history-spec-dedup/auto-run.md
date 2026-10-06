# Auto run — 473-audit-history-spec-dedup

- Description: ST-473 tech debt from ST-391 — delete the adversary spec's restated cases, share the HTTP helpers in audit-history.testing.ts
- Start: origin/main 7d067e46, worktree .worktrees/473-audit-history-spec-dedup, draft PR #179

## 0. Size
- level.mjs suggest ST-473: level 2 (boards: 1, brief not found); accepted (rule: boards make it at least 2).

## 1. Constitution
- v1.8.2 card read; Principle I and II carried.

## 2. Specify
- task-runner (fable): success — 5 FRs, 3 autonomous clarifications; level check unchanged.

## 3. Context
- org-researcher: success — 6 findings, 0 contradictions; ST-472 (PR #177) overlaps audit-history.api spec: merge origin/main before ready.

## 4. Clarify
- spec-challenger: 5 findings. Answers applied to spec.md: (1) nested masking maps to `are masked for the %s`, deep arrays move there; (2) the restated cursor case is `keeps a cursor from another garage…`, the platform cursor moves to the service case, the admin non-existent cursor case stays; (3) SC-003 counts titles; (4) helpers registered by one call, no hooks on import; (5) the other mappings verified; plus ST-472 merge order.
