# /speckit-auto run — 421-monorepo-platform

- Description: ST-421 — The Nx monorepo, staging and production on Railway, and the release pipeline (EP-1 Foundations, slice 1, first story). Notion story: https://app.notion.com/p/3ee607bff0d2815a8fede068cbfbad58.
- Start: branch `main`, commit `69b1c22c1dd8b6ad24a1928577fe4b0f8578c658`, 2026-10-03.

## Preflight
- Tree clean. `npm run typecheck` (placeholder) and `npm run lint` green; `npm test` → harness: 19 files, 350 passed, 1 skipped.
- `npx jest` as written in the skill fails 19/19: no Jest is installed, and npx fetched one that tried to run the harness's vitest ESM specs. Not a red start; the repo's suite is `npm test`. (autonomous decision, evidence: package.json scripts.test)
- Constitution v1.1.0, no placeholders. Spec-drift: no active feature.

## 0. Size
- Level 2 (feature): the outcome is fixed but the plan has choices (Nx layout, CI, Railway wiring).

## 2. Specify
- Branch `421-monorepo-platform` from the user's name (GIT_BRANCH_NAME).
- `specs/` is NOT git-excluded in this repo (`.git/info/exclude` has no specs/.specify/.claude entry; `.claude/` is tracked). Artifacts are committable. Decision: commit the artifacts once, after phase 8, as `docs(specs): …`, and stage spec.md/tasks.md with each feat slice as spec-drift requires.
- Story fetched with discussions: no comments. The Build brief is the main source.
- Clarification table: one open item (domains) → Railway's own addresses, from the Build brief's Open section.
- after_specify hooks: notion-sync start (done), design-check (done, no screens), git commit (deferred to after phase 8, see above), agent-context update (deferred to phase 15, where it runs anyway).

## 3. Notion context
- org-researcher: 21 findings (5 decisions, 8 constraints, 4 open, 1 contradiction, 7 proposed clarifications). Backend architecture read through search excerpts only (page too large to fetch).

## 4. Clarify (5 questions, spec-challenger findings matched the digest)
- Q1 How does the skeleton page reach the API's status / does web forward /health/? → web forwards /api/ only; SSR page calls API /health/ready at API_INTERNAL_URL (FR-019, FR-020).
- Q2 Older commit's production approval when a newer one passes staging? → cancelled; staging serialized in commit order (FR-030).
- Q3 Staging health wait? → 5 minutes, then fail (FR-028).
- Q4 Required variables per app? → listed in FR-021; RELEASE_SHA defaults to dev.
- Q5 mcp health? → /health/live only (FR-012, US3-1).
- Also applied from context.md: Prisma and A28 marked "proposed, confirmed in the plan"; backwards-compatible migrations in the api pre-deploy command (FR-028). Versions are left to the plan (current LTS, read from npm at plan time).

## 5. Plan
- before_plan: design-check → design.md current (written 2026-10-04, story unchanged since).
- Versions from npm 2026-10-04: Node 24 LTS, TS ~6.0 (TS 7 excluded by Angular peers), Nx 23.2.1, Angular 22.2.1, NestJS 12, Prisma 7.10.0 (8 is rc).
- No Docker on this machine → decision: install postgresql@17 and redis with Homebrew for local real-server tests; docker-compose.yml still written for the team (R9).
- Railway: deploy by GraphQL (serviceInstanceUpdate + serviceInstanceDeployV2), research agent report; digest refs and preDeployCommand on image services unconfirmed → checked by hand on first deploy.
- Spec edit: FR-032 one root Dockerfile with an APP build argument (Principle I).
- Constitution Check: all pass; Complexity Tracking: empty schema files, railway-deploy.mjs.

## 6. Checklist
- checklists/platform.md: 15 items; 4 failed and were fixed in spec.md (US3-3 503 shape, FR-014 measurable, production migration edge case, FR-034 by-hand checks). 15/15.

## 7. Tasks
- 38 tasks in 9 phases. T007 changed from a project-graph spec to a Biome noRestrictedImports override (Principle I).

## 8. Analyze
- artifact-lint round 1: 3 ERROR (FR-007/008/009 untasked — ranges "FR-006–FR-010" not parsed), 1 WARN (no Spec Delta). Fixed: FRs listed explicitly in T017/T018; Spec Delta added (capability `platform`, Adds FR-001…FR-034); `.specify/capabilities/platform.md` created from the template (empty requirements; archive fills them).
- Round 2: 0 errors, 0 warnings. Manual passes: 0 CRITICAL, 0 HIGH; 100% FR coverage; context contradiction resolved by Q1.

## 9. Tests (red-first)
- Phase 1 scaffold done first so tests have projects to live in: Nx 23.2.1 generators (`--linter none`), generator samples deleted; webpack configs renamed `.cjs` (root package is `"type": "module"`).
- Dependency decisions: generators pinned Angular ~22.1 / Nest 11 / Express 4 → reset to plan versions. `@nx/nest@23.2.1` peers Nest `<12` → removed `@nx/nest` and `@nestjs/schematics` (generators only; builds use @nx/webpack), Nest 12 kept. `npm audit --omit=dev` found 4 high in Prisma CLI transitive deps (mysql2, deepmerge-ts) → npm `overrides` mysql2 3.24.5, deepmerge-ts 8.0.2 → 0 vulnerabilities. Dev-tool highs (Nx, webpack-dev-server) remain; the CI audit is scoped to production dependencies (FR-027 wording updated).
- Homebrew postgresql@17 and redis installed and started (research R9).
- Red: `npx jest libs/contracts libs/domain apps/api apps/mcp apps/web/src` → Test Suites: 7 failed, 7 total (missing modules; seed: 2 tests failed).
- Seams chosen for testability: readEnv(required, env); HealthModule.register({databaseUrl, redisUrl, version}); configureApp(app, env) + AppModule.register(env); mcp createServer(); web mountEdge(app, apiUrl); page reads TransferState key HEALTH. Added state "unknown" when the API did not answer (FR-019 updated).
