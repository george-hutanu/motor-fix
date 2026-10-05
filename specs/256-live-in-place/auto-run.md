# Auto run — 256-live-in-place

- Description: ST-256 See live updates in place without losing my work (Notion https://app.notion.com/p/3ee607bff0d281a39af4f03b587eb2ae, EP-1 Foundations)
- Start commit: 86017d0 (origin/main)

## Preflight
- Story picked: ST-256 and ST-199 both High, Ready to work, To do, every Blocked by Merged; ST-256 chosen as it is on the critical path and starts earlier on the Foundations timeline (W7, 10 Nov vs 20 Nov). ST-200 has PR #78, ST-127 is in QA. (autonomous default)
- Tree clean; branch 256-live-in-place made from origin/main 86017d0 (the worktree was behind). The base is the merge of PR #77, whose CI ran typecheck, lint and every test green; `.husky/pre-commit` re-runs them on the first real commit.
- Constitution v1.6.1 read; no placeholders.
- Dependencies installed in this worktree (`npm ci` through heavy.sh): it had no node_modules and resolved the main checkout's older ones, so the first pre-commit run failed to load 23 suites. With them, `.husky/pre-commit` (typecheck, lint, test) passed on the start commit 471825f.
- Draft PR #79 opened from the template; story PR property written.

## Size
- Level 1 (one-session), as ST-257 and ST-254: front-end rules in `apps/web/src/app/dashboard/` plus the frame's test update. Phases 2, 7, 9, 10, 12, 14, 16, 17. (autonomous default)

## Specify
- Spec from the story's Build brief (wins over the criteria above it); 5 clarifications self-answered (spec.md Clarifications), 5 assumptions marked (autonomous default).
- design.md: mock read through a subagent (DashClient.dc.html, Overlays.dc.html). The mock pops a new row in (420 ms) and has no highlight, pill or aria-live; the brief's 1 s highlight and polite announcement win.
- Decision: the ST-253 test toast is replaced by a status line under each dashboard's header that changes in place, because the brief rules "Live updates do not raise toasts on their own". The text the e2e suite looks for is unchanged. (autonomous default)
- Decision: the library stays in apps/web beside `Live` (it depends on the app's Session); no new Nx lib. (autonomous default)

## Tasks
- tasks.md: 7 tasks in 2 phases.

## Tests (red first)
- `npx jest apps/web/src/app/dashboard/live-in-place.spec.ts apps/web/src/app/dashboard/live.spec.ts apps/web/src/app/dashboard/frame.spec.ts`: 3 suites failed (no `./live-in-place`), 14 tests failed, 37 passed, before any code.

## Implement
- `npx jest apps/web libs/ui-cockpit libs/overlays libs/i18n`: 92 suites, 1817 tests passed. `nx run-many -t typecheck -p web web-e2e`: green. Biome: 3 warnings, all pre-existing (`!important` in the reduced-motion reset, one in another file).
- The kit's motion specs pin the token set and keyframe count, and require keyframes to move only opacity or transform. So the highlight is an amber-tint `::after` whose opacity fades over the new token `--mf-motion-flash: 1s`, and both pins were raised by one.
- The Romanian "S‑a" uses U+2011 (the i18n check).
- End-to-end: not run locally (it boots API, worker, web and the databases); CI's E2E job runs it.

## Harden
- artifact-lint: 0 errors after two fixes (T007 named both shell files; the Spec Delta block in the capabilities format: Modifies 253-FR-015 → FR-011, 257-FR-009 → FR-002, 257-FR-010 → FR-012, FR-012 added). `capabilities.mjs validate`: merges cleanly.
- diff-audit on this change's files: 3 dead exports (the return-type interfaces, now unexported); the `@ts-expect-error` in live.spec.ts is ST-257's, on main already; test-only-export warnings on the helpers are expected (no live list, form or drawer exists in EP-1).
- Mutation testing: CI only (AGENTS.md).

## Review (lap 1 of 5)
- code-reviewer BLOCK: HIGH a re-read that fails after the view is destroyed left a 60 s timer (guard in `failed`, test proven to fail without it). MEDIUM `:where()` for the highlight's `position: relative`; the highlight's 1 s lived twice (timer removed, the class leaves on `animationend`); the unexported interfaces. LOW 404 read through `HttpErrorResponse`; the anchor's per-scroll scan loops without copying; the pill looks only in its own container; the duplicate test helper folded into the other.
- code-reviewer MEDIUM decision (helpers with no caller): kept (option A). The Build brief scopes "the front-end rules in the shared live library" to this story, and FR-006–FR-008 are its requirements; the first callers are ST-199 (the bell's list) and later screens. Recorded for the owner. (autonomous default)
- spec-reviewer BLOCK: HIGH the spec said the two brief e2e checks were deferred, but no deferred.md existed (written; filed as Notion tasks); MEDIUM the gone/changed texts are not shown by any screen yet (deferred, filed); LOW the dialog label in the assumption corrected; the pill's scope; the destroy timer.
