# /speckit-auto run — 612-live-status-spacing

Description: ST-612 Give the live status line room under the RO/EN switch (tech debt from ST-256, PR #79; judged against ST-255's offline bar, #103)
Start commit: 990df691f210056af177b7dc0004400a11dd811a (origin/main)
Worktree: .worktrees/612-live-status-spacing

## Preflight
- Rules read on origin/main: AGENTS.md, CLAUDE.local.md, constitution v1.8.1 (VII).
- ST-612 free: Status To do, Ready to work ticked, PR empty. #103 (ST-255) merged 2026-10-05T10:03Z. Open PRs #107 and #112 touch no `frame.ts`.
- Branch created by hand off origin/main with its upstream unset; `identity.sh apply`; `npm ci` under `scripts/heavy.sh`.
- `typecheck && lint && test` green (13 typecheck, 11 test projects).

## 0. Size
- Level 1 (one-session): one CSS rule in `frame.ts` and its tests. Phases: 2, 7, 9, 10, 12, 14, 16.

## Design check
- No Build brief (tech-debt task); EP-1 boards Home and Dashboard · Driver read in the mock: the header's lower edge is never touched by the content below (main's 24 px top padding). The mock has no status line and no offline bar. `design.md` written.

## 2. Specify
- Spec written from the story; 4 assumptions marked (autonomous default).
- Spacing: `--mf-space-2` (8 px) top margin, applied whatever sits above the line; under the offline bar it adds to the bar's 12 px (20 px). The bar's own flush top edge is deferred.

## 7. Tasks
- `tasks.md`: T001–T003 tests, T004 the CSS rule, T005 proof.

## 9. Tests (red-first)
- A Jest computed-style test was tried first and dropped: jsdom lays nothing out and resolves no component margin (`getComputedStyle` gave empty strings), so it could never go green. T001 struck in tasks.md; assumption added to spec.md.
- `apps/web-e2e/src/live-status.spec.ts` (API stubbed, no `@seeded`): the four widths and the offline-bar state. The stub confirms the e-mail: a first run passed red-free because the e-mail banner sat between the header and the line.
- Red, against the dev server on :4612 (`BASE_URL`, under `scripts/heavy.sh`): "5 failed" — gap 0 px (want ≥ 8) at 320, 390, 768, 1280; gap under the offline bar 12 px (want ≥ 20).

## 10. Implement
- `speckit-notion-sync implement`: ST-612 Planning → Implementing, PR #114 label `in development`.
- `frame.ts`: `.live-status { margin: var(--mf-space-2) 0 0; padding: 0; … }`.
- Green: live-status, live, dashboards, dashboard-tab-bar, phone specs on :4612 → "45 passed" (`@seeded` flows left to CI).

## 12. Harden
- artifact-lint: 0 errors. diff-audit: every finding is in files outside this branch's diff (it diffs against the stale local `main`); none in the 7 files this branch changes.
- test-adversary: `apps/web-e2e/src/live-status.adversary.spec.ts`, 3 tests (English driver, unconfirmed e-mail with the banner, garage dashboard), 3 passed against :4612.
- Decision taken for the owner (Principle I, spec review's option A): the adversary file's 320 px switch-gap and no-scroll checks duplicated `live-status.spec.ts`, so its computed-style check (no horizontal margin or padding) and its e-mail banner case moved into `live-status.spec.ts` and the file was dropped. `live-status.spec.ts`: 6 passed against :4612.
- Mutation: none locally (CI only, nightly); a CSS value has no Stryker mutant in a TS project.

## 14. Review
- spec-reviewer: APPROVE (FR-001 met). Two MEDIUM, both fixed: `deferred.md` committed and filed as a Notion debt task (https://app.notion.com/p/3f0607bff0d2816bb941df4c46810caa); the adversary file folded into `live-status.spec.ts` (decision above).
- code-reviewer: APPROVE, LOW only. Applied: a comment on the offline wait (twice `OFFLINE_AFTER`); the no-scroll check compares `scrollWidth` with the viewport width so a failure shows both. Deferred and filed: the shared `signInAs` stub omits `emailConfirmed` (https://app.notion.com/p/3f0607bff0d2816ca660e1b3f7086f4d). `live-status.spec.ts`: 6 passed.

## 16. Retrospective evidence
- `retro-evidence.mjs --since 990df69`: 3 commits on the branch; no open retro action item touches this change. Verdict left to the owner.
