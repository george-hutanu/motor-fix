# Auto run — 254-live-audience

- Description: ST-254 Send live updates only to the people involved (Notion https://app.notion.com/p/3ee607bff0d281769e64ff763a743def, EP-1 Foundations)
- Start commit: c28fbd0 (origin/main); branch start commit b6a911c
- Draft PR: #75

## Preflight
- Tree clean apart from the new feature folder; `.husky/pre-commit` ran typecheck, lint and test green on the start commit b6a911c.
- Constitution v1.6.1 read; no placeholders.

## Size
- Level 1 (one-session): one backend unit in libs/domain/src/events, no screen. Phases 2, 7, 9, 10, 12, 14, 16, 17. (autonomous default)

## Specify
- Spec written from the Notion story's Build brief; 5 clarifications self-answered (spec.md Clarifications), 6 assumptions marked (autonomous default).
- Notion stories query quota exhausted; story and timeline row read by direct fetch.

## Tasks
- tasks.md: 9 tasks in 3 phases.

## Tests (red first)
- `npx jest libs/domain/src/events/audience.spec.ts libs/domain/src/events/live.hub.audience.spec.ts`: 2 suites failed (no `audience.ts`, `LiveHub` took one argument) before any code.
- Seed spec and e2e expect a second driver `sofer2@example.test` (absent before).

## Implement
- 3e807f8 feat(live): audience table, staff filter, garage-access cache, member removal, suspension, public separation. Events integration suites 7/7, 170 tests green on motorfix_st254.
- Notion implement written after the slice was committed (late; the story moved Planning → Implementing before the PR went ready).

## Harden
- artifact-lint: 0 errors after the Spec Delta was rewritten as `253-FR-006 → FR-013`. diff-audit: only the known import-extension false positives on libs/ (ST-457) and pre-existing untested-new-file warnings.
- test-adversary: 118 cases, all passing; no defect found.
- code-reviewer APPROVE: #1 follow() early return (fixed), #2 floating deliver() promise (fixed), #3 LiveSubject export (kept: the adversary spec imports it), #4 cache never sweeps (deferred → ST-567). Mutation testing: CI only (AGENTS.md), not run locally.
- Repair lap 1 of 5.

## Review
- spec-reviewer APPROVE; one LOW decision: the brief's e2e names a garage context and a request event; requests do not exist, so FR-012 uses two drivers and the test update. Recorded as a deviation in the finish comment.

## Agent context
- Skipped: CLAUDE.local.md is the owner's private file with local edits; nothing tracked needed a change.

## Retrospective evidence (unjudged)
- `retro-evidence.mjs --since c28fbd0`: 3 commits of this feature (b6a911c, 3e807f8, eef4b59); jev lane unavailable, no suggested verdict.

## Archive
- `capabilities.mjs merge specs/254-live-audience --apply`: live-updates +12 added, ~1 modified.
