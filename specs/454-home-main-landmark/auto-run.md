# speckit-auto run log — 454-home-main-landmark

**Description**: ST-454 — the public home page `/` fails axe `landmark-one-main` and `region`; give it a proper main landmark so every piece of content sits inside a landmark. ST-458 is the same finding.
**Start commit**: a55fa6e03f4ab3c2720249baa7466f3d5a2e6e5b (origin/main)
**Branch**: 454-home-main-landmark (worktree `.worktrees/454-home-main-landmark`)

## Preflight

- Tree clean; identity check green (george-hutanu).
- `sh scripts/heavy.sh sh -c 'npm run typecheck && npm run lint && npm run test'` exit 0.
- Task choice: ST-444 (lower ST number, same priority) skipped — already done on origin/main by 8309e45; ST-454 next.

## 0. Size

- Level 1 (one-session): intent clear — one main landmark, all content in landmarks, no visual change. Phases 2, 7, 9, 10, 12, 14, 16.

## 2. Specify

- spec.md written; checklist all pass.
- (autonomous default) `/` renders Home inside the public frame instead of Home carrying its own `<main>`: the frame already owns the one `<main>` (Principle I).
- (autonomous default) frame top bar becomes `<header>`; no visual change.
- (autonomous default) Spec Delta capability `phone-layout` (the public frame's capability).
- 2026-10-05 · design-check · design.md written (semantic change, no visual change)

## 7. Tasks

- tasks.md: T001–T005, one story. Before-implement hooks: design.md current; Notion ST-454 Planning → Implementing, PR #115 label `in development`.

## 9. Tests (red-first)

- `addresses.spec.ts`: 2 new tests (/ro browser, / server) — `npx jest apps/web/src/app/addresses.spec.ts`: 2 failed, 16 passed (red).
- `apps/web-e2e/src/landmarks.spec.ts`: axe landmark rules on `/` at 320 px and 1440 px, RO and EN, plus the server HTML for `/` holding one `<main>`. Not run locally (needs the three servers; CI's E2E job runs it). Evidence it is red today: the 390 lap-2 QA report listed `landmark-one-main` and `region` on `/`, and the frame's top bar was a bare `<div>`.

## 10. Implement

- `/` now renders Home inside `PublicFrame` (route `''` with a child), with a `publicTexts` canMatch loading the frame's texts on the server; the browser still moves `/` to `/<lang>`.
- The frame's top bar `<div class="top">` → `<header class="top">`, same class, no style change.
- `npx jest -c apps/web/jest.config.cts apps/web/src/app`: 883 passed.

## 12. Harden

- artifact-lint --check: 0 errors, 0 warnings. diff-audit: no finding in this diff's files (its other findings are generated `libs/data-access` files outside this change).
- trace-matrix shows FR-001/FR-002 untagged: the project rule keeps FR ids out of test source; the mapping is tasks.md (T001, T002).
- Mutation: not run locally (AGENTS.md: mutation runs only in CI, nightly on main).
- test-adversary dispatched.

## 16. Retrospective evidence

- `retro-evidence.mjs --since a55fa6e`: 2 commits (docs spec, fix); 10 carried-over open items from earlier features, none touching this change. Jev lane unavailable (no key). Verdict left to the owner.
- test-adversary: 3 tests, all passing. Folded 2 into `addresses.spec.ts` as one `it.each` (`/ro/garages` and `/ro/no-such-page`: one main, never nested), because they add evidence about the shared frame and the not-found page. Dropped its server-side `/` test because it repeated the existing one; kept its one extra assertion by tightening the helper to exactly one frame banner. Separate adversary file not kept (Principle I: same setup helpers twice). `addresses.spec.ts`: 20 passed.

## 14. Review

- spec-reviewer: APPROVE. FR-001, FR-002 and SC-001 verified; constitution I–VI hold.
  - LOW: `publicTexts` also runs in the browser before the redirect. Fixed by rewording the comment at `addresses.ts` to cover both cases (the load is shared with `/<lang>`).
  - Note: ST-458 is the same finding. After the merge, close it in Notion as a duplicate, with a comment pointing to ST-454 and #115.
- code-reviewer: APPROVE. MEDIUM (deferred, `deferred.md`): the axe loader is now in four e2e specs; a shared `apps/web-e2e/src/axe.ts` is the fix. LOW (patched): the two server tests in `addresses.spec.ts` share a `serverSetUp()`; the `''` route's comment says why `toLanguageAddress` comes first. 20/20 in `addresses.spec.ts` after the patch.
