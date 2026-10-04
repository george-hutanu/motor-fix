# Auto run — 286-phone-layout

Description: ST-286 — Set up the shared phone layout rules: the shared phone layout rules every screen uses, plus the installable web app's manifest and service worker (ST-196 Web Push extends that service worker later), built on the merged Cockpit theme in libs/ui-cockpit. Notion story: https://app.notion.com/p/3ee607bff0d281df9a9ef85c0725362c. Spec folder and branch: 286-phone-layout.

Start: `origin/main` at c03d7691461e9a621824af549485dbd8507aba60 (fast-forward from 1888f48 after the orchestrator's resume message: ST-17, ST-19, ST-50 merged), branch `286-phone-layout`, worktree agent-a3d811b135b59fad9.

## Preflight
- Tree clean. `npm install` re-run under heavy.sh after the merge (package.json changed); install scripts skipped, so `prisma generate`, `husky` and `identity.sh apply` were run by hand.
- `npm run typecheck` green, `npm run lint` green, `npm run test` green (10 projects), all through heavy.sh.
- spec-drift: no active feature before this run.
- Heavy commands run through the orchestrator's heavy.sh (16 GB laptop rule).

## Phase 0 — Size
- Level 2: CSS rules, a service, a dependency and a build change across a lib and the app.

## Phase 1 — Constitution
- v1.4.0 read; no placeholders. Principle VII (autonomous PR lifecycle) applies: draft PR at the first push.

## Phase 2 — Specify
- Feature dir forced to `specs/286-phone-layout` (`create_new_feature.py --number 286`). 11 FRs, 4 user stories.
- after_specify: notion-sync start (story To do → In progress, timeline Not started → In progress, epic unchanged); design-check wrote design.md (11 mobile boards read from the mock files; index page itself renders only "Loading…").

## Phase 3 — Org context
- org-researcher had no Notion tools in its session (`[UNAVAILABLE: notion — subagent]`); context.md written by the main run from the pages it read with the connector (story, epic, ST-285, ST-196, timeline row). `query-data-sources` hit the workspace usage limit; the timeline row was found by search instead.

## Phase 4 — Clarify (spec-challenger + context)
- Text zoom 200 % → doubled type tokens and body size at 375 px (no automation exposes text-only zoom).
- Every route → `/`, `/cockpit`, three dashboard frames with a stubbed session.
- Server layout → `phone`; first paint comes from CSS media queries.
- Secondary columns → every column not main/key, only in tables naming a main column.
- Navigations → `freshness` (server first, shell offline).
- Challenger #1 standalone link = not inside `p`/`li`; #2 row side by side (mock); #3 media-query driven signal; #4 SC-003 on the production build, install heuristic not asserted; #5 theme colour = `--mf-bg`; #6 bar adds its own edge's inset; #8 delta moved to a new `phone-layout` capability.

## Phase 5 — Plan
- `@angular/service-worker` 22.2.1 added (exact; only new dependency; Complexity Tracking). Theme-color tags from `provideCockpitTheme()` to respect the colour-literal check. T4 (PWA) is decided in Notion (A19).

## Phase 6 — Checklist
- requirements.md all satisfied.

## Phase 7 — Tasks
- 18 tasks; FR → test table in tasks.md.

## Phase 8 — Analyze
- artifact-lint: 0 errors, 0 warnings (Jev lane unavailable: no key). `capabilities validate`: merges cleanly into the new `phone-layout` capability.

## Phase 9 — Tests (red)
- New/extended suites: cockpit.css.spec (phone rules), helm/table.spec, layout.spec, provide-cockpit-theme.spec, apps/web pwa.spec; e2e phone.spec, pwa.spec.
- Red: `npx jest --maxWorkers=2 <the 5 files>` → Test Suites: 5 failed, 5 total; Tests: 3 failed, 1 passed (3 suites failed to load: no layout.ts, no manifest/ngsw config).

## Phase 10 — Implement
- Biome breaks long selectors over lines → the CSS spec compares selectors flattened.
- `npx jest --maxWorkers=2 apps/web libs/ui-cockpit` → 18 suites, 186 tests passed.
- Production build OK; `ngsw.json` index is `/index.csr.html`; SSR head carries both `theme-color` tags. Warning: initial bundle 578.98 kB > 500 kB warning budget (error at 1 MB); it was already over (546 kB at ST-50).
- E2E against the production server (`APP_ENV=test PORT=4286 node dist/apps/web/server/server.mjs`, `BASE_URL=http://localhost:4286`, `--workers=2`): 42 passed, 1 failed — `skeleton.spec` "shows the release and both checks" needs the API with PostgreSQL/Redis, not running locally (unrelated; it runs on staging). All 19 phone.spec tests, the pwa test and the existing specs passed with service workers blocked.
- `npm run typecheck` (12 projects), `npm run lint`, `npm run test` (10 projects): green.
- Commits: ui-cockpit slice, then web slice.

## Draft PR
- Pushed, draft PR #22. The PR-template check failed on the first body (template from #17 on main); body rewritten to the template, title `feat(web): ST-286 …`; checks green on the draft.

## Phase 11 — Converge
- Every FR has code and a test; nothing unbuilt.

## Phase 12 — Harden
- diff-audit (stale local `main` base): `import-extension` ERRORs are the lib's `bundler` resolution (same as ST-50, kept); `new-dependency` `@angular/service-worker` justified in Complexity Tracking; `BREAKPOINTS` test-only export kept (ties the CSS query to the signal).
- test-adversary: `libs/ui-cockpit/src/phone.adversary.spec.ts` (22) and `apps/web/src/pwa.adversary.spec.ts` (25). Two real defects: (a) the CSS phone query `max-width: 767.98px` and the signal's `min-width: 768px` disagreed between 767.98 and 768 px → CSS now `@media not all and (min-width: 768px)`; (b) a row header (`th` in a body) with no role stayed visible → hidden with the cells.
- Mutation: not run locally (owner's rule: never on this laptop); the nightly mutation workflow covers it.

## Phase 14 — Review
- spec-reviewer BLOCK: HIGH fractional-width disagreement (fixed above); LOW `/media/**` glob (kept: the build emits the self-hosted fonts there — recorded in Assumptions), plan line about `BREAKPOINTS` export (plan corrected), manifest `lang`/`scope` (recorded in Assumptions).
- code-reviewer APPROVE: MEDIUM pwa e2e cannot pass on the dev server (now runs only with `BASE_URL`, as the release pipeline does); MEDIUM duplicated sign-in stub (shared `apps/web-e2e/src/sign-in.ts`); LOW default `registrationStrategy` (dropped); LOW link rule specificity (`:where(a:not(:where(p, li) a))`); LOW duplicate regex helper (one `ruleIn`).
- Re-verified: production build; e2e 42 passed / 1 unrelated (`skeleton.spec`, needs the API); `npm run typecheck`, `npm run lint`, `npm run test` green; 20 suites / 231 tests in apps/web + ui-cockpit.
- spec-reviewer re-review APPROVE; its two LOWs fixed (two padding tests dropped, one adversary title corrected). Ticket refresh: story unchanged since 2026-10-03, no comments. Agent context: CLAUDE.local.md not changed (tracked, shared by the lanes). Archive: after merge, as the earlier features did.
