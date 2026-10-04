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
