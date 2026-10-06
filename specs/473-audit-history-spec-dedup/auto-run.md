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

## 5. Plan
- design check: no screens (test-only task, no Build brief); plan.md: Technical Context cited from package.json / jest.preset.cjs / libs/domain/jest.config.cts / apps/api/src/bootstrap.ts; research.md, data-model.md, contracts and quickstart N/A; helper `auditHistoryApp()` after serial-db.testing.ts; six-removal mapping table.

## 5–8. Plan, checklist, tasks, analyze
- plan (fable): success; checklist (sonnet): success, 9 ticked, 1 struck N/A; tasks (sonnet): success, 6 tasks.
- analyze: artifact-lint 0 errors, 5 warnings (delta-unassigned: test-only FRs merge into no capability, by design).

## 9–10. Tests, implement
- Red-first: a test-only refactor has no new behaviour to prove red; the moved assertions characterise existing behaviour and pass.
- New audit-history.testing.ts (auditHistoryApp: lifecycle, account, bearer, get, http); API and adversary specs use it; six restated adversary cases removed (48 -> 42 titles; service 39, API 11 unchanged); platform cursor, deep-array and array oldValue masking moved into the service cases.
- nx test domain: 103 suites, 3342 tests passed.
