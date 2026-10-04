# Auto run — 422-private-file-storage

- Description: ST-422 Private file storage with signed uploads and downloads (Notion story ST-422, epic Foundations EP-1). Build what the story's Build brief says; the EP-2 listing form photos and documents will use it.
- Start commit: 3f717c6c11b66f23ded60bc502f94477df02105e (origin/main, detached), branch 422-private-file-storage
- Run in worktree agent-a55428368af980fba; DATABASE_URL=postgresql://localhost:5432/motorfix_st422, REDIS_URL=redis://localhost:6379/4, APP_ENV=test

## Preflight
- Tree clean; typecheck, lint, test green (nx, 7 projects). Constitution v1.1.0 read, no placeholders. spec-drift: no active feature before phase 2.

## 0 Size
- Level 2 (feature): provider, key layout, signing and test store are design choices. Evidence: Build brief has an Open section and 13 scenarios.

## 1 Constitution
- Read only; v1.1.0, Principle I first.

## 2 Specify
- Story fetched with discussions: none. Branch via GIT_BRANCH_NAME=422-private-file-storage.
- Q: provider? A: open in Notion; S3 protocol only, provider is configuration (autonomous default; Build brief "The code speaks only S3").
- Q: bucket settings (lifecycle, versioning, CORS)? A: provisioning outside the code, recorded for the owner (Build brief "Depends on ... Outside the code").
- Q: test store? A: in-process S3-protocol store over HTTP (no Docker on this machine; orchestrator directive "in-process fake/adapter, never a real bucket"). s3rver rejected: it ignores the POST policy (s3rver/lib/controllers/object.js:330 "unimplemented") and was last published 2022.
- Q: lifetimes as env vars? A: constants (Principle I, no knob nobody asked for).
- Q: helper retries? A: 3 retries, 1/2/4 s pause (Build brief scenario 3).
- Hooks: notion-sync start (story To do → In progress; epic unchanged; timeline row PENDING, Query Data Source quota exhausted); design-check wrote design.md (no screens); git commit nothing to stage (specs/ excluded).
- Orchestrator relay (ST-79 shape): storage has no controllers and takes a plain owner id, so no actor port; problem.filter.ts left to ST-79; no migration.

## 3 Org context
- org-researcher wrote context.md: 18 findings (8 decisions, 8 constraints, 2 open, 4 contradictions). Backend architecture via search excerpts only; sibling statuses not read (query quota).

## 4 Clarify
- spec-challenger: 5 findings. Answered (all autonomous, recorded under spec Clarifications):
  1. In-process test store stays (orchestrator directive; no Docker; s3rver lacks policy checks; `.skip` forbidden) → Complexity Tracking; MinIO in CI follow-up. Challenger recommended MinIO + skip: rejected, a skip is not allowed by the Autonomy Contract.
  2. Helper: 3 retries + one renewal (Build brief scenario 3); "queue while page open" logged as contradiction for owner. Challenger recommended unbounded queue: rejected, scenario 3 is the testable statement.
  3. Confirm(key, purpose, owner); declared type = stored Content-Type; incoming/<purpose>/<owner>/<id> → <purpose>/<owner>/<id>. (challenger recommendation)
  4. putObject(key, body, type) raw key, per brief interface. Challenger recommended purpose-validated: rejected, the brief names the signature.
  5. RFC 6266 dual-form Content-Disposition. (challenger recommendation)

## 5 Plan
- plan.md, research.md (R1–R7), data-model.md (no table), contracts/storage.md, quickstart.md. Versions from package.json; SDK 3.1146.0 from npm view.
- Decisions: global StorageModule beside HealthModule; no SignedUploadDto yet (no endpoint uses it, Principle I); biome noRestrictedImports override extended to libs/media; bucket settings listed under "Outside the code".
- Complexity Tracking: in-process S3 test store; libs/media lib.

## 9 Tests
- Red specs: libs/contracts files.spec.ts (7), env.spec.ts (+6); libs/domain storage.service.spec.ts (~38, with the in-process S3 test store s3-test-store.ts), health.controller.spec.ts (7) and health.adversary.spec.ts (storage added, +3); libs/media file-uploader.spec.ts (7); apps/api bootstrap specs boot with storage env.
- RED: `npx jest <those files>` → "Test Suites: 8 failed, 8 total" — every suite fails to compile on the missing ./files, ./storage.module, ./storage.service, ./file-uploader and STORAGE_ENV (the behaviour does not exist yet).
- test-adversary launched in background (new files storage.adversary.spec.ts, file-uploader.adversary.spec.ts).
- Also: SDK installed (T001, 0 prod vulnerabilities); libs/media scaffold (T002); tsconfig paths @motor-fix/domain/testing and @motor-fix/media.

## 6 Checklist
## 7 Tasks
- tasks.md: 21 tasks (setup 3, foundational 3, US1 4, US2 2, US3 2, US5 4, US4 2, polish 1), FR → test map.

## 8 Analyze
- artifact-lint: WARN delta-missing → added Spec Delta (storage Adds FR-001–008, 011, 012; platform Modifies 421-FR-013 → FR-009, 421-FR-021 → FR-010; FR-009/FR-010 restated in full); then ERROR delta-unknown-capability → created .specify/capabilities/storage.md (empty, archive fills it). Re-run: 0/0; capabilities validate: merges cleanly.
- Own pass: HIGH — FR-010 test was hollow (generic readEnv). Remediated: STORAGE_ENV in contracts env.ts used by both mains and StorageModule.register (T006, T017, T018, plan Config). Re-run lint: clean. No CRITICAL. Coverage 12/12 FRs.

- checklists/security.md: 19 items; 4 failed first reading and were fixed in spec.md (owner id quantified, 400 for malformed input, store-down for confirm/delete/write, check-then-move race → move only the checked object). 0 unchecked. requirements.md 16/16.
