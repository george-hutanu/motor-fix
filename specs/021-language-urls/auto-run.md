# Auto run — 021-language-urls

- Description: ST-21 — Give each language its own web address for search engines (see spec.md Input).
- Start commit: e68eb58 (origin/main, contains ST-17 00e17ad). Branch 021-language-urls, worktree agent-a831fafc074f0c500.
- Draft PR: https://github.com/george-hutanu/motor-fix/pull/24 (merge freeze until the orchestrator reports PR #21 merged).

## 0 Size
- Level 2 (feature): intent needs settling (`/` redirect vs ST-17, URL vs remembered choice).

## Preflight
- Clean tree; `heavy.sh npm run typecheck` green; `npm run lint` green; `npm run test:unit -- --maxWorkers=2` 10 projects green. Integration tests not run (need PostgreSQL/Redis; this change touches no API).

## 1 Constitution
- v1.4.0 read; no placeholders. Principle I and VII carried.

## 2 Specify
- Feature dir created with `create_new_feature.py --number 21 --allow-existing-branch` (orchestrator: folder MUST be 021-language-urls).
- Autonomous: `/` rendered (no 302) — brief scenario 2 vs 016-FR-011 + ST-17 reopen e2e; the address wins and is remembered (MF-1 edge case "English, and the choice is remembered (proposed)"); no placeholder pages (Principle I); data-backed sitemap rules → EP-4; cockpit noindex; no cache layer.
- Notion start sync: ST-21 To do → In progress; timeline row Not started → In progress; EP-1 unchanged (In progress).
- design.md: mock read returned only the canvas loader → UNAVAILABLE noted; story has no board of its own.

## 3 Context
- org-researcher cannot reach this session's Notion connector (orchestrator); main session read ST-21, MF-1, EP-1 read-only; context.md written. 1 contradiction (`/` 302) → spec Assumptions.

## 4 Clarify
- spec-challenger: 6 findings, all answered with its recommendation: (1) `/` 200 + canonical /ro/; (2) `/en` or `/en/`, tests `^/en/?$`; (3) direct /en/ propagates to other tabs, new US1 AS4; (4) 404 status only for server-rendered addresses, not /app/; (5) PUBLIC_WEB_URL required by readEnv in deployed server, request origin is the dev fallback; (6) query/fragment kept, 404 under a known prefix switches in place.

## 5 Plan
- plan.md: Technical Context from package.json; SITE_ORIGIN token and `/` rendered in Complexity Tracking.

## 6 Checklist
- checklists/requirements.md: 9/9 checked.

## 7–8 Tasks / Analyze
- tasks.md T001–T017; artifact-lint clean (after fixing the Modifies format: `016-FR-011` → `FR-002`).

## 9 Tests (red first)
- New/extended specs: libs/i18n/src/switch.spec.ts (saved), apps/web/src/app/addresses.spec.ts, apps/web/src/app/not-found/not-found.spec.ts, apps/web/src/server/search.spec.ts.
- Red: `npx jest --maxWorkers=2 <4 files>` → 4 suites failed (3 modules missing), 3 tests failed, 12 passed (the existing switch tests).

## 10 Implement
- `LanguageChoice.saved()`, `isLanguage` exported; `addresses.ts` (guards, effect, head tags, alternates, PUBLIC_PATHS, SITE_ORIGIN); `not-found.ts` (RESPONSE_INIT 404); `search.ts` (sitemap, robots, /app X-Robots-Tag); routes, app.config(.server), server.ts lines.
- Green: the 4 files 37/37; `nx run-many -t test -p web i18n` green.
- e2e (built SSR on :4221, APP_ENV=test, PUBLIC_WEB_URL=http://localhost:4221, no API, one bounded script): 30 passed, 1 failed — skeleton "release and both checks" needs the API/DB (environment, same as ST-17's run). New addresses.spec 7/7, language.spec 3/3, dashboards.spec 7/7, cockpit 12/12.
- Existing e2e changed with the behaviour: language.spec blocked-storage reopen uses `goto('/')` (the address now keeps English on reload); dashboards.spec signed-out landing `/ro`.
- `npm run typecheck` 12 projects green; `npm run lint` clean (238 files); `npm run test:unit -- --maxWorkers=2` 10 projects green.
