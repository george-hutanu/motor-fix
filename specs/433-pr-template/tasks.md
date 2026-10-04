# Tasks: One standard pull request template, enforced on every PR

**Input**: `specs/433-pr-template/spec.md` (level 1: no plan.md)

## Format: `[ID] [P?] [Story] Description`

## Phase 1: Tests first

- [X] T001 [US1][US2][US3] Red tests in `scripts/pr-body-check.spec.ts` (new): a filled ready body passes; N/A with a reason passes; a pending Agent review passes; a missing section, a `(fill in:` placeholder, an empty section, a bare N/A, a removed labelled line, an unticked box, a non-Conventional title and a Notion section without a link each fail and name what is wrong; a draft with the raw template passes and a draft without a heading fails; null body and `\r\n` bodies. The tests read the real `.github/pull_request_template.md`. (FR-001–FR-006)

## Phase 2: Implementation

- [X] T002 [US1] Write `.github/pull_request_template.md` with the FR-001 sections (FR-001)
- [X] T003 [US1][US2][US3] Implement `checkPrBody` and the CLI in `scripts/pr-body-check.ts` (new): env `PR_BODY`, `PR_TITLE`, `PR_DRAFT`, or `--body-file <path> --title <title> [--draft]` for local use (FR-002–FR-006)
- [X] T004 [US1] Add `.github/workflows/pr-template.yml` running `node scripts/pr-body-check.ts` on the five event types, skipping bot authors (FR-007)
- [X] T005 [P] [US4] Use the template with `--body-file` in `.claude/skills/speckit-git-commit/SKILL.md`, the hand-off of `.claude/skills/speckit-auto/SKILL.md`, the lifecycle in `AGENTS.md` and the message of `.claude/hooks/pr-lifecycle-gate.mjs` (+ its spec); doctor `--bless-hooks`, `npm run test:harness` (FR-008)

## Phase 3: Review fixes

- [X] T006 [US1][US2] Boxes required by their lead text, no N/A excuse for an unticked box, code fences ignored, lenient heading syntax, case-insensitive repeated headings, the visible `_(fill in: …)_` marker only, with tests (FR-002–FR-004)

## FR → test

| FR | Test |
| --- | --- |
| FR-001 | `scripts/pr-body-check.spec.ts` › the template has every required section |
| FR-002 | › missing section (ready and draft) |
| FR-003 | › placeholder, empty, bare N/A |
| FR-004 | › labelled line removed, unticked box |
| FR-005 | › title |
| FR-006 | › Notion section |
| FR-007 | this PR's own `PR template` run |
| FR-008 | `.claude/hooks/pr-lifecycle-gate.spec.mjs` › draft message names `--body-file` |
