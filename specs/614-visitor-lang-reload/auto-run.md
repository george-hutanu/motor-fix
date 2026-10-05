# /speckit-auto run — 614-visitor-lang-reload

Description: ST-614 Check that the visitor's language survives a reload at 320 px (bug filed by the PR tester on PR #99, unconfirmed)
Start commit: 53ddff0f1cdbdf764b2a8d5eb846d8ea4b4456b0 (origin/main)
Worktree: .worktrees/614-visitor-lang-reload

## Preflight
- Rules read on origin/main: AGENTS.md, CLAUDE.local.md, constitution v1.8.1 (VII).
- ST-614 free: Status To do, PR empty. Draft PR #124 opened (`planning`), linked in Notion.
- `typecheck && lint && test` green.

## 0. Size
- Level 1 (one-session). Phases: 2, 7, 9, 10, 12, 14, 16.

## Design check
- No Build brief; EP-1 boards. The mock read failed (artifact not found), logged in `design.md`; no visual change.

## 2. Specify
- Reproduced by hand at 320×640 on the dev server: a tap after hydration survives a reload (en/en); a tap on the server-rendered page before hydration is lost (ro/ro), which is the tester's reading; tapping RO (the first button) also reads ro/ro.
- FR-001 (an early tap is applied after hydration) and FR-002 (the choice survives a reload at 320 px).

## 7. Tasks
- T001, T002, T005 tests; T003, T006 the fix; T004 proof.

## 9. Tests (red-first)
- `language.spec.ts` (320 px, the scripts held back with `page.route`): red, "1 failed, 34 passed" (Expected "en", Received "ro").
- `addresses.spec.ts` "keeps the first page at / until the app is stable…": red without the guard change (Expected "/", Received "/ro").

## 10. Implement
- `speckit-notion-sync implement`: ST-614 Planning → Implementing, PR #124 label `in development`.
- `withEventReplay()` alone was not enough: replay worked on `/ro` but not on `/`, because the browser's first navigation sent `/` to `/ro` before hydrating and threw the tapped button away. `toLanguageAddress` now keeps `/` on the first browser navigation and moves it to the language address a task after the app is stable, once the replay has run. Decision recorded in spec Assumptions.
- Green: web unit specs (addresses, home: 47 passed); e2e language, phone, addresses, one-language, account-language on :4614 (63 passed). `pwa.spec.ts` fails against the dev server with or without this change (the service worker is off in dev mode); CI judges it.

## 12. Harden
- artifact-lint: 0 errors. diff-audit: 0 errors. Mutation: CI only.
- test-adversary: 11 tests proposed in `addresses.adversary.spec.ts`; 7 duplicated existing tests and were cut (Principle I); 4 kept (query and fragment through the move, not pulled back when the first page leaves `/`, later visits redirect at once). All pass.

## 14. Review
- spec-reviewer: APPROVE. One LOW (empty `auto-run.md`): fixed, this log.
- code-reviewer: BLOCK, repair lap 1. HIGH: with storage blocked, the move read `language()` while the replayed EN was still loading its texts, so it went to `/ro` and dropped EN. Red first: `language.spec.ts` storage-blocked early tap received `/ro`. Fix: the move prefers the language tapped meanwhile (`LanguageChoice.taps`). A unit version passed without the fix (jsdom loads texts at once) and was dropped. HIGH: adversary spec uncommitted: committed. LOW: the settled-tap reload test duplicated others: deleted.
- Green after the fix: web addresses and home specs; e2e language, phone, addresses, one-language, account-language on :4614 (63 passed).

## 16. Retrospective evidence
- `retro-evidence.mjs --since 53ddff0`: 6 tasks done, 2 FRs, Spec Delta i18n +2, nothing deferred; no open carry-over item touches this change. Verdict left to the owner.

## 17. Archive (on the branch)
- Spec Delta merged into `.specify/capabilities/i18n.md` (+2: 614-FR-001, 614-FR-002); spec status Archived (2026-10-05). The finish runs after the merge.

## Final report
- Root cause: a tap on the server-rendered `/` before hydration was lost (no event replay, and the client's first navigation replaced `/` with `/ro` before hydrating). The tester's `before=ro after=ro` on PR #99 is this. A tap after hydration always survived a reload.
- Fix: `withEventReplay()`; `/` hydrates in place on the first browser navigation and moves to the tapped, remembered or current language once the replay has run.
