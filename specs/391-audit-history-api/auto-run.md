# Auto run — 391-audit-history-api

- **Description**: ST-391 — See the audit history of my garage, or all of it as admin: the GET /api/v1/audit-history API over ST-390's activity_log, with the capability rules from ST-79's policy (404 for no right or another garage's entries), filters and paging per the Build brief; the screens come later with ST-97 and ST-160.
- **Start commit**: cea1552 (origin/main, contains ST-390)
- **Branch**: 391-audit-history-api (created by the orchestrator's setup, not by the specify hook)
- **Database**: motorfix_391, both migrations applied with psql

## Preflight
- tree clean; `npm run typecheck` 0, `npm run lint` 0, `npx jest --maxWorkers=2`: 64 suites, 1564 tests passed.

## 0 Size
- level 2 (feature): design choices (capability names, scope, masking, paging) — `level.mjs set 2`.

## 1 Constitution
- v1.5.0 read; no placeholders. Principle I first; VII lifecycle (draft PR, push per commit) per the orchestrator.

## 2 Specify
- spec.md written directly against the template (the specify hook would create a new branch; the branch already exists by instruction). Clarification table self-answered; assumptions marked (autonomous default).

## 3 Notion context
- context.md written by this agent from read-only Notion calls (orchestrator: "Read it yourself, read-only"). Backend architecture not fetched (size).
- notion-sync start: ST-391 To do → In progress; timeline row Not started → In progress; EP-1 unchanged (In progress).
- design.md: no board exists ("Not designed in mock v22"); API only.

## 4 Clarify
- Five questions answered in spec Clarifications (one endpoint for both views; 7-day default in the API; raw values, formatting in the view; conservative mask; admin actions = admin actor role).

## 5 Plan
- plan.md: Technical Context from package.json, bootstrap.ts, data-access project.json, the ST-390 migration. Constitution Check PASS; no Complexity Tracking.

## 6 Checklist
- checklists/requirements.md: 0 unchecked.

## 7 Tasks / 8 Analyze
- tasks.md T001–T009 with the FR → test table. `artifact-lint.mjs`: 0 errors, 0 warnings (Jev lane unavailable: no key).
- spec-challenger (8 findings) applied: cursor scope + `invalid_cursor`; exact case-insensitive mask keys, text untouched; start-after-end only for an explicit pair; date-times with a zone only; stored actor role; exactly-once for a fixed `from`; SC-001 reworded; platform area recorded as late.

## 9 Tests (red first)
- New: audit-history.service.integration.spec.ts, audit-history.api.integration.spec.ts; extended: capabilities.spec.ts, auth.adversary.spec.ts, auth.api.integration.spec.ts, auth.adversary.http.integration.spec.ts, apps/api bootstrap.integration.spec.ts.
- Red: 5 suites failed, 26 tests failed (service spec: cannot find module './audit-history.service').

## 10 Implement
- capabilities.ts, contracts audit-history.dto.ts, audit-history.service.ts, audit-history.controller.ts, auth.module.ts registration; `npx nx run data-access:generate` regenerated openapi.json and the client.
- Two test-isolation fixes (supertest server reuse; the admin's unscoped page measured in a moment no other test writes at).
- `npm run typecheck` 0, `npm run lint` 0, `npx jest --maxWorkers=2`: 66 suites, 1655 tests passed.
